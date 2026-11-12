using System.Text;
using System.Net;
using FluentValidation;
using FluentValidation.AspNetCore;
using FreelanceTn.Api.Configuration;
using FreelanceTn.Api.Data;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;

var builder = WebApplication.CreateBuilder(args);

// Alias explicites demandés au déploiement. Ils ont priorité sur les valeurs
// des fichiers appsettings, sans jamais coder d'URL de production en dur.
var frontendBaseUrl = Environment.GetEnvironmentVariable("FRONTEND_BASE_URL");
if (!string.IsNullOrWhiteSpace(frontendBaseUrl))
{
    builder.Configuration["Auth:FrontendBaseUrl"] = frontendBaseUrl.Trim();
}

var appBaseUrl = Environment.GetEnvironmentVariable("APP_BASE_URL");
if (!string.IsNullOrWhiteSpace(appBaseUrl))
{
    builder.Configuration["Auth:AppBaseUrl"] = appBaseUrl.Trim();
}

// Configuration strongly-typed (valeurs fournies par appsettings + variables d'environnement).
builder.Services.Configure<MongoSettings>(builder.Configuration.GetSection(MongoSettings.SectionName));
builder.Services.Configure<JwtSettings>(builder.Configuration.GetSection(JwtSettings.SectionName));
builder.Services.Configure<CorsSettings>(builder.Configuration.GetSection(CorsSettings.SectionName));
builder.Services.Configure<AuthSettings>(builder.Configuration.GetSection(AuthSettings.SectionName));
builder.Services.Configure<KonnectSettings>(builder.Configuration.GetSection(KonnectSettings.SectionName));
builder.Services.Configure<FeedbackWorkerSettings>(builder.Configuration.GetSection(FeedbackWorkerSettings.SectionName));

// Ne traiter les en-têtes transférés que depuis les adresses de reverse proxy
// explicitement configurées (ReverseProxy:KnownProxies:n). Les proxies loopback
// approuvés par ASP.NET Core restent autorisés pour le développement local.
var knownProxyAddresses = builder.Configuration.GetSection("ReverseProxy:KnownProxies").Get<string[]>() ?? [];
var knownProxyIps = new List<IPAddress>();
foreach (var configuredAddress in knownProxyAddresses)
{
    if (!IPAddress.TryParse(configuredAddress, out var proxyAddress))
    {
        throw new InvalidOperationException(
            "ReverseProxy:KnownProxies contient une adresse IP invalide. Configurez uniquement les IPs exactes de vos proxies.");
    }

    knownProxyIps.Add(proxyAddress);
}

builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.ForwardLimit = 1;
    foreach (var proxyAddress in knownProxyIps)
    {
        if (!options.KnownProxies.Contains(proxyAddress))
        {
            options.KnownProxies.Add(proxyAddress);
        }
    }
});

var mongoSettings = builder.Configuration.GetSection(MongoSettings.SectionName).Get<MongoSettings>() ?? new MongoSettings();
var jwtSettings = builder.Configuration.GetSection(JwtSettings.SectionName).Get<JwtSettings>() ?? new JwtSettings();
var corsSettings = builder.Configuration.GetSection(CorsSettings.SectionName).Get<CorsSettings>() ?? new CorsSettings();
var authSettings = builder.Configuration.GetSection(AuthSettings.SectionName).Get<AuthSettings>() ?? new AuthSettings();

// ---------------------------------------------------------------------------
// Passerelle Konnect : Sandbox exclusivement. L'URL est vérifiée au démarrage,
// puis à chaque construction du client HTTP : aucune bascule production n'est
// possible, même par erreur de configuration.
// ---------------------------------------------------------------------------
var konnectSettings = builder.Configuration.GetSection(KonnectSettings.SectionName).Get<KonnectSettings>()
    ?? new KonnectSettings();
