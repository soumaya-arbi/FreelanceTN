using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using FreelanceTn.Api.Configuration;
using FreelanceTn.Api.Exceptions;

namespace FreelanceTn.Api.Services;

/// <summary>
/// Client HTTP officiel Konnect (Sandbox uniquement).
///
/// - l'initialisation d'un paiement se fait exclusivement côté serveur ;
/// - seules les réponses de <c>GET /payments/:id</c> font foi ;
/// - la clé API n'est jamais exposée au frontend ni journalisée.
/// </summary>
public sealed class KonnectPaymentClient
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly HttpClient _http;
    private readonly KonnectSettings _settings;
    private readonly ILogger<KonnectPaymentClient> _logger;

    public KonnectPaymentClient(
        HttpClient http,
        KonnectSettings settings,
        ILogger<KonnectPaymentClient> logger)
    {
        _settings = settings;
        _settings.EnsureSandboxOnly();
        _http = http;
        _logger = logger;
    }

    /// <summary>
    /// Crée un paiement chez Konnect et retourne l'URL hébergée ainsi que la
    /// référence fournisseur. Le montant est exprimé en millimes.
    /// </summary>
    public async Task<KonnectInitPaymentResult> InitPaymentAsync(
        KonnectInitPaymentRequest request,
        CancellationToken cancellationToken)
    {
        EnsureConfigured();

        HttpResponseMessage response;
        string body;
        try
        {
            response = await _http.PostAsJsonAsync("payments/init-payment", request, JsonOptions, cancellationToken);
            body = await response.Content.ReadAsStringAsync(cancellationToken);
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new PaymentGatewayException(
                "La passerelle Konnect Sandbox n'a pas répondu dans le délai imparti. Aucun montant n'a été engagé.");
        }
        catch (HttpRequestException exception)
        {
            _logger.LogWarning(exception, "Konnect Sandbox injoignable lors de l'initialisation du paiement.");
            throw new PaymentGatewayException(
                "La passerelle Konnect Sandbox est injoignable. Aucun montant n'a été engagé.", exception);
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "Konnect a refusé l'initialisation ({StatusCode}): {Body}",
                    (int)response.StatusCode,
                    Truncate(body));
                throw BuildHttpError("initialiser le paiement", response.StatusCode);
            }

            KonnectInitPaymentResponse? payload;
            try
            {
                payload = JsonSerializer.Deserialize<KonnectInitPaymentResponse>(body, JsonOptions);
            }
            catch (JsonException exception)
            {
                _logger.LogWarning(exception, "Réponse d'initialisation Konnect illisible.");
                throw new PaymentGatewayException(
                    "La passerelle Konnect Sandbox a renvoyé une réponse illisible. Aucun montant n'a été engagé.", exception);
            }

            if (payload == null
                || string.IsNullOrWhiteSpace(payload.PaymentRef)
                || string.IsNullOrWhiteSpace(payload.PayUrl))
            {
                throw new PaymentGatewayException(
                    "La passerelle Konnect Sandbox n'a pas fourni d'URL de paiement. Aucun montant n'a été engagé.");
            }

            // Défense en profondeur : le navigateur ne doit être redirigé que
            // vers une page hébergée officielle Konnect en HTTPS.
            if (!Uri.TryCreate(payload.PayUrl, UriKind.Absolute, out var payUri)
                || !string.Equals(payUri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
                || !(payUri.Host.Equals("konnect.network", StringComparison.OrdinalIgnoreCase)
                     || payUri.Host.EndsWith(".konnect.network", StringComparison.OrdinalIgnoreCase)))
            {
                _logger.LogWarning("URL de paiement Konnect inattendue : {PayUrl}", payload.PayUrl);
                throw new PaymentGatewayException(
                    "La passerelle Konnect Sandbox a renvoyé une URL de paiement non reconnue. Aucun montant n'a été engagé.");
            }

            return new KonnectInitPaymentResult(payload.PayUrl.Trim(), payload.PaymentRef.Trim());
        }
    }

    /// <summary>
    /// Récupère l'état officiel d'un paiement. C'est cette réponse, et elle
    /// seule, qui autorise l'application du montant à la facture.
    /// </summary>
    public async Task<KonnectPaymentDetails> GetPaymentAsync(
        string paymentRef,
        CancellationToken cancellationToken)
    {
        EnsureConfigured();
        if (string.IsNullOrWhiteSpace(paymentRef))
        {
            throw new PaymentGatewayException("Référence de paiement Konnect manquante.");
        }

        HttpResponseMessage response;
        string body;
        try
        {
            response = await _http.GetAsync(
                $"payments/{Uri.EscapeDataString(paymentRef.Trim())}",
                cancellationToken);
            body = await response.Content.ReadAsStringAsync(cancellationToken);
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new PaymentGatewayException(
                "La vérification du paiement Konnect a dépassé le délai imparti. Le paiement reste en attente.");
        }
        catch (HttpRequestException exception)
        {
            _logger.LogWarning(exception, "Konnect Sandbox injoignable lors de la vérification du paiement {PaymentRef}.", paymentRef);
            throw new PaymentGatewayException(
                "La vérification du paiement Konnect Sandbox est impossible pour le moment. Le paiement reste en attente.", exception);
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "Konnect a refusé la vérification de {PaymentRef} ({StatusCode}): {Body}",
                    paymentRef,
                    (int)response.StatusCode,
                    Truncate(body));
                throw BuildHttpError("vérifier le paiement", response.StatusCode);
            }

            try
            {
                using var document = JsonDocument.Parse(body);
                var root = document.RootElement;
                // L'API documentée renvoie { "payment": { ... } } ; certaines
                // versions renvoient directement l'objet. Les deux formes sont
                // acceptées sans jamais faire confiance à un autre champ.
                if (root.ValueKind == JsonValueKind.Object
                    && root.TryGetProperty("payment", out var wrapped)
                    && wrapped.ValueKind == JsonValueKind.Object)
                {
                    root = wrapped;
                }

                var details = root.Deserialize<KonnectPaymentDetails>(JsonOptions);
                if (details == null || string.IsNullOrWhiteSpace(details.Status))
                {
                    throw new PaymentGatewayException(
                        "La passerelle Konnect Sandbox a renvoyé un état de paiement incomplet. Le paiement reste en attente.");
                }
                details.Transactions ??= [];
                return details;
            }
            catch (JsonException exception)
            {
                _logger.LogWarning(exception, "Réponse de vérification Konnect illisible pour {PaymentRef}.", paymentRef);
                throw new PaymentGatewayException(
                    "La passerelle Konnect Sandbox a renvoyé une réponse illisible. Le paiement reste en attente.", exception);
            }
        }
    }

    private void EnsureConfigured()
    {
        if (!_settings.IsConfigured)
        {
            throw new PaymentGatewayException(
                "Le paiement par carte est indisponible : la passerelle Konnect Sandbox n'est pas configurée. " +
                "Aucun montant n'a été engagé.");
        }
    }

    private static PaymentGatewayException BuildHttpError(string action, HttpStatusCode status) => status switch
    {
        HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden =>
            new PaymentGatewayException(
                $"Impossible de {action} : la clé API Konnect Sandbox a été refusée ({ (int)status })."),
        HttpStatusCode.NotFound =>
            new PaymentGatewayException(
                $"Impossible de {action} : la référence Konnect est introuvable (404)."),
        HttpStatusCode.TooManyRequests =>
            new PaymentGatewayException(
                $"Impossible de {action} : la passerelle Konnect Sandbox limite temporairement les requêtes (429)."),
        _ => new PaymentGatewayException(
            $"Impossible de {action} : la passerelle Konnect Sandbox a répondu {(int)status}."),
    };

    private static string Truncate(string value) =>
        value.Length <= 400 ? value : value[..400] + "…";
}

