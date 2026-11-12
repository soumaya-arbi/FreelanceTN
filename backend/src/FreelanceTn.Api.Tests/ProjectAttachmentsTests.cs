using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using FreelanceTn.Api.Controllers;
using FreelanceTn.Api.Configuration;
using FreelanceTn.Api.Dtos.Projects;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using FreelanceTn.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using Task = System.Threading.Tasks.Task;

namespace FreelanceTn.Api.Tests;

public class ProjectAttachmentsTests : IClassFixture<MongoFixture>, IDisposable
{
    private readonly MongoFixture _fixture;
    private readonly ProjectService _projects;
    private readonly string _testTempDir;
    private readonly TestWebHostEnvironment _env;

    public ProjectAttachmentsTests(MongoFixture fixture)
    {
        _fixture = fixture;
        _projects = new ProjectService(fixture.Context);
        _testTempDir = Path.Combine(Path.GetTempPath(), $"FreelanceTn_Tests_{Guid.NewGuid():N}");
        Directory.CreateDirectory(_testTempDir);
        _env = new TestWebHostEnvironment { ContentRootPath = _testTempDir };
    }

    public void Dispose()
    {
        try
        {
            if (Directory.Exists(_testTempDir))
            {
                Directory.Delete(_testTempDir, true);
            }
        }
        catch
        {
            // Nettoyage au mieux
        }
    }

    private UploadsController CreateController(string? userId = null)
    {
        var controller = new UploadsController(
            null!,
            _env,
            _fixture.Context,
            Options.Create(new AuthSettings()));
        var httpContext = new DefaultHttpContext();
        if (!string.IsNullOrWhiteSpace(userId))
        {
            httpContext.User = new ClaimsPrincipal(new ClaimsIdentity(
            [
                new Claim(JwtRegisteredClaimNames.Sub, userId),
                new Claim(ClaimTypes.NameIdentifier, userId)
            ], "TestAuth"));
        }
        controller.ControllerContext = new ControllerContext { HttpContext = httpContext };
        return controller;
    }

    private static IFormFile CreateFormFile(string fileName, string content = "test content")
    {
        var bytes = Encoding.UTF8.GetBytes(content);
        var stream = new MemoryStream(bytes);
        return new FormFile(stream, 0, bytes.Length, "file", fileName)
        {
            Headers = new HeaderDictionary(),
            ContentType = "application/pdf"
        };
    }

    [Fact]
    public async Task CreationSansFichier_CreeUnProjetSansAttachments()
    {
        var client = await TestData.InsertUserAsync(_fixture.Context, UserRole.Client, "Alice", "Client");

        var response = await _projects.CreateAsync(client.Id, new CreateProjectRequest
        {
            Title = "Projet sans fichier",
            Description = "Description",
            Budget = "500",
            Type = "Fixed price",
            Client = "Alice Client",
            Attachments = null,
        }, CancellationToken.None);

        Assert.NotNull(response);
        Assert.Empty(response.Attachments);
    }

    [Fact]
    public async Task CreationAvecUnFichier_EnregistreLaPieceJointe()
    {
        var client = await TestData.InsertUserAsync(_fixture.Context, UserRole.Client, "Alice", "Client");

        var response = await _projects.CreateAsync(client.Id, new CreateProjectRequest
        {
            Title = "Projet avec un fichier",
            Description = "Description",
            Budget = "500",
            Type = "Fixed price",
            Client = "Alice Client",
            Attachments =
            [
                new ProjectAttachmentRequest
                {
                    FileName = "cahier_des_charges.pdf",
                    Url = "/api/uploads/project/p1/f1.pdf",
                    Size = 1024,
                }
            ],
        }, CancellationToken.None);

        Assert.Single(response.Attachments);
        Assert.Equal("cahier_des_charges.pdf", response.Attachments[0].FileName);
        Assert.Equal("/api/uploads/project/p1/f1.pdf", response.Attachments[0].Url);
    }

