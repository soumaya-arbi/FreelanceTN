using System.Net.Http;
using System.Text;
using FreelanceTn.Api.Data;
using FreelanceTn.Api.Dtos.Portfolio;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using Microsoft.AspNetCore.Hosting;
using MongoDB.Driver;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace FreelanceTn.Api.Services;

/// <summary>
/// Génération d'un CV PDF professionnel à partir des données réelles du compte
/// connecté et de ses réalisations portfolio. Aucune donnée fictive n'est ajoutée
/// et aucune section vide n'est imprimée.
/// </summary>
public class CvPdfService
{
    private readonly MongoContext _mongo;
    private readonly PortfolioService _portfolioService;
    private readonly IWebHostEnvironment _environment;

    static CvPdfService()
    {
        QuestPDF.Settings.License = LicenseType.Community;
    }

    public CvPdfService(MongoContext mongo, PortfolioService portfolioService, IWebHostEnvironment environment)
    {
        _mongo = mongo;
        _portfolioService = portfolioService;
        _environment = environment;
    }

    private IMongoCollection<User> Users =>
        _mongo.GetCollection<User>(_mongo.Settings.UsersCollection);

    public async Task<byte[]> GenerateAsync(string userId, CancellationToken cancellationToken)
    {
        var user = await Users.Find(item => item.Id == userId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");

        if (!string.Equals(user.Role, UserRole.Freelancer, StringComparison.OrdinalIgnoreCase))
        {
            throw new ForbiddenException("Seuls les freelancers peuvent générer leur CV.");
        }

        var portfolioItems = await _portfolioService.ListMineAsync(userId, cancellationToken);
        var avatarBytes = await TryGetAvatarBytesAsync(user.Avatar, cancellationToken);

        var name = $"{user.FirstName} {user.LastName}".Trim();
        if (string.IsNullOrWhiteSpace(name)) name = user.Email;

        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(36);
                page.PageColor(Colors.White);
                page.DefaultTextStyle(style => style.FontSize(9.5f).FontColor(Colors.Grey.Darken4).LineHeight(1.4f));

                page.Header().Element(header => ComposeHeader(header, name, user, avatarBytes));
                page.Content().PaddingTop(10).Element(content => ComposeContent(content, user, portfolioItems));
                page.Footer().PaddingTop(6).AlignCenter().Text(text =>
                {
                    text.Span("CV généré depuis FreelanceTN  ·  page ").FontSize(7.5f).FontColor(Colors.Grey.Medium);
                    text.CurrentPageNumber().FontSize(7.5f).FontColor(Colors.Grey.Medium);
                    text.Span(" / ").FontSize(7.5f).FontColor(Colors.Grey.Medium);
                    text.TotalPages().FontSize(7.5f).FontColor(Colors.Grey.Medium);
                });
            });
        });

        return document.GeneratePdf();
    }

    private static void ComposeHeader(IContainer container, string name, User user, byte[]? avatarBytes)
    {
        container.ShowEntire().PaddingBottom(4).Column(header =>
        {
            header.Item().Row(row =>
            {
                row.Spacing(16);

                if (avatarBytes is { Length: > 0 })
                {
                    row.ConstantItem(66).Height(66).Image(avatarBytes).FitArea();
                }

                row.RelativeItem().Column(column =>
                {
                    column.Spacing(2);
                    column.Item().Text(name).FontSize(21).Bold().FontColor(Colors.Indigo.Darken3);

                    if (!string.IsNullOrWhiteSpace(user.Title))
                    {
                        column.Item().Text(user.Title.Trim()).FontSize(10.5f).SemiBold().FontColor(Colors.Indigo.Medium);
                    }

                    var contactParts = new List<string>();
                    if (!string.IsNullOrWhiteSpace(user.Phone)) contactParts.Add(user.Phone.Trim());
                    if (!string.IsNullOrWhiteSpace(user.Email)) contactParts.Add(user.Email.Trim());
                    if (!string.IsNullOrWhiteSpace(user.Location)) contactParts.Add(user.Location.Trim());
                    if (contactParts.Count > 0)
                    {
                        column.Item().PaddingTop(4)
                            .Text(string.Join("   •   ", contactParts))
                            .FontSize(8.5f)
                            .FontColor(Colors.Grey.Darken1);
                    }

                    var links = new List<string>();
                    if (!string.IsNullOrWhiteSpace(user.LinkedIn)) links.Add(user.LinkedIn.Trim());
                    if (!string.IsNullOrWhiteSpace(user.GitHub)) links.Add(user.GitHub.Trim());
                    if (!string.IsNullOrWhiteSpace(user.Website)) links.Add(user.Website.Trim());
                    if (links.Count > 0)
                    {
                        column.Item().Text(string.Join("   •   ", links)).FontSize(8).FontColor(Colors.Indigo.Medium);
                    }
                });
            });

            header.Item().PaddingTop(8).LineHorizontal(1.5f).LineColor(Colors.Indigo.Lighten2);
        });
    }

    private static void ComposeContent(IContainer container, User user, List<PortfolioItemResponse> portfolioItems)
    {
        var certifications = user.Certifications ?? [];
        var skills = user.Skills ?? [];
        var publishedProjects = portfolioItems.Where(item => item.Published).ToList();

        container.Column(column =>
        {
            column.Spacing(12);

            if (!string.IsNullOrWhiteSpace(user.Bio))
            {
                AddSection(column, "Profil", section =>
                {
                    section.Text(FlowText(user.Bio)).FontSize(9.5f).LineHeight(1.45f);
                });
            }

            if (skills.Count > 0)
            {
                AddSection(column, "Compétences", section =>
                {
                    ComposeChips(section, skills, Colors.Indigo.Lighten5, Colors.Indigo.Darken3);
                });
            }

            if (user.Experiences.Count > 0)
            {
                AddSection(column, "Expériences professionnelles", section =>
                {
                    section.Column(list =>
                    {
                        for (var index = 0; index < user.Experiences.Count; index++)
                        {
                            var experience = user.Experiences[index];
                            var isLast = index == user.Experiences.Count - 1;

                            list.Item().ShowEntire().PaddingTop(index == 0 ? 0 : 7).Column(item =>
                            {
                                item.Spacing(1.5f);

                                var period = FormatPeriod(experience.StartDate, experience.EndDate, experience.IsCurrent, experience.Period);
                                item.Item().Row(row =>
                                {
                                    row.RelativeItem().Text(string.IsNullOrWhiteSpace(experience.Role) ? "Expérience" : experience.Role.Trim())
                                        .FontSize(10.5f).Bold().FontColor(Colors.Grey.Darken4);
                                    if (period.Length > 0)
                                    {
                                        row.AutoItem().PaddingLeft(10).Text(period).FontSize(8.5f).SemiBold().FontColor(Colors.Indigo.Medium);
                                    }
                                });

                                var companyLine = string.Join("  ·  ", new[]
                                {
                                    experience.Company?.Trim(),
                                    experience.Location?.Trim(),
                                }.Where(value => !string.IsNullOrWhiteSpace(value)));

                                if (companyLine.Length > 0)
                                {
                                    item.Item().Text(companyLine).FontSize(9.5f).SemiBold().FontColor(Colors.Grey.Darken2);
                                }

                                if (!string.IsNullOrWhiteSpace(experience.Description))
                                {
                                    item.Item().PaddingTop(2).Text(FlowText(experience.Description)).FontSize(9.2f).LineHeight(1.45f);
                                }

                                if (experience.Technologies.Count > 0)
                                {
                                    item.Item().PaddingTop(3).Element(chips =>
                                        ComposeChips(chips, experience.Technologies, Colors.Grey.Lighten4, Colors.Grey.Darken3, 7.5f));
                                }

                                if (!isLast)
                                {
                                    item.Item().PaddingTop(6).LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten2);
                                }
                            });
                        }
                    });
                });
            }

            if (user.Education.Count > 0)
            {
                AddSection(column, "Formations", section =>
                {
                    section.Column(list =>
                    {
                        for (var index = 0; index < user.Education.Count; index++)
                        {
                            var education = user.Education[index];
                            var isLast = index == user.Education.Count - 1;

                            list.Item().ShowEntire().PaddingTop(index == 0 ? 0 : 7).Column(item =>
                            {
                                item.Spacing(1.5f);

                                var period = FormatPeriod(education.StartDate, education.EndDate, false, education.Period);
                                item.Item().Row(row =>
                                {
                                    row.RelativeItem().Text(string.IsNullOrWhiteSpace(education.Degree) ? "Formation" : education.Degree.Trim())
                                        .FontSize(10.5f).Bold().FontColor(Colors.Grey.Darken4);
                                    if (period.Length > 0)
                                    {
                                        row.AutoItem().PaddingLeft(10).Text(period).FontSize(8.5f).SemiBold().FontColor(Colors.Indigo.Medium);
                                    }
                                });

                                var educationLine = string.Join("  ·  ", new[]
                                {
                                    education.Institution?.Trim(),
                                    education.Specialty?.Trim(),
                                    education.Location?.Trim(),
                                }.Where(value => !string.IsNullOrWhiteSpace(value)));

                                if (educationLine.Length > 0)
                                {
                                    item.Item().Text(educationLine).FontSize(9.5f).SemiBold().FontColor(Colors.Grey.Darken2);
                                }

                                if (!string.IsNullOrWhiteSpace(education.Description))
                                {
                                    item.Item().PaddingTop(2).Text(FlowText(education.Description)).FontSize(9.2f).LineHeight(1.45f);
                                }

                                if (!isLast)
                                {
                                    item.Item().PaddingTop(6).LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten2);
                                }
                            });
                        }
                    });
                });
            }

            if (certifications.Count > 0)
            {
                AddSection(column, "Certifications", section =>
                {
                    section.Column(list =>
                    {
                        list.Spacing(3);
                        foreach (var certification in certifications)
                        {
                            var line = new StringBuilder();
                            if (!string.IsNullOrWhiteSpace(certification.Name)) line.Append(certification.Name.Trim());
                            if (!string.IsNullOrWhiteSpace(certification.Issuer))
                            {
                                if (line.Length > 0) line.Append(" — ");
                                line.Append(certification.Issuer.Trim());
                            }
                            if (!string.IsNullOrWhiteSpace(certification.Year))
                            {
                                if (line.Length > 0) line.Append(" (").Append(certification.Year.Trim()).Append(')');
                                else line.Append(certification.Year.Trim());
                            }

                            if (line.Length > 0)
                            {
                                list.Item().ShowEntire().Text(line.ToString()).FontSize(9.5f).LineHeight(1.4f);
                            }
                        }
                    });
                });
            }

            if (user.Languages.Count > 0)
            {
                AddSection(column, "Langues", section =>
                {
                    var languageLabels = user.Languages
                        .Where(language => !string.IsNullOrWhiteSpace(language.Name))
                        .Select(language => string.IsNullOrWhiteSpace(language.Level)
                            ? language.Name.Trim()
                            : $"{language.Name.Trim()} — {language.Level.Trim()}")
                        .ToList();

                    ComposeChips(section, languageLabels, Colors.Indigo.Lighten5, Colors.Indigo.Darken3);
                });
            }

            var preferences = user.WorkPreferences;
            var hasPreferences = user.HourlyRate > 0 ||
                (preferences is not null &&
                 (preferences.ProjectTypes.Count > 0 ||
                  !string.IsNullOrWhiteSpace(preferences.WorkPreference) ||
                  !string.IsNullOrWhiteSpace(preferences.MinimumBudget)));

            if (hasPreferences)
            {
                AddSection(column, "Préférences", section =>
                {
                    var lines = new List<string>();
                    if (user.HourlyRate > 0) lines.Add($"Tarif horaire : {user.HourlyRate:0.##} TND/h");
                    if (preferences is not null && preferences.ProjectTypes.Count > 0)
                    {
                        lines.Add($"Types de projets : {string.Join(", ", preferences.ProjectTypes)}");
                    }
                    if (!string.IsNullOrWhiteSpace(preferences?.WorkPreference))
                    {
                        lines.Add($"Modalité : {preferences.WorkPreference.Trim()}");
                    }
                    if (!string.IsNullOrWhiteSpace(preferences?.MinimumBudget))
                    {
                        lines.Add($"Budget minimum : {preferences.MinimumBudget.Trim()}");
                    }
                    section.Text(string.Join("\n", lines)).FontSize(9.2f).LineHeight(1.5f);
                });
            }

            if (publishedProjects.Count > 0)
            {
                AddSection(column, "Projets du portfolio", section =>
                {
                    section.Column(list =>
                    {
                        for (var index = 0; index < publishedProjects.Count; index++)
                        {
                            var project = publishedProjects[index];
                            var isLast = index == publishedProjects.Count - 1;

                            list.Item().ShowEntire().PaddingTop(index == 0 ? 0 : 7).Column(item =>
                            {
                                item.Spacing(1.5f);
                                if (!string.IsNullOrWhiteSpace(project.Title))
                                {
                                    item.Item().Text(project.Title.Trim()).FontSize(10.5f).Bold().FontColor(Colors.Grey.Darken4);
                                }

                                var meta = new List<string>();
                                if (!string.IsNullOrWhiteSpace(project.Category)) meta.Add(project.Category.Trim());
                                if (!string.IsNullOrWhiteSpace(project.Role)) meta.Add(project.Role.Trim());
                                if (!string.IsNullOrWhiteSpace(project.Duration)) meta.Add(project.Duration.Trim());
                                if (meta.Count > 0)
                                {
                                    item.Item().Text(string.Join("  ·  ", meta)).FontSize(8.5f).SemiBold().FontColor(Colors.Indigo.Medium);
                                }

                                if (!string.IsNullOrWhiteSpace(project.Summary))
                                {
                                    item.Item().PaddingTop(2).Text(project.Summary.Trim()).FontSize(9.2f).LineHeight(1.45f);
                                }

                                if (project.Skills.Count > 0)
                                {
                                    item.Item().PaddingTop(3).Element(chips =>
                                        ComposeChips(chips, project.Skills, Colors.Grey.Lighten4, Colors.Grey.Darken3, 7.5f));
                                }

                                if (!string.IsNullOrWhiteSpace(project.Link))
                                {
                                    item.Item().PaddingTop(1).Text(project.Link.Trim()).FontSize(8).FontColor(Colors.Indigo.Medium);
                                }

                                if (!isLast)
                                {
                                    item.Item().PaddingTop(6).LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten2);
                                }
                            });
                        }
                    });
                });
            }
        });
    }

    private static void ComposeChips(
        IContainer container,
        IEnumerable<string> values,
        string background,
        string foreground,
        float fontSize = 8.2f)
    {
        container.Inlined(inlined =>
        {
            inlined.Spacing(4);
            inlined.VerticalSpacing(4);
            inlined.BaselineMiddle();

            foreach (var value in values.Where(value => !string.IsNullOrWhiteSpace(value)))
            {
                inlined.Item()
                    .Background(background)
                    .PaddingVertical(2)
                    .PaddingHorizontal(6)
                    .Text(value.Trim())
                    .FontSize(fontSize)
                    .SemiBold()
                    .FontColor(foreground);
            }
        });
    }


    /// <summary>
    /// Réenroule un texte multiligne issu de l'import PDF. Les lignes coupées
    /// par la mise en page d'origine sont recollées en un paragraphe; les listes
    /// à puces conservent leurs retours à la ligne.
    /// </summary>
    private static string FlowText(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;

        var lines = value
            .Replace("\r\n", "\n", StringComparison.Ordinal)
            .Replace('\r', '\n')
            .Split('\n')
            .Select(line => line.Trim())
            .Where(line => line.Length > 0)
            .ToList();

        if (lines.Count == 0) return string.Empty;

        var hasBullets = lines.Any(line => line.Length > 1 &&
            "•·▪◦-*".Contains(line[0]) &&
            char.IsWhiteSpace(line[1]));

        if (hasBullets) return string.Join("\n", lines);

        var joined = string.Join(" ", lines);
        return System.Text.RegularExpressions.Regex.Replace(joined, @"[^\S\n]{2,}", " ");
    }

    private static string FormatPeriod(string? startDate, string? endDate, bool isCurrent, string? period)
    {
        var start = startDate?.Trim() ?? string.Empty;
        var end = endDate?.Trim() ?? string.Empty;

        if (start.Length > 0 && (end.Length > 0 || isCurrent))
        {
            return $"{start} — {(isCurrent ? "Présent" : end)}";
        }

        if (start.Length > 0) return start;
        return period?.Trim() ?? string.Empty;
    }

    private async Task<byte[]?> TryGetAvatarBytesAsync(string avatar, CancellationToken cancellationToken)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(avatar)) return null;

            if (avatar.StartsWith("/api/uploads/avatar/", StringComparison.Ordinal))
            {
                var fileName = Path.GetFileName(avatar);
                if (string.IsNullOrWhiteSpace(fileName)) return null;
                var path = Path.Combine(_environment.ContentRootPath, "App_Data", "uploads", "avatars", fileName);
                if (!File.Exists(path)) return null;
                return await File.ReadAllBytesAsync(path, cancellationToken);
            }

            if (Uri.TryCreate(avatar, UriKind.Absolute, out var uri) &&
                (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
            {
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
                var bytes = await client.GetByteArrayAsync(uri, cancellationToken);
                return bytes.Length > 0 ? bytes : null;
            }
        }
        catch
        {
            // Une photo illisible ne doit jamais faire échouer la génération du CV.
        }

        return null;
    }

    private static void AddSection(ColumnDescriptor column, string title, Action<IContainer> content)
    {
        column.Item().Column(section =>
        {
            section.Item().EnsureSpace(72).PaddingBottom(5).Column(heading =>
            {
                heading.Item().Text(title).FontSize(9.5f).Bold().FontColor(Colors.Indigo.Darken2);
                heading.Item().PaddingTop(2).LineHorizontal(0.8f).LineColor(Colors.Indigo.Lighten2);
            });

            content(section.Item());
        });
    }
}
