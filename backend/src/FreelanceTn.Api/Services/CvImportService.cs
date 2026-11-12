using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using FreelanceTn.Api.Dtos.Auth;
using FreelanceTn.Api.Dtos.Portfolio;
using FreelanceTn.Api.Exceptions;
using UglyToad.PdfPig;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.DocumentLayoutAnalysis.TextExtractor;

namespace FreelanceTn.Api.Services;

/// <summary>
/// Extraction best-effort d'un CV PDF. Aucun fichier n'est conservé : le PDF
/// est lu en mémoire et seules les données structurées sont renvoyées.
/// L'OCR n'est pas configuré : un PDF image est refusé explicitement.
/// Les langues parlées et les technologies sont classées séparément.
/// </summary>
public class CvImportService
{
    private const long MaxFileSize = 10 * 1024 * 1024;
    private const int MaxPages = 20;
    private const int MinUsefulCharacters = 40;
    private const int MaxTextCharacters = 300_000;
    private const int MaxSkills = 60;
    private const int MaxExperiences = 30;
    private const int MaxEducation = 30;
    private const int MaxCertifications = 30;
    private const int MaxLanguages = 20;

    /// <summary>Noms de mois reconnus (français, abrégés français et anglais).</summary>
    private const string MonthNames =
        "janv[a-zéû.]*|jan|févr[a-zéû.]*|fev[a-zéû.]*|feb|mars|mar|avr[a-zéû.]*|apr|mai|may|juin|jun|juil[a-zéû.]*|jul|août|aou|aug|sept[a-zéû.]*|sep|oct|nov|déc[a-zéû.]*|dec";

    /// <summary>
    /// Jeton de date : « 2021 », « 03/2021 », « mars 2021 » et forme ISO « 2021-03 »
    /// (celle produite par le CV PDF de l'application, indispensable à l'aller-retour).
    /// </summary>
    private const string DateTokenSource =
        @"(?:(?:\d{1,2}\s*[/.\-]\s*)?(?:(?:" + MonthNames + @")[a-zéû.]*\.?\s*)?(?:19|20)\d{2})(?:\s*[-/]\s*\d{1,2}(?!\d))?";

    private static readonly Regex WhitespaceRegex = new(@"[^\S\n]+", RegexOptions.Compiled);
    private static readonly Regex ControlRegex = new(@"[\u0000-\u0008\u000B\u000C\u000E-\u001F]", RegexOptions.Compiled);
    private static readonly Regex BulletRegex = new(@"^[\-\*\u2022\u25CF\u25E6\u2023\u00B7]\s*", RegexOptions.Compiled);
    private static readonly Regex UrlRegex = new(
        @"(?i)\b(?:https?://|www\.)[^\s<>()]+|\b(?:linkedin\.com|github\.com|gitlab\.com|behance\.net|dribbble\.com)/[^\s<>()]+",
        RegexOptions.Compiled);
    private static readonly Regex EmailRegex = new(
        @"(?i)\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b",
        RegexOptions.Compiled);
    private static readonly Regex PhoneRegex = new(
        @"(?<![\d/])(?:\+|00)?\d{1,3}[\s.\-]?(?:\(\d{1,4}\)[\s.\-]?)?\d{2,4}(?:[\s.\-]?\d{2,4}){1,4}(?![\d/])",
        RegexOptions.Compiled);
    private static readonly Regex DateTokenRegex = new(
        @"(?i)(?:(?<mnum>\d{1,2})\s*[/.\-]\s*)?(?:(?<mname>" + MonthNames + @")[a-zéû.]*\.?\s*)?(?<year>(?:19|20)\d{2})(?:\s*[-/]\s*(?<isonum>\d{1,2})(?!\d))?",
        RegexOptions.Compiled);
    private static readonly Regex PeriodRegex = new(
        @"(?i)" + DateTokenSource + @"\s*(?:[-–—]|to|au|à|jusqu'?[àa])\s*(?:" + DateTokenSource + @"|present|présent|current|aujourd'hui|now|ce jour|en cours)",
        RegexOptions.Compiled);
    /// <summary>« 2025 Aujourd'hui » sans tiret entre l'année et le marqueur de courant.</summary>
    private static readonly Regex YearPresentRegex = new(
        @"(?i)(?<!\d)((?:19|20)\d{2})\s+(present|présent|current|aujourd'hui|now|ce jour|en cours)\b",
        RegexOptions.Compiled);
    /// <summary>
    /// Année seule exploitable comme borne d'entrée CV : collée à un mot
    /// (« Immobilière2022 »), avant un lieu entre parenthèses, ou en fin de ligne.
    /// </summary>
    private static readonly Regex EmbeddedEmploymentYearRegex = new(
        @"(?i)(?:(?<=\p{L})|(?<=[\s|•·,\-/]))((?:19|20)\d{2})(?!\d)(?=\s*(?:[\(\[]|$|[,;|•·]))",
        RegexOptions.Compiled);
    private static readonly Regex HeaderSeparatorRegex = new(
        @"\s*[|•·]\s*|\s+[–—]\s+|\s+-\s+|\s+:\s*|\s+at\s+|\s+chez\s+",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex YearOnlyRegex = new(@"^(?:19|20)\d{2}$", RegexOptions.Compiled);
    private static readonly Regex ParentheticalLocationRegex = new(
        @"\(([^)]{2,60})\)\s*$",
        RegexOptions.Compiled);

    private static readonly Dictionary<string, string> SectionAliases = new(StringComparer.Ordinal)
    {
        ["summary"] = "summary",
        ["professional summary"] = "summary",
        ["profile"] = "summary",
        ["professional profile"] = "summary",
        ["profil"] = "summary",
        ["about"] = "summary",
        ["about me"] = "summary",
        ["presentation"] = "summary",
        ["objectif"] = "summary",
        ["objectifs"] = "summary",
        ["career objective"] = "summary",
        ["personal statement"] = "summary",
        ["resume"] = "summary",

        ["skills"] = "skills",
        ["skill"] = "skills",
        ["technical skills"] = "skills",
        ["core skills"] = "skills",
        ["skills expertise"] = "skills",
        ["expertise"] = "skills",
        ["competences"] = "skills",
        ["competences techniques"] = "skills",
        ["technical expertise"] = "skills",
        ["technologies"] = "skills",
        ["technology stack"] = "skills",
        ["stack"] = "skills",
        ["outils"] = "skills",
        ["tools"] = "skills",

        ["experience"] = "experience",
        ["experiences"] = "experience",
        ["work experience"] = "experience",
        ["professional experience"] = "experience",
        ["employment"] = "experience",
        ["employment history"] = "experience",
        ["work history"] = "experience",
        ["career history"] = "experience",
        ["experience professionnelle"] = "experience",
        ["experiences professionnelles"] = "experience",
        ["parcours professionnel"] = "experience",

        ["education"] = "education",
        ["formation"] = "education",
        ["formations"] = "education",
        ["formations certifications"] = "education",
        ["formations et certifications"] = "education",
        ["education and training"] = "education",
        ["academic background"] = "education",
        ["academic qualifications"] = "education",
        ["diplomes"] = "education",
        ["cursus"] = "education",
        ["qualifications"] = "education",

        ["certifications"] = "certifications",
        ["certification"] = "certifications",
        ["certificats"] = "certifications",
        ["certificat"] = "certifications",
        ["professional certifications"] = "certifications",
        ["licences"] = "certifications",
        ["accreditations"] = "certifications",

        ["languages"] = "languages",
        ["language"] = "languages",
        ["langues"] = "languages",
        ["langue"] = "languages",
        ["language skills"] = "languages",

        ["projects"] = "projects",
        ["projets"] = "projects",
        ["projets academiques"] = "projects",
        ["project experience"] = "projects",
        ["realisations"] = "projects",
        ["realisations professionnelles"] = "projects",

        ["links"] = "links",
        ["liens"] = "links",
        ["portfolio"] = "links",
        ["websites"] = "links",
        ["contact"] = "links",
        ["coordonnees"] = "links",

        ["expertises"] = "skills",
        ["expertises technologies"] = "skills",
        ["expertises et technologies"] = "skills",
        ["expertise technologies"] = "skills",
        ["data"] = "skills",
        ["salesforce"] = "skills",
        ["developpement front end"] = "skills",
        ["developpement back end"] = "skills",
        ["devops cloud"] = "skills",
        ["devops and cloud"] = "skills",

        ["interests"] = "interests",
        ["centres dinteret"] = "interests",
        ["centres dinterets"] = "interests",
        ["centre dinteret"] = "interests",
        ["interet"] = "interests",
        ["interets"] = "interests",
        ["hobbies"] = "interests",
        ["loisirs"] = "interests",

        ["preferences"] = "preferences",
        ["preferences de travail"] = "preferences",
        ["work preferences"] = "preferences",

        ["projets du portfolio"] = "projects",
        ["projects portfolio"] = "projects",
    };

    /// <summary>
    /// Libellés de champs rencontrés à l'intérieur d'une entrée (« Technologies : React »).
    /// Ils ne doivent jamais être interprétés comme des titres de section.
    /// </summary>
    private static readonly HashSet<string> InlineFieldLabels = new(StringComparer.Ordinal)
    {
        "technologies",
        "technologie",
        "technos",
        "techniques",
        "stack",
        "stack technique",
        "outils",
        "tools",
        "environnement",
        "environment",
        "competences techniques",
    };

    /// <summary>Langues réellement parlées (normalisées sans accent). Les technologies n'y figurent jamais.</summary>
    private static readonly Dictionary<string, string> SpokenLanguages = new(StringComparer.Ordinal)
    {
        ["francais"] = "Français",
        ["french"] = "Français",
        ["anglais"] = "Anglais",
        ["english"] = "Anglais",
        ["arabe"] = "Arabe",
        ["arabic"] = "Arabe",
        ["allemand"] = "Allemand",
        ["german"] = "Allemand",
        ["espagnol"] = "Espagnol",
        ["spanish"] = "Espagnol",
        ["italien"] = "Italien",
        ["italian"] = "Italien",
        ["portugais"] = "Portugais",
        ["portuguese"] = "Portugais",
        ["russe"] = "Russe",
        ["russian"] = "Russe",
        ["chinois"] = "Chinois",
        ["chinese"] = "Chinois",
        ["mandarin"] = "Chinois",
        ["japonais"] = "Japonais",
        ["japanese"] = "Japonais",
        ["coreen"] = "Coréen",
        ["korean"] = "Coréen",
        ["turc"] = "Turc",
        ["turkish"] = "Turc",
        ["neerlandais"] = "Néerlandais",
        ["dutch"] = "Néerlandais",
        ["suedois"] = "Suédois",
        ["swedish"] = "Suédois",
        ["norvegien"] = "Norvégien",
        ["danois"] = "Danois",
        ["polonais"] = "Polonais",
        ["roumain"] = "Roumain",
        ["grec"] = "Grec",
        ["hindi"] = "Hindi",
        ["urdu"] = "Ourdou",
        ["berbere"] = "Berbère",
        ["hebreu"] = "Hébreu",
        ["ukrainien"] = "Ukrainien",
    };

    /// <summary>Technologies, frameworks, outils, bases de données et méthodologies.</summary>
    private static readonly string[] TechTerms =
    [
        "C#", ".NET", ".NET Core", "ASP.NET", "ASP.NET Core", "Blazor", "Entity Framework",
        "Java", "JavaScript", "TypeScript", "Python", "PHP", "Ruby", "Go", "Rust", "Kotlin",
        "Swift", "Scala", "C++", "SQL", "PL/SQL", "T-SQL", "HTML", "HTML5", "CSS", "CSS3",
        "Sass", "SCSS", "Tailwind CSS", "Bootstrap", "Material UI", "React", "React Native",
        "Next.js", "Vue.js", "Nuxt.js", "Angular", "Svelte", "Node.js", "Express.js",
        "NestJS", "Spring Boot", "Spring", "Django", "Flask", "FastAPI", "Laravel", "Symfony",
        "Ruby on Rails", "jQuery", "Redux", "GraphQL", "REST API", "REST", "SOAP", "gRPC",
        "Microservices", "Docker", "Kubernetes", "Jenkins", "GitLab CI", "GitHub Actions",
        "CI/CD", "Terraform", "Ansible", "AWS", "Azure", "Google Cloud", "Firebase",
        "Heroku", "Vercel", "Netlify", "Salesforce", "Apex", "Visualforce",
        "Lightning Web Components", "LWC", "SOQL", "SOSL", "MongoDB", "PostgreSQL", "MySQL",
        "SQL Server", "Oracle", "Redis", "Elasticsearch", "Cassandra", "SQLite", "Supabase",
        "Prisma", "Hibernate", "JPA", "Jest", "Cypress", "Playwright", "Selenium", "JUnit",
        "xUnit", "NUnit", "pytest", "Figma", "Adobe XD", "Photoshop", "Illustrator",
        "Sketch", "Jira", "Confluence", "Trello", "Notion", "Slack", "Git", "GitHub",
        "GitLab", "Bitbucket", "Linux", "Windows Server", "Bash", "PowerShell", "Unity",
        "Blender", "Excel", "Power BI", "Tableau", "Google Analytics", "SEO", "Agile",
        "Scrum", "Kanban", "TDD", "BDD", "DevOps", "OOP", "MVC", "MVVM", "Clean Architecture",
        "Design Patterns", "Machine Learning", "Deep Learning", "TensorFlow", "PyTorch",
        "Pandas", "NumPy", "OpenCV", "NLP", "Data Analysis", "ETL", "Power Automate",
        "SAP", "Odoo", "WordPress", "Shopify", "Drupal", "Magento", "Flutter", "Xamarin",
        ".NET MAUI", "WPF", "WinForms", "MediatR", "AutoMapper", "Swagger", "Postman",
        "RabbitMQ", "Kafka", "SignalR", "WebSockets", "OAuth", "JWT", "UML", "Photoshop",
        "Canva", "Figma", "Zoho", "HubSpot", "Stripe", "PayPal", "FlutterFlow", "LangChain",
        "OpenAI", "ChatGPT", "Azure DevOps", "GitHub Copilot", "Solidity", "Web3",
        "React Query", "Vite", "Webpack", "ESLint", "Nginx", "Apache", "IIS", "Cloudflare",
    ];

    private static readonly string[] TitleWords =
    [
        "engineer", "developer", "designer", "manager", "consultant", "architect", "analyst",
        "specialist", "director", "lead", "freelance", "product", "marketing", "accountant",
        "translator", "writer", "data", "software", "fullstack", "full stack", "frontend",
        "front end", "backend", "back end", "mobile", "project", "operations", "sales",
        "expert", "technician", "support", "success", "human resources", "finance", "legal",
        "ux", "ui", "graphic", "web", "digital", "content", "seo", "community", "teacher",
        "photographer", "video", "editor", "administrator", "coordinator", "assistant",
        "officer", "mechanic", "electrician", "chef", "cook", "waiter", "business", "account",
        "nurse", "ingenieur", "developpeur", "developpeuse", "chef de projet", "responsable",
        "specialiste", "comptable", "traducteur", "redacteur", "infographiste", "gestionnaire",
        "consultante", "consultant", "analyste", "architecte", "technicien", "technicienne",
        "administrateur", "administratrice", "formateur", "formatrice", "charge de projet",
        "chargee de projet", "directeur", "directrice", "fondateur", "fondatrice",
        "devops", "sre", "qa", "testeur", "testeuse", "scrum master", "product owner",
    ];

    private static readonly string[] EducationWords =
    [
        "universite", "university", "institut", "institute", "ecole", "school", "lycee",
        "college", "faculte", "faculty", "academie", "master", "licence", "bachelor",
        "baccalaureat", "diplome", "doctorat", "phd", "mba", "bts", "dut", "ingeniorat",
        "formation", "certification", "certificat",
    ];

    public async Task<CvImportResponse> ImportAsync(IFormFile? file, CancellationToken cancellationToken)
    {
        ValidateFile(file);

        byte[] bytes;
        try
        {
            await using var stream = file!.OpenReadStream();
            using var memory = new MemoryStream();
            await stream.CopyToAsync(memory, cancellationToken);
            bytes = memory.ToArray();
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            throw new BadRequestException("Le fichier PDF n'a pas pu être lu.");
        }

        if (!LooksLikePdf(bytes))
        {
            throw new BadRequestException("Le fichier n'est pas un PDF valide.");
        }

        int pageCount;
        var pageTexts = new List<string>();

        try
        {
            using var document = PdfDocument.Open(bytes);
            pageCount = document.NumberOfPages;

            if (pageCount == 0)
            {
                throw new BadRequestException("Le PDF ne contient aucune page.");
            }

            if (pageCount > MaxPages)
            {
                throw new BadRequestException($"Le CV ne peut pas dépasser {MaxPages} pages.");
            }

            for (var pageNumber = 1; pageNumber <= pageCount; pageNumber++)
            {
                var page = document.GetPage(pageNumber);
                pageTexts.Add(NormalizeText(ExtractPageText(page)));
            }
        }
        catch (BadRequestException)
        {
            throw;
        }
        catch
        {
            throw new BadRequestException("Le PDF est illisible, protégé ou endommagé.");
        }

        // L'en-tête (nom, titre, coordonnées, liens) est répété sur chaque page du
        // PDF. Ces répétitions sont retirées des pages suivantes pour ne pas
        // polluer les sections expériences / formations / compétences.
        var headerKeys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var line in pageTexts[0].Split('\n'))
        {
            var trimmed = line.Trim();
            if (trimmed.Length == 0) continue;
            if (IsSectionHeading(trimmed)) break;
            headerKeys.Add(NormalizeKey(trimmed));
        }

        if (headerKeys.Count >= 2)
        {
            for (var pageIndex = 1; pageIndex < pageTexts.Count; pageIndex++)
            {
                var pageLines = pageTexts[pageIndex].Split('\n').ToList();
                var skip = 0;
                var matched = 0;

                while (skip < pageLines.Count)
                {
                    var trimmed = pageLines[skip].Trim();
                    if (trimmed.Length == 0)
                    {
                        skip++;
                        continue;
                    }

                    if (!headerKeys.Contains(NormalizeKey(trimmed))) break;
                    matched++;
                    skip++;
                }

                if (matched >= 2)
                {
                    pageTexts[pageIndex] = string.Join("\n", pageLines.Skip(skip));
                }
            }
        }

        var text = string.Join("\n\n", pageTexts).Trim();
        if (text.Length > MaxTextCharacters)
        {
            text = text[..MaxTextCharacters];
        }

        var letterCount = text.Count(char.IsLetter);
        if (letterCount < MinUsefulCharacters)
        {
            throw new ConflictException(
                "Ce PDF ne contient pas assez de texte exploitable. Il est probablement scanné ou composé d'images ; l'OCR n'est pas configuré.");
        }

        var pagesWithText = pageTexts.Count(pageText => pageText.Count(char.IsLetter) >= 20);

        var response = Parse(text, pageCount, pagesWithText);
        response.ExtractedCharacters = text.Length;

        return response;
    }

