using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using FreelanceTn.Api.Configuration;
using FreelanceTn.Api.Exceptions;

namespace FreelanceTn.Api.Services;

/// <summary>Transaction telle que lue sur le réseau Ethereum actif (lecture seule).</summary>
public sealed record EthereumTransactionInfo(
    string Hash,
    string From,
    string? To,
    string ValueHex,
    long? BlockNumber);

/// <summary>Reçu d'exécution du réseau Ethereum actif (lecture seule).</summary>
public sealed record EthereumReceiptInfo(bool Success, long BlockNumber);

/// <summary>
/// En-tête de bloc minimal (lecture seule). L'empreinte Genesis sert à
/// identifier l'instance de chaîne : Hardhat Local étant éphémère, un même
/// hash de transaction peut exister sur deux instances distinctes.
/// </summary>
public sealed record EthereumBlockInfo(string Hash, long Timestamp, long Number);

/// <summary>
/// Client JSON-RPC minimal pour le réseau Ethereum actif (Sepolia ou Hardhat
/// local). Aucune dépendance externe, aucune clé privée : uniquement les
/// lectures nécessaires à la vérification d'un paiement (<c>eth_chainId</c>,
/// <c>eth_getTransactionByHash</c>, <c>eth_getTransactionReceipt</c>,
/// <c>eth_blockNumber</c>).
/// </summary>
public sealed class EthereumRpcClient
{
    private readonly HttpClient _http;
    private readonly BlockchainSettings _settings;
    private readonly ILogger<EthereumRpcClient> _logger;

    public EthereumRpcClient(
        HttpClient http,
        BlockchainSettings settings,
        ILogger<EthereumRpcClient> logger)
    {
        _http = http;
        _settings = settings;
        _logger = logger;
    }

    private string NetworkLabel => _settings.ActiveNetworkName;

    /// <summary>Chaîne réellement servie par le nœud (garde réseau).</summary>
    public async Task<long> GetChainIdAsync(CancellationToken cancellationToken)
    {
        var result = await CallAsync("eth_chainId", [], cancellationToken);
        return ParseHexLong(result.GetString());
    }

    public async Task<long> GetBlockNumberAsync(CancellationToken cancellationToken)
    {
        var result = await CallAsync("eth_blockNumber", [], cancellationToken);
        return ParseHexLong(result.GetString());
    }

    /// <summary>
    /// Solde réel d'une adresse, en wei (chaîne décimale). Lecture seule sur le
    /// nœud du réseau actif : aucune valeur n'est déduite de la base locale.
    /// </summary>
    public async Task<string> GetBalanceWeiAsync(string address, CancellationToken cancellationToken)
    {
        var result = await CallAsync("eth_getBalance", [address, "latest"], cancellationToken);
        var hex = result.ValueKind == JsonValueKind.String ? result.GetString() : null;
        if (string.IsNullOrWhiteSpace(hex)
            || !hex.StartsWith("0x", StringComparison.OrdinalIgnoreCase)
            || hex.Length <= 2
            || !System.Numerics.BigInteger.TryParse(
                hex[2..],
                NumberStyles.HexNumber,
                CultureInfo.InvariantCulture,
                out var wei))
        {
            throw new PaymentGatewayException(
                $"Le nœud {NetworkLabel} a renvoyé un solde illisible : aucune vérification fiable n'est possible.");
        }

        return wei.ToString(CultureInfo.InvariantCulture);
    }

