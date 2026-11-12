namespace FreelanceTn.Api.Configuration;

public class CorsSettings
{
    public const string SectionName = "Cors";

    public const string PolicyName = "FrontendPolicy";

    public string[] AllowedOrigins { get; set; } = [];
}