    private static void ValidateFile(IFormFile? file)
    {
        if (file is null || file.Length == 0)
        {
            throw new BadRequestException("Sélectionnez un fichier PDF.");
        }

        if (file.Length > MaxFileSize)
        {
            throw new BadRequestException("Le CV ne peut pas dépasser 10 Mo.");
        }

        var extensionIsPdf = string.Equals(Path.GetExtension(file.FileName), ".pdf", StringComparison.OrdinalIgnoreCase);
        var contentTypeIsPdf =
            string.IsNullOrWhiteSpace(file.ContentType) ||
            string.Equals(file.ContentType, "application/pdf", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(file.ContentType, "application/octet-stream", StringComparison.OrdinalIgnoreCase);

        if (!extensionIsPdf && !contentTypeIsPdf)
        {
            throw new BadRequestException("Le fichier doit être au format PDF.");
        }
    }

    private static bool LooksLikePdf(byte[] bytes)
    {
        var limit = Math.Min(bytes.Length - 5, 1024);
        for (var index = 0; index <= limit; index++)
        {
            if (bytes[index] == (byte)'%' && bytes[index + 1] == (byte)'P' &&
                bytes[index + 2] == (byte)'D' && bytes[index + 3] == (byte)'F' &&
                bytes[index + 4] == (byte)'-')
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// Extraction de texte tenant compte de la mise en page (colonnes). Les PDF
    /// multi-colonnes sont lus colonne par colonne, de haut en bas, au lieu
    /// d'être mélangés dans l'ordre du flux de contenu.
    /// </summary>
    private static string ExtractPageText(UglyToad.PdfPig.Content.Page page)
    {
        var words = page.GetWords().ToList();
        if (words.Count == 0) return string.Empty;

        // Seuil de séparation des colonnes : plus grand écart horizontal entre
        // les débuts de mots consécutifs (triés).
        var lefts = words.Select(w => (double)w.BoundingBox.Left).Distinct().OrderBy(x => x).ToList();
        double threshold = double.MaxValue;
        double maxGap = 0;
        for (var i = 1; i < lefts.Count; i++)
        {
            var gap = lefts[i] - lefts[i - 1];
            if (gap > maxGap)
            {
                maxGap = gap;
                threshold = (lefts[i - 1] + lefts[i]) / 2.0;
            }
        }

        var isMultiColumn = maxGap >= 40;

        // Regroupe les mots en lignes par bande Y (tolérance 3 pt).
        static List<List<UglyToad.PdfPig.Content.Word>> BuildLines(IEnumerable<UglyToad.PdfPig.Content.Word> ws)
        {
            var result = new List<List<UglyToad.PdfPig.Content.Word>>();
            foreach (var word in ws.OrderBy(w => -w.BoundingBox.Top).ThenBy(w => w.BoundingBox.Left))
            {
                var line = result.FirstOrDefault(l =>
                    l.Count > 0 && Math.Abs(l[0].BoundingBox.Top - word.BoundingBox.Top) <= 15);
                if (line is null)
                {
                    line = new List<UglyToad.PdfPig.Content.Word>();
                    result.Add(line);
                }
                line.Add(word);
            }
            return result;
        }

        static string ColumnText(List<List<UglyToad.PdfPig.Content.Word>> lines)
        {
            var sb = new StringBuilder();
            foreach (var line in lines)
            {
                var t = string.Join(" ", line.OrderBy(w => w.BoundingBox.Left).Select(w => w.Text));
                if (!string.IsNullOrWhiteSpace(t)) sb.AppendLine(t);
            }
            return sb.ToString();
        }

        static bool ColumnContainsNameLine(string columnText)
        {
            foreach (var line in columnText.Split('\n'))
            {
                var trimmed = line.Trim();
                if (trimmed.Length > 0 && LooksLikeName(trimmed)) return true;
            }
            return false;
        }

        Func<UglyToad.PdfPig.Content.Word, bool> inLeft = w => !isMultiColumn || w.BoundingBox.Left < threshold;
        Func<UglyToad.PdfPig.Content.Word, bool> inRight = w => !isMultiColumn || w.BoundingBox.Left >= threshold;

        var leftLines = BuildLines(words.Where(inLeft));
        var rightLines = BuildLines(words.Where(inRight));

        // Détermine l'ordre des colonnes : celle qui contient le prénom/nom
        // (en-tête) est traitée en premier pour que les sections « header »
        // apparaissent avant les sections de contenu dans le texte final.
        var leftText = ColumnText(leftLines);
        var rightText = ColumnText(rightLines);
        var leftHasName = ColumnContainsNameLine(leftText);
        var rightHasName = ColumnContainsNameLine(rightText);
        var leftFirst = !rightHasName; // gauche en premier (colonne latérale classique)

        if (leftHasName && !rightHasName) leftFirst = true;
        else if (rightHasName && !leftHasName) leftFirst = false;

        var sb = new StringBuilder();
        // Reconstruire chaque colonne indépendamment puis lire la colonne principale en premier
        var leftLineData = leftLines.Select(line => new {
            Top = line.Average(w => w.BoundingBox.Top),
            Text = string.Join(" ", line.OrderBy(w => w.BoundingBox.Left).Select(w => w.Text))
        }).Where(x => !string.IsNullOrWhiteSpace(x.Text)).OrderByDescending(x => x.Top).ToList();
        var rightLineData = rightLines.Select(line => new {
            Top = line.Average(w => w.BoundingBox.Top),
            Text = string.Join(" ", line.OrderBy(w => w.BoundingBox.Left).Select(w => w.Text))
        }).Where(x => !string.IsNullOrWhiteSpace(x.Text)).OrderByDescending(x => x.Top).ToList();

        // Normaliser les apostrophes typographiques pour la regex
        static string NormalizeApostrophes(string s) => s.Replace('’', '\'').Replace('‘', '\'').Replace('“', '"').Replace('”', '"');
        leftLineData = leftLineData.Select(l => new { l.Top, Text = NormalizeApostrophes(l.Text) }).ToList();
        rightLineData = rightLineData.Select(l => new { l.Top, Text = NormalizeApostrophes(l.Text) }).ToList();

        // Déterminer la colonne principale (celle contenant le nom) et la colonne secondaire
        bool mainIsLeft = leftHasName && !rightHasName;
        bool mainIsRight = rightHasName && !leftHasName;
        // Si les deux colonnes contiennent un nom ou aucune, privilégier la colonne droite comme principale
        if (!mainIsLeft && !mainIsRight) mainIsRight = true;

        var mainLines = mainIsLeft ? leftLineData : rightLineData;
        var sideLines = mainIsLeft ? rightLineData : leftLineData;

        // Fusionner les lignes où la période est coupée sur plusieurs lignes
        static List<string> MergeSplitLines(List<dynamic> lines)
        {
            var merged = new List<string>();
            for (int i = 0; i < lines.Count; i++)
            {
                var cur = lines[i];
                var text = cur.Text as string ?? "";
                // Si la ligne se termine par un tiret, tenter de fusionner avec la suivante
                if (i + 1 < lines.Count && (text.EndsWith("–") || text.EndsWith("-")))
                {
                    var next = lines[i + 1];
                    var nextText = next.Text as string ?? "";
                    var mergedText = text.TrimEnd('–', '-', ' ') + " " + nextText.TrimStart();
                    merged.Add(mergedText);
                    i++; // sauter la ligne suivante
                    continue;
                }
                merged.Add(text);
            }
            return merged;
        }

        // Convertir en liste dynamique pour le merge
        var mainDyn = mainLines.Cast<dynamic>().ToList();
        var sideDyn = sideLines.Cast<dynamic>().ToList();

        var mergedMainLines = MergeSplitLines(mainDyn);
        var mergedSideLines = MergeSplitLines(sideDyn);

        // Séparer la partie header de la colonne principale avant le premier titre de section
        int firstSectionIdx = -1;
        for (int i = 0; i < mergedMainLines.Count; i++)
        {
            if (TryReadSectionHeading(mergedMainLines[i], out _, out _))
            {
                firstSectionIdx = i;
                break;
            }
        }
        var mainHeader = firstSectionIdx > 0 ? mergedMainLines.Take(firstSectionIdx).ToList() : new List<string>();
        var mainBody = firstSectionIdx >= 0 ? mergedMainLines.Skip(firstSectionIdx).ToList() : mergedMainLines;

        foreach (var txt in mainHeader)
        {
            sb.AppendLine(txt);
        }
        // Insérer les informations de contact de la colonne secondaire juste après l’en-tête
        foreach (var txt in mergedSideLines)
        {
            sb.AppendLine(txt);
        }
        foreach (var txt in mainBody)
        {
            sb.AppendLine(txt);
        }

        return sb.ToString();
    }

    private static string NormalizeText(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;

        value = value
            .Replace("\r\n", "\n", StringComparison.Ordinal)
            .Replace('\r', '\n')
            .Replace('\u00A0', ' ')
            .Replace("\u00AD", string.Empty, StringComparison.Ordinal)
            .Replace("\u200B", string.Empty, StringComparison.Ordinal);

        var builder = new StringBuilder(value.Length);
        var previousBlank = false;

        foreach (var rawLine in value.Split('\n'))
        {
            var line = ControlRegex.Replace(rawLine, string.Empty);
            line = WhitespaceRegex.Replace(line, " ").Trim();

            if (line.Length == 0)
            {
                if (builder.Length > 0 && !previousBlank)
                {
                    builder.AppendLine();
                    previousBlank = true;
                }

                continue;
            }

            builder.AppendLine(line);
            previousBlank = false;
        }

        return builder.ToString().Trim();
    }

    private static CvImportResponse Parse(string text, int pageCount, int pagesWithText)
    {
        var response = new CvImportResponse
        {
            PageCount = pageCount,
            PagesWithText = pagesWithText,
        };

        var rawLines = text.Split('\n').Select(line => line.Trim()).ToList();

        // Fusion des plages de dates coupées sur deux lignes (ex. « 2025 – » /
        // « Aujourd'hui »).
        var mergedRaw = new List<string>();
        for (var i = 0; i < rawLines.Count; i++)
        {
            var current = rawLines[i];
            if (i + 1 < rawLines.Count)
            {
                var next = rawLines[i + 1];
                var endsWithSeparator = current.EndsWith("–") || current.EndsWith("—") ||
                    current.EndsWith("-") || current.EndsWith("to", StringComparison.OrdinalIgnoreCase) ||
                    current.EndsWith("au", StringComparison.OrdinalIgnoreCase);
                var nextStartsDate = Regex.IsMatch(next, @"^(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|january|february|march|april|may|june|july|august|september|october|november|december|present|présent|current|aujourd'hui|now|ce jour|en cours|\d)", RegexOptions.IgnoreCase);
                if (endsWithSeparator && nextStartsDate)
                {
                    mergedRaw.Add(current + " " + next);
                    i++;
                    continue;
                }
            }
            mergedRaw.Add(current);
        }
        rawLines = mergedRaw;

        var lines = rawLines
            .Where(line => line.Length == 0 || !IsFooterLine(line))
            .ToList();
        var sections = SplitSections(lines);

        var headerLines = SectionLines(sections, "header");
        var headerContent = headerLines.Where(line => line.Length > 0 && !LooksLikeContact(line)).ToList();

        ParseContacts(text, headerLines, response);
        if (string.IsNullOrWhiteSpace(response.Location))
        {
            response.Location = DetectLocation(lines);
        }

        var detectedName = headerContent.FirstOrDefault(LooksLikeName) ?? string.Empty;
        var nameParts = detectedName.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (nameParts.Length >= 2)
        {
            response.FirstName = nameParts[0];
            response.LastName = string.Join(" ", nameParts.Skip(1));
        }

        var titleAlternatives = new List<string>();
        response.Title = DetectTitle(headerContent, SectionLines(sections, "summary"), titleAlternatives);
        foreach (var alternative in titleAlternatives.Take(3))
        {
            response.Uncertain.Add($"Titre possible : « {alternative} » — vérifiez le titre professionnel.");
        }

        response.Summary = ReadParagraph(SectionLines(sections, "summary"), 2000);
        if (string.IsNullOrWhiteSpace(response.Summary))
        {
            var nameIndex = headerContent.FindIndex(line => line == detectedName);
            var summaryCandidateLines = nameIndex >= 0
                ? headerContent.Skip(nameIndex + 1)
                    .Where(line => !line.Equals(line.ToUpperInvariant(), StringComparison.Ordinal) || line.Length > 40)
                    .Where(line => line.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length >= 3)
                    .Where(line => line.Length >= 15)
                    .ToList()
                : headerContent
                    .Where(line => line != detectedName)
                    .Where(line => !LooksLikeName(line))
                    .Where(line => TitleScore(CleanTitle(line)) <= 0)
                    .Where(line => !LooksLikeContact(line))
                    .Where(line => !(line.Length <= 40 && line.Equals(line.ToUpperInvariant(), StringComparison.Ordinal)))
                    .Where(line => line.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length >= 3)
                    .Where(line => line.Length >= 15)
                    .ToList();
            response.Summary = ReadParagraph(summaryCandidateLines, 2000);
        }
        response.Skills = ParseSkills(SectionLines(sections, "skills"), text, response.Uncertain);

        var experienceLines = SectionLines(sections, "experience");
        var educationLines = SectionLines(sections, "education");

        if (experienceLines.Count > 0)
        {
            response.Experiences = ParseExperiences(experienceLines, response.Uncertain);
        }

        if (educationLines.Count > 0)
        {
            response.Education = ParseEducation(educationLines, response.Uncertain);
        }

        // Repli : lorsque les titres de sections sont absents ou non reconnus,
        // les entrées datées sont classées d'après leur contenu.
        if (experienceLines.Count == 0 && educationLines.Count == 0)
        {
            var datedEntries = SplitDatedEntries(lines.Where(line => !IsSectionHeading(line)).ToList());
            if (datedEntries.Count > 0)
            {
                var experiences = new List<CvExperienceDto>();
                var education = new List<CvEducationDto>();
                foreach (var entry in datedEntries)
                {
                    var header = string.Join(" ", entry.HeaderLines);
                    if (LooksLikeEducationEntry(header))
                    {
                        var item = BuildEducation(entry);
                        if (item is not null) education.Add(item);
                    }
                    else
                    {
                        var item = BuildExperience(entry);
                        if (item is not null) experiences.Add(item);
                    }
                }

                response.Experiences = experiences;
                response.Education = education;
                if (experiences.Count > 0 || education.Count > 0)
                {
                    response.Warnings.Add(
                        "Sections non détectées : les entrées datées ont été classées automatiquement. Vérifiez chaque champ avant d'enregistrer.");
                }
            }
        }

        response.Certifications = ParseCertifications(SectionLines(sections, "certifications"), response.Uncertain);
        response.Languages = ParseLanguages(SectionLines(sections, "languages"), response.Uncertain);
        response.Links = ExtractLinks(text);

        ParseProjects(sections, response.Uncertain);

        if (pagesWithText < pageCount)
        {
            response.Warnings.Add(
                $"{pageCount - pagesWithText} page(s) ne contiennent pas de texte exploitable. Ces pages n'ont pas été importées.");
        }

        if (string.IsNullOrWhiteSpace(response.Title))
        {
            response.Warnings.Add("Titre professionnel non détecté : complétez-le si nécessaire.");
        }

        if (string.IsNullOrWhiteSpace(response.Summary))
        {
            response.Warnings.Add("Résumé non détecté.");
        }

        if (response.Skills.Count == 0)
        {
            response.Warnings.Add("Aucune compétence détectée.");
        }

        if (response.Experiences.Count == 0)
        {
            response.Warnings.Add("Aucune expérience détectée.");
        }

        if (response.Education.Count == 0)
        {
            response.Warnings.Add("Aucune formation détectée.");
        }

        if (response.Languages.Count == 0)
        {
            response.Warnings.Add("Aucune langue parlée détectée.");
        }

        if (response.Links.Count > 0)
        {
            response.Warnings.Add(
                "Des liens professionnels ont été détectés et préremplissent les champs LinkedIn / GitHub / site web lorsqu'ils sont reconnus.");
        }

        return response;
    }

    private static Dictionary<string, List<string>> SplitSections(IReadOnlyList<string> lines)
    {
        var sections = new Dictionary<string, List<string>>(StringComparer.Ordinal)
        {
            ["header"] = [],
        };

        var current = "header";

        foreach (var line in lines)
        {
            if (TryReadSectionHeading(line, out var section, out var remainder))
            {
                current = section;
                if (!sections.ContainsKey(current)) sections[current] = [];

                if (!string.IsNullOrWhiteSpace(remainder))
                {
                    sections[current].Add(remainder);
                }

                continue;
            }

            if (!sections.ContainsKey(current)) sections[current] = [];
            sections[current].Add(line);
        }

        return sections;
    }

    private static bool IsSectionHeading(string line) => TryReadSectionHeading(line, out _, out _);

    private static bool TryReadSectionHeading(string line, out string section, out string remainder)
    {
        section = string.Empty;
        remainder = string.Empty;

        if (string.IsNullOrWhiteSpace(line) || line.Length > 200) return false;

        var colonIndex = line.IndexOf(':');
        var headingPart = colonIndex >= 0 ? line[..colonIndex] : line;
        var key = NormalizeKey(headingPart);

        if (SectionAliases.TryGetValue(key, out section!))
        {
            if (colonIndex >= 0)
            {
                // « Technologies : React » dans une expérience est un libellé de champ,
                // pas un nouveau titre de section : sinon toutes les entrées suivantes
                // basculent dans la section Compétences.
                if (InlineFieldLabels.Contains(key)) return false;

                remainder = line[(colonIndex + 1)..].Trim();
            }
            return true;
        }

        // Titre de section contenant du texte supplémentaire après un séparateur
        // (ex. « Profil / Résumé », « Expériences | Détail »). On normalise la
        // ligne entière et on vérifie chaque fragment séparé par /, |, —, – ou -.
        if (colonIndex < 0 && key.Length > 0)
        {
            foreach (var sep in new[] { " / ", " | ", " — ", " – ", " - " })
            {
                var sepKey = NormalizeKey(sep);
                var sepPos = key.IndexOf(sepKey);
                if (sepPos <= 0) continue;

                var prefix = key[..sepPos].Trim();
                if (prefix.Length > 0 && SectionAliases.TryGetValue(prefix, out section!)) return true;

                var suffix = key[(sepPos + sepKey.Length)..].Trim();
                if (suffix.Length > 0 && SectionAliases.TryGetValue(suffix, out section!)) return true;
            }
        }

        return false;
    }

    // --- Coordonnées -------------------------------------------------------

    private static void ParseContacts(string text, IReadOnlyList<string> headerLines, CvImportResponse response)
    {
        var email = EmailRegex.Match(text);
        if (email.Success) response.Email = email.Value.Trim();

        foreach (var line in text.Split('\n'))
        {
            var phone = FindPhone(line);
            if (phone.Length == 0) continue;
            if (response.Phone.Length == 0) response.Phone = phone;
            break;
        }

        var links = ExtractLinks(text);
        response.LinkedIn = links.FirstOrDefault(link => link.Contains("linkedin.", StringComparison.OrdinalIgnoreCase)) ?? string.Empty;
        response.GitHub = links.FirstOrDefault(link =>
            link.Contains("github.", StringComparison.OrdinalIgnoreCase) ||
            link.Contains("gitlab.", StringComparison.OrdinalIgnoreCase)) ?? string.Empty;
        response.Website = links.FirstOrDefault(link =>
            !link.Contains("linkedin.", StringComparison.OrdinalIgnoreCase) &&
            !link.Contains("github.", StringComparison.OrdinalIgnoreCase) &&
            !link.Contains("gitlab.", StringComparison.OrdinalIgnoreCase)) ?? string.Empty;

        response.Location = DetectLocation(headerLines);
    }

    private static string FindPhone(string line)
    {
        if (line.Length == 0) return string.Empty;

        // Les coordonnées sont souvent sur une seule ligne « email • téléphone • ville » :
        // on retire d'abord e-mails et URL pour ne pas perdre le numéro.
        var cleaned = UrlRegex.Replace(line, " ");
        cleaned = EmailRegex.Replace(cleaned, " ");
        if (cleaned.Length == 0) return string.Empty;

        foreach (Match match in PhoneRegex.Matches(cleaned))
        {
            var value = match.Value.Trim(' ', '-', '.', '(', ')');
            var digits = value.Count(char.IsDigit);
            if (digits < 8 || digits > 15) continue;
            if (YearOnlyRegex.IsMatch(value)) continue;

            // Une plage de dates ISO ne doit jamais devenir un numéro de téléphone.
            if (Regex.IsMatch(value, @"^(?:19|20)\d{2}\s*[-/]\s*\d{1,2}$")) continue;
            // Rejeter les plages d'années comme 2024 2025 qui ressemblent à un téléphone
            if (Regex.IsMatch(value, @"^(?:19|20)\d{2}\s*[-–—/ ]\s*(?:19|20)\d{2}$")) continue;
            if (Regex.IsMatch(value, @"^(?:19|20)\d{2}\s*(?:19|20)\d{2}$")) continue;

            return value;
        }

        return string.Empty;
    }

    /// <summary>
    /// Ligne de pied de page du CV (numéro de page). Elle ne doit jamais être
    /// interprétée comme une compétence, une langue ou une formation.
    /// </summary>
    private static bool IsFooterLine(string line)
    {
        if (line.Length is < 3 or > 120) return false;

        var normalized = RemoveDiacritics(line).ToLowerInvariant();

        if (Regex.IsMatch(normalized, @"^page\s*\d+\s*(?:/|sur|of|de)\s*\d+$")) return true;
        if (!Regex.IsMatch(normalized, @"page\s*\d+\s*(?:/|sur|of|de)\s*\d+")) return false;

        return normalized.Contains("freelancetn")
            || normalized.Contains("genere")
            || normalized.Contains("generated")
            || normalized.StartsWith("cv ", StringComparison.Ordinal)
            || normalized.Contains("curriculum")
            || normalized.Contains("resume");
    }

    private static string DetectLocation(IReadOnlyList<string> headerLines)
    {
        foreach (var line in headerLines)
        {
            var labelIndex = line.IndexOf(':');
            if (labelIndex > 0 && labelIndex < 24)
            {
                var label = NormalizeKey(line[..labelIndex]);
                if (label is "adresse" or "addresse" or "localisation" or "location" or "ville" or "city" or "pays" or "country")
                {
                    var value = line[(labelIndex + 1)..].Trim();
                    if (LooksLikeLocation(value)) return value;
                }
            }

            // Libellé sans deux-points : « Addresse Ariana, Tunisie ».
            var normalizedLine = RemoveDiacritics(line).ToLowerInvariant();
            foreach (var label in new[] { "addresse", "adresse", "address", "localisation", "location", "ville", "city", "pays", "country" })
            {
                if (!normalizedLine.StartsWith(label + " ", StringComparison.Ordinal)) continue;

                var value = line[label.Length..].Trim(' ', ':', '-', '–', '—');
                if (LooksLikeLocation(value)) return value;
            }

            var parts = HeaderSeparatorRegex.Split(line)
                .Select(part => part.Trim(' ', ',', ';', '(', ')'))
                .Where(part => part.Length > 0)
                .ToList();

            foreach (var part in parts)
            {
                if (LooksLikeLocation(part)) return part;
            }
        }

        return string.Empty;
    }

    /// <summary>Espace après les virgules : « Lac,Tunisie » → « Lac, Tunisie ».</summary>
    private static string NormalizeLocation(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        return Regex.Replace(value.Trim(), @"\s*,\s*", ", ").Trim(' ', ',');
    }

    private static bool LooksLikeLocation(string value)
    {
        if (value.Length is < 2 or > 60) return false;
        if (LooksLikeContact(value) || value.Any(char.IsDigit)) return false;
        if (value.Any(character => !(char.IsLetter(character) || character is ' ' or '-' or '\'' or ',' or '.'))) return false;
        if (LooksLikeName(value)) return false;

        var normalized = RemoveDiacritics(value).ToLowerInvariant();
        if (TitleWords.Any(word => normalized.Contains(word, StringComparison.Ordinal))) return false;
        if (TechTerms.Any(term => normalized.Contains(term.ToLowerInvariant(), StringComparison.Ordinal))) return false;

        var words = value.Split([' ', ','], StringSplitOptions.RemoveEmptyEntries);
        // Les localisations sont généralement composées d'au moins deux mots (ville, pays)
        return words.Length is >= 2 and <= 4;
    }

    // --- Titre professionnel ----------------------------------------------

    private static string DetectTitle(
        IReadOnlyList<string> headerContent,
        IReadOnlyList<string> summaryLines,
        List<string> alternatives)
    {
        var candidates = new List<(string Value, int Score)>();
        var name = headerContent.FirstOrDefault(LooksLikeName);

        // Titre sur plusieurs lignes : « CONSULTANTE TECHNIQUE ET » / « FONCTIONNELLE ».
        var titleBlock = new List<string>();
        var nameIndex = name is null ? -1 : headerContent.ToList().IndexOf(name);
        var searchLines = nameIndex >= 0
            ? headerContent.Skip(nameIndex + 1).ToList()
            : headerContent.ToList();
        foreach (var line in searchLines)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            if (LooksLikeContact(line)) continue;
            if (IsSectionHeading(line)) break;
            if (line.Length > 60) break;
            if (titleBlock.Count >= 3) break;
            if (titleBlock.Count == 0)
            {
                if (TitleScore(CleanTitle(line)) == 0) continue;
            }
            else
            {
                // Une suite de titre doit rester courte et en majuscules (ex. « FONCTIONNELLE »).
                if (line.Length > 40) break;
                if (!line.Equals(line.ToUpperInvariant(), StringComparison.Ordinal) &&
                    TitleScore(CleanTitle(line)) == 0) break;
            }
            titleBlock.Add(line);
        }
        // Si rien après le nom, chercher avant.
        if (titleBlock.Count == 0 && nameIndex > 0)
        {
            foreach (var line in headerContent.Take(nameIndex).Reverse())
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                if (LooksLikeContact(line)) continue;
                if (IsSectionHeading(line)) break;
                if (line.Length > 60) break;
                if (titleBlock.Count >= 3) break;
                if (titleBlock.Count == 0 && TitleScore(CleanTitle(line)) == 0) continue;
                titleBlock.Insert(0, line);
            }
        }
        if (titleBlock.Count > 1)
        {
            var merged = CleanTitle(string.Join(" ", titleBlock));
            var mergedScore = TitleScore(merged);
            if (mergedScore > 0)
            {
                candidates.Add((merged, mergedScore + 2));
            }
        }

        foreach (var line in headerContent.Take(6))
        {
            if (line == name) continue;
            if (LooksLikeName(line)) continue;

            foreach (var part in HeaderSeparatorRegex.Split(line))
            {
                var candidate = CleanTitle(part);
                var score = TitleScore(candidate);
                if (score > 0) candidates.Add((candidate, score));
            }

            if (candidates.Count == 0)
            {
                var whole = CleanTitle(line);
                var wholeScore = TitleScore(whole);
                if (wholeScore > 0) candidates.Add((whole, wholeScore));
            }
        }

        if (candidates.Count == 0)
        {
            var summaryText = string.Join(" ", summaryLines.Where(line => line.Length > 0).Take(3));
            var match = Regex.Match(
                summaryText,
                @"(?i)\b(?:je suis|i am|passionné[e]? par|specialis[e]? en|spécialisé[e]? en|expert[e]? en|consultant[e]?|développeur|developpeur|développeuse|developpeuse|ingénieur|ingenieur|full[\s-]?stack|front[\s-]?end|back[\s-]?end)\b[^.,;:\n]{0,70}");
            if (match.Success)
            {
                var candidate = CleanTitle(match.Value);
                if (TitleScore(candidate) > 0) candidates.Add((candidate, 1));
            }
        }

        if (candidates.Count == 0) return string.Empty;

        var ordered = candidates
            .GroupBy(item => item.Value, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.OrderByDescending(item => item.Score).First())
            .OrderByDescending(item => item.Score)
            .ToList();

        alternatives.AddRange(ordered.Skip(1).Select(item => item.Value));
        return ordered.Count > 0 ? ordered[0].Value : string.Empty;
    }

    private static int TitleScore(string value)
    {
        var trimmed = value.Trim();
        if (trimmed.Length is < 3 or > 120) return 0;
        if (LooksLikeContact(trimmed) || trimmed.Any(char.IsDigit)) return 0;

        var normalized = RemoveDiacritics(trimmed).ToLowerInvariant();
        if (EducationWords.Any(word => normalized.Contains(word, StringComparison.Ordinal))) return 0;

        var words = trimmed.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (words.Length > 10) return 0;

        var score = 0;
        if (TitleWords.Any(word => normalized.Contains(word, StringComparison.Ordinal))) score += 5;
        if (trimmed.Length <= 60) score += 1;
        if (trimmed.EndsWith(".", StringComparison.Ordinal)) score -= 2;
        if (normalized.StartsWith("cv ", StringComparison.Ordinal)) score -= 5;

        return score >= 5 ? score : 0;
    }

    // --- Compétences et langues -------------------------------------------

    private static List<string> ParseSkills(IReadOnlyList<string> lines, string fullText, List<string> uncertain)
    {
        var skills = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void Add(string value)
        {
            var skill = NormalizeSpaces(value).Trim(' ', '-', '–', '—', ',', ';', ':', '•', '·').TrimEnd('.');
            if (skill.Length is 0 or > 60) return;
            if (!skill.Any(char.IsLetter)) return;
            if (skill.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length > 8) return;
            if (LooksLikeContact(skill) || YearOnlyRegex.IsMatch(skill)) return;
            if (SectionAliases.ContainsKey(NormalizeKey(skill))) return;
            if (SpokenLanguages.ContainsKey(NormalizeKey(skill))) return;
            if (seen.Add(skill)) skills.Add(skill);
            if (skills.Count >= MaxSkills) return;
        }

        foreach (var line in lines)
        {
            var cleanLine = BulletRegex.Replace(line, string.Empty).Trim();
            if (cleanLine.Length == 0) continue;

            var labelIndex = cleanLine.IndexOf(':');
            if (labelIndex is > 0 and < 30)
            {
                cleanLine = cleanLine[(labelIndex + 1)..].Trim();
            }

            foreach (var part in Regex.Split(cleanLine, @"\s*[,;|•·/]\s*"))
            {
                Add(part);
            }
        }

        // Les technologies citées dans les expériences/projets sont aussi des compétences.
        foreach (var term in DetectTechTerms(fullText))
        {
            Add(term);
        }

        if (skills.Count == 0)
        {
            uncertain.Add("Aucune compétence technique fiable détectée : complétez la liste manuellement.");
        }

        return skills;
    }

    private static List<string> DetectTechTerms(string text)
    {
        var found = new List<string>();
        var normalizedText = RemoveDiacritics(text);

        foreach (var term in TechTerms)
        {
            var pattern = $@"(?<![\w#+.])(?:{Regex.Escape(term).Replace(@"\ ", @"\s+")})(?![\w#+])";
            if (Regex.IsMatch(normalizedText, pattern, RegexOptions.IgnoreCase))
            {
                found.Add(term);
            }
        }

        return found;
    }

    private static List<CvLanguageDto> ParseLanguages(IReadOnlyList<string> lines, List<string> uncertain)
    {
        var result = new List<CvLanguageDto>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void Add(string name, string level)
        {
            if (name.Length is 0 or > 60) return;
            if (!seen.Add(name)) return;

            result.Add(new CvLanguageDto { Name = name, Level = level });
        }

        foreach (var line in lines)
        {
            var cleanLine = BulletRegex.Replace(line, string.Empty).Trim();
            if (cleanLine.Length == 0) continue;

            var labelIndex = cleanLine.IndexOf(':');
            if (labelIndex is > 0 and < 30)
            {
                cleanLine = cleanLine[(labelIndex + 1)..].Trim();
            }

            foreach (var rawPart in Regex.Split(cleanLine, @"\s*[,;|•·/]\s*"))
            {
                var part = rawPart.Trim(' ', '-', '–', '—', '(', ')');
                if (part.Length is 0 or > 70) continue;

                var level = DetectLanguageLevel(part);
                var name = RemoveLanguageLevel(part, level).Trim(' ', '-', '–', '—', '(', ')', ':');
                if (name.Length == 0) continue;

                var key = NormalizeKey(name);
                if (SpokenLanguages.TryGetValue(key, out var canonical))
                {
                    Add(canonical, level);
                    if (level.Length == 0)
                    {
                        uncertain.Add(
                            $"Niveau de langue non indiqué pour « {canonical} » — précisez Basic, Intermediate, Advanced ou Native.");
                    }
                    continue;
                }

                if (DetectTechTerms(name).Count > 0) continue;
                if (name.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length > 3) continue;

                uncertain.Add(
                    level.Length > 0
                        ? $"Langue à vérifier : « {name} » (niveau « {level} »)."
                        : $"Langue possible : « {name} » — à vérifier avant de l'ajouter.");
            }
        }

        return result;
    }

    private static string DetectLanguageLevel(string value)
    {
        var normalized = RemoveDiacritics(value).ToLowerInvariant();
        if (ContainsAny(normalized, "native", "natif", "maternelle", "bilingue", "bilingual", "c2"))
        {
            return "Native";
        }

        if (ContainsAny(normalized, "advanced", "avance", "courant", "fluent", "c1", "b2"))
        {
            return "Advanced";
        }

        if (ContainsAny(normalized, "intermediate", "intermediaire", "moyen", "b1", "a2"))
        {
            return "Intermediate";
        }

        if (ContainsAny(normalized, "basic", "debutant", "notions", "a1"))
        {
            return "Basic";
        }

        return string.Empty;
    }

    private static string RemoveLanguageLevel(string value, string level)
    {
        if (level.Length == 0) return value;

        var words = level switch
        {
            "Native" => new[] { "native", "natif", "native", "maternelle", "bilingue", "bilingual", "c2" },
            "Advanced" => new[] { "advanced", "avance", "courant", "fluent", "c1", "b2" },
            "Intermediate" => new[] { "intermediate", "intermediaire", "moyen", "b1", "a2" },
            _ => new[] { "basic", "debutant", "notions", "a1" },
        };

        var result = value;
        foreach (var word in words.Concat(["langue", "language", "niveau", "level"]))
        {
            result = Regex.Replace(result, $@"\b{Regex.Escape(word)}\b", string.Empty, RegexOptions.IgnoreCase);
        }

        result = Regex.Replace(result, @"\(\s*\)", string.Empty);
        return Regex.Replace(result, @"\s+", " ");
    }

    // --- Expériences et formations ----------------------------------------

    private sealed record Entry(List<string> HeaderLines, string Period, List<string> Body);

    private static List<CvExperienceDto> ParseExperiences(IReadOnlyList<string> lines, List<string> uncertain)
    {
        var result = new List<CvExperienceDto>();

        foreach (var entry in SplitDatedEntries(lines))
        {
            if (result.Count >= MaxExperiences) break;

            var experience = BuildExperience(entry);
            if (experience is null) continue;
            result.Add(experience);
        }

        if (result.Count == 0 && lines.Any(line => line.Length > 0))
        {
            uncertain.Add("La section Expériences a été détectée mais aucune entrée exploitable n'a pu être structurée.");
        }

        return result;
    }

    private static CvExperienceDto? BuildExperience(Entry entry)
    {
        var parts = SplitHeaderParts(entry.HeaderLines);
        var body = entry.Body.ToList();

        var role = parts.Count > 0 ? CleanTitle(parts[0]) : string.Empty;
        var company = parts.Count > 1 ? CleanTitle(parts[1]) : string.Empty;
        var location = parts.Count > 2 ? CleanTitle(string.Join(", ", parts.Skip(2))) : string.Empty;

        // Lieu coupé sur deux lignes : « … 2021 (Lac, » / « Tunisie) ».
        if (body.Count > 0 && HasUnclosedParenthesis($"{role} {company} {location}"))
        {
            var fragment = body[0].Trim();
            if (fragment.Length <= 40 && (fragment.Contains(')') || LooksLikeGeographicHint(fragment.Trim(')', ' '))))
            {
                if (HasUnclosedParenthesis(company)) company = $"{company} {fragment}".Trim();
                else if (HasUnclosedParenthesis(role)) role = $"{role} {fragment}".Trim();
                else location = $"{location} {fragment}".Trim();
                body.RemoveAt(0);
                parts = SplitHeaderParts([string.Join(" | ", new[] { role, company, location }.Where(part => part.Length > 0))]);
                role = parts.Count > 0 ? CleanTitle(parts[0]) : role;
                company = parts.Count > 1 ? CleanTitle(parts[1]) : company;
                location = parts.Count > 2 ? CleanTitle(string.Join(", ", parts.Skip(2))) : location;
            }
        }

        // Lieu souvent entre parenthèses : « Neoledge 2023 (Lac, Tunisie) ».
        if (location.Length == 0)
        {
            ExtractParentheticalLocation(ref role, ref company, ref location);
        }

        location = location.Trim('(', ')', ' ');

        // Suite d'intitulé projet prise pour un lieu : « Salesforce Consumer Goods » + « Cloud mobile app ».
        if (location.Length > 0 && company.Length > 0 && !LooksLikeGeographicHint(location))
        {
            company = $"{company} {location}".Trim();
            location = string.Empty;
        }

        // Filtrer les entrées qui sont en réalité des coordonnées
        var roleNorm = NormalizeKey(role);
        if (roleNorm.Contains("telephone") || roleNorm.Contains("adresse") || roleNorm.Contains("email") || roleNorm.Contains("linkedin") || roleNorm.Contains("github"))
        {
            return null;
        }

        if (company.Length == 0 && body.Count > 0 && LooksLikeOrganizationLine(body[0]))
        {
            company = StripPeriod(body[0]);
            body.RemoveAt(0);
        }

        // Une ligne de lieu orpheline après une année collée : « (Lac,Tunisie) ».
        if (location.Length == 0 && body.Count > 0)
        {
            var locationCandidate = body[0].Trim();
            var locationMatch = ParentheticalLocationRegex.Match(locationCandidate);
            if (locationMatch.Success && locationCandidate.Length <= 60)
            {
                location = locationMatch.Groups[1].Value.Trim();
                body.RemoveAt(0);
            }
        }

        // Re-tenter l'extraction parenthèses après fusion éventuelle.
        if (location.Length == 0)
        {
            ExtractParentheticalLocation(ref role, ref company, ref location);
            location = location.Trim('(', ')', ' ');
        }

        if (role.Length == 0 && company.Length == 0) return null;

        if (company.Length == 0 && role.Length > 0)
        {
            // Une seule information : elle reste l'intitulé du poste.
            company = string.Empty;
        }

        var description = string.Join("\n", body
            .Where(line => !InlineFieldLabels.Contains(NormalizeKey(line.Split(':', 2)[0])))
            .Select(line => BulletRegex.Replace(line, string.Empty).Trim())
            .Where(line => line.Length > 0));

        if (description.Length > 1000) description = description[..1000].Trim();

        var (startDate, endDate, isCurrent) = ParseDateRange(entry.Period);
        var technologies = DetectTechTerms(string.Join(" ", entry.HeaderLines.Concat(entry.Body)));

        return new CvExperienceDto
        {
            Role = role,
            Company = company,
            Location = NormalizeLocation(location),
            Period = entry.Period,
            StartDate = startDate,
            EndDate = isCurrent ? string.Empty : endDate,
            IsCurrent = isCurrent,
            Technologies = technologies,
            Description = description,
        };
    }

    private static List<CvEducationDto> ParseEducation(IReadOnlyList<string> lines, List<string> uncertain)
    {
        var result = new List<CvEducationDto>();

        // Cas le plus fréquent dans les CV mis en page en colonnes : les lignes de
        // l'établissement précèdent la ligne du diplôme qui porte les dates.
        // On les regroupe explicitement pour que l'établissement ne soit pas
        // rattaché à la formation précédente (ou inversé avec le diplôme).
        result.AddRange(ParseEducationEntries(lines));

        if (result.Count == 0)
        {
            foreach (var entry in SplitDatedEntries(lines))
            {
                if (result.Count >= MaxEducation) break;

                var education = BuildEducation(entry);
                if (education is null) continue;
                result.Add(education);
            }
        }

        if (result.Count == 0 && lines.Any(line => line.Length > 0))
        {
            uncertain.Add("La section Formations a été détectée mais aucune entrée exploitable n'a pu être structurée.");
        }

        return result;
    }

    /// <summary>
    /// Découpe la section Formation en partant des lignes datées, puis récupère
    /// l'établissement dans les lignes qui précèdent immédiatement chaque date.
    /// La dernière ligne avant la date peut être le début du diplôme coupé sur
    /// deux lignes (elle se termine alors par un tiret).
    /// </summary>
    private static List<CvEducationDto> ParseEducationEntries(IReadOnlyList<string> lines)
    {
        var result = new List<CvEducationDto>();
        var cleaned = lines.Select(line => SeparateGluedYear(line.Trim())).ToList();
        var dateIndexes = Enumerable.Range(0, cleaned.Count)
            .Where(index => IsDatedEntryAnchor(cleaned[index]))
            .ToList();

        if (dateIndexes.Count == 0) return result;

        var entryStarts = new int[dateIndexes.Count];
        var institutions = new string[dateIndexes.Count];
        var degreePrefixes = new string[dateIndexes.Count];

        for (var index = 0; index < dateIndexes.Count; index++)
        {
            var dateIndex = dateIndexes[index];
            var regionStart = index == 0 ? 0 : dateIndexes[index - 1] + 1;

            var region = cleaned
                .Skip(regionStart)
                .Take(dateIndex - regionStart)
                .Where(line => line.Length > 0)
                .ToList();

            var prefix = string.Empty;
            if (region.Count > 0 && EndsWithContinuation(region[^1]))
            {
                prefix = CleanTitle(region[^1]);
                region.RemoveAt(region.Count - 1);
            }

            // L'établissement occupe au plus deux lignes (« École … » + « (ESPRIT) »).
            var institutionLines = region
                .Skip(Math.Max(0, region.Count - 2))
                .Where(LooksLikeEntryHeaderLine)
                .ToList();

            institutions[index] = string.Join(" ", institutionLines).Trim();
            degreePrefixes[index] = prefix;
            entryStarts[index] = dateIndex - (institutionLines.Count + (prefix.Length > 0 ? 1 : 0));
        }

        for (var index = 0; index < dateIndexes.Count; index++)
        {
            if (result.Count >= MaxEducation) break;

            var dateIndex = dateIndexes[index];
            var period = ExtractPeriod(cleaned[dateIndex]);
            var degreeText = CleanTitle(StripPeriod(cleaned[dateIndex]));

            if (degreePrefixes[index].Length > 0)
            {
                degreeText = $"{degreePrefixes[index]} — {degreeText}";
            }

            if (degreeText.Length == 0) continue;

            var bodyStart = dateIndex + 1;
            var bodyEnd = index + 1 < dateIndexes.Count ? entryStarts[index + 1] : cleaned.Count;
            if (bodyEnd < bodyStart) bodyEnd = bodyStart;

            var body = cleaned
                .Skip(bodyStart)
                .Take(bodyEnd - bodyStart)
                .Where(line => line.Length > 0 && !IsSectionHeading(line))
                .ToList();

            var education = BuildEducationFromParts(degreeText, institutions[index], period, body);
            if (education is not null) result.Add(education);
        }

        return result;
    }

    /// <summary>Diplôme + établissement + spécialité déjà isolés par le découpage.</summary>
    private static CvEducationDto? BuildEducationFromParts(
        string degreeText,
        string institution,
        string period,
        List<string> body)
    {
        var segments = HeaderSeparatorRegex.Split(degreeText)
            .Select(part => part.Trim(' ', '-', '–', '—', '|', '•', '·', ','))
            .Where(part => part.Length > 0)
            .ToList();

        var degree = segments.Count > 0 ? segments[0] : CleanTitle(degreeText);
        var specialty = segments.Count > 1 ? string.Join(" — ", segments.Skip(1)) : string.Empty;

        // « Cycle Ingénieur en Génie Études Logiciel » : le diplôme et la
        // spécialité sont dans le même segment. Ne jamais re-découper un diplôme
        // dont la spécialité a déjà été trouvée (sinon « Licence Appliquée en
        // Technologies de l'Informatique » perdrait sa fin).
        if (specialty.Length == 0)
        {
            var degreeMatch = Regex.Match(
                degree,
                @"^(?<degree>.{2,60}?)\s+(?:en|in|de|of)\s+(?<specialty>.{2,60})$",
                RegexOptions.IgnoreCase);
            if (degreeMatch.Success && !degree.Any(char.IsDigit))
            {
                degree = degreeMatch.Groups["degree"].Value.Trim();
                specialty = degreeMatch.Groups["specialty"].Value.Trim();
            }
        }

        // Établissement absent des lignes précédentes : il peut être sur la même
        // ligne que le diplôme (« Master — Université de Tunis »).
        if (institution.Length == 0 && segments.Count > 1)
        {
            institution = segments[1];
            specialty = segments.Count > 2 ? string.Join(" — ", segments.Skip(2)) : string.Empty;
        }

        if (degree.Length == 0 && institution.Length == 0) return null;

        var description = string.Join("\n", body
            .Select(line => BulletRegex.Replace(line, string.Empty).Trim())
            .Where(line => line.Length > 0));
        if (description.Length > 1000) description = description[..1000].Trim();

        var (startDate, endDate, _) = ParseDateRange(period);

        return new CvEducationDto
        {
            Degree = degree,
            Institution = institution,
            Specialty = specialty,
            Location = string.Empty,
            Period = period,
            StartDate = startDate,
            EndDate = endDate,
            Description = description,
        };
    }

    private static bool EndsWithContinuation(string value)
    {
        var trimmed = value.TrimEnd();
        return trimmed.EndsWith('—') || trimmed.EndsWith('–') ||
               trimmed.EndsWith('-') || trimmed.EndsWith('|');
    }

    private static CvEducationDto? BuildEducation(Entry entry)
    {
        var parts = SplitHeaderParts(entry.HeaderLines);
        var body = entry.Body.ToList();

        var degree = parts.Count > 0 ? parts[0] : string.Empty;
        var institution = parts.Count > 1 ? parts[1] : string.Empty;

        // Filtrer les entrées qui sont en réalité des coordonnées ou des sections
        var degreeNorm = NormalizeKey(degree);
        if (degreeNorm.Contains("telephone") || degreeNorm.Contains("adresse") || degreeNorm.Contains("email") || degreeNorm.Contains("linkedin") || degreeNorm.Contains("naissance"))
        {
            return null;
        }

        // Ligne de dates : « Génie logiciel • Tunis, Tunisie • 2005-09 — 2007-06 ».
        // La spécialité précède alors la ville (et non l'inverse).
        var specialty = string.Empty;
        var location = string.Empty;
        if (parts.Count == 3)
        {
            location = parts[2];
        }
        else if (parts.Count > 3)
        {
            specialty = parts[2];
            location = string.Join(", ", parts.Skip(3));
        }

        if (degree.Length > 0 && institution.Length > 0 &&
            LooksLikeEducationOrganization(degree) && !LooksLikeEducationOrganization(institution))
        {
            (degree, institution) = (institution, degree);
        }

        if (institution.Length == 0 && body.Count > 0 && LooksLikeOrganizationLine(body[0]))
        {
            institution = StripPeriod(body[0]);
            body.RemoveAt(0);
        }

        if (degree.Length == 0 && institution.Length == 0) return null;

        var degreeMatch = Regex.Match(degree, @"^(?<degree>.{2,60}?)\s+(?:en|in|de|of)\s+(?<specialty>.{2,60})$", RegexOptions.IgnoreCase);
        if (degreeMatch.Success && !degree.Any(char.IsDigit))
        {
            degree = degreeMatch.Groups["degree"].Value.Trim();
            if (specialty.Length == 0)
            {
                specialty = degreeMatch.Groups["specialty"].Value.Trim();
            }
        }

        var description = string.Join("\n", body
            .Select(line => BulletRegex.Replace(line, string.Empty).Trim())
            .Where(line => line.Length > 0));
        if (description.Length > 1000) description = description[..1000].Trim();

        var (startDate, endDate, _) = ParseDateRange(entry.Period);

        return new CvEducationDto
        {
            Degree = degree,
            Institution = institution,
            Specialty = specialty,
            Location = location,
            Period = entry.Period,
            StartDate = startDate,
            EndDate = endDate,
            Description = description,
        };
    }

    private static List<CvCertificationDto> ParseCertifications(IReadOnlyList<string> lines, List<string> uncertain)
    {
        var result = new List<CvCertificationDto>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var rawLine in lines)
        {
            if (result.Count >= MaxCertifications) break;

            var line = BulletRegex.Replace(rawLine.Trim(), string.Empty).Trim();
            if (line.Length < 3) continue;
            if (YearOnlyRegex.IsMatch(line)) continue;
            if (IsSectionHeading(line)) continue;

            // Chaque ligne de la section est une certification : les PDF n'insèrent
            // pas de ligne vide entre deux entrées, un regroupement par blocs
            // fusionnerait plusieurs certifications en une seule.
            var period = ExtractPeriod(line);
            var withoutRange = period.Length > 0 ? StripPeriod(line) : line;

            var parts = SplitHeaderParts([withoutRange]);
            var name = CleanTitle(parts.Count > 0 ? parts[0] : withoutRange);
            var issuer = parts.Count > 1 ? CleanTitle(parts[1]) : string.Empty;

            var yearMatch = DateTokenRegex.Match(line);
            var year = yearMatch.Success ? yearMatch.Groups["year"].Value : string.Empty;

            // L'année et l'organisme ne doivent pas rester collés au nom.
            name = Regex.Replace(name, @"\s*[\(\[]?\s*(?:19|20)\d{2}\s*[\)\]]?\s*$", string.Empty).Trim();
            issuer = Regex.Replace(issuer, @"\s*[\(\[]?\s*(?:19|20)\d{2}\s*[\)\]]?\s*$", string.Empty).Trim();

            if (name.Length == 0) continue;
            if (!seen.Add(name)) continue;

            if (year.Length == 0 && issuer.Length == 0)
            {
                uncertain.Add($"Certification sans organisme ni année : « {name} ». Complétez si nécessaire.");
            }

            result.Add(new CvCertificationDto
            {
                Name = name,
                Issuer = issuer,
                Year = year,
            });
        }

        if (result.Count == 0 && lines.Any(line => line.Length > 0))
        {
            uncertain.Add("La section Certifications a été détectée mais aucune certification n'a pu être structurée.");
        }

        return result;
    }

