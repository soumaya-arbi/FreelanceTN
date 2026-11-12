namespace FreelanceTn.Api.Dtos.Portfolio;

/// <summary>
/// Demande de création d'une réalisation. Le propriétaire n'y figure pas :
/// il est déduit de la session authentifiée.
/// </summary>
public class CreatePortfolioItemRequest
{
    public string Title { get; set; } = string.Empty;
    public string Summary { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string? Role { get; set; }
    public string? Duration { get; set; }
    public string? Challenge { get; set; }
    public string? Solution { get; set; }
    public string? Outcome { get; set; }
    public List<string>? Skills { get; set; }
    public string? Link { get; set; }
    public string? Image { get; set; }
    public string? Visibility { get; set; }
    public bool Published { get; set; }
}

/// <summary>Demande de modification : chaque champ absent conserve sa valeur actuelle.</summary>
public class UpdatePortfolioItemRequest
{
    public string? Title { get; set; }
    public string? Summary { get; set; }
    public string? Category { get; set; }
    public string? Role { get; set; }
    public string? Duration { get; set; }
    public string? Challenge { get; set; }
    public string? Solution { get; set; }
    public string? Outcome { get; set; }
    public List<string>? Skills { get; set; }
    public string? Link { get; set; }
    public string? Image { get; set; }
    public string? Visibility { get; set; }
    public bool? Published { get; set; }
}

/// <summary>Réalisation renvoyée au client.</summary>
public class PortfolioItemResponse
{
    public string Id { get; set; } = string.Empty;

    /// <summary>Identifiant du freelance propriétaire (jamais fourni par le client).</summary>
    public string OwnerId { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;
    public string Summary { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string? Role { get; set; }
    public string? Duration { get; set; }
    public string? Challenge { get; set; }
    public string? Solution { get; set; }
    public string? Outcome { get; set; }
    public List<string> Skills { get; set; } = [];
    public string? Link { get; set; }
    public string? Image { get; set; }
    public string Visibility { get; set; } = string.Empty;
    public bool Published { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
