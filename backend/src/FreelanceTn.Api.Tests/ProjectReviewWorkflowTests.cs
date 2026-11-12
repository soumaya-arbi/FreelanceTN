using FreelanceTn.Api.Dtos.Projects;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using FreelanceTn.Api.Services;

// Le modèle « Task » du module Tasks entre en conflit avec
// System.Threading.Tasks.Task : l'alias ci-dessous garde « Task » pour
// l'asynchrone.
using Task = System.Threading.Tasks.Task;

namespace FreelanceTn.Api.Tests;

/// <summary>
/// Tests du workflow de livraison : soumission par le freelance, visibilité
/// côté client, approbation et demande de correction. Ces tests couvrent le
/// correctif du bug où une soumission n'était plus consultable une fois le
/// projet passé au statut « Client review ».
/// </summary>
public class ProjectReviewWorkflowTests : IClassFixture<MongoFixture>
{
    private readonly MongoFixture _fixture;
    private readonly ProjectService _projects;

    public ProjectReviewWorkflowTests(MongoFixture fixture)
    {
        _fixture = fixture;
        _projects = new ProjectService(fixture.Context);
    }

    private FreelanceTn.Api.Data.MongoContext Mongo => _fixture.Context;

    [Fact]
    public async Task Catalogue_ExclutLesProjetsDejaAttribues()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Alice", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Bob", "Freelancer");

        var openUnassigned = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.Open);
        // Un projet affecté manuellement peut encore porter le statut « Open » :
        // il ne doit malgré tout plus apparaître comme une opportunité ouverte.
        var openAssigned = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.Open, freelancer);

        var catalog = await _projects.ListCatalogAsync(null, null, 200, cancellationToken: CancellationToken.None);

        Assert.Contains(catalog, item => item.Id == openUnassigned.Id);
        Assert.DoesNotContain(catalog, item => item.Id == openAssigned.Id);
    }

    [Fact]
    public async Task SoumissionDuFreelance_PasseEnRevueClientEtNotifieLeClient()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Alice", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Bob", "Freelancer");

        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.InProgress, freelancer);

        var response = await _projects.SubmitForReviewAsync(freelancer.Id, project.Id, CancellationToken.None);

        Assert.Equal(ProjectStatus.ClientReview, response.Status);
        Assert.Equal(freelancer.Id, response.AssignedTo);

        // La soumission est bien persistée dans MongoDB.
        var stored = await TestData.GetProjectAsync(Mongo, project.Id);
        Assert.Equal(ProjectStatus.ClientReview, stored.Status);

        // Le client est notifié et les informations d'affectation sont intactes.
        var notification = await TestData.GetNotificationAsync(Mongo, client.Id, "project-submitted-review");
        Assert.NotNull(notification);
        Assert.Equal(project.Id, notification!.ProjectId);

        // Le client concerné retrouve immédiatement le projet soumis.
        var clientView = await _projects.GetAsync(client.Id, project.Id, CancellationToken.None);
        Assert.Equal(ProjectStatus.ClientReview, clientView.Status);
    }

    [Fact]
    public async Task FreelanceAttribue_PeutConsulterUnProjetEnRevueClient()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Alice", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Bob", "Freelancer");
        var other = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Carla", "Other");

        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.ClientReview, freelancer);

        // Le propriétaire et le freelance attribué voient le projet soumis.
        Assert.Equal(ProjectStatus.ClientReview, (await _projects.GetAsync(client.Id, project.Id, CancellationToken.None)).Status);
        Assert.Equal(ProjectStatus.ClientReview, (await _projects.GetAsync(freelancer.Id, project.Id, CancellationToken.None)).Status);
        Assert.Equal(ProjectStatus.ClientReview, (await _projects.GetEntityAsync(freelancer.Id, project.Id, CancellationToken.None)).Status);

        // Ni un visiteur anonyme ni un autre freelance n'y ont accès.
        await Assert.ThrowsAsync<NotFoundException>(() => _projects.GetAsync(null, project.Id, CancellationToken.None));
        await Assert.ThrowsAsync<NotFoundException>(() => _projects.GetAsync(other.Id, project.Id, CancellationToken.None));
    }

    [Fact]
    public async Task DemandeDeCorrection_RepasseEnCoursEtNotifieLeFreelance()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Alice", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Bob", "Freelancer");

        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.ClientReview, freelancer);

        var response = await _projects.UpdateAsync(
            client.Id,
            project.Id,
            new UpdateProjectRequest { Status = ProjectStatus.InProgress },
            CancellationToken.None);

        Assert.Equal(ProjectStatus.InProgress, response.Status);
        Assert.Equal(freelancer.Id, response.AssignedTo);

        var notification = await TestData.GetNotificationAsync(Mongo, freelancer.Id, "project-revision-requested");
        Assert.NotNull(notification);
        Assert.Equal(project.Id, notification!.ProjectId);

        // Le projet redevient consultable publiquement par le freelance attribué
        // et la discussion est de nouveau ouverte (« In progress »).
        Assert.Equal(ProjectStatus.InProgress, (await _projects.GetAsync(freelancer.Id, project.Id, CancellationToken.None)).Status);
    }

    [Fact]
    public async Task ApprobationDuClient_CompleteLeProjetEtConserveLAffectation()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Alice", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Bob", "Freelancer");

        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.ClientReview, freelancer);

        var response = await _projects.UpdateAsync(
            client.Id,
            project.Id,
            new UpdateProjectRequest { Status = ProjectStatus.Completed },
            CancellationToken.None);

        Assert.Equal(ProjectStatus.Completed, response.Status);
        Assert.Equal(freelancer.Id, response.AssignedTo);

        var notification = await TestData.GetNotificationAsync(Mongo, freelancer.Id, "project-completed");
        Assert.NotNull(notification);
        Assert.Equal(project.Id, notification!.ProjectId);
    }
}