konnectSettings.FrontendBaseUrl = authSettings.EffectiveFrontendBaseUrl;
konnectSettings.AppBaseUrl = authSettings.AppBaseUrl;
konnectSettings.EnsureSandboxOnly();

if (konnectSettings.Enabled && !konnectSettings.IsConfigured)
{
    throw new InvalidOperationException(
        "Konnect:Enabled est actif mais la configuration est incomplète. Renseignez Konnect:ApiKey et " +
        "Konnect:ReceiverWalletId via variables d'environnement (Konnect__ApiKey / Konnect__ReceiverWalletId) " +
        "ou User Secrets. Aucune valeur secrète ne doit être versionnée.");
}

builder.Services.AddSingleton(konnectSettings);
builder.Services.AddHttpClient<FreelanceTn.Api.Services.KonnectPaymentClient>(client =>
{
    client.BaseAddress = new Uri(
        konnectSettings.BaseUrl.EndsWith("/", StringComparison.Ordinal)
            ? konnectSettings.BaseUrl
            : konnectSettings.BaseUrl + "/");
    client.Timeout = TimeSpan.FromSeconds(Math.Clamp(konnectSettings.TimeoutSeconds, 5, 120));
    client.DefaultRequestHeaders.Remove("x-api-key");
    if (!string.IsNullOrWhiteSpace(konnectSettings.ApiKey))
    {
        client.DefaultRequestHeaders.Add("x-api-key", konnectSettings.ApiKey);
    }
});

// ---------------------------------------------------------------------------
// Ethereum de test (MetaMask) : Sepolia ou Hardhat local, lecture seule.
// Aucune clé privée n'est stockée. L'URL RPC du réseau actif est vérifiée ici
// puis le chainId est recontrôlé à chaque vérification via eth_chainId.
// ---------------------------------------------------------------------------
var blockchainSettings = builder.Configuration.GetSection(BlockchainSettings.SectionName).Get<BlockchainSettings>()
    ?? new BlockchainSettings();
blockchainSettings.EnsureSupportedNetwork();
builder.Services.AddSingleton(blockchainSettings);
builder.Services.AddHttpClient<FreelanceTn.Api.Services.EthereumRpcClient>(client =>
{
    client.BaseAddress = new Uri(blockchainSettings.ActiveRpcUrl);
    client.Timeout = TimeSpan.FromSeconds(Math.Clamp(blockchainSettings.TimeoutSeconds, 5, 120));
});

// Accès MongoDB (pilote officiel MongoDB.Driver).
builder.Services.AddSingleton<MongoContext>();
builder.Services.AddHttpClient();
builder.Services.AddScoped<FreelanceTn.Api.Services.AuthEmailService>();
builder.Services.AddScoped<FreelanceTn.Api.Services.GoogleAuthService>();

// ---------------------------------------------------------------------------
// Transport e-mail : Auth:Email:Mode = auto | smtp | dev-outbox | none.
// « auto » conserve exactement l'ancien comportement (SMTP dès que Host est
// renseigné). Un mode explicite permet de garder le dossier de développement
// même quand les identifiants SMTP existent.
// ---------------------------------------------------------------------------
var emailSettings = authSettings.Email;
var emailMode = (emailSettings.Mode ?? string.Empty).Trim().ToLowerInvariant();
if (emailMode.Length == 0)
{
    emailMode = EmailSettings.ModeAuto;
}

if (emailMode is not (EmailSettings.ModeAuto or EmailSettings.ModeSmtp
    or EmailSettings.ModeDevOutbox or EmailSettings.ModeNone))
{
    throw new InvalidOperationException(
        $"Auth:Email:Mode = \"{emailMode}\" est invalide. Valeurs acceptées : " +
        $"{EmailSettings.ModeAuto}, {EmailSettings.ModeSmtp}, {EmailSettings.ModeDevOutbox}, {EmailSettings.ModeNone}.");
}