public sealed class KonnectInitPaymentRequest
{
    [JsonPropertyName("receiverWalletId")]
    public string ReceiverWalletId { get; set; } = string.Empty;

    [JsonPropertyName("token")]
    public string Token { get; set; } = "TND";

    /// <summary>Montant en millimes (1 TND = 1000 millimes).</summary>
    [JsonPropertyName("amount")]
    public long Amount { get; set; }

    [JsonPropertyName("type")]
    public string Type { get; set; } = "immediate";

    [JsonPropertyName("description")]
    public string Description { get; set; } = string.Empty;

    [JsonPropertyName("acceptedPaymentMethods")]
    public string[] AcceptedPaymentMethods { get; set; } = ["bank_card"];

    [JsonPropertyName("lifespan")]
    public int Lifespan { get; set; } = 15;

    [JsonPropertyName("checkoutForm")]
    public bool CheckoutForm { get; set; }

    [JsonPropertyName("addPaymentFeesToAmount")]
    public bool AddPaymentFeesToAmount { get; set; }

    [JsonPropertyName("firstName")]
    public string? FirstName { get; set; }

    [JsonPropertyName("lastName")]
    public string? LastName { get; set; }

    [JsonPropertyName("phoneNumber")]
    public string? PhoneNumber { get; set; }

    [JsonPropertyName("email")]
    public string? Email { get; set; }

    [JsonPropertyName("orderId")]
    public string? OrderId { get; set; }

    [JsonPropertyName("webhook")]
    public string? Webhook { get; set; }

    [JsonPropertyName("successUrl")]
    public string? SuccessUrl { get; set; }

    [JsonPropertyName("failUrl")]
    public string? FailUrl { get; set; }

    [JsonPropertyName("theme")]
    public string Theme { get; set; } = "light";
}

public sealed class KonnectInitPaymentResponse
{
    [JsonPropertyName("payUrl")]
    public string? PayUrl { get; set; }

    [JsonPropertyName("paymentRef")]
    public string? PaymentRef { get; set; }
}

public sealed record KonnectInitPaymentResult(string PayUrl, string PaymentRef);

public sealed class KonnectPaymentDetails
{
    [JsonPropertyName("id")]
    public string? Id { get; set; }

    [JsonPropertyName("status")]
    public string? Status { get; set; }

    /// <summary>Montant demandé, en millimes.</summary>
    [JsonPropertyName("amount")]
    public long? Amount { get; set; }

    [JsonPropertyName("amountDue")]
    public long? AmountDue { get; set; }

    [JsonPropertyName("reachedAmount")]
    public long? ReachedAmount { get; set; }

    [JsonPropertyName("token")]
    public string? Token { get; set; }

    [JsonPropertyName("type")]
    public string? Type { get; set; }

    [JsonPropertyName("orderId")]
    public string? OrderId { get; set; }

    [JsonPropertyName("transactions")]
    public List<KonnectTransactionDetails> Transactions { get; set; } = [];
}

public sealed class KonnectTransactionDetails
{
    [JsonPropertyName("id")]
    public string? Id { get; set; }

    [JsonPropertyName("status")]
    public string? Status { get; set; }

    /// <summary>Montant de la transaction, en millimes.</summary>
    [JsonPropertyName("amount")]
    public long? Amount { get; set; }

    [JsonPropertyName("token")]
    public string? Token { get; set; }

    [JsonPropertyName("type")]
    public string? Type { get; set; }
}
