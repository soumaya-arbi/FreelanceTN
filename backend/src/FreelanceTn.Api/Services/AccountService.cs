using System.Security.Cryptography;
using System.Text;
using FreelanceTn.Api.Configuration;
using FreelanceTn.Api.Data;
using FreelanceTn.Api.Dtos.Account;
using FreelanceTn.Api.Dtos.Auth;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using Task = System.Threading.Tasks.Task;

namespace FreelanceTn.Api.Services;

/// <summary>
/// Service du module Account Settings : profil client, équipe, facturation,
/// sécurité, notifications et préférences. Toutes les lectures/écritures sont
/// filtrées par l'identifiant de la session authentifiée ; les contrôles de
/// rôle sont refaits ici, jamais uniquement dans l'interface.
/// </summary>
public class AccountService
{
    private static readonly string[] AvatarSources = ["initials", "preset", "upload", "generated"];

    private readonly MongoContext _mongo;
    private readonly AuthService _authService;
    private readonly AuthEmailService _email;
    private readonly SessionService _sessions;
    private readonly AuthSettings _settings;
    private readonly bool _exposeDevLinks;
    private readonly ILogger<AccountService> _logger;

    public AccountService(
        MongoContext mongo,
        AuthService authService,
        AuthEmailService email,
        SessionService sessions,
        IOptions<AuthSettings> settings,
        IWebHostEnvironment environment,
        ILogger<AccountService> logger)
    {
        _mongo = mongo;
        _authService = authService;
        _email = email;
        _sessions = sessions;
        _settings = settings.Value;
        _exposeDevLinks = _settings.ExposeDevEmailLinks &&
                          environment.IsDevelopment() &&
                          _email.Transport == EmailTransport.DevOutbox;
        _logger = logger;
    }

    private IMongoCollection<User> Users => _mongo.GetCollection<User>(_mongo.Settings.UsersCollection);
    private IMongoCollection<TeamMember> Team => _mongo.GetCollection<TeamMember>(_mongo.Settings.TeamMembersCollection);
    private IMongoCollection<BillingProfile> Billing =>
        _mongo.GetCollection<BillingProfile>(_mongo.Settings.BillingProfilesCollection);
    private IMongoCollection<UserPreference> Preferences =>
        _mongo.GetCollection<UserPreference>(_mongo.Settings.UserPreferencesCollection);
    private IMongoCollection<NotificationPreference> NotificationPreferences =>
        _mongo.GetCollection<NotificationPreference>(_mongo.Settings.NotificationPreferencesCollection);
    private IMongoCollection<AccountChange> Changes =>
        _mongo.GetCollection<AccountChange>(_mongo.Settings.AccountChangesCollection);

    // ------------------------------------------------------------ Profil client