    private static void ParseProjects(IReadOnlyDictionary<string, List<string>> sections, List<string> uncertain)
    {
        var lines = SectionLines(sections, "projects")
            .Select(line => BulletRegex.Replace(line, string.Empty).Trim())
            .Where(line => line.Length > 2)
            .Take(10)
            .ToList();

        if (lines.Count > 0)
        {
            uncertain.Add(
                $"Projets détectés dans le CV : {string.Join(" ; ", lines)}. Ils ne sont pas créés automatiquement : ajoutez-les comme case studies.");
        }
    }

    private static List<Entry> SplitDatedEntries(IReadOnlyList<string> lines)
    {
        var cleaned = lines.Select(line => SeparateGluedYear(line.Trim())).ToList();
        var dateIndexes = Enumerable.Range(0, cleaned.Count)
            .Where(index => IsDatedEntryAnchor(cleaned[index]))
            .ToList();

        if (dateIndexes.Count == 0)
        {
            return GroupBlankBlocks(cleaned)
                .Select(block =>
                {
                    var content = block.Where(line => line.Length > 0).ToList();
                    var period = content.Select(ExtractPeriod).FirstOrDefault(value => value.Length > 0) ?? string.Empty;
                    var header = content.Where(line => !BulletRegex.IsMatch(line)).Take(2).ToList();
                    var body = content.Skip(header.Count).ToList();
                    return new Entry(header, period, body);
                })
                .Where(entry => entry.HeaderLines.Count > 0 || entry.Body.Count > 0)
                .ToList();
        }

        var headerStarts = new int[dateIndexes.Count];
        var headerLines = new List<string>[dateIndexes.Count];

        for (var index = 0; index < dateIndexes.Count; index++)
        {
            var dateIndex = dateIndexes[index];
            var lowerBound = index == 0 ? -1 : dateIndexes[index - 1];
            var collected = new List<string>();
            var cursor = dateIndex - 1;
            var startIndex = dateIndex;

            var dateLine = cleaned[dateIndex];
            var dateLineIsSelfContainedHeader =
                LooksLikeExperienceEntryMarker(dateLine) ||
                HeaderSeparatorRegex.IsMatch(StripPeriod(dateLine));

            while (cursor > lowerBound && collected.Count < 2)
            {
                var line = cleaned[cursor];
                if (line.Length == 0)
                {
                    cursor--;
                    continue;
                }

                // Ne pas inclure un titre de section dans l'en-tête d'entrée
                if (TryReadSectionHeading(line, out _, out _))
                {
                    break;
                }

                // « Technologies : React » appartient à l'entrée précédente : on la
                // saute sans interrompre la recherche du vrai en-tête.
                if (InlineFieldLabels.Contains(NormalizeKey(line.Split(':', 2)[0])))
                {
                    cursor--;
                    continue;
                }

                // Description, liste techno ou autre corps : stop. Si la ligne datée
                // porte déjà Stage/Projet/…, inutile de remonter plus haut.
                if (LooksLikeExperienceBodyLine(line) || dateLineIsSelfContainedHeader)
                {
                    break;
                }

                if (BulletRegex.IsMatch(line) || !LooksLikeEntryHeaderLine(line)) break;

                collected.Insert(0, line);
                startIndex = cursor;
                cursor--;
            }

            var inline = StripPeriod(dateLine);
            if (!string.IsNullOrWhiteSpace(inline) && !LooksLikeContact(inline))
            {
                collected.Add(inline);
            }

            headerLines[index] = collected;
            headerStarts[index] = startIndex;
        }

        var entries = new List<Entry>();
        for (var index = 0; index < dateIndexes.Count; index++)
        {
            var bodyStart = dateIndexes[index] + 1;
            var bodyEnd = index + 1 < dateIndexes.Count ? headerStarts[index + 1] : cleaned.Count;
            if (bodyEnd < bodyStart) bodyEnd = bodyStart;

            var body = cleaned
                .Skip(bodyStart)
                .Take(bodyEnd - bodyStart)
                .Where(line => line.Length > 0)
                .ToList();

            entries.Add(new Entry(headerLines[index], ExtractPeriod(cleaned[dateIndexes[index]]), body));
        }

        return entries;
    }