    [Fact]
    public async Task CreationAvecPlusieursFichiers_EnregistreToutesLesPiecesJointes()
    {
        var client = await TestData.InsertUserAsync(_fixture.Context, UserRole.Client, "Alice", "Client");

        var response = await _projects.CreateAsync(client.Id, new CreateProjectRequest
        {
            Title = "Projet plusieurs fichiers",
            Description = "Description",
            Budget = "1500",
            Type = "Fixed price",
            Client = "Alice Client",
            Attachments =
            [
                new ProjectAttachmentRequest { FileName = "brief.pdf", Url = "/api/uploads/project/p2/f1.pdf", Size = 2000 },
                new ProjectAttachmentRequest { FileName = "maquette.png", Url = "/api/uploads/project/p2/f2.png", Size = 5000 },
            ],
        }, CancellationToken.None);

        Assert.Equal(2, response.Attachments.Count);
    }

    [Fact]
    public async Task VerificationAbsenceDeDoublons_IgnoreLesUrlDupliquees()
    {
        var client = await TestData.InsertUserAsync(_fixture.Context, UserRole.Client, "Alice", "Client");

        var project = await TestData.InsertProjectAsync(_fixture.Context, client, ProjectStatus.Open);

        // Mise à jour avec doublons intentionnels sur la même URL
        var updated = await _projects.UpdateAsync(client.Id, project.Id, new UpdateProjectRequest
        {
            Attachments =
            [
                new ProjectAttachmentRequest { FileName = "brief.pdf", Url = "/api/uploads/project/p/doc1.pdf", Size = 1000 },
                new ProjectAttachmentRequest { FileName = "brief_copy.pdf", Url = "/api/uploads/project/p/doc1.pdf", Size = 1000 },
                new ProjectAttachmentRequest { FileName = "specs.docx", Url = "/api/uploads/project/p/doc2.docx", Size = 3000 },
            ]
        }, CancellationToken.None);

        Assert.Equal(2, updated.Attachments.Count);
        Assert.Equal("/api/uploads/project/p/doc1.pdf", updated.Attachments[0].Url);
        Assert.Equal("/api/uploads/project/p/doc2.docx", updated.Attachments[1].Url);
    }

    [Fact]
    public async Task AjoutDeFichiersPendantModification_ConserveLesAnciennesPiecesJointes()
    {
        var client = await TestData.InsertUserAsync(_fixture.Context, UserRole.Client, "Alice", "Client");
        var project = await TestData.InsertProjectAsync(_fixture.Context, client, ProjectStatus.Open);

        // 1ère étape : attachement initial
        var step1 = await _projects.UpdateAsync(client.Id, project.Id, new UpdateProjectRequest
        {
            Attachments =
            [
                new ProjectAttachmentRequest { FileName = "initial.pdf", Url = "/api/uploads/project/p/initial.pdf", Size = 1234 }
            ]
        }, CancellationToken.None);

        Assert.Single(step1.Attachments);

        // 2ème étape : ajout d'un nouveau fichier pendant modification en conservant l'ancien
        var step2 = await _projects.UpdateAsync(client.Id, project.Id, new UpdateProjectRequest
        {
            Attachments =
            [
                new ProjectAttachmentRequest { FileName = step1.Attachments[0].FileName, Url = step1.Attachments[0].Url, Size = step1.Attachments[0].Size },
                new ProjectAttachmentRequest { FileName = "added_during_edit.png", Url = "/api/uploads/project/p/edit.png", Size = 4567 }
            ]
        }, CancellationToken.None);

        Assert.Equal(2, step2.Attachments.Count);
        Assert.Contains(step2.Attachments, a => a.FileName == "initial.pdf");
        Assert.Contains(step2.Attachments, a => a.FileName == "added_during_edit.png");
    }

    [Fact]
    public async Task UploadViaController_EchecVolontairePuisRetry_AbsenceDeDoublon()
    {
        var client = await TestData.InsertUserAsync(_fixture.Context, UserRole.Client, "Alice", "Client");
        var project = await TestData.InsertProjectAsync(_fixture.Context, client, ProjectStatus.Open);

        var controller = CreateController(client.Id);

        // 1er upload réussi
        var file1 = CreateFormFile("document1.pdf", "Hello 1");
        var actionResult1 = await controller.UploadProjectAttachment(project.Id, file1, CancellationToken.None);
        var okResult1 = Assert.IsType<OkObjectResult>(actionResult1);
        var val1 = Assert.IsType<UploadProjectAttachmentResponse>(okResult1.Value);
        string url1 = val1.Url;

        // 2ème upload avec échec volontaire (format non autorisé)
        var invalidFile = CreateFormFile("malicious.exe", "bad executable");
        await Assert.ThrowsAsync<ConflictException>(async () =>
        {
            await controller.UploadProjectAttachment(project.Id, invalidFile, CancellationToken.None);
        });

        // Retry : on ne renvoie pas le fichier 1 déjà réussi, on envoie le fichier corrigé
        var file2Corrected = CreateFormFile("document2.pdf", "Hello 2");
        var actionResult2 = await controller.UploadProjectAttachment(project.Id, file2Corrected, CancellationToken.None);
        Assert.IsType<OkObjectResult>(actionResult2);

        // Vérification dans la base MongoDB : 2 fichiers uniques sans doublon
        var freshProject = await _fixture.Context.GetCollection<Project>(_fixture.Context.Settings.ProjectsCollection)
            .Find(p => p.Id == project.Id)
            .FirstOrDefaultAsync();

        Assert.NotNull(freshProject);
        Assert.Equal(2, freshProject.Attachments.Count);
        Assert.Single(freshProject.Attachments, a => a.Url == url1);
    }

