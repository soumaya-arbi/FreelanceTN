namespace FreelanceTn.Api.Dtos.Services;

/// <summary>Package tarifaire proposé pour un service.</summary>
public class ServicePackageRequest
{
    public string Name { get; set; } = string.Empty;
    public decimal Price { get; set; }
    public int DeliveryDays { get; set; }
    public int Revisions { get; set; }
    public string? Description { get; set; }
}

/// <summary>
/// Demande de création d'un service. Le propriétaire n'y figure pas : il est
/// déduit de la session authentifiée par le service métier.
/// </summary>
public class CreateServiceRequest
{
    public string Title { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string? Subcategory { get; set; }
    public string Description { get; set; } = string.Empty;
    public List<ServicePackageRequest> Packages { get; set; } = [];
    public string? Requirements { get; set; }

    /// <summary>
    /// Tags de recherche facultatifs. Le type est nullable pour qu'une liste
    /// absente ("tags": null) soit normalisée en liste vide au lieu d'être
    /// rejetée par la validation implicite des propriétés non-nullables.
    /// </summary>
    public List<string>? Tags { get; set; }

    /// <summary>Statut initial : "Draft" ou "Published" (par défaut).</summary>
    public string? Status { get; set; }
}

/// <summary>Demande de modification : chaque champ absent conserve sa valeur actuelle.</summary>
public class UpdateServiceRequest
{
    public string? Title { get; set; }
    public string? Category { get; set; }
    public string? Subcategory { get; set; }
    public string? Description { get; set; }
    public List<ServicePackageRequest>? Packages { get; set; }
    public string? Requirements { get; set; }
    public List<string>? Tags { get; set; }
    public string? Status { get; set; }
}

/// <summary>Package tarifaire renvoyé au client.</summary>
public class ServicePackageResponse
{
    public string Name { get; set; } = string.Empty;
    public decimal Price { get; set; }
    public int DeliveryDays { get; set; }
    public int Revisions { get; set; }
    public string? Description { get; set; }
}

/// <summary>Service renvoyé au client.</summary>
public class ServiceResponse
{
    public string Id { get; set; } = string.Empty;

    /// <summary>Identifiant du freelance propriétaire (jamais fourni par le client).</summary>
    public string OwnerId { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string? Subcategory { get; set; }
    public string Description { get; set; } = string.Empty;
    public List<ServicePackageResponse> Packages { get; set; } = [];
    public string? Requirements { get; set; }
    public List<string> Tags { get; set; } = [];
    public string Status { get; set; } = string.Empty;

    /// <summary>Prix du package le moins cher (prix de départ affiché au catalogue).</summary>
    public decimal MinPrice { get; set; }

    public string Currency { get; set; } = "TND";
    public double Rating { get; set; }
    public int ReviewsCount { get; set; }
    public string? CoverImage { get; set; }

    /// <summary>Nom public du freelance auteur du service.</summary>
    public string AuthorName { get; set; } = string.Empty;

    public string? AuthorAvatar { get; set; }

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
