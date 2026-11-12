using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using FreelanceTn.Api.Configuration;
using FreelanceTn.Api.Data;
using FreelanceTn.Api.Dtos.Auth;
using FreelanceTn.Api.Dtos.Projects;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using FreelanceTn.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using MongoDB.Driver;

namespace FreelanceTn.Api.Controllers;

/// <summary>
/// Upload local des photos de profil. Les fichiers sont stockés hors de
/// wwwroot et servis par une route API, elle-même relayée par le proxy Next.
/// </summary>
[ApiController]
[Route("api/uploads")]
public class UploadsController : ControllerBase
{
    private static readonly Dictionary<string, string> ContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".jpg"] = "image/jpeg",
        [".jpeg"] = "image/jpeg",
        [".png"] = "image/png",
        [".webp"] = "image/webp",
    };

    private readonly AuthService _authService;
    private readonly IWebHostEnvironment _environment;
    private readonly MongoContext _mongo;
    private readonly AuthSettings _settings;

    public UploadsController(
        AuthService authService,
        IWebHostEnvironment environment,
        MongoContext mongo,
        IOptions<AuthSettings> settings)
    {
        _authService = authService;
        _environment = environment;
        _mongo = mongo;
        _settings = settings.Value;
    }

    private long MaxImageSize => Math.Max(1, _settings.MaxImageUploadMb) * 1024L * 1024L;

    private string CurrentUserId =>
        User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
        ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value
        ?? throw new UnauthorizedException("Session invalide.");

    [HttpPost("avatar")]
    [Authorize]
    [RequestSizeLimit(6_000_000)]
    public async Task<IActionResult> UploadAvatar(IFormFile? file, CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0)
        {
            throw new ConflictException("Sélectionnez une image.");
        }

        if (file.Length > MaxImageSize)
        {
            throw new ConflictException($"L'image ne peut pas dépasser {Math.Max(1, _settings.MaxImageUploadMb)} Mo.");
        }

        var bytes = await ReadAllBytesAsync(file, cancellationToken);
        var extension = DetectImageExtension(bytes)
            ?? throw new ConflictException("Formats acceptés : JPG, PNG ou WebP.");

        var fileName = $"{Guid.NewGuid():N}{extension}";
        var directory = GetAvatarDirectory();
        Directory.CreateDirectory(directory);

        var path = Path.Combine(directory, fileName);
        await System.IO.File.WriteAllBytesAsync(path, bytes, cancellationToken);

        var current = await _authService.GetByIdAsync(CurrentUserId, cancellationToken);
        var avatarUrl = $"/api/uploads/avatar/{fileName}";

        try
        {
            var updated = await _authService.UpdateProfileAsync(
                CurrentUserId,
                new UpdateProfileRequest { Avatar = avatarUrl, AvatarSource = "upload" },
                cancellationToken);

            DeletePreviousUpload(current?.Avatar, "/api/uploads/avatar/", GetAvatarDirectory());
            return Ok(updated);
        }
        catch
        {
            TryDelete(path);
            throw;
        }
    }

    [HttpGet("avatar/{fileName}")]
    [AllowAnonymous]
    public IActionResult GetAvatar(string fileName)
    {
        return GetImage("avatars", fileName);
    }

    [HttpPost("cover")]
    [Authorize]
    [RequestSizeLimit(6_000_000)]
    public Task<IActionResult> UploadCover(IFormFile? file, CancellationToken cancellationToken) =>
        UploadUserImageAsync("cover", "covers", u => u.CoverImage, file, cancellationToken, requireClient: false);

    [HttpPost("logo")]
    [Authorize]
    [RequestSizeLimit(6_000_000)]
    public Task<IActionResult> UploadLogo(IFormFile? file, CancellationToken cancellationToken) =>
        UploadUserImageAsync("logo", "logos", u => u.CompanyLogo, file, cancellationToken, requireClient: true);

    [HttpGet("cover/{fileName}")]
    [AllowAnonymous]
    public IActionResult GetCover(string fileName) => GetImage("covers", fileName);

    [HttpGet("logo/{fileName}")]
    [AllowAnonymous]
    public IActionResult GetLogo(string fileName) => GetImage("logos", fileName);

    [HttpDelete("cover")]
    [Authorize]
    public Task<IActionResult> DeleteCover(CancellationToken cancellationToken) =>
        DeleteUserImageAsync("/api/uploads/cover/", "covers", u => u.CoverImage, cancellationToken, requireClient: false);

    [HttpDelete("logo")]
    [Authorize]
    public Task<IActionResult> DeleteLogo(CancellationToken cancellationToken) =>
        DeleteUserImageAsync("/api/uploads/logo/", "logos", u => u.CompanyLogo, cancellationToken, requireClient: true);

    [HttpDelete("avatar")]
    [Authorize]
    public async Task<IActionResult> DeleteAvatar(CancellationToken cancellationToken)
    {
        var user = await _authService.GetByIdAsync(CurrentUserId, cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");

        DeletePreviousUpload(user.Avatar, "/api/uploads/avatar/", GetImageDirectory("avatars"));

        var users = _mongo.GetCollection<User>(_mongo.Settings.UsersCollection);
        var update = Builders<User>.Update
            .Set(u => u.Avatar, string.Empty)
            .Set(u => u.AvatarSource, "initials")
            .Set(u => u.UpdatedAt, DateTime.UtcNow);
        await users.UpdateOneAsync(u => u.Id == CurrentUserId, update, cancellationToken: cancellationToken);

        var updated = await _authService.GetByIdAsync(CurrentUserId, cancellationToken);
        return Ok(AuthService.ToResponse(updated!));
    }

    private async Task<IActionResult> UploadUserImageAsync(
        string kind,
        string folder,
        System.Linq.Expressions.Expression<Func<User, string>> field,
        IFormFile? file,
        CancellationToken cancellationToken,
        bool requireClient = false)
    {
        if (requireClient)
        {
            RequireClient();
        }

        if (file is null || file.Length == 0)
        {
            throw new ConflictException("Sélectionnez une image.");
        }

        if (file.Length > MaxImageSize)
        {
            throw new ConflictException($"L'image ne peut pas dépasser {Math.Max(1, _settings.MaxImageUploadMb)} Mo.");
        }

        var bytes = await ReadAllBytesAsync(file, cancellationToken);
        var extension = DetectImageExtension(bytes)
            ?? throw new ConflictException("Formats acceptés : JPG, PNG ou WebP.");

        var fileName = $"{Guid.NewGuid():N}{extension}";
        var directory = GetImageDirectory(folder);
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, fileName);
        await System.IO.File.WriteAllBytesAsync(path, bytes, cancellationToken);

        var user = await _authService.GetByIdAsync(CurrentUserId, cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");

        var previous = kind == "cover" ? user.CoverImage : user.CompanyLogo;
        var url = $"/api/uploads/{kind}/{fileName}";

        try
        {
            var users = _mongo.GetCollection<User>(_mongo.Settings.UsersCollection);
            var update = Builders<User>.Update
                .Set(field, url)
                .Set(u => u.UpdatedAt, DateTime.UtcNow);
            await users.UpdateOneAsync(u => u.Id == CurrentUserId, update, cancellationToken: cancellationToken);

            DeletePreviousUpload(previous, $"/api/uploads/{kind}/", directory);
            return Ok(new { url });
        }
        catch
        {
            TryDelete(path);
            throw;
        }
    }

    private async Task<IActionResult> DeleteUserImageAsync(
        string urlPrefix,
        string folder,
        System.Linq.Expressions.Expression<Func<User, string>> field,
        CancellationToken cancellationToken,
        bool requireClient = false)
    {
        if (requireClient)
        {
            RequireClient();
        }

        var user = await _authService.GetByIdAsync(CurrentUserId, cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");

        var current = urlPrefix.Contains("cover", StringComparison.OrdinalIgnoreCase)
            ? user.CoverImage
            : user.CompanyLogo;
        DeletePreviousUpload(current, urlPrefix, GetImageDirectory(folder));

        var users = _mongo.GetCollection<User>(_mongo.Settings.UsersCollection);
        var update = Builders<User>.Update
            .Set(field, string.Empty)
            .Set(u => u.UpdatedAt, DateTime.UtcNow);
        await users.UpdateOneAsync(u => u.Id == CurrentUserId, update, cancellationToken: cancellationToken);

        return NoContent();
    }

    private void RequireClient()
    {
        var role = User.FindFirst(ClaimTypes.Role)?.Value;
        if (!string.Equals(role, UserRole.Client, StringComparison.OrdinalIgnoreCase))
        {
            throw new ForbiddenException("Cette fonctionnalité est réservée aux comptes client.");
        }
    }

    private IActionResult GetImage(string folder, string fileName)
    {
        if (string.IsNullOrWhiteSpace(fileName) || Path.GetFileName(fileName) != fileName)
        {
            throw new NotFoundException("Image introuvable.");
        }

        var extension = Path.GetExtension(fileName);
        if (!ContentTypes.TryGetValue(extension, out var contentType))
        {
            throw new NotFoundException("Image introuvable.");
        }

        var path = Path.Combine(GetImageDirectory(folder), fileName);
        if (!System.IO.File.Exists(path))
        {
            throw new NotFoundException("Image introuvable.");
        }

        Response.Headers.CacheControl = "public,max-age=31536000,immutable";
        return PhysicalFile(path, contentType, enableRangeProcessing: true);
    }

    [HttpPost("project/{projectId}")]
    [Authorize]
    [RequestSizeLimit(20_000_000)]
    public async Task<IActionResult> UploadProjectAttachment(string projectId, IFormFile? file, CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0) throw new ConflictException("Sélectionnez un fichier.");
        if (file.Length > 10 * 1024 * 1024) throw new ConflictException("Le fichier ne peut pas dépasser 10 Mo.");

        var directory = GetProjectDirectory(projectId);

        var projects = _mongo.GetCollection<Project>(_mongo.Settings.ProjectsCollection);
        var project = await projects.Find(p => p.Id == projectId).FirstOrDefaultAsync(cancellationToken);
        if (project is null)
        {
            throw new NotFoundException("Projet introuvable.");
        }

        var currentUserId = CurrentUserId;
        if (!string.Equals(project.OwnerId, currentUserId, StringComparison.Ordinal))
        {
            throw new ForbiddenException("Seul le propriétaire du projet peut ajouter des pièces jointes.");
        }

        var safeName = Path.GetFileName(file.FileName);
        var extension = Path.GetExtension(safeName);
        var allowed = new[] { ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".png", ".jpg", ".jpeg", ".zip", ".txt" };
        if (!allowed.Contains(extension, StringComparer.OrdinalIgnoreCase)) throw new ConflictException("Format non autorisé.");

        var fileName = $"{Guid.NewGuid():N}{extension}";
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, fileName);
        using (var stream = System.IO.File.Create(path))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        var url = $"/api/uploads/project/{projectId}/{fileName}";
        var attachment = new ProjectAttachment
        {
            FileName = safeName,
            Url = url,
            Size = file.Length,
            UploadedAt = DateTime.UtcNow,
        };

        // Enregistrer la pièce jointe dans le projet s'il n'existe pas déjà
        if (!project.Attachments.Any(a => string.Equals(a.Url, url, StringComparison.OrdinalIgnoreCase)))
        {
            var filter = Builders<Project>.Filter.Eq(p => p.Id, projectId);
            var update = Builders<Project>.Update.Push(p => p.Attachments, attachment);
            await projects.UpdateOneAsync(filter, update, cancellationToken: cancellationToken);
        }

        return Ok(new UploadProjectAttachmentResponse
        {
            FileName = safeName,
            Url = url,
            Size = file.Length,
            UploadedAt = attachment.UploadedAt,
        });
    }

    [HttpGet("project/{projectId}/{fileName}")]
    [Authorize]
    public async Task<IActionResult> GetProjectAttachment(string projectId, string fileName, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(fileName) || Path.GetFileName(fileName) != fileName || fileName.Contains("..") || fileName.Contains('/') || fileName.Contains('\\'))
        {
            throw new NotFoundException("Fichier introuvable.");
        }

        var directory = GetProjectDirectory(projectId);

        var projects = _mongo.GetCollection<Project>(_mongo.Settings.ProjectsCollection);
        var project = await projects.Find(p => p.Id == projectId).FirstOrDefaultAsync(cancellationToken);
        if (project is null)
        {
            throw new NotFoundException("Projet introuvable.");
        }

        var currentUserId = CurrentUserId;
        var isOwner = string.Equals(project.OwnerId, currentUserId, StringComparison.Ordinal);
        var isAssigned = !string.IsNullOrWhiteSpace(project.AssignedTo) && string.Equals(project.AssignedTo, currentUserId, StringComparison.Ordinal);

        if (!isOwner && !isAssigned)
        {
            throw new ForbiddenException("Accès refusé.");
        }

        var path = Path.GetFullPath(Path.Combine(directory, fileName));
        if (!path.StartsWith(directory + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !System.IO.File.Exists(path))
        {
            throw new NotFoundException("Fichier introuvable.");
        }

        var extension = Path.GetExtension(fileName).ToLowerInvariant();
        var contentType = extension switch
        {
            ".pdf" => "application/pdf",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            ".webp" => "image/webp",
            ".txt" => "text/plain",
            ".zip" => "application/zip",
            ".doc" => "application/msword",
            ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".xls" => "application/vnd.ms-excel",
            ".xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            _ => "application/octet-stream",
        };

        return PhysicalFile(path, contentType, enableRangeProcessing: true);
    }

    private string GetProjectDirectory(string projectId)
    {
        if (string.IsNullOrWhiteSpace(projectId) || projectId.Contains("..") || projectId.Contains('/') || projectId.Contains('\\'))
        {
            throw new NotFoundException("Projet introuvable.");
        }

        var baseDir = Path.GetFullPath(Path.Combine(_environment.ContentRootPath, "App_Data", "uploads", "projects"));
        var dir = Path.GetFullPath(Path.Combine(baseDir, projectId));
        if (!dir.StartsWith(baseDir + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
        {
            throw new NotFoundException("Projet introuvable.");
        }

        return dir;
    }

    private string GetAvatarDirectory() => GetImageDirectory("avatars");

    private string GetImageDirectory(string folder) =>
        Path.Combine(_environment.ContentRootPath, "App_Data", "uploads", folder);

    private static void DeletePreviousUpload(string? url, string prefix, string directory)
    {
        if (string.IsNullOrWhiteSpace(url) || !url.StartsWith(prefix, StringComparison.Ordinal))
        {
            return;
        }

        var fileName = url[prefix.Length..];
        if (Path.GetFileName(fileName) != fileName)
        {
            return;
        }

        TryDelete(Path.Combine(directory, fileName));
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (System.IO.File.Exists(path)) System.IO.File.Delete(path);
        }
        catch
        {
            // Un ancien fichier non supprimé ne doit pas faire échouer l'upload.
        }
    }

    private static async Task<byte[]> ReadAllBytesAsync(IFormFile file, CancellationToken cancellationToken)
    {
        using var stream = file.OpenReadStream();
        using var memory = new MemoryStream();
        await stream.CopyToAsync(memory, cancellationToken);
        return memory.ToArray();
    }

    /// <summary>Détecte le format à partir des octets, jamais du nom fourni.</summary>
    private static string? DetectImageExtension(byte[] bytes)
    {
        if (bytes.Length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF)
        {
            return ".jpg";
        }

        if (bytes.Length >= 8 &&
            bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47 &&
            bytes[4] == 0x0D && bytes[5] == 0x0A && bytes[6] == 0x1A && bytes[7] == 0x0A)
        {
            return ".png";
        }

        if (bytes.Length >= 12 &&
            bytes[0] == (byte)'R' && bytes[1] == (byte)'I' && bytes[2] == (byte)'F' && bytes[3] == (byte)'F' &&
            bytes[8] == (byte)'W' && bytes[9] == (byte)'E' && bytes[10] == (byte)'B' && bytes[11] == (byte)'P')
        {
            return ".webp";
        }

        return null;
    }
}