    // --- Tests Sécurité Téléchargement ---

    [Fact]
    public async Task Telechargement_ParClientProprietaire_AccesAutorise()
    {
        var client = await TestData.InsertUserAsync(_fixture.Context, UserRole.Client, "Alice", "Client");
        var project = await TestData.InsertProjectAsync(_fixture.Context, client, ProjectStatus.Open);

        var controller = CreateController(client.Id);
        var file = CreateFormFile("brief.pdf", "content");
        var uploadRes = await controller.UploadProjectAttachment(project.Id, file, CancellationToken.None);
        var okResult = Assert.IsType<OkObjectResult>(uploadRes);
        var val = Assert.IsType<UploadProjectAttachmentResponse>(okResult.Value);
        string url = val.Url;
        var fileName = Path.GetFileName(url);

        // Téléchargement par le propriétaire
        var downloadResult = await controller.GetProjectAttachment(project.Id, fileName, CancellationToken.None);
        var physicalFile = Assert.IsType<PhysicalFileResult>(downloadResult);
        Assert.Equal("application/pdf", physicalFile.ContentType);
    }

    [Fact]
    public async Task Telechargement_ParFreelancerAffecte_AccesAutorise()
    {
        var client = await TestData.InsertUserAsync(_fixture.Context, UserRole.Client, "Alice", "Client");
        var freelancer = await TestData.InsertUserAsync(_fixture.Context, UserRole.Freelancer, "Bob", "Freelance");
        var project = await TestData.InsertProjectAsync(_fixture.Context, client, ProjectStatus.InProgress, assignee: freelancer);

        // Le client upload le fichier
        var clientController = CreateController(client.Id);
        var file = CreateFormFile("specs.pdf", "content specs");
        var uploadRes = await clientController.UploadProjectAttachment(project.Id, file, CancellationToken.None);
        var okResult = Assert.IsType<OkObjectResult>(uploadRes);
        var val = Assert.IsType<UploadProjectAttachmentResponse>(okResult.Value);
        string fileName = Path.GetFileName(val.Url);

        // Le freelancer affecté télécharge le fichier
        var freelancerController = CreateController(freelancer.Id);
        var downloadResult = await freelancerController.GetProjectAttachment(project.Id, fileName, CancellationToken.None);
        var physicalFile = Assert.IsType<PhysicalFileResult>(downloadResult);
        Assert.Equal("application/pdf", physicalFile.ContentType);
    }

    [Fact]
    public async Task Telechargement_ParFreelancerNonAffecte_AccesRefuse403()
    {
        var client = await TestData.InsertUserAsync(_fixture.Context, UserRole.Client, "Alice", "Client");
        var assigned = await TestData.InsertUserAsync(_fixture.Context, UserRole.Freelancer, "Bob", "Freelance");
        var unassigned = await TestData.InsertUserAsync(_fixture.Context, UserRole.Freelancer, "Charlie", "Freelance");
        var project = await TestData.InsertProjectAsync(_fixture.Context, client, ProjectStatus.InProgress, assignee: assigned);

        var clientController = CreateController(client.Id);
        var file = CreateFormFile("specs.pdf", "specs");
        var uploadRes = await clientController.UploadProjectAttachment(project.Id, file, CancellationToken.None);
        var okResult = Assert.IsType<OkObjectResult>(uploadRes);
        var val = Assert.IsType<UploadProjectAttachmentResponse>(okResult.Value);
        string fileName = Path.GetFileName(val.Url);

        // Charlie (non affecté) tente de télécharger
        var unassignedController = CreateController(unassigned.Id);
        await Assert.ThrowsAsync<ForbiddenException>(async () =>
        {
            await unassignedController.GetProjectAttachment(project.Id, fileName, CancellationToken.None);
        });
    }