var smtpSelected = emailMode == EmailSettings.ModeSmtp
    || (emailMode == EmailSettings.ModeAuto && !string.IsNullOrWhiteSpace(emailSettings.Host));

if (smtpSelected)
{
    // Refus de démarrer plutôt que d'annoncer un envoi qui échouera : on ne
    // liste QUE les clés manquantes, jamais une valeur (donc jamais le mot de passe).
    var missingSettings = new List<string>();
    if (string.IsNullOrWhiteSpace(emailSettings.Host)) missingSettings.Add("Auth:Email:Host");
    if (emailSettings.Port is <= 0 or > 65535) missingSettings.Add("Auth:Email:Port (1-65535)");
    if (string.IsNullOrWhiteSpace(emailSettings.Username)) missingSettings.Add("Auth:Email:Username");
    if (string.IsNullOrWhiteSpace(emailSettings.Password)) missingSettings.Add("Auth:Email:Password");
    if (string.IsNullOrWhiteSpace(emailSettings.FromAddress)) missingSettings.Add("Auth:Email:FromAddress");
    if (emailSettings.TimeoutSeconds <= 0) missingSettings.Add("Auth:Email:TimeoutSeconds (> 0)");

    if (!string.IsNullOrWhiteSpace(emailSettings.FromAddress)
        && !System.Net.Mail.MailAddress.TryCreate(emailSettings.FromAddress, out _))
    {
        missingSettings.Add("Auth:Email:FromAddress (adresse invalide)");
    }

    if (missingSettings.Count > 0)
    {
        throw new InvalidOperationException(
            "Configuration SMTP incomplète (Auth:Email:Mode=smtp). Renseignez via User Secrets ou " +
            "variables d'environnement : " + string.Join(", ", missingSettings) + ".");
    }
}

if (emailMode == EmailSettings.ModeDevOutbox && !builder.Environment.IsDevelopment())
{
    throw new InvalidOperationException(
        "Auth:Email:Mode=dev-outbox est réservé au développement : aucun e-mail réel ne serait envoyé.");
}

if (smtpSelected)
{
    builder.Services.AddScoped<FreelanceTn.Api.Services.IEmailSender, FreelanceTn.Api.Services.SmtpEmailSender>();
}
else if (emailMode != EmailSettings.ModeNone && builder.Environment.IsDevelopment())
{
    builder.Services.AddScoped<FreelanceTn.Api.Services.IEmailSender, FreelanceTn.Api.Services.FileEmailSender>();
}
else
{
    builder.Services.AddScoped<FreelanceTn.Api.Services.IEmailSender, FreelanceTn.Api.Services.NullEmailSender>();
}
builder.Services.AddDataProtection();
builder.Services.AddScoped<FreelanceTn.Api.Services.AuthService>();
builder.Services.AddScoped<FreelanceTn.Api.Services.SessionService>();
builder.Services.AddScoped<FreelanceTn.Api.Services.AccountService>();
builder.Services.AddScoped<FreelanceTn.Api.Services.ProjectService>();
builder.Services.AddScoped<FreelanceTn.Api.Services.ServiceService>();
builder.Services.AddScoped<FreelanceTn.Api.Services.ProposalService>();
builder.Services.AddScoped<FreelanceTn.Api.Services.InvitationService>();
builder.Services.AddScoped<FreelanceTn.Api.Services.FeedbackService>();
builder.Services.AddScoped<FreelanceTn.Api.Services.CommentService>();
builder.Services.AddScoped<FreelanceTn.Api.Services.PortfolioService>();
builder.Services.AddScoped<FreelanceTn.Api.Services.CvImportService>();
builder.Services.AddScoped<FreelanceTn.Api.Services.CvPdfService>();
builder.Services.AddScoped<FreelanceTn.Api.Services.QuoteService>();
builder.Services.AddScoped<FreelanceTn.Api.Services.ReceiptPdfService>();
builder.Services.AddScoped<FreelanceTn.Api.Services.PaymentService>();
builder.Services.AddScoped<FreelanceTn.Api.Services.InvoiceService>();
builder.Services.AddScoped<FreelanceTn.Api.Services.TaskService>();
builder.Services.AddScoped<FreelanceTn.Api.Services.NotificationService>();