    private static List<List<string>> GroupBlankBlocks(IReadOnlyList<string> lines)
    {
        var blocks = new List<List<string>>();
        var current = new List<string>();

        void Flush()
        {
            if (current.Any(line => line.Length > 0)) blocks.Add(current.ToList());
            current.Clear();
        }

        foreach (var line in lines)
        {
            if (line.Length == 0)
            {
                Flush();
                continue;
            }

            current.Add(line);
        }

        Flush();
        return blocks;
    }

    private static List<string> SplitHeaderParts(IReadOnlyList<string> headerLines)
    {
        if (headerLines.Count == 0) return [];

        var first = headerLines[0];
        var parts = HeaderSeparatorRegex.Split(first)
            .Select(part => part.Trim(' ', '-', '–', '—', '|', '•', '·', ','))
            .Where(part => part.Length > 0)
            .ToList();

        if (parts.Count == 0)
        {
            parts.Add(CleanTitle(first));
        }

        // Une deuxième ligne d'en-tête complète généralement l'organisme.
        if (headerLines.Count > 1)
        {
            var second = HeaderSeparatorRegex.Split(headerLines[1])
                .Select(part => part.Trim(' ', '-', '–', '—', '|', '•', '·', ','))
                .Where(part => part.Length > 0 && !parts.Contains(part, StringComparer.OrdinalIgnoreCase));

            foreach (var part in second)
            {
                parts.Add(part);
            }
        }

        return parts;
    }