    public async Task<ClientProfileResponse> GetClientProfileAsync(string userId, CancellationToken cancellationToken)
    {
        var user = await Users.Find(u => u.Id == userId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");

        return ToClientProfile(user);
    }

    public async Task<ClientProfileResponse> UpdateClientProfileAsync(
        string userId,
        UpdateClientProfileRequest request,
        CancellationToken cancellationToken)
    {
        var user = await Users.Find(u => u.Id == userId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");

        var changedFields = new List<string>();

        void Set(string field, string? value, Action<string> assign)
        {
            if (value is null) return;
            var trimmed = value.Trim();
            assign(trimmed);
            changedFields.Add(field);
        }

        Set("Prénom", request.FirstName, v => user.FirstName = v);
        Set("Nom", request.LastName, v => user.LastName = v);
        Set("Téléphone", request.Phone, v => user.Phone = v);
        Set("Nom de l'entreprise", request.CompanyName, v => user.CompanyName = v);
        Set("Logo", request.CompanyLogo, v => user.CompanyLogo = v);
        Set("Couverture", request.CoverImage, v => user.CoverImage = v);
        Set("Secteur", request.Industry, v => user.Industry = v);
        Set("Poste", request.Position, v => user.Position = v);
        Set("Site web", request.CompanyWebsite, v => user.CompanyWebsite = v);
        Set("Taille de l'entreprise", request.CompanySize, v => user.CompanySize = v);
        Set("Description de l'entreprise", request.CompanyDescription, v => user.CompanyDescription = v);
        Set("Pays", request.Country, v => user.Country = v);
        Set("Gouvernorat", request.Governorate, v => user.Governorate = v);
        Set("Ville", request.City, v => user.City = v);
        Set("Adresse professionnelle", request.BusinessAddress, v => user.BusinessAddress = v);
        Set("Présentation personnelle", request.PersonalPresentation, v => user.PersonalPresentation = v);
        Set("E-mail professionnel", request.ProfessionalEmail, v => user.ProfessionalEmail = v);
        Set("Téléphone professionnel", request.ProfessionalPhone, v => user.ProfessionalPhone = v);
        Set("Site web personnel", request.Website, v => user.Website = v);

        if (request.AvatarSource is not null)
        {
            var source = request.AvatarSource.Trim().ToLowerInvariant();
            if (!AvatarSources.Contains(source))
            {
                throw new BadRequestException("Source d'avatar invalide.");
            }
            user.AvatarSource = source;
            changedFields.Add("Avatar : source");
        }
        Set("Avatar : preset", request.AvatarPreset, v => user.AvatarPreset = v);
        Set("Avatar : couleur", request.AvatarColor, v => user.AvatarColor = v);
        if (request.AvatarConfig is not null) user.AvatarConfig = request.AvatarConfig;

        user.UpdatedAt = DateTime.UtcNow;
        await Users.ReplaceOneAsync(u => u.Id == userId, user, cancellationToken: cancellationToken);

        await RecordChangeAsync(userId, "Profil", "Mise à jour du profil professionnel", cancellationToken);
        return ToClientProfile(user);
    }

    public async Task<ClientProfileResponse> SetAvatarStyleAsync(
        string userId,
        AvatarStyleRequest request,
        CancellationToken cancellationToken)
    {
        var user = await Users.Find(u => u.Id == userId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");

        if (request.Source is not null)
        {
            var source = request.Source.Trim().ToLowerInvariant();
            if (!AvatarSources.Contains(source))
            {
                throw new BadRequestException("Source d'avatar invalide.");
            }
            user.AvatarSource = source;
        }

        if (request.Preset is not null) user.AvatarPreset = request.Preset.Trim();
        if (request.Color is not null) user.AvatarColor = NormalizeColor(request.Color);
        if (request.Config is not null) user.AvatarConfig = request.Config;
        user.UpdatedAt = DateTime.UtcNow;

        await Users.ReplaceOneAsync(u => u.Id == userId, user, cancellationToken: cancellationToken);
        await RecordChangeAsync(userId, "Profil", "Personnalisation de l'avatar", cancellationToken);
        return ToClientProfile(user);
    }

    // ------------------------------------------------------------ Équipe

    public async Task<List<TeamMemberResponse>> GetTeamAsync(string userId, CancellationToken cancellationToken)
    {
        var members = await Team
            .Find(m => m.OwnerId == userId)
            .SortBy(m => m.InvitedAt)
            .ToListAsync(cancellationToken);

        return members.Select(m => ToTeamResponse(m, canManage: true)).ToList();
    }

    public async Task<TeamInviteResponse> InviteTeamMemberAsync(
        string userId,
        TeamInviteRequest request,
        CancellationToken cancellationToken)
    {
        var owner = await Users.Find(u => u.Id == userId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");

        if (!UserRole.IsValid(owner.Role) || !string.Equals(owner.Role, UserRole.Client, StringComparison.OrdinalIgnoreCase))
        {
            throw new ForbiddenException("Seul un compte client peut inviter des membres d'équipe.");
        }

        var email = AuthService.NormalizeEmail(request.Email);
        if (email.Length == 0 || !email.Contains('@'))
        {
            throw new BadRequestException("L'adresse e-mail de l'invitation est invalide.");
        }

        if (!TeamMember.Roles.IsInvitable(request.Role))
        {
            throw new BadRequestException("Le rôle doit être Admin, Manager, Member ou Viewer.");
        }

        if (string.Equals(email, AuthService.NormalizeEmail(owner.Email), StringComparison.Ordinal))
        {
            throw new BadRequestException("Vous ne pouvez pas vous inviter vous-même.");
        }

        var duplicate = await Team
            .Find(m => m.OwnerId == userId &&
                       m.EmailNormalized == email &&
                       (m.Status == TeamMember.Statuses.Pending || m.Status == TeamMember.Statuses.Active))
            .FirstOrDefaultAsync(cancellationToken);

        if (duplicate is not null)
        {
            throw new ConflictException(
                duplicate.Status == TeamMember.Statuses.Active
                    ? "Cette adresse fait déjà partie de votre équipe."
                    : "Une invitation est déjà en attente pour cette adresse.");
        }

        var token = CreateOpaqueToken();
        var now = DateTime.UtcNow;
        var member = new TeamMember
        {
            OwnerId = userId,
            Email = request.Email.Trim(),
            EmailNormalized = email,
            Name = request.Name?.Trim() ?? string.Empty,
            Role = TeamMember.Roles.Normalize(request.Role),
            Status = TeamMember.Statuses.Pending,
            InviteTokenHash = HashToken(token),
            InviteExpiresAt = now.AddHours(Math.Max(1, _settings.TeamInviteTokenHours)),
            InvitedAt = now,
            UpdatedAt = now,
        };

        await Team.InsertOneAsync(member, cancellationToken: cancellationToken);

        var sent = false;
        var transport = "none";
        string? devUrl = null;
        try
        {
            await _email.SendTeamInvitationAsync(
                member.Email,
                string.Join(' ', new[] { owner.FirstName, owner.LastName }.Where(s => !string.IsNullOrWhiteSpace(s))),
                string.IsNullOrWhiteSpace(owner.CompanyName) ? "FreelanceTN" : owner.CompanyName,
                member.Role,
                token,
                Math.Max(1, _settings.TeamInviteTokenHours),
                cancellationToken);

            sent = _email.Transport != EmailTransport.None;
            transport = _email.Transport switch
            {
                EmailTransport.Smtp => "smtp",
                EmailTransport.DevOutbox => "dev-outbox",
                _ => "none",
            };
            if (_exposeDevLinks)
            {
                devUrl = $"{_settings.EffectiveFrontendBaseUrl.TrimEnd('/')}/team/accept?token={Uri.EscapeDataString(token)}";
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "L'invitation d'équipe n'a pas pu être envoyée pour le membre {MemberId}.", member.Id);
            transport = _email.Transport switch
            {
                EmailTransport.Smtp => "smtp",
                EmailTransport.DevOutbox => "dev-outbox",
                _ => "none",
            };
        }

        return new TeamInviteResponse
        {
            Member = ToTeamResponse(member, canManage: true),
            Sent = sent,
            Transport = transport,
            Message = sent
                ? "Invitation enregistrée et e-mail remis au transport configuré."
                : "Invitation enregistrée, mais aucun e-mail n'a pu être envoyé. Vérifiez la configuration e-mail.",
            DevInviteUrl = devUrl,
        };
    }

    public async Task<TeamMemberResponse> UpdateTeamRoleAsync(
        string userId,
        string memberId,
        string role,
        CancellationToken cancellationToken)
    {
        if (!TeamMember.Roles.IsInvitable(role))
        {
            throw new BadRequestException("Le rôle doit être Admin, Manager, Member ou Viewer.");
        }

        EnsureValidObjectId(memberId, "Membre d'équipe introuvable.");

        var member = await Team.Find(m => m.Id == memberId && m.OwnerId == userId)
            .FirstOrDefaultAsync(cancellationToken)
            ?? throw new NotFoundException("Membre d'équipe introuvable.");

        member.Role = TeamMember.Roles.Normalize(role);
        member.UpdatedAt = DateTime.UtcNow;
        await Team.ReplaceOneAsync(m => m.Id == member.Id, member, cancellationToken: cancellationToken);

        await RecordChangeAsync(userId, "Équipe", $"Rôle de {member.Email} modifié en {member.Role}", cancellationToken);
        return ToTeamResponse(member, canManage: true);
    }

    public async Task<TeamMemberResponse> RevokeTeamMemberAsync(
        string userId,
        string memberId,
        CancellationToken cancellationToken)
    {
        EnsureValidObjectId(memberId, "Membre d'équipe introuvable.");

        var member = await Team.Find(m => m.Id == memberId && m.OwnerId == userId)
            .FirstOrDefaultAsync(cancellationToken)
            ?? throw new NotFoundException("Membre d'équipe introuvable.");

        member.Status = TeamMember.Statuses.Revoked;
        member.RevokedAt = DateTime.UtcNow;
        member.InviteTokenHash = null;
        member.InviteExpiresAt = null;
        member.UpdatedAt = DateTime.UtcNow;
        await Team.ReplaceOneAsync(m => m.Id == member.Id, member, cancellationToken: cancellationToken);

        await RecordChangeAsync(userId, "Équipe", $"Accès révoqué pour {member.Email}", cancellationToken);
        return ToTeamResponse(member, canManage: true);
    }

    public async Task<TeamMemberResponse> AcceptInvitationAsync(string token, CancellationToken cancellationToken)
    {
        var member = await FindPendingByTokenAsync(token, cancellationToken);
        member.Status = TeamMember.Statuses.Active;
        member.AcceptedAt = DateTime.UtcNow;
        member.InviteTokenHash = null;
        member.InviteExpiresAt = null;
        member.UpdatedAt = DateTime.UtcNow;

        var linked = await Users.Find(u => u.EmailNormalized == member.EmailNormalized)
            .FirstOrDefaultAsync(cancellationToken);
        if (linked is not null) member.UserId = linked.Id;

        await Team.ReplaceOneAsync(m => m.Id == member.Id, member, cancellationToken: cancellationToken);
        await RecordChangeAsync(member.OwnerId, "Équipe", $"Invitation acceptée par {member.Email}", cancellationToken);
        return ToTeamResponse(member, canManage: false);
    }

    public async Task<TeamMemberResponse> ActivateTeamMemberAsync(
        string token,
        string password,
        CancellationToken cancellationToken)
    {
        var member = await FindPendingByTokenAsync(token, cancellationToken);

        var user = await _authService.CreateOrActivateTeamMemberAsync(member.Email, password, cancellationToken);
        member.UserId = user.Id;
        member.Status = TeamMember.Statuses.Active;
        member.AcceptedAt = DateTime.UtcNow;
        member.InviteTokenHash = null;
        member.InviteExpiresAt = null;
        member.UpdatedAt = DateTime.UtcNow;

        await Team.ReplaceOneAsync(m => m.Id == member.Id, member, cancellationToken: cancellationToken);
        await RecordChangeAsync(member.OwnerId, "Équipe", $"Invitation activée par {member.Email}", cancellationToken);
        return ToTeamResponse(member, canManage: false);
    }

    public async Task<TeamMemberResponse> DeclineInvitationAsync(string token, CancellationToken cancellationToken)
    {
        var member = await FindPendingByTokenAsync(token, cancellationToken);
        member.Status = TeamMember.Statuses.Declined;
        member.InviteTokenHash = null;
        member.InviteExpiresAt = null;
        member.UpdatedAt = DateTime.UtcNow;
        await Team.ReplaceOneAsync(m => m.Id == member.Id, member, cancellationToken: cancellationToken);
        await RecordChangeAsync(member.OwnerId, "Équipe", $"Invitation refusée par {member.Email}", cancellationToken);
        return ToTeamResponse(member, canManage: false);
    }

    private async Task<TeamMember> FindPendingByTokenAsync(string token, CancellationToken cancellationToken)
    {
        var hash = HashToken(token.Trim());
        var member = await Team.Find(m => m.InviteTokenHash == hash).FirstOrDefaultAsync(cancellationToken);

        if (member is null)
        {
            throw new BadRequestException("Cette invitation n'est pas valide ou a déjà été utilisée.");
        }

        if (member.InviteExpiresAt is null || member.InviteExpiresAt < DateTime.UtcNow)
        {
            throw new BadRequestException("Cette invitation a expiré. Demandez une nouvelle invitation.");
        }

        if (member.Status != TeamMember.Statuses.Pending)
        {
            throw new BadRequestException("Cette invitation n'est plus en attente.");
        }

        return member;
    }

    // ------------------------------------------------------------ Facturation

    public async Task<BillingProfileResponse> GetBillingAsync(string userId, CancellationToken cancellationToken)
    {
        var billing = await Billing.Find(b => b.UserId == userId).FirstOrDefaultAsync(cancellationToken);
        return billing is null ? new BillingProfileResponse() : ToBillingResponse(billing);
    }

    public async Task<BillingProfileResponse> UpdateBillingAsync(
        string userId,
        UpdateBillingRequest request,
        CancellationToken cancellationToken)
    {
        var billing = await Billing.Find(b => b.UserId == userId).FirstOrDefaultAsync(cancellationToken);
        var isNew = billing is null;
        billing ??= new BillingProfile { UserId = userId };

        var changed = new List<string>();

        void Set(string field, string? value, Action<string> assign)
        {
            if (value is null) return;
            var trimmed = value.Trim();
            var previous = field switch
            {
                "Nom légal" => billing!.LegalName,
                "Adresse de facturation" => billing!.BillingAddress,
                "Pays" => billing!.Country,
                "Gouvernorat" => billing!.Governorate,
                "Ville" => billing!.City,
                "Identifiant fiscal" => billing!.TaxId,
                "Nom du contact" => billing!.ContactName,
                "E-mail de contact" => billing!.ContactEmail,
                "Téléphone de contact" => billing!.ContactPhone,
                _ => string.Empty,
            };
            if (!string.Equals(previous, trimmed, StringComparison.Ordinal))
            {
                changed.Add(field);
            }
            assign(trimmed);
        }

        Set("Nom légal", request.LegalName, v => billing!.LegalName = v);
        Set("Adresse de facturation", request.BillingAddress, v => billing!.BillingAddress = v);
        Set("Pays", request.Country, v => billing!.Country = v);
        Set("Gouvernorat", request.Governorate, v => billing!.Governorate = v);
        Set("Ville", request.City, v => billing!.City = v);
        Set("Identifiant fiscal", request.TaxId, v => billing!.TaxId = v);
        Set("Nom du contact", request.ContactName, v => billing!.ContactName = v);
        Set("E-mail de contact", request.ContactEmail, v => billing!.ContactEmail = v);
        Set("Téléphone de contact", request.ContactPhone, v => billing!.ContactPhone = v);

        billing.UpdatedAt = DateTime.UtcNow;
        billing.History.Add(new BillingHistoryEntry
        {
            ChangedAt = billing.UpdatedAt,
            ChangedByUserId = userId,
            Fields = changed,
        });

        if (isNew)
        {
            billing.CreatedAt = billing.UpdatedAt;
            await Billing.InsertOneAsync(billing, cancellationToken: cancellationToken);
        }
        else
        {
            await Billing.ReplaceOneAsync(b => b.Id == billing.Id, billing, cancellationToken: cancellationToken);
        }

        await RecordChangeAsync(userId, "Facturation", "Mise à jour des informations de facturation", cancellationToken);
        return ToBillingResponse(billing);
    }

    // ------------------------------------------------------------ Notifications

    public async Task<NotificationPreferencesDto> GetNotificationPreferencesAsync(
        string userId,
        CancellationToken cancellationToken)
    {
        var prefs = await NotificationPreferences.Find(p => p.UserId == userId).FirstOrDefaultAsync(cancellationToken);
        return prefs is null ? new NotificationPreferencesDto() : ToNotificationPreferences(prefs);
    }

    public async Task<NotificationPreferencesDto> UpdateNotificationPreferencesAsync(
        string userId,
        NotificationPreferencesDto request,
        CancellationToken cancellationToken)
    {
        var prefs = await NotificationPreferences.Find(p => p.UserId == userId).FirstOrDefaultAsync(cancellationToken);
        var isNew = prefs is null;
        prefs ??= new NotificationPreference { UserId = userId };

        prefs.EmailEnabled = request.EmailEnabled;
        prefs.InAppEnabled = request.InAppEnabled;
        prefs.InvitationsEnabled = request.InvitationsEnabled;
        prefs.ProjectActivityEnabled = request.ProjectActivityEnabled;
        prefs.MessagesEnabled = request.MessagesEnabled;
        prefs.BillingEnabled = request.BillingEnabled;
        prefs.UpdatedAt = DateTime.UtcNow;

        if (isNew)
        {
            prefs.CreatedAt = prefs.UpdatedAt;
            await NotificationPreferences.InsertOneAsync(prefs, cancellationToken: cancellationToken);
        }
        else
        {
            await NotificationPreferences.ReplaceOneAsync(p => p.Id == prefs.Id, prefs, cancellationToken: cancellationToken);
        }

        await RecordChangeAsync(userId, "Notifications", "Mise à jour des préférences de notification", cancellationToken);
        return ToNotificationPreferences(prefs);
    }

    /// <summary>Préférences utilisées par le service de notifications pour filtrer réellement l'in-app.</summary>
    public async Task<NotificationPreference?> GetNotificationPreferencesEntityAsync(
        string userId,
        CancellationToken cancellationToken)
    {
        return await NotificationPreferences.Find(p => p.UserId == userId).FirstOrDefaultAsync(cancellationToken);
    }

    // ------------------------------------------------------------ Préférences

    public async Task<UserPreferencesDto> GetPreferencesAsync(string userId, CancellationToken cancellationToken)
    {
        var prefs = await Preferences.Find(p => p.UserId == userId).FirstOrDefaultAsync(cancellationToken);
        return prefs is null ? new UserPreferencesDto() : ToPreferences(prefs);
    }

    public async Task<UserPreferencesDto> UpdatePreferencesAsync(
        string userId,
        UserPreferencesDto request,
        CancellationToken cancellationToken)
    {
        if (!UserPreference.Languages.IsValid(request.Language))
        {
            throw new BadRequestException("La langue doit être 'fr' ou 'en'.");
        }
        if (!UserPreference.Themes.IsValid(request.Theme))
        {
            throw new BadRequestException("Le thème doit être 'light' ou 'dark'.");
        }
        if (!string.Equals(request.Currency?.Trim(), "TND", StringComparison.OrdinalIgnoreCase))
        {
            throw new BadRequestException("La devise par défaut de la plateforme est TND.");
        }
        if (string.IsNullOrWhiteSpace(request.Timezone))
        {
            throw new BadRequestException("Le fuseau horaire est obligatoire.");
        }

        var prefs = await Preferences.Find(p => p.UserId == userId).FirstOrDefaultAsync(cancellationToken);
        var isNew = prefs is null;
        prefs ??= new UserPreference { UserId = userId };

        prefs.Language = request.Language;
        prefs.Currency = "TND";
        prefs.Theme = request.Theme;
        prefs.Timezone = request.Timezone.Trim();
        prefs.DateFormat = request.DateFormat is "YYYY-MM-DD" ? "YYYY-MM-DD" : "DD/MM/YYYY";
        prefs.ThousandsSeparator = request.ThousandsSeparator;
        prefs.UpdatedAt = DateTime.UtcNow;

        if (isNew)
        {
            prefs.CreatedAt = prefs.UpdatedAt;
            await Preferences.InsertOneAsync(prefs, cancellationToken: cancellationToken);
        }
        else
        {
            await Preferences.ReplaceOneAsync(p => p.Id == prefs.Id, prefs, cancellationToken: cancellationToken);
        }

        await RecordChangeAsync(userId, "Préférences", "Mise à jour des préférences", cancellationToken);
        return ToPreferences(prefs);
    }

    // ------------------------------------------------------------ Sécurité

    public async Task<SecurityOverviewResponse> GetSecurityOverviewAsync(
        string userId,
        string? currentSessionKey,
        CancellationToken cancellationToken)
    {
        var user = await Users.Find(u => u.Id == userId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");

        return new SecurityOverviewResponse
        {
            Email = user.Email,
            EmailVerified = user.EmailVerified != false,
            HasPassword = !string.IsNullOrWhiteSpace(user.PasswordHash),
            TwoFactorEnabled = user.TwoFactorEnabled && !string.IsNullOrWhiteSpace(user.TwoFactorSecret),
            TwoFactorEnabledAt = user.TwoFactorEnabledAt,
            RecoveryCodesRemaining = user.RecoveryCodeHashes.Count,
            TwoFactorAvailable = true,
            Sessions = await _sessions.ListAsync(userId, currentSessionKey, cancellationToken),
        };
    }

    public Task<long> RevokeOtherSessionsAsync(string userId, string? currentSessionKey, CancellationToken cancellationToken) =>
        _sessions.RevokeOthersAsync(userId, currentSessionKey, cancellationToken);

    public async Task<bool> RevokeSessionAsync(string userId, string sessionId, CancellationToken cancellationToken)
    {
        EnsureValidObjectId(sessionId, "Session introuvable ou déjà déconnectée.");

        var ok = await _sessions.RevokeAsync(userId, sessionId, cancellationToken);
        if (ok)
        {
            await RecordChangeAsync(userId, "Sécurité", "Session distante déconnectée", cancellationToken);
        }
        return ok;
    }

    // ------------------------------------------------------------ Historique / export / public

    public async Task<List<AccountChangeResponse>> GetChangesAsync(string userId, CancellationToken cancellationToken)
    {
        var changes = await Changes
            .Find(c => c.UserId == userId)
            .SortByDescending(c => c.CreatedAt)
            .Limit(50)
            .ToListAsync(cancellationToken);

        return changes.Select(c => new AccountChangeResponse
        {
            Area = c.Area,
            Summary = c.Summary,
            CreatedAt = c.CreatedAt,
        }).ToList();
    }

    public async Task<AccountExportResponse> ExportAsync(string userId, CancellationToken cancellationToken)
    {
        var profile = await GetClientProfileAsync(userId, cancellationToken);
        var billing = await GetBillingAsync(userId, cancellationToken);
        var preferences = await GetPreferencesAsync(userId, cancellationToken);
        var notifications = await GetNotificationPreferencesAsync(userId, cancellationToken);
        var team = await GetTeamAsync(userId, cancellationToken);

        return new AccountExportResponse
        {
            GeneratedAt = DateTime.UtcNow.ToString("O"),
            Profile = profile,
            Billing = billing,
            Preferences = preferences,
            Notifications = notifications,
            Team = team,
        };
    }

    public async Task<PublicClientProfileResponse> GetPublicProfileAsync(
        string clientId,
        CancellationToken cancellationToken)
    {
        EnsureValidObjectId(clientId, "Profil introuvable.");

        var user = await Users.Find(u => u.Id == clientId && u.Role == UserRole.Client)
            .FirstOrDefaultAsync(cancellationToken)
            ?? throw new NotFoundException("Profil introuvable.");

        return new PublicClientProfileResponse
        {
            DisplayName = string.Join(' ', new[] { user.FirstName, user.LastName }.Where(s => !string.IsNullOrWhiteSpace(s))),
            CompanyName = user.CompanyName,
            CompanyLogo = user.CompanyLogo,
            CoverImage = user.CoverImage,
            Industry = user.Industry,
            Position = user.Position,
            CompanyWebsite = user.CompanyWebsite,
            CompanySize = user.CompanySize,
            CompanyDescription = user.CompanyDescription,
            Country = user.Country,
            Governorate = user.Governorate,
            City = user.City,
            PersonalPresentation = user.PersonalPresentation,
            Avatar = user.Avatar,
            AvatarSource = string.IsNullOrWhiteSpace(user.AvatarSource) ? "initials" : user.AvatarSource,
            AvatarConfig = user.AvatarConfig,
            Verified = user.EmailVerified != false,
            CreatedAt = user.CreatedAt,
        };
    }

    // ------------------------------------------------------------ Helpers

    private async Task RecordChangeAsync(string userId, string area, string summary, CancellationToken cancellationToken)
    {
        await Changes.InsertOneAsync(new AccountChange
        {
            UserId = userId,
            Area = area,
            Summary = summary,
            CreatedAt = DateTime.UtcNow,
        }, cancellationToken: cancellationToken);
    }

    /// <summary>
    /// Les identifiants Mongo sont des ObjectId : une valeur arbitraire ne doit
    /// pas provoquer une erreur 500 lors de la traduction du filtre LINQ.
    /// </summary>
    private static void EnsureValidObjectId(string id, string notFoundMessage)
    {
        if (!ObjectId.TryParse(id, out _))
        {
            throw new NotFoundException(notFoundMessage);
        }
    }

    private static string NormalizeColor(string? value)
    {
        var trimmed = value?.Trim() ?? string.Empty;
        if (trimmed.Length == 0) return string.Empty;
        if (trimmed.Length == 7 && trimmed[0] == '#' &&
            trimmed[1..].All(c => Uri.IsHexDigit(c)))
        {
            return trimmed.ToLowerInvariant();
        }
        throw new BadRequestException("La couleur doit être au format hexadécimal #RRGGBB.");
    }

    private static ClientProfileResponse ToClientProfile(User user)
    {
        var response = new ClientProfileResponse
        {
            Id = user.Id,
            Email = user.Email,
            EmailVerified = user.EmailVerified != false,
            HasPassword = !string.IsNullOrWhiteSpace(user.PasswordHash),
            Role = user.Role,
            FirstName = user.FirstName,
            LastName = user.LastName,
            Phone = user.Phone ?? string.Empty,
            Avatar = user.Avatar,
            AvatarSource = string.IsNullOrWhiteSpace(user.AvatarSource) ? "initials" : user.AvatarSource,
            AvatarPreset = user.AvatarPreset,
            AvatarColor = user.AvatarColor,
            AvatarConfig = user.AvatarConfig,
            CompanyName = user.CompanyName,
            CompanyLogo = user.CompanyLogo,
            CoverImage = user.CoverImage,
            Industry = user.Industry,
            Position = user.Position,
            CompanyWebsite = user.CompanyWebsite,
            CompanySize = user.CompanySize,
            CompanyDescription = user.CompanyDescription,
            Country = user.Country,
            Governorate = user.Governorate,
            City = user.City,
            BusinessAddress = user.BusinessAddress,
            PersonalPresentation = user.PersonalPresentation,
            ProfessionalEmail = user.ProfessionalEmail,
            ProfessionalPhone = user.ProfessionalPhone,
            Website = user.Website ?? string.Empty,
            Bio = user.Bio,
            CreatedAt = user.CreatedAt,
            UpdatedAt = user.UpdatedAt,
        };

        var fields = new (string Label, string Value)[]
        {
            ("Prénom", response.FirstName),
            ("Nom", response.LastName),
            ("Téléphone", response.Phone),
            ("Nom de l'entreprise", response.CompanyName),
            ("Secteur d'activité", response.Industry),
            ("Poste occupé", response.Position),
            ("Site web", response.CompanyWebsite),
            ("Taille de l'entreprise", response.CompanySize),
            ("Description de l'entreprise", response.CompanyDescription),
            ("Pays", response.Country),
            ("Gouvernorat", response.Governorate),
            ("Ville", response.City),
            ("Adresse professionnelle", response.BusinessAddress),
            ("Présentation personnelle", response.PersonalPresentation),
        };

        var missing = fields.Where(f => string.IsNullOrWhiteSpace(f.Value)).Select(f => f.Label).ToList();
        response.MissingFields = missing;
        response.ProfileCompletion = (int)Math.Round((fields.Length - missing.Count) * 100.0 / fields.Length);
        return response;
    }

    private static TeamMemberResponse ToTeamResponse(TeamMember member, bool canManage) => new()
    {
        Id = member.Id,
        Email = member.Email,
        Name = member.Name,
        Role = member.Role,
        Status = member.Status,
        IsOwner = false,
        CanManage = canManage,
        InvitedAt = member.InvitedAt,
        AcceptedAt = member.AcceptedAt,
        RevokedAt = member.RevokedAt,
    };

    private static BillingProfileResponse ToBillingResponse(BillingProfile billing) => new()
    {
        LegalName = billing.LegalName,
        BillingAddress = billing.BillingAddress,
        Country = billing.Country,
        Governorate = billing.Governorate,
        City = billing.City,
        TaxId = billing.TaxId,
        ContactName = billing.ContactName,
        ContactEmail = billing.ContactEmail,
        ContactPhone = billing.ContactPhone,
        History = billing.History
            .OrderByDescending(h => h.ChangedAt)
            .Select(h => new BillingHistoryEntryResponse
            {
                ChangedAt = h.ChangedAt,
                Fields = h.Fields,
            }).ToList(),
        UpdatedAt = billing.UpdatedAt,
    };

    private static NotificationPreferencesDto ToNotificationPreferences(NotificationPreference prefs) => new()
    {
        EmailEnabled = prefs.EmailEnabled,
        InAppEnabled = prefs.InAppEnabled,
        InvitationsEnabled = prefs.InvitationsEnabled,
        ProjectActivityEnabled = prefs.ProjectActivityEnabled,
        MessagesEnabled = prefs.MessagesEnabled,
        BillingEnabled = prefs.BillingEnabled,
    };

    private static UserPreferencesDto ToPreferences(UserPreference prefs) => new()
    {
        Language = prefs.Language,
        Currency = prefs.Currency,
        Theme = prefs.Theme,
        Timezone = prefs.Timezone,
        DateFormat = prefs.DateFormat,
        ThousandsSeparator = prefs.ThousandsSeparator,
    };

    private static string CreateOpaqueToken() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');

    private static string HashToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
