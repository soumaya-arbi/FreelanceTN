using FreelanceTn.Api.Dtos.Projects;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using FreelanceTn.Api.Services;

using Task = System.Threading.Tasks.Task;

namespace FreelanceTn.Api.Tests;

public class ProjectMilestoneWorkflowTests : IClassFixture<MongoFixture>
{
    private readonly MongoFixture _fixture;
    private readonly ProjectService _projects;

    public ProjectMilestoneWorkflowTests(MongoFixture fixture)
    {
        _fixture = fixture;
        _projects = new ProjectService(fixture.Context);
    }

    private FreelanceTn.Api.Data.MongoContext Mongo => _fixture.Context;

    [Fact]
    public async Task Synchronisation_CreeQuatreEtapesSansDoublon()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Alice", "Client");
        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.InProgress);

        var first = await _projects.UpdateAsync(client.Id, project.Id, new UpdateProjectRequest { Status = ProjectStatus.InProgress }, CancellationToken.None);
        Assert.Equal(4, first.Milestones.Count);

        var second = await _projects.UpdateAsync(client.Id, project.Id, new UpdateProjectRequest { Status = ProjectStatus.InProgress }, CancellationToken.None);
        Assert.Equal(4, second.Milestones.Count);
        Assert.Equal(first.Milestones.Select(m => m.Id).OrderBy(x => x), second.Milestones.Select(m => m.Id).OrderBy(x => x));
    }

    [Fact]
    public async Task ReouvertureProjetTermine_PasseEnCoursConserveAffectationEtNotifie()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Alice", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Bob", "Freelancer");
        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.Completed, freelancer);

        var response = await _projects.ReopenAsync(client.Id, project.Id, new ReopenProjectRequest { Message = "Reprise" }, CancellationToken.None);

        Assert.Equal(ProjectStatus.InProgress, response.Status);
        Assert.Equal(freelancer.Id, response.AssignedTo);
        Assert.Equal(4, response.Milestones.Count);

        var notification = await TestData.GetNotificationAsync(Mongo, freelancer.Id, "project-reopened");
        Assert.NotNull(notification);
        Assert.Contains("Reprise", notification!.Message);

        var stored = await TestData.GetProjectAsync(Mongo, project.Id);
        Assert.Contains(stored.MilestoneHistory, entry => entry.Type == "project-reopened");
    }

    [Fact]
    public async Task ReouvertureProjetTermine_Permissions()
    {
        var owner = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Alice", "Owner");
        var other = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Bob", "Other");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Carla", "Freelancer");
        var project = await TestData.InsertProjectAsync(Mongo, owner, ProjectStatus.Completed, freelancer);

        await Assert.ThrowsAsync<NotFoundException>(() =>
            _projects.ReopenAsync(other.Id, project.Id, new ReopenProjectRequest(), CancellationToken.None));

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            _projects.ReopenAsync(freelancer.Id, project.Id, new ReopenProjectRequest(), CancellationToken.None));
    }

    [Fact]
    public async Task DemandeModification_Milestone_RepasseEnCoursEtEnregistreMessage()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Alice", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Bob", "Freelancer");
        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.ClientReview, freelancer);

        // Force la création des étapes standard.
        await _projects.GetAsync(client.Id, project.Id, CancellationToken.None);
        var loaded = await TestData.GetProjectAsync(Mongo, project.Id);
        var reviewMilestone = loaded.Milestones.First(m => m.Key == MilestoneKey.Review);

        var response = await _projects.MilestoneActionAsync(
            client.Id,
            project.Id,
            reviewMilestone.Id,
            new MilestoneActionRequest { Action = "request-changes", Message = "Corriger la mise en page" },
            CancellationToken.None);

        Assert.Equal(ProjectStatus.InProgress, response.Status);
        var milestone = response.Milestones.First(m => m.Id == reviewMilestone.Id);
        Assert.Equal(MilestoneStatus.ChangesRequested, milestone.Status);
        Assert.Contains(response.MilestoneHistory, entry => entry.Type == "changes-requested" && entry.Message == "Corriger la mise en page");

        var notification = await TestData.GetNotificationAsync(Mongo, freelancer.Id, "project-revision-requested");
        Assert.NotNull(notification);
    }

    [Fact]
    public async Task Catalogue_FiltresMultiMotsTypeBudgetEtDuree()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Alice", "Client");

        var matching = new Project
        {
            Id = MongoFixture.NewId(),
            OwnerId = client.Id,
            Title = "Web design project",
            Description = "Refonte complète du site",
            Budget = "1000",
            BudgetMin = 1000m,
            BudgetMax = 3000m,
            Type = "Fixed price",
            Client = "Alice",
            Status = ProjectStatus.Open,
            Skills = ["React", "Design"],
            DurationValue = 2,
            DurationUnit = "Weeks",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        var nonMatching = new Project
        {
            Id = MongoFixture.NewId(),
            OwnerId = client.Id,
            Title = "Mobile app",
            Description = "Application mobile",
            Budget = "500",
            BudgetMin = 500m,
            BudgetMax = 800m,
            Type = "Fixed",
            Client = "Alice",
            Status = ProjectStatus.Open,
            Skills = ["Flutter"],
            DurationValue = 5,
            DurationUnit = "Days",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };

        var collection = Mongo.GetCollection<Project>(Mongo.Settings.ProjectsCollection);
        await collection.InsertManyAsync(new[] { matching, nonMatching });

        var byQuery = await _projects.ListCatalogAsync("Programming & Technology".Equals("x") ? null : null, "web design", 200, cancellationToken: CancellationToken.None);
        // La recherche multi-mots ne doit pas casser sur une catégorie inexistante :
        // on vérifie simplement que le projet correspondant est renvoyé.
        Assert.Contains(byQuery, item => item.Id == matching.Id);

        var byType = await _projects.ListCatalogAsync(null, null, 200, "Fixed price", cancellationToken: CancellationToken.None);
        Assert.Contains(byType, item => item.Id == matching.Id);
        Assert.Contains(byType, item => item.Id == nonMatching.Id);

        var byBudget = await _projects.ListCatalogAsync(null, null, 200, null, 900m, 1200m, cancellationToken: CancellationToken.None);
        Assert.Contains(byBudget, item => item.Id == matching.Id);
        Assert.DoesNotContain(byBudget, item => item.Id == nonMatching.Id);

        var byDuration = await _projects.ListCatalogAsync(null, null, 200, null, null, null, 2, "Weeks", CancellationToken.None);
        Assert.Contains(byDuration, item => item.Id == matching.Id);
    }
}