    private static bool LooksLikeEntryHeaderLine(string value)
    {
        var trimmed = value.Trim();
        if (trimmed.Length is < 2 or > 140) return false;
        if (trimmed.EndsWith(".", StringComparison.Ordinal)) return false;
        if (trimmed.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length > 12) return false;
        if (LooksLikeExperienceBodyLine(trimmed)) return false;

        return true;
    }

    /// <summary>
    /// Lignes de description / techno qui ne doivent jamais servir d'en-tête
    /// ni d'ancre de période pour une nouvelle expérience.
    /// </summary>
    private static bool LooksLikeExperienceBodyLine(string value)
    {
        var trimmed = value.Trim();
        if (trimmed.Length == 0) return false;
        if (trimmed.EndsWith('.')) return true;
        if (trimmed.Count(character => character == ',') >= 2) return true;

        var label = NormalizeKey(trimmed.Split(':', 2)[0]);
        if (InlineFieldLabels.Contains(label)) return true;
        if (label is "utilisees" or "technologies utilisees" or "environnement technique") return true;

        var normalized = RemoveDiacritics(trimmed).ToLowerInvariant();
        if (normalized.StartsWith("realisation", StringComparison.Ordinal) ||
            normalized.StartsWith("decouverte", StringComparison.Ordinal) ||
            normalized.StartsWith("contribution", StringComparison.Ordinal) ||
            normalized.StartsWith("actuellement", StringComparison.Ordinal) ||
            normalized.StartsWith("j ai ", StringComparison.Ordinal) ||
            normalized.StartsWith("jai ", StringComparison.Ordinal))
        {
            return true;
        }

        return false;
    }

