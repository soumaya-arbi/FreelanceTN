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
/// Tests des transitions du module Projects :
/// annulation d'une acceptation (In progress → Open), réouverture d'un projet
/// terminé (Completed → Open) et dépublication (Completed → Draft).
/// </summary>
public class ProjectTransitionsTests : IClassFixture<MongoFixture>
{
    private readonly MongoFixture _fixture;
    private readonly ProjectService _projects;
    private readonly ProposalService _proposals;

    public ProjectTransitionsTests(MongoFixture fixture)
    {
        _fixture = fixture;
        _projects = new ProjectService(fixture.Context);
        _proposals = new ProposalService(fixture.Context, _projects);
    }

    private FreelanceTn.Api.Data.MongoContext Mongo => _fixture.Context;

    [Fact]
    public async Task AnnulationAcception_RepublieLeProjetEtAnnuleSeuleLaPropositionAcceptee()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Alice", "Client");
        var accepted = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Bob", "Accepted");
        var pending = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Carla", "Pending");
        var refused = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Denis", "Refused");

        // Compteur volontairement incohérent : il doit être recalculé.
        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.InProgress, accepted, proposals: 99);
        var acceptedProposal = await TestData.InsertProposalAsync(Mongo, project, accepted, ProposalStatus.Accepted);
        var pendingProposal = await TestData.InsertProposalAsync(Mongo, project, pending, ProposalStatus.Pending);
        var refusedProposal = await TestData.InsertProposalAsync(Mongo, project, refused, ProposalStatus.Refused);

        var response = await _projects.UpdateAsync(
            client.Id,
            project.Id,
            new UpdateProjectRequest { Status = ProjectStatus.Open },
            CancellationToken.None);

        // Le projet redevient ouvert et l'affectation active est retirée.
        Assert.Equal(ProjectStatus.Open, response.Status);
        Assert.Null(response.AssignedTo);
        Assert.Null(response.AssignedToName);
        Assert.Null(response.AssignedAt);

        // Seule la proposition acceptée change de statut : une proposition
        // refusée n'est jamais remise automatiquement en attente.
        var proposals = await TestData.GetProposalsAsync(Mongo, project.Id);
        Assert.Equal(3, proposals.Count);
        Assert.Equal(ProposalStatus.Cancelled, proposals.Single(p => p.Id == acceptedProposal.Id).Status);
        Assert.Equal(ProposalStatus.Pending, proposals.Single(p => p.Id == pendingProposal.Id).Status);
        Assert.Equal(ProposalStatus.Refused, proposals.Single(p => p.Id == refusedProposal.Id).Status);

        // Le compteur est recalculé à partir des propositions existantes.
        var stored = await TestData.GetProjectAsync(Mongo, project.Id);
        Assert.Equal(2, stored.Proposals);

        // L'historique conserve l'information du freelance libéré.
        var entry = Assert.Single(stored.AssignmentHistory);
        Assert.Equal(accepted.Id, entry.FreelancerId);
        Assert.Equal($"{accepted.FirstName} {accepted.LastName}", entry.FreelancerName);
        Assert.Equal(AssignmentReleaseReason.AcceptanceCancelled, entry.Reason);
        Assert.NotNull(entry.ReleasedAt);

        // Le freelancePreviously retenu est notifié.
        var notification = await TestData.GetNotificationAsync(Mongo, accepted.Id, "proposal-cancelled");
        Assert.NotNull(notification);
        Assert.Equal(project.Id, notification!.ProjectId);

        // Le projet repasse dans le catalogue des opportunités.
        var catalog = await _projects.ListCatalogAsync(null, null, 200, cancellationToken: CancellationToken.None);
        Assert.Contains(catalog, item => item.Id == project.Id);
    }

    [Fact]
    public async Task AnnulationAcception_NeSupprimeAucuneDonnee()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Alice", "Client");
        var accepted = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Bob", "Accepted");

        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.InProgress, accepted, proposals: 1);
        await TestData.InsertProposalAsync(Mongo, project, accepted, ProposalStatus.Accepted);
        await TestData.InsertTaskAsync(Mongo, project, accepted);

        await _projects.UpdateAsync(
            client.Id,
            project.Id,
            new UpdateProjectRequest { Status = ProjectStatus.Open },
            CancellationToken.None);

        Assert.Equal(1, (await TestData.GetProposalsAsync(Mongo, project.Id)).Count);
        Assert.Equal(1, await TestData.CountTasksAsync(Mongo, project.Id));
    }

    [Fact]
    public async Task ReouvertureProjetTermine_RendLeProjetVisibleEtLibereLFreelance()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Alice", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Bob", "Accepted");

        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.Completed, freelancer, proposals: 1);
        var proposal = await TestData.InsertProposalAsync(Mongo, project, freelancer, ProposalStatus.Accepted);
        await TestData.InsertTaskAsync(Mongo, project, freelancer);

        var response = await _projects.UpdateAsync(
            client.Id,
            project.Id,
            new UpdateProjectRequest { Status = ProjectStatus.Open },
            CancellationToken.None);

        Assert.Equal(ProjectStatus.Open, response.Status);
        Assert.Null(response.AssignedTo);
        Assert.Null(response.AssignedToName);
        Assert.Null(response.AssignedAt);

        // Toutes les données associées au projet sont conservées.
        var proposals = await TestData.GetProposalsAsync(Mongo, project.Id);
        Assert.Single(proposals);
        Assert.Equal(ProposalStatus.Accepted, proposals.Single(p => p.Id == proposal.Id).Status);
        Assert.Equal(1, await TestData.CountTasksAsync(Mongo, project.Id));

        // L'historique conserve l'information du freelance précédent.
        var stored = await TestData.GetProjectAsync(Mongo, project.Id);
        var entry = Assert.Single(stored.AssignmentHistory);
        Assert.Equal(freelancer.Id, entry.FreelancerId);
        Assert.Equal($"{freelancer.FirstName} {freelancer.LastName}", entry.FreelancerName);
        Assert.Equal(AssignmentReleaseReason.ProjectReopened, entry.Reason);

        // L'ancien freelance est notifié de la réouverture.
        var notification = await TestData.GetNotificationAsync(Mongo, freelancer.Id, "project-reopened");
        Assert.NotNull(notification);
        Assert.Equal(project.Id, notification!.ProjectId);

        // Le projet rouvert est de nouveau publié.
        var catalog = await _projects.ListCatalogAsync(null, null, 200, cancellationToken: CancellationToken.None);
        Assert.Contains(catalog, item => item.Id == project.Id);
    }

    [Fact]
    public async Task CompletionVersBrouillon_DepublieSansRouvrirLeProjet()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Alice", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Bob", "Accepted");

        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.Completed, freelancer, proposals: 1);
        await TestData.InsertProposalAsync(Mongo, project, freelancer, ProposalStatus.Accepted);

        var response = await _projects.UpdateAsync(
            client.Id,
            project.Id,
            new UpdateProjectRequest { Status = ProjectStatus.Draft },
            CancellationToken.None);

        // Dépublication : l'affectation et l'historique ne sont pas touchés.
        Assert.Equal(ProjectStatus.Draft, response.Status);
        Assert.Equal(freelancer.Id, response.AssignedTo);
        Assert.Empty(response.AssignmentHistory);

        var stored = await TestData.GetProjectAsync(Mongo, project.Id);
        Assert.Empty(stored.AssignmentHistory);
        Assert.Equal(freelancer.Id, stored.AssignedTo);

        // Aucune notification de réouverture n'est envoyée.
        Assert.Null(await TestData.GetNotificationAsync(Mongo, freelancer.Id, "project-reopened"));

        // Le projet dépublié quitte le catalogue.
        var catalog = await _projects.ListCatalogAsync(null, null, 200, cancellationToken: CancellationToken.None);
        Assert.DoesNotContain(catalog, item => item.Id == project.Id);
    }

    [Fact]
    public async Task SeulLeProprietaireClientPeutAnnulerUneAcceptation()
    {
        var owner = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Alice", "Owner");
        var other = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Bob", "Other");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Carla", "Freelancer");

        var project = await TestData.InsertProjectAsync(Mongo, owner, ProjectStatus.InProgress, freelancer, proposals: 1);
        await TestData.InsertProposalAsync(Mongo, project, freelancer, ProposalStatus.Accepted);

        // Un autre client ne peut pas agir sur le projet.
        await Assert.ThrowsAsync<NotFoundException>(() => _projects.UpdateAsync(
            other.Id,
            project.Id,
            new UpdateProjectRequest { Status = ProjectStatus.Open },
            CancellationToken.None));

        // Un freelance ne peut pas gérer les projets.
        await Assert.ThrowsAsync<ForbiddenException>(() => _projects.UpdateAsync(
            freelancer.Id,
            project.Id,
            new UpdateProjectRequest { Status = ProjectStatus.Open },
            CancellationToken.None));

        // L'état du projet est inchangé et aucune notification n'est partie.
        var stored = await TestData.GetProjectAsync(Mongo, project.Id);
        Assert.Equal(ProjectStatus.InProgress, stored.Status);
        Assert.Equal(freelancer.Id, stored.AssignedTo);
        Assert.Empty(stored.AssignmentHistory);
        Assert.Equal(0, await TestData.CountNotificationsAsync(Mongo, project.Id));
    }

    [Fact]
    public async Task TransitionInterdite_EstRefuseeSansEffetDeBord()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Alice", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Bob", "Freelancer");

        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.Draft, proposals: 1);
        await TestData.InsertProposalAsync(Mongo, project, freelancer, ProposalStatus.Pending);

        await Assert.ThrowsAsync<ConflictException>(() => _projects.UpdateAsync(
            client.Id,
            project.Id,
            new UpdateProjectRequest { Status = ProjectStatus.Completed },
            CancellationToken.None));

        var stored = await TestData.GetProjectAsync(Mongo, project.Id);
        Assert.Equal(ProjectStatus.Draft, stored.Status);
        Assert.Empty(stored.AssignmentHistory);
        Assert.Equal(0, await TestData.CountNotificationsAsync(Mongo, project.Id));
    }

    [Fact]
    public async Task RetraitExpliciteDeLAffectation_ConserveLHistorique()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Alice", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Bob", "Freelancer");

        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.InProgress, freelancer, proposals: 1);

        await _projects.UpdateAsync(
            client.Id,
            project.Id,
            new UpdateProjectRequest { AssignedTo = string.Empty },
            CancellationToken.None);

        var stored = await TestData.GetProjectAsync(Mongo, project.Id);
        Assert.Null(stored.AssignedTo);
        var entry = Assert.Single(stored.AssignmentHistory);
        Assert.Equal(freelancer.Id, entry.FreelancerId);
        Assert.Equal(AssignmentReleaseReason.AssignmentRemoved, entry.Reason);
    }

    [Fact]
    public async Task ChangementDeFreelance_TraceLeFreelancePrecedent()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Alice", "Client");
        var previous = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Bob", "Previous");
        var replacement = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Carla", "Replacement");

        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.Open, previous, proposals: 0);

        await _projects.UpdateAsync(
            client.Id,
            project.Id,
            new UpdateProjectRequest { AssignedTo = replacement.Id },
            CancellationToken.None);

        var stored = await TestData.GetProjectAsync(Mongo, project.Id);
        Assert.Equal(replacement.Id, stored.AssignedTo);
        var entry = Assert.Single(stored.AssignmentHistory);
        Assert.Equal(previous.Id, entry.FreelancerId);
        Assert.Equal(AssignmentReleaseReason.Reassigned, entry.Reason);
    }

    [Fact]
    public async Task AffectationEtRouvertureSimultanees_EstRefusees()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Alice", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Bob", "Freelancer");

        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.InProgress, freelancer, proposals: 1);

        await Assert.ThrowsAsync<ConflictException>(() => _projects.UpdateAsync(
            client.Id,
            project.Id,
            new UpdateProjectRequest { Status = ProjectStatus.Open, AssignedTo = freelancer.Id },
            CancellationToken.None));

        var stored = await TestData.GetProjectAsync(Mongo, project.Id);
        Assert.Equal(ProjectStatus.InProgress, stored.Status);
        Assert.Equal(freelancer.Id, stored.AssignedTo);
    }
}