    [Fact]
    public async Task Telechargement_ParAutreClient_AccesRefuse403()
    {
        var clientOwner = await TestData.InsertUserAsync(_fixture.Context, UserRole.Client, "Alice", "Client");
        var otherClient = await TestData.InsertUserAsync(_fixture.Context, UserRole.Client, "David", "Client");
        var project = await TestData.InsertProjectAsync(_fixture.Context, clientOwner, ProjectStatus.Open);

        var clientController = CreateController(clientOwner.Id);
        var file = CreateFormFile("confidential.pdf", "confidential");
        var uploadRes = await clientController.UploadProjectAttachment(project.Id, file, CancellationToken.None);
        var okResult = Assert.IsType<OkObjectResult>(uploadRes);
        var val = Assert.IsType<UploadProjectAttachmentResponse>(okResult.Value);
        string fileName = Path.GetFileName(val.Url);

        // David (autre client) tente de télécharger
        var otherController = CreateController(otherClient.Id);
        await Assert.ThrowsAsync<ForbiddenException>(async () =>
        {
            await otherController.GetProjectAttachment(project.Id, fileName, CancellationToken.None);
        });
    }

    [Fact]
    public async Task Telechargement_SansAuthentification_AccesRefuse401()
    {
        var client = await TestData.InsertUserAsync(_fixture.Context, UserRole.Client, "Alice", "Client");
        var project = await TestData.InsertProjectAsync(_fixture.Context, client, ProjectStatus.Open);

        // Utilisateur non authentifié
        var anonymousController = CreateController(null);

        await Assert.ThrowsAsync<UnauthorizedException>(async () =>
        {
            await anonymousController.GetProjectAttachment(project.Id, "somefile.pdf", CancellationToken.None);
        });
    }

    [Fact]
    public async Task Telechargement_NomDeFichierMalveillantPathTraversal_NotFound404()
    {
        var client = await TestData.InsertUserAsync(_fixture.Context, UserRole.Client, "Alice", "Client");
        var project = await TestData.InsertProjectAsync(_fixture.Context, client, ProjectStatus.Open);

        var controller = CreateController(client.Id);

        // Tentatives de path traversal
        await Assert.ThrowsAsync<NotFoundException>(async () =>
        {
            await controller.GetProjectAttachment(project.Id, "../../../etc/passwd", CancellationToken.None);
        });

        await Assert.ThrowsAsync<NotFoundException>(async () =>
        {
            await controller.GetProjectAttachment(project.Id, "..\\..\\windows\\system32\\cmd.exe", CancellationToken.None);
        });

        await Assert.ThrowsAsync<NotFoundException>(async () =>
        {
            await controller.GetProjectAttachment(project.Id, "subfolder/file.pdf", CancellationToken.None);
        });
    }

    [Fact]
    public async Task Telechargement_ProjetOuFichierInexistant_NotFound404()
    {
        var client = await TestData.InsertUserAsync(_fixture.Context, UserRole.Client, "Alice", "Client");
        var project = await TestData.InsertProjectAsync(_fixture.Context, client, ProjectStatus.Open);

        var controller = CreateController(client.Id);

        // Fichier inexistant sur un projet existant
        await Assert.ThrowsAsync<NotFoundException>(async () =>
        {
            await controller.GetProjectAttachment(project.Id, $"{Guid.NewGuid():N}.pdf", CancellationToken.None);
        });

        // Projet inexistant
        await Assert.ThrowsAsync<NotFoundException>(async () =>
        {
            await controller.GetProjectAttachment(MongoFixture.NewId(), "file.pdf", CancellationToken.None);
        });
    }

    private class TestWebHostEnvironment : IWebHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Testing";
        public string ApplicationName { get; set; } = "FreelanceTn.Api";
        public string WebRootPath { get; set; } = string.Empty;
        public IFileProvider WebRootFileProvider { get; set; } = null!;
        public string ContentRootPath { get; set; } = string.Empty;
        public IFileProvider ContentRootFileProvider { get; set; } = null!;
    }
}