    private static bool LooksLikeOrganizationLine(string value)
    {
        var trimmed = value.Trim();
        if (trimmed.Length is < 2 or > 120) return false;
        if (trimmed.EndsWith(".", StringComparison.Ordinal) && trimmed.Length > 60) return false;
        if (trimmed.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length > 6) return false;
        if (LooksLikeContact(trimmed)) return false;

        return true;
    }

    private static bool HasUnclosedParenthesis(string value) =>
        value.Count(character => character == '(') > value.Count(character => character == ')');

    private static void ExtractParentheticalLocation(ref string role, ref string company, ref string location)
    {
        foreach (var field in new[] { "company", "role", "location" })
        {
            var value = field switch
            {
                "company" => company,
                "role" => role,
                _ => location,
            };

            var match = ParentheticalLocationRegex.Match(value);
            if (!match.Success) continue;

            location = match.Groups[1].Value.Trim();
            var cleaned = ParentheticalLocationRegex.Replace(value, string.Empty).Trim();
            switch (field)
            {
                case "company":
                    company = CleanTitle(cleaned);
                    break;
                case "role":
                    role = CleanTitle(cleaned);
                    break;
                default:
                    location = match.Groups[1].Value.Trim();
                    break;
            }

            return;
        }
    }

    /// <summary>
    /// Indique si un fragment ressemble à un lieu géographique plutôt qu'à la
    /// suite d'un intitulé de projet (« Cloud mobile app »).
    /// </summary>
    private static bool LooksLikeGeographicHint(string value)
    {
        var trimmed = value.Trim('(', ')', ' ');
        if (trimmed.Length is < 2 or > 80) return false;

        var normalized = RemoveDiacritics(trimmed).ToLowerInvariant();
        if (normalized.Contains(',')) return true;
        return ContainsAny(
            normalized,
            "tunisie",
            "tunisia",
            "france",
            "paris",
            "tunis",
            "ariana",
            "lac",
            "sfax",
            "sousse",
            "nabeul",
            "remote",
            "distanciel",
            "sur site",
            "onsite",
            "hybrid",
            "maroc",
            "algerie",
            "belgique",
            "canada",
            "usa",
            "uk",
            "dubai",
            "emirats");
    }