    public async Task<EthereumTransactionInfo?> GetTransactionAsync(
        string txHash,
        CancellationToken cancellationToken)
    {
        var result = await CallAsync("eth_getTransactionByHash", [txHash], cancellationToken);
        if (result.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        var hash = result.TryGetProperty("hash", out var hashElement)
            ? hashElement.GetString() ?? txHash
            : txHash;
        var from = result.TryGetProperty("from", out var fromElement)
            ? fromElement.GetString() ?? string.Empty
            : string.Empty;
        var to = result.TryGetProperty("to", out var toElement) && toElement.ValueKind == JsonValueKind.String
            ? toElement.GetString()
            : null;
        var value = result.TryGetProperty("value", out var valueElement)
            ? valueElement.GetString() ?? "0x0"
            : "0x0";
        long? blockNumber = result.TryGetProperty("blockNumber", out var blockElement)
            && blockElement.ValueKind == JsonValueKind.String
            ? ParseHexLong(blockElement.GetString())
            : null;

        return new EthereumTransactionInfo(hash, from, to, value, blockNumber);
    }

    public async Task<EthereumReceiptInfo?> GetReceiptAsync(
        string txHash,
        CancellationToken cancellationToken)
    {        var result = await CallAsync("eth_getTransactionReceipt", [txHash], cancellationToken);
        if (result.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        var status = result.TryGetProperty("status", out var statusElement)
            ? statusElement.GetString()
            : null;
        if (!result.TryGetProperty("blockNumber", out var blockElement)
            || blockElement.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        var blockNumber = ParseHexLong(blockElement.GetString());
        return new EthereumReceiptInfo(
            string.Equals(status, "0x1", StringComparison.OrdinalIgnoreCase),
            blockNumber);
    }

    /// <summary>
    /// En-tête d'un bloc par numéro. Retourne <c>null</c> si le nœud ne fournit
    /// pas de hash exploitable : l'appelant doit alors refuser la vérification.
    /// </summary>
    public async Task<EthereumBlockInfo?> GetBlockAsync(
        long blockNumber,
        CancellationToken cancellationToken)
    {
        var result = await CallAsync(
            "eth_getBlockByNumber",
            [$"0x{blockNumber:x}", false],
            cancellationToken);

        if (result.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        var hash = result.TryGetProperty("hash", out var hashElement)
            && hashElement.ValueKind == JsonValueKind.String
            ? hashElement.GetString()
            : null;
        if (string.IsNullOrWhiteSpace(hash))
        {
            return null;
        }

        var timestamp = result.TryGetProperty("timestamp", out var timestampElement)
            && timestampElement.ValueKind == JsonValueKind.String
            ? ParseHexLong(timestampElement.GetString())
            : 0L;

        var number = result.TryGetProperty("number", out var numberElement)
            && numberElement.ValueKind == JsonValueKind.String
            ? ParseHexLong(numberElement.GetString())
            : blockNumber;

        return new EthereumBlockInfo(hash.Trim().ToLowerInvariant(), timestamp, number);
    }

    /// <summary>Empreinte du bloc Genesis de l'instance servie par le nœud.</summary>
    public Task<EthereumBlockInfo?> GetGenesisAsync(CancellationToken cancellationToken) =>
        GetBlockAsync(0, cancellationToken);

    private async Task<JsonElement> CallAsync(
        string method,
        object[] parameters,
        CancellationToken cancellationToken)
    {
        var payload = new
        {
            jsonrpc = "2.0",
            id = 1,
            method,
            @params = parameters,
        };

        try
        {
            using var response = await _http.PostAsJsonAsync(_settings.ActiveRpcUrl, payload, cancellationToken);
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                throw new PaymentGatewayException(
                    $"Le nœud {NetworkLabel} a répondu HTTP {(int)response.StatusCode}. " +
                    "La vérification est momentanément indisponible, aucun montant n'a été appliqué.");
            }

            using var document = JsonDocument.Parse(body);
            var root = document.RootElement;
            if (root.TryGetProperty("error", out var error))
            {
                var message = error.TryGetProperty("message", out var messageElement)
                    ? messageElement.GetString()
                    : "erreur RPC inconnue";
                throw new PaymentGatewayException(
                    $"Le nœud {NetworkLabel} a refusé la requête ({message}). Aucun montant n'a été appliqué.");
            }

            if (!root.TryGetProperty("result", out var result))
            {
                throw new PaymentGatewayException(
                    $"Réponse RPC {NetworkLabel} invalide : champ « result » absent. " +
                    "Aucun montant n'a été appliqué.");
            }

            return result.Clone();
        }
        catch (PaymentGatewayException)
        {
            throw;
        }
        catch (TaskCanceledException exception) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning(exception, "Délai dépassé lors de l'appel RPC {Network} ({Method}).", NetworkLabel, method);
            throw new PaymentGatewayException(
                $"Le nœud {NetworkLabel} ne répond pas dans le délai imparti. Aucun montant n'a été appliqué.",
                exception);
        }
        catch (HttpRequestException exception)
        {
            _logger.LogWarning(exception, "Nœud {Network} injoignable lors de l'appel {Method}.", NetworkLabel, method);
            throw new PaymentGatewayException(
                $"Le nœud {NetworkLabel} est injoignable. Aucun montant n'a été appliqué.",
                exception);
        }
    }

    private static long ParseHexLong(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return 0;
        }

        var hex = value.StartsWith("0x", StringComparison.OrdinalIgnoreCase)
            ? value[2..]
            : value;
        if (hex.Length == 0)
        {
            return 0;
        }

        return long.TryParse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : 0;
    }
}