// Publication automatique des évaluations à échéance, indépendante de toute
// consultation utilisateur. Idempotent et sûr en cas de plusieurs instances.
builder.Services.AddHostedService<FreelanceTn.Api.Services.FeedbackPublicationWorker>();

builder.Services.AddControllers()
    .ConfigureApiBehaviorOptions(options =>
    {
        // Erreurs de validation FluentValidation → JSON structuré cohérent.
        options.InvalidModelStateResponseFactory = context =>
        {
            var errors = context.ModelState
                .Where(entry => entry.Value?.Errors.Count > 0)
                .SelectMany(entry => entry.Value!.Errors.Select(error =>
                    string.IsNullOrWhiteSpace(error.ErrorMessage) ? "Valeur invalide." : error.ErrorMessage))
                .ToArray();

            return new Microsoft.AspNetCore.Mvc.BadRequestObjectResult(new
            {
                status = StatusCodes.Status400BadRequest,
                message = "La requête contient des données invalides.",
                errors,
            });
        };
    });
builder.Services.AddFluentValidationAutoValidation();
builder.Services.AddValidatorsFromAssemblyContaining<Program>();

// Authentification JWT : le jeton est transporté par un cookie httpOnly (non lisible par le JS frontend).
builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtSettings.Issuer,
            ValidAudience = jwtSettings.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSettings.Key)),
        };

        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                if (string.IsNullOrEmpty(context.Token) &&
                    context.Request.Cookies.TryGetValue(jwtSettings.CookieName, out var cookieToken))
                {
                    context.Token = cookieToken;
                }

                return Task.CompletedTask;
            },
            OnTokenValidated = async context =>
            {
                // Vérifie que la session n'a pas été révoquée ou expirée depuis
                // la déconnexion à distance ou la réinitialisation du mot de passe.
                // Les jetons historiques sans claim "sid" restent acceptés.
                var sessionKey = context.Principal?.FindFirst("sid")?.Value;
                if (string.IsNullOrWhiteSpace(sessionKey))
                {
                    return;
                }

                var sessions = context.HttpContext.RequestServices
                    .GetRequiredService<FreelanceTn.Api.Services.SessionService>();

                var active = await sessions.IsActiveAsync(sessionKey, context.HttpContext.RequestAborted);
                if (!active)
                {
                    context.Fail("Session révoquée ou expirée.");
                }
            },
        };
    });

builder.Services.AddAuthorization();