    private static bool LooksLikeEducationEntry(string value)
    {
        var normalized = RemoveDiacritics(value).ToLowerInvariant();
        return EducationWords.Any(word => normalized.Contains(word, StringComparison.Ordinal));
    }

    private static bool LooksLikeEducationOrganization(string value) => LooksLikeEducationEntry(value);

    // --- Dates -------------------------------------------------------------

    private static (string Start, string End, bool Current) ParseDateRange(string period)
    {
        if (string.IsNullOrWhiteSpace(period)) return (string.Empty, string.Empty, false);

        var matches = DateTokenRegex.Matches(period);
        if (matches.Count == 0) return (string.Empty, string.Empty, false);

        var start = FormatDateToken(matches[0]);
        var end = matches.Count > 1 ? FormatDateToken(matches[1]) : string.Empty;
        var normalized = RemoveDiacritics(period).ToLowerInvariant();
        var isCurrent = ContainsAny(normalized, "present", "current", "aujourd", "now", "ce jour", "en cours");

        return (start, isCurrent ? string.Empty : end, isCurrent);
    }

    private static string FormatDateToken(Match match)
    {
        var year = match.Groups["year"].Value;
        var month = match.Groups["mnum"].Value;
        var monthName = match.Groups["mname"].Value;

        if (string.IsNullOrEmpty(month) && !string.IsNullOrEmpty(monthName))
        {
            month = MonthNumber(monthName).ToString(CultureInfo.InvariantCulture);
        }

        if (string.IsNullOrEmpty(month))
        {
            month = match.Groups["isonum"].Value;
        }

        if (int.TryParse(month, NumberStyles.Integer, CultureInfo.InvariantCulture, out var monthValue) &&
            monthValue is >= 1 and <= 12)
        {
            return $"{year}-{monthValue:D2}";
        }

        return year;
    }

