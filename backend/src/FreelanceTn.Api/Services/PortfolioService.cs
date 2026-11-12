using System.Threading;
using System.Threading.Tasks;
using FreelanceTn.Api.Data;
using FreelanceTn.Api.Dtos.Portfolio;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using MongoDB.Bson;
using MongoDB.Driver;

namespace FreelanceTn.Api.Services;

/// <summary>
/// Gestion du portfolio des freelances. Le propriétaire est toujours déduit de
/// la session authentifiée et les éléments non publiés ou privés ne sont jamais
/// exposés sur le profil public.
/// </summary>
public class PortfolioService
{
    private readonly MongoContext _mongo;

    public PortfolioService(MongoContext mongo)
    {
        _mongo = mongo;
    }

    private IMongoCollection<PortfolioItem> Portfolio =>
        _mongo.GetCollection<PortfolioItem>(_mongo.Settings.PortfolioCollection);

    private IMongoCollection<User> Users =>
        _mongo.GetCollection<User>(_mongo.Settings.UsersCollection);

    public async Task<PortfolioItemResponse> CreateAsync(
        string ownerId,
        CreatePortfolioItemRequest request,
        CancellationToken cancellationToken)
    {
        await EnsureFreelancerAsync(ownerId, cancellationToken);

        var now = DateTime.UtcNow;
        var item = new PortfolioItem
        {
            OwnerId = ownerId,
            Title = request.Title.Trim(),
            Summary = request.Summary.Trim(),
            Category = request.Category.Trim(),
            Role = NormalizeOptional(request.Role),
            Duration = NormalizeOptional(request.Duration),
            Challenge = NormalizeOptional(request.Challenge),
            Solution = NormalizeOptional(request.Solution),
            Outcome = NormalizeOptional(request.Outcome),
            Skills = NormalizeSkills(request.Skills),
            Link = NormalizeOptional(request.Link),
            Image = NormalizeOptional(request.Image),
            Visibility = PortfolioVisibility.Normalize(request.Visibility),
            Published = request.Published,
            CreatedAt = now,
            UpdatedAt = now,
        };

        await Portfolio.InsertOneAsync(item, cancellationToken: cancellationToken);
        return ToResponse(item);
    }

    /// <summary>Toutes les réalisations du freelance connecté, brouillons compris.</summary>
    public async Task<List<PortfolioItemResponse>> ListMineAsync(string ownerId, CancellationToken cancellationToken)
    {
        await EnsureFreelancerAsync(ownerId, cancellationToken);

        var items = await Portfolio
            .Find(item => item.OwnerId == ownerId)
            .SortByDescending(item => item.UpdatedAt)
            .ToListAsync(cancellationToken);

        return items.Select(ToResponse).ToList();
    }

    /// <summary>
    /// Portfolio public d'un freelance : uniquement les réalisations publiées.
    /// Les éléments "Registered clients only" sont réservés aux clients connectés.
    /// </summary>
    public async Task<List<PortfolioItemResponse>> ListForFreelancerAsync(
        string freelancerId,
        bool isClient,
        CancellationToken cancellationToken)
    {
        await EnsureFreelancerExistsAsync(freelancerId, cancellationToken);

        var allowedVisibilities = new List<string> { PortfolioVisibility.Public };
        if (isClient) allowedVisibilities.Add(PortfolioVisibility.RegisteredClientsOnly);

        var filter = Builders<PortfolioItem>.Filter.Eq(item => item.OwnerId, freelancerId)
            & Builders<PortfolioItem>.Filter.Eq(item => item.Published, true)
            & Builders<PortfolioItem>.Filter.In(item => item.Visibility, allowedVisibilities);

        var items = await Portfolio
            .Find(filter)
            .SortByDescending(item => item.UpdatedAt)
            .ToListAsync(cancellationToken);

        return items.Select(ToResponse).ToList();
    }

    /// <summary>
    /// Consultation d'une réalisation. Le propriétaire voit tout ; les autres
    /// utilisateurs ne voient que les éléments publiés et autorisés. Un élément
    /// inaccessible renvoie le même 404 qu'un identifiant inexistant.
    /// </summary>
    public async Task<PortfolioItemResponse> GetAsync(
        string? requesterId,
        bool isClient,
        string itemId,
        CancellationToken cancellationToken)
    {
        var item = await FindAsync(itemId, cancellationToken);

        if (!CanView(item, requesterId, isClient))
        {
            throw new NotFoundException("Réalisation introuvable.");
        }

        return ToResponse(item);
    }