// CORS : origine locale réelle du frontend, avec credentials (cookie httpOnly).
// En développement, toute origine loopback est acceptée (localhost, 127.0.0.1,
// quel que soit le port) : le navigateur bloque sinon la requête quand
// l'application est ouverte via 127.0.0.1 ou une autre origine locale.
builder.Services.AddCors(options =>
{
    options.AddPolicy(CorsSettings.PolicyName, policy =>
    {
        if (builder.Environment.IsDevelopment())
        {
            policy
                .SetIsOriginAllowed(origin =>
                    Uri.TryCreate(origin, UriKind.Absolute, out var uri) && uri.IsLoopback)
                .AllowAnyHeader()
                .AllowAnyMethod()
                .AllowCredentials();
            return;
        }

        policy
            .WithOrigins(corsSettings.AllowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo { Title = "FreelanceTN API", Version = "v1" });
    options.AddSecurityDefinition("cookieAuth", new OpenApiSecurityScheme
    {
        Name = jwtSettings.CookieName,
        Type = SecuritySchemeType.ApiKey,
        In = ParameterLocation.Cookie,
        Description = "Cookie httpOnly contenant le JWT.",
    });
});

var app = builder.Build();

// Doit précéder tout middleware ou contrôleur qui consulte Request.Scheme ou
// Request.IsHttps (notamment l'émission des cookies d'authentification).
app.UseForwardedHeaders();

// Diagnostic de démarrage : ne jamais laisser croire que Google ou l'envoi
// d'e-mails est actif alors qu'il ne l'est pas.
if (!authSettings.Google.IsConfigured)
{
    app.Logger.LogWarning(
        "Connexion Google désactivée : renseignez Auth:Google:ClientId et Auth:Google:ClientSecret " +
        "(ou les variables d'environnement Auth__Google__ClientId / Auth__Google__ClientSecret).");
}

if (string.IsNullOrWhiteSpace(authSettings.FrontendBaseUrl))
{
    app.Logger.LogWarning(
        "Auth:FrontendBaseUrl n'est pas renseigné : les liens e-mail utilisent l'ancienne clé FrontendUrl. " +
        "En production, définissez FRONTEND_BASE_URL (ou Auth__FrontendBaseUrl) avec l'URL publique réelle.");
}
else if (!app.Environment.IsDevelopment() &&
         authSettings.EffectiveFrontendBaseUrl.Contains("localhost", StringComparison.OrdinalIgnoreCase))
{
    app.Logger.LogWarning(
        "Auth:FrontendBaseUrl pointe vers localhost en environnement non-Development : " +
        "les liens e-mail ne seront pas accessibles en production.");
}

if (string.IsNullOrWhiteSpace(authSettings.AppBaseUrl))
{
    app.Logger.LogInformation(
        "Auth:AppBaseUrl n'est pas renseigné (facultatif). Définissez APP_BASE_URL au déploiement.");
}

if (!konnectSettings.Enabled)
{
    app.Logger.LogInformation(
        "Passerelle Konnect Sandbox désactivée (Konnect:Enabled=false). " +
        "Les paiements par carte renverront une erreur explicite, sans repli vers un faux succès.");
}
else
{
    app.Logger.LogInformation(
        "Passerelle Konnect Sandbox active : {BaseUrl} (wallet {WalletId}). Webhook : {Webhook}.",
        konnectSettings.BaseUrl,
        konnectSettings.ReceiverWalletId,
        BuildWebhookStatus(konnectSettings));
    app.Logger.LogInformation(
        "Cartes de test officielles Konnect Sandbox : Visa 4509 2111 1111 1119 (12/26, CVV 748), " +
        "MasterCard succès 5440 2127 1111 1110 (12/26, CVV 665), MasterCard échec 5471 2511 1111 1116 (11/23, CVV 858).");
}

if (!blockchainSettings.IsConfigured)
{
    app.Logger.LogWarning(
        "Paiement MetaMask indisponible sur « {Network} » : l'adresse de réception du réseau actif " +
        "n'est pas renseignée. Les paiements MetaMask seront refusés explicitement (aucun crédit fictif).",
        blockchainSettings.ActiveNetworkName);
}
else
{
    app.Logger.LogInformation(
        "Paiement MetaMask actif sur « {Network} » : chainId {ChainId}, destinataire {Receiver}, " +
        "taux {TndPerEth} TND/ETH, {MinConfirmations} confirmation(s) requise(s), RPC {RpcUrl}.",
        blockchainSettings.ActiveNetworkName,
        blockchainSettings.ActiveChainId,
        blockchainSettings.ActiveReceiverAddress,
        blockchainSettings.TndPerEth,
        blockchainSettings.ActiveMinConfirmations,
        blockchainSettings.ActiveRpcUrl);
}

static string BuildWebhookStatus(KonnectSettings settings)
{
    if (string.IsNullOrWhiteSpace(settings.AppBaseUrl)) return "désactivé (AppBaseUrl vide)";
    if (!Uri.TryCreate(settings.AppBaseUrl, UriKind.Absolute, out var uri)) return "désactivé (AppBaseUrl invalide)";
    if (uri.IsLoopback || uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
        || uri.Host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase))
    {
        return "non joignable en local : vérification effectuée au retour du client";
    }
    return settings.AppBaseUrl.TrimEnd('/') + "/api/payments/konnect/webhook";
}

if (smtpSelected)
{
    app.Logger.LogInformation(
        "Envoi d'e-mails : SMTP {Host}:{Port} (STARTTLS={StartTls}), expéditeur {FromAddress}, délai {TimeoutSeconds}s.",
        emailSettings.Host,
        emailSettings.Port,
        emailSettings.UseStartTls,
        FreelanceTn.Api.Services.AuthService.MaskEmail(emailSettings.FromAddress),
        emailSettings.TimeoutSeconds);

    // Gmail réécrit (ou refuse) un expéditeur différent du compte authentifié.
    if (emailSettings.Host.Contains("gmail", StringComparison.OrdinalIgnoreCase)
        && !string.Equals(
            emailSettings.FromAddress.Trim(),
            emailSettings.Username.Trim(),
            StringComparison.OrdinalIgnoreCase))
    {
        app.Logger.LogWarning(
            "Gmail exige que l'expéditeur ({FromAddress}) corresponde au compte authentifié ({Username}) : " +
            "les messages risquent d'être réécrits ou refusés.",
            FreelanceTn.Api.Services.AuthService.MaskEmail(emailSettings.FromAddress),
            FreelanceTn.Api.Services.AuthService.MaskEmail(emailSettings.Username));
    }
}
else if (emailMode != EmailSettings.ModeNone && app.Environment.IsDevelopment())
{
    app.Logger.LogWarning(
        "Envoi d'e-mails : mode développement (dev-outbox), les messages sont écrits dans {Path}. " +
        "Aucun e-mail réel n'est envoyé.",
        Path.Combine(app.Environment.ContentRootPath, emailSettings.DevOutboxPath));
}
else
{
    app.Logger.LogWarning(
        "Envoi d'e-mails : aucun transport configuré, les e-mails transactionnels ne seront PAS envoyés.");
}

// Création des index MongoDB au démarrage (dont l'index unique sur l'email).
using (var scope = app.Services.CreateScope())
{
    var mongo = scope.ServiceProvider.GetRequiredService<MongoContext>();
    try
    {
        await mongo.EnsureIndexesAsync();
    }
    catch (Exception exception)
    {
        var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
        logger.LogWarning(exception, "Les index MongoDB n'ont pas pu être créés au démarrage.");
    }
}

app.UseMiddleware<FreelanceTn.Api.Middleware.ErrorHandlingMiddleware>();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors(CorsSettings.PolicyName);

// Réponses 401/403 structurées en JSON (au lieu des redirections/challenges par
// défaut). Ce middleware doit être enregistré AVANT UseAuthorization : il
// enveloppe le court-circuit produit par le refus d'accès, sinon il ne voit
// jamais la réponse et le corps reste vide. Il est aussi placé après
// ErrorHandlingMiddleware, qui écrit lui-même la réponse en cas d'exception
// métier (HasStarted alors true, donc non écrasé).
app.UseStatusCodePages(async context =>
{
    var response = context.HttpContext.Response;
    if (response.StatusCode is StatusCodes.Status401Unauthorized or StatusCodes.Status403Forbidden)
    {
        if (response.HasStarted) return;
        response.ContentType = "application/json";
        var message = response.StatusCode == StatusCodes.Status401Unauthorized
            ? "Authentification requise."
            : "Accès refusé.";
        await response.WriteAsync(
            System.Text.Json.JsonSerializer.Serialize(new { status = response.StatusCode, message, errors = Array.Empty<string>() }));
    }
});

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();

// Exposé pour les tests d'intégration éventuels.
public partial class Program;