    private static int MonthNumber(string value)
    {
        var normalized = RemoveDiacritics(value).ToLowerInvariant();
        if (normalized.StartsWith("jan", StringComparison.Ordinal)) return 1;
        if (normalized.StartsWith("fev", StringComparison.Ordinal) || normalized.StartsWith("feb", StringComparison.Ordinal)) return 2;
        if (normalized.StartsWith("mar", StringComparison.Ordinal)) return 3;
        if (normalized.StartsWith("avr", StringComparison.Ordinal) || normalized.StartsWith("apr", StringComparison.Ordinal)) return 4;
        if (normalized.StartsWith("mai", StringComparison.Ordinal) || normalized.StartsWith("may", StringComparison.Ordinal)) return 5;
        if (normalized.StartsWith("juin", StringComparison.Ordinal) || normalized.StartsWith("jun", StringComparison.Ordinal)) return 6;
        if (normalized.StartsWith("juil", StringComparison.Ordinal) || normalized.StartsWith("jul", StringComparison.Ordinal)) return 7;
        if (normalized.StartsWith("aou", StringComparison.Ordinal) || normalized.StartsWith("aug", StringComparison.Ordinal)) return 8;
        if (normalized.StartsWith("sep", StringComparison.Ordinal)) return 9;
        if (normalized.StartsWith("oct", StringComparison.Ordinal)) return 10;
        if (normalized.StartsWith("nov", StringComparison.Ordinal)) return 11;
        if (normalized.StartsWith("dec", StringComparison.Ordinal)) return 12;
        return 0;
    }

    /// <summary>
    /// Sépare une année collée au mot précédent (« Immobilière2022 ») pour
    /// permettre la détection de période et le découpage des en-têtes.
    /// </summary>
    private static string SeparateGluedYear(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return value;
        return Regex.Replace(value, @"(?<=\p{L})((?:19|20)\d{2})\b", " $1");
    }

    private static string ExtractPeriod(string value)
    {
        value = SeparateGluedYear(value);

        var match = PeriodRegex.Match(value);
        if (match.Success) return match.Value.Trim();

        var yearPresent = YearPresentRegex.Match(value);
        if (yearPresent.Success) return yearPresent.Value.Trim();

        // Plage d'années séparées par une barre oblique : « 2025/2026 ».
        var slashMatch = Regex.Match(value, @"(?:19|20)\d{2}\s*/\s*(?:19|20)\d{2}");
        if (slashMatch.Success) return slashMatch.Value.Trim();

        var trimmed = value.Trim(' ', '(', ')', ',', ';', '|');
        if (YearOnlyRegex.IsMatch(trimmed))
        {
            return trimmed;
        }

        var embedded = EmbeddedEmploymentYearRegex.Matches(value);
        if (embedded.Count > 0)
        {
            return embedded[^1].Groups[1].Value;
        }

        return string.Empty;
    }

    /// <summary>
    /// Une ligne ancre une nouvelle entrée datée seulement si la période est
    /// fiable : plage explicite, ou année seule sur une ligne d'en-tête (pas
    /// une phrase de description se terminant par un point).
    /// </summary>
    private static bool IsDatedEntryAnchor(string line)
    {
        if (LooksLikeExperienceBodyLine(line)) return false;

        var period = ExtractPeriod(line);
        if (period.Length == 0) return false;

        var prepared = SeparateGluedYear(line);
        if (PeriodRegex.IsMatch(prepared) ||
            YearPresentRegex.IsMatch(prepared) ||
            Regex.IsMatch(line, @"(?:19|20)\d{2}\s*/\s*(?:19|20)\d{2}"))
        {
            return true;
        }

        // Année seule : uniquement sur un en-tête d'expérience / formation.
        if (line.TrimEnd().EndsWith('.')) return false;
        if (LooksLikeExperienceEntryMarker(line)) return true;
        if (LooksLikeEntryHeaderLine(line) && !LooksLikeExperienceBodyLine(line)) return true;

        return false;
    }

    private static bool LooksLikeExperienceEntryMarker(string value)
    {
        var normalized = RemoveDiacritics(value).ToLowerInvariant();
        return ContainsAny(
            normalized,
            "stage",
            "projet",
            "internship",
            "alternance",
            "freelance",
            "consultant",
            "consultante",
            "developpeur",
            "developpeuse",
            "ingenieur",
            "mission",
            "cdi",
            "cdd",
            "emploi",
            "work experience");
    }

    private static string StripPeriod(string value)
    {
        value = SeparateGluedYear(value);
        var period = ExtractPeriod(value);
        if (period.Length == 0) return value.Trim();

        var index = value.IndexOf(period, StringComparison.OrdinalIgnoreCase);
        if (index < 0)
        {
            // Année seule éventuellement collée avant normalisation déjà appliquée.
            return Regex.Replace(value, @"\b" + Regex.Escape(period) + @"\b", string.Empty)
                .Trim(' ', '-', '–', '—', '|', '•', '·', ',', ';', '(', ')');
        }

        // Ne pas retirer les parenthèses : elles encadrent souvent le lieu
        // (« Neoledge 2023 (Lac, Tunisie) »).
        return (value[..index] + value[(index + period.Length)..])
            .Trim(' ', '-', '–', '—', '|', '•', '·', ',', ';');
    }

    // --- Divers ------------------------------------------------------------

    private static bool LooksLikeName(string value)
    {
        var valueWithoutAccents = RemoveDiacritics(value);
        if (valueWithoutAccents.Length is < 3 or > 80) return false;
        if (value.Any(char.IsDigit) || value.Contains('@') || value.Contains("http", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (TitleWords.Any(word => valueWithoutAccents.Contains(word, StringComparison.OrdinalIgnoreCase)))
        {
            return false;
        }

        if (EducationWords.Any(word => valueWithoutAccents.ToLowerInvariant().Contains(word, StringComparison.OrdinalIgnoreCase)))
        {
            return false;
        }

        var words = value.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return words.Length is >= 2 and <= 5
            && words.All(word => word.All(character => char.IsLetter(character) || character is '-' or '\'' or '.'));
    }

    private static string CleanTitle(string value) => value.Trim(' ', '-', '–', '—', '|', '•', '·');

    private static bool LooksLikeContact(string line) =>
        line.Contains('@') ||
        line.Contains("http", StringComparison.OrdinalIgnoreCase) ||
        line.Contains("linkedin.", StringComparison.OrdinalIgnoreCase) ||
        line.Contains("github.", StringComparison.OrdinalIgnoreCase) ||
        Regex.IsMatch(line, @"\+?\d[\d\s().-]{6,}\d");

    private static string ReadParagraph(IReadOnlyList<string> lines, int maxLength)
    {
        var content = string.Join("\n", lines
            .Select(line => line.Trim())
            .Where(line => line.Length > 0));

        content = Regex.Replace(content, @"\n{3,}", "\n\n").Trim();
        return content.Length <= maxLength ? content : content[..maxLength].Trim();
    }

    private static List<string> ExtractLinks(string text)
    {
        var links = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (Match match in UrlRegex.Matches(text))
        {
            var link = match.Value.TrimEnd('.', ',', ';', ':', ')', ']', '}');
            if (link.Length < 5) continue;
            if (seen.Add(link)) links.Add(link);
            if (links.Count >= 10) break;
        }

        return links;
    }

    private static List<string> SectionLines(IReadOnlyDictionary<string, List<string>> sections, string name) =>
        sections.TryGetValue(name, out var lines) ? lines : [];

    private static string NormalizeKey(string value)
    {
        var normalized = RemoveDiacritics(value).ToLowerInvariant();
        var builder = new StringBuilder(normalized.Length);

        foreach (var character in normalized)
        {
            if (char.IsLetterOrDigit(character) || char.IsWhiteSpace(character))
            {
                builder.Append(character);
            }
        }

        return Regex.Replace(builder.ToString(), @"\s+", " ").Trim();
    }

    private static string NormalizeSpaces(string value) => Regex.Replace(value, @"\s+", " ").Trim();

    private static bool ContainsAny(string value, params string[] candidates) =>
        candidates.Any(candidate => value.Contains(candidate, StringComparison.OrdinalIgnoreCase));

    private static string RemoveDiacritics(string value)
    {
        var normalized = value.Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(normalized.Length);

        foreach (var character in normalized)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark)
            {
                builder.Append(character);
            }
        }

        return builder.ToString().Normalize(NormalizationForm.FormC);
    }
}
