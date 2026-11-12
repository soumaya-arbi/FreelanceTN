using System.Text.RegularExpressions;
using FreelanceTn.Api.Data;
using FreelanceTn.Api.Dtos.Services;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using MongoDB.Bson;
using MongoDB.Driver;

namespace FreelanceTn.Api.Services;

/// <summary>
/// Gestion des services (offres) des freelances. Le propriétaire d'un service est
/// toujours déduit de l'utilisateur authentifié : il n'est jamais lu dans la requête.
/// </summary>
public class ServiceService
{
    private readonly MongoContext _mongo;

    public ServiceService(MongoContext mongo)
    {
        _mongo = mongo;
    }

    private IMongoCollection<Service> Services => _mongo.GetCollection<Service>(_mongo.Settings.ServicesCollection);

    private IMongoCollection<User> Users => _mongo.GetCollection<User>(_mongo.Settings.UsersCollection);

    public async Task<ServiceResponse> CreateAsync(string ownerId, CreateServiceRequest request, CancellationToken cancellationToken)
    {
        await EnsureFreelancerAsync(ownerId, cancellationToken);

        var packages = NormalizePackages(request.Packages);
        var status = string.IsNullOrWhiteSpace(request.Status)
            ? ServiceStatus.Published
            : ServiceStatus.Normalize(request.Status);

        var service = new Service
        {
            OwnerId = ownerId,
            Title = request.Title.Trim(),
            Category = request.Category.Trim(),
            Subcategory = string.IsNullOrWhiteSpace(request.Subcategory) ? null : request.Subcategory.Trim(),
            Description = request.Description.Trim(),
            Packages = packages,
            Requirements = string.IsNullOrWhiteSpace(request.Requirements) ? null : request.Requirements.Trim(),
            Tags = NormalizeTags(request.Tags),
            Status = status,
            MinPrice = packages.Min(package => package.Price),
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };

        await Services.InsertOneAsync(service, cancellationToken: cancellationToken);
        return ToResponse(service, await GetAuthorAsync(ownerId, cancellationToken));
    }

    /// <summary>Services du freelance connecté, tous statuts confondus (brouillon, publié, archivé).</summary>
    public async Task<List<ServiceResponse>> ListMineAsync(string ownerId, CancellationToken cancellationToken)
    {
        await EnsureFreelancerAsync(ownerId, cancellationToken);

        var services = await Services
            .Find(service => service.OwnerId == ownerId)
            .SortByDescending(service => service.UpdatedAt)
            .ToListAsync(cancellationToken);

        var authors = await GetAuthorsAsync(services.Select(service => service.OwnerId).Distinct().ToList(), cancellationToken);
        return services.Select(service => ToResponse(service, authors.GetValueOrDefault(service.OwnerId))).ToList();
    }

    /// <summary>Catalogue public : seuls les services publiés sont exposés.</summary>
    public async Task<List<ServiceResponse>> ListPublishedAsync(string? category, string? query, int limit, CancellationToken cancellationToken)
    {
        var filter = Builders<Service>.Filter.Eq(service => service.Status, ServiceStatus.Published);

        if (!string.IsNullOrWhiteSpace(category))
        {
            filter &= Builders<Service>.Filter.Regex(
                service => service.Category,
                new BsonRegularExpression($"^{Regex.Escape(category.Trim())}$", "i"));
        }

        if (!string.IsNullOrWhiteSpace(query))
        {
            var pattern = new BsonRegularExpression(Regex.Escape(query.Trim()), "i");
            filter &= Builders<Service>.Filter.Or(
                Builders<Service>.Filter.Regex(service => service.Title, pattern),
                Builders<Service>.Filter.Regex(service => service.Description, pattern),
                Builders<Service>.Filter.Regex(service => service.Tags, pattern));
        }

        var services = await Services
            .Find(filter)
            .SortByDescending(service => service.CreatedAt)
            .Limit(limit)
            .ToListAsync(cancellationToken);

        var authors = await GetAuthorsAsync(services.Select(service => service.OwnerId).Distinct().ToList(), cancellationToken);
        return services.Select(service => ToResponse(service, authors.GetValueOrDefault(service.OwnerId))).ToList();
    }

    /// <summary>
    /// Consultation d'un service. Un service publié est visible par tous ; un service
    /// brouillon ou archivé n'est visible que par son propriétaire.
    /// </summary>
    public async Task<ServiceResponse> GetAsync(string? requesterId, string serviceId, CancellationToken cancellationToken)
    {
        var service = await FindAsync(serviceId, cancellationToken);
        var isOwner = requesterId is not null && service.OwnerId == requesterId;

        if (service.Status != ServiceStatus.Published && !isOwner)
        {
            throw new NotFoundException("Service introuvable.");
        }

        var author = await GetAuthorAsync(service.OwnerId, cancellationToken);
        return ToResponse(service, author);
    }