    public async Task<PortfolioItemResponse> UpdateAsync(
        string ownerId,
        string itemId,
        UpdatePortfolioItemRequest request,
        CancellationToken cancellationToken)
    {
        await EnsureFreelancerAsync(ownerId, cancellationToken);

        var item = await FindOwnedAsync(ownerId, itemId, cancellationToken);

        if (request.Title is not null) item.Title = request.Title.Trim();
        if (request.Summary is not null) item.Summary = request.Summary.Trim();
        if (request.Category is not null) item.Category = request.Category.Trim();
        if (request.Role is not null) item.Role = NormalizeOptional(request.Role);
        if (request.Duration is not null) item.Duration = NormalizeOptional(request.Duration);
        if (request.Challenge is not null) item.Challenge = NormalizeOptional(request.Challenge);
        if (request.Solution is not null) item.Solution = NormalizeOptional(request.Solution);
        if (request.Outcome is not null) item.Outcome = NormalizeOptional(request.Outcome);
        if (request.Skills is not null) item.Skills = NormalizeSkills(request.Skills);
        if (request.Link is not null) item.Link = NormalizeOptional(request.Link);
        if (request.Image is not null) item.Image = NormalizeOptional(request.Image);
        if (request.Visibility is not null) item.Visibility = PortfolioVisibility.Normalize(request.Visibility);
        if (request.Published.HasValue) item.Published = request.Published.Value;

        item.UpdatedAt = DateTime.UtcNow;

        await Portfolio.ReplaceOneAsync(
            entry => entry.Id == item.Id && entry.OwnerId == ownerId,
            item,
            cancellationToken: cancellationToken);

        return ToResponse(item);
    }

    public async System.Threading.Tasks.Task DeleteAsync(string ownerId, string itemId, CancellationToken cancellationToken)
    {
        await EnsureFreelancerAsync(ownerId, cancellationToken);

        await FindOwnedAsync(ownerId, itemId, cancellationToken);
        await Portfolio.DeleteOneAsync(item => item.Id == itemId && item.OwnerId == ownerId, cancellationToken);
    }

    private static bool CanView(PortfolioItem item, string? requesterId, bool isClient)
    {
        if (requesterId is not null && item.OwnerId == requesterId) return true;
        if (!item.Published) return false;

        return item.Visibility switch
        {
            PortfolioVisibility.Public => true,
            PortfolioVisibility.RegisteredClientsOnly => isClient,
            _ => false,
        };
    }

    private async Task<PortfolioItem> FindOwnedAsync(string ownerId, string itemId, CancellationToken cancellationToken)
    {
        if (!ObjectId.TryParse(itemId, out _))
        {
            throw new NotFoundException("Réalisation introuvable.");
        }

        var item = await Portfolio
            .Find(entry => entry.Id == itemId && entry.OwnerId == ownerId)
            .FirstOrDefaultAsync(cancellationToken);

        return item ?? throw new NotFoundException("Réalisation introuvable.");
    }

    private async Task<PortfolioItem> FindAsync(string itemId, CancellationToken cancellationToken)
    {
        if (!ObjectId.TryParse(itemId, out _))
        {
            throw new NotFoundException("Réalisation introuvable.");
        }

        var item = await Portfolio
            .Find(entry => entry.Id == itemId)
            .FirstOrDefaultAsync(cancellationToken);

        return item ?? throw new NotFoundException("Réalisation introuvable.");
    }

    public async System.Threading.Tasks.Task EnsureFreelancerAsync(string userId, CancellationToken cancellationToken)
    {
        var user = await Users.Find(item => item.Id == userId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");

        if (!string.Equals(user.Role, UserRole.Freelancer, StringComparison.OrdinalIgnoreCase))
        {
            throw new ForbiddenException("Seuls les freelancers peuvent gérer leur portfolio.");
        }
    }

    private async System.Threading.Tasks.Task EnsureFreelancerExistsAsync(string freelancerId, CancellationToken cancellationToken)
    {
        if (!ObjectId.TryParse(freelancerId, out _))
        {
            throw new NotFoundException("Freelance introuvable.");
        }

        var user = await Users.Find(item => item.Id == freelancerId).FirstOrDefaultAsync(cancellationToken);
        if (user is null || !string.Equals(user.Role, UserRole.Freelancer, StringComparison.OrdinalIgnoreCase))
        {
            throw new NotFoundException("Freelance introuvable.");
        }
    }

    private static string? NormalizeOptional(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static List<string> NormalizeSkills(IEnumerable<string>? skills) =>
        (skills ?? [])
            .Select(skill => skill.Trim())
            .Where(skill => skill.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

    private static PortfolioItemResponse ToResponse(PortfolioItem item) => new()
    {
        Id = item.Id,
        OwnerId = item.OwnerId,
        Title = item.Title,
        Summary = item.Summary,
        Category = item.Category,
        Role = item.Role,
        Duration = item.Duration,
        Challenge = item.Challenge,
        Solution = item.Solution,
        Outcome = item.Outcome,
        Skills = item.Skills,
        Link = item.Link,
        Image = item.Image,
        Visibility = item.Visibility,
        Published = item.Published,
        CreatedAt = item.CreatedAt,
        UpdatedAt = item.UpdatedAt,
    };
}