    public async Task<ServiceResponse> UpdateAsync(string ownerId, string serviceId, UpdateServiceRequest request, CancellationToken cancellationToken)
    {
        await EnsureFreelancerAsync(ownerId, cancellationToken);

        var service = await FindOwnedAsync(ownerId, serviceId, cancellationToken);

        if (request.Title is not null) service.Title = request.Title.Trim();
        if (request.Category is not null) service.Category = request.Category.Trim();
        if (request.Subcategory is not null) service.Subcategory = request.Subcategory.Trim();
        if (request.Description is not null) service.Description = request.Description.Trim();
        if (request.Requirements is not null) service.Requirements = request.Requirements.Trim();

        if (request.Packages is not null)
        {
            service.Packages = NormalizePackages(request.Packages);
            service.MinPrice = service.Packages.Min(package => package.Price);
        }

        if (request.Tags is not null) service.Tags = NormalizeTags(request.Tags);

        if (request.Status is not null)
        {
            var target = ServiceStatus.Normalize(request.Status);

            if (!ServiceStatus.CanTransition(service.Status, target))
            {
                throw new ConflictException($"Transition de statut non autorisée : « {service.Status} » vers « {target} ».");
            }

            service.Status = target;
        }

        service.UpdatedAt = DateTime.UtcNow;

        await Services.ReplaceOneAsync(
            item => item.Id == service.Id && item.OwnerId == ownerId,
            service,
            cancellationToken: cancellationToken);

        var author = await GetAuthorAsync(service.OwnerId, cancellationToken);
        return ToResponse(service, author);
    }

    public async System.Threading.Tasks.Task DeleteAsync(string ownerId, string serviceId, CancellationToken cancellationToken)
    {
        await EnsureFreelancerAsync(ownerId, cancellationToken);

        await FindOwnedAsync(ownerId, serviceId, cancellationToken);
        await Services.DeleteOneAsync(item => item.Id == serviceId && item.OwnerId == ownerId, cancellationToken);
    }

    /// <summary>
    /// Récupère un service uniquement s'il appartient au freelance authentifié.
    /// Un identifiant invalide ou un service d'un autre freelance renvoie le même 404 :
    /// aucune information n'est divulguée.
    /// </summary>
    private async Task<Service> FindOwnedAsync(string ownerId, string serviceId, CancellationToken cancellationToken)
    {
        if (!MongoDB.Bson.ObjectId.TryParse(serviceId, out _))
        {
            throw new NotFoundException("Service introuvable.");
        }

        var service = await Services
            .Find(item => item.Id == serviceId && item.OwnerId == ownerId)
            .FirstOrDefaultAsync(cancellationToken);

        return service ?? throw new NotFoundException("Service introuvable.");
    }

    private async Task<Service> FindAsync(string serviceId, CancellationToken cancellationToken)
    {
        if (!MongoDB.Bson.ObjectId.TryParse(serviceId, out _))
        {
            throw new NotFoundException("Service introuvable.");
        }

        var service = await Services
            .Find(item => item.Id == serviceId)
            .FirstOrDefaultAsync(cancellationToken);

        return service ?? throw new NotFoundException("Service introuvable.");
    }

    /// <summary>
    /// Seul un freelance peut gérer des services. Le rôle est relu en base (source de
    /// vérité) et non déduit d'une valeur fournie par le client.
    /// </summary>
    private async System.Threading.Tasks.Task EnsureFreelancerAsync(string userId, CancellationToken cancellationToken)
    {
        var user = await Users.Find(item => item.Id == userId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");

        if (!string.Equals(user.Role, UserRole.Freelancer, StringComparison.OrdinalIgnoreCase))
        {
            throw new ForbiddenException("Seuls les freelancers peuvent gérer leurs services.");
        }
    }

    private async Task<User?> GetAuthorAsync(string ownerId, CancellationToken cancellationToken)
    {
        return await Users.Find(item => item.Id == ownerId).FirstOrDefaultAsync(cancellationToken);
    }

    private async Task<Dictionary<string, User>> GetAuthorsAsync(List<string> ownerIds, CancellationToken cancellationToken)
    {
        if (ownerIds.Count == 0) return [];

        var users = await Users.Find(item => ownerIds.Contains(item.Id)).ToListAsync(cancellationToken);
        return users.ToDictionary(user => user.Id);
    }

    private static List<ServicePackage> NormalizePackages(IEnumerable<ServicePackageRequest> packages) =>
        packages
            .Select(package => new ServicePackage
            {
                Name = package.Name.Trim(),
                Price = package.Price,
                DeliveryDays = package.DeliveryDays,
                Revisions = package.Revisions,
                Description = string.IsNullOrWhiteSpace(package.Description) ? null : package.Description.Trim(),
            })
            .ToList();

    private static List<string> NormalizeTags(IEnumerable<string>? tags) =>
        (tags ?? [])
            .Select(tag => tag.Trim())
            .Where(tag => tag.Length > 0)
            .Distinct()
            .ToList();

    private static ServiceResponse ToResponse(Service service, User? author) => new()
    {
        Id = service.Id,
        OwnerId = service.OwnerId,
        Title = service.Title,
        Category = service.Category,
        Subcategory = service.Subcategory,
        Description = service.Description,
        Packages = service.Packages.Select(package => new ServicePackageResponse
        {
            Name = package.Name,
            Price = package.Price,
            DeliveryDays = package.DeliveryDays,
            Revisions = package.Revisions,
            Description = package.Description,
        }).ToList(),
        Requirements = service.Requirements,
        Tags = service.Tags,
        Status = service.Status,
        MinPrice = service.MinPrice,
        Rating = service.Rating,
        ReviewsCount = service.ReviewsCount,
        CoverImage = service.CoverImage,
        AuthorName = author is null ? string.Empty : $"{author.FirstName} {author.LastName}".Trim(),
        AuthorAvatar = author?.Avatar,
        CreatedAt = service.CreatedAt,
        UpdatedAt = service.UpdatedAt,
    };
}
