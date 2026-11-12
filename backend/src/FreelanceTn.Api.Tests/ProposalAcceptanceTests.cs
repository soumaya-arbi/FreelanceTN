using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using FreelanceTn.Api.Services;

// Le modèle « Task » du module Tasks entre en conflit avec
// System.Threading.Tasks.Task : l'alias ci-dessous garde « Task » pour
// l'asynchrone.
using Task = System.Threading.Tasks.Task;

namespace FreelanceTn.Api.Tests;

/// <summary>
/// Tests de l'acceptation d'une candidature : unicité de l'affectation et
/// cohérence du projet.
/// </summary>
public class ProposalAcceptanceTests : IClassFixture<MongoFixture>
{
    private readonly MongoFixture _fixture;
    private readonly ProjectService _projects;
    private readonly ProposalService _proposals;

    public ProposalAcceptanceTests(MongoFixture fixture)
    {
        _fixture = fixture;
        _projects = new ProjectService(fixture.Context);
        _proposals = new ProposalService(fixture.Context, _projects);
    }

    private FreelanceTn.Api.Data.MongoContext Mongo => _fixture.Context;

    [Fact]
    public async Task Acceptation_AffecteLeFreelanceEtRefuseLesAutresCandidatures()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Alice", "Client");
        var chosen = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Bob", "Chosen");
        var other = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Carla", "Other");

        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.Open, proposals: 2);
        var chosenProposal = await TestData.InsertProposalAsync(Mongo, project, chosen, ProposalStatus.Pending);
        var otherProposal = await TestData.InsertProposalAsync(Mongo, project, other, ProposalStatus.Pending);

        var response = await _proposals.ReviewAsync(
            client.Id,
            chosenProposal.Id,
            ProposalStatus.Accepted,
            CancellationToken.None);

        Assert.Equal(ProposalStatus.Accepted, response.Status);

        var stored = await TestData.GetProjectAsync(Mongo, project.Id);
        Assert.Equal(ProjectStatus.InProgress, stored.Status);
        Assert.Equal(chosen.Id, stored.AssignedTo);
        Assert.Equal($"{chosen.FirstName} {chosen.LastName}", stored.AssignedToName);
        Assert.NotNull(stored.AssignedAt);

        // Un seul freelance est retenu : l'autre candidature est refusée.
        var proposals = await TestData.GetProposalsAsync(Mongo, project.Id);
        Assert.Equal(ProposalStatus.Accepted, proposals.Single(p => p.Id == chosenProposal.Id).Status);
        Assert.Equal(ProposalStatus.Refused, proposals.Single(p => p.Id == otherProposal.Id).Status);

        Assert.NotNull(await TestData.GetNotificationAsync(Mongo, chosen.Id, "proposal-accepted"));
    }

    [Fact]
    public async Task DeuxAcceptationsSurLeMemeProjet_NeAttribuentLeProjetQuAUnSeulFreelance()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Alice", "Client");
        var first = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Bob", "First");
        var second = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Carla", "Second");

        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.Open, proposals: 1);
        var firstProposal = await TestData.InsertProposalAsync(Mongo, project, first, ProposalStatus.Pending);

        await _proposals.ReviewAsync(client.Id, firstProposal.Id, ProposalStatus.Accepted, CancellationToken.None);

        // Une seconde candidature déposée après coup ne peut pas être acceptée :
        // le projet n'est plus ouvert.
        var lateProposal = await TestData.InsertProposalAsync(Mongo, project, second, ProposalStatus.Pending);

        await Assert.ThrowsAsync<ConflictException>(() => _proposals.ReviewAsync(
            client.Id,
            lateProposal.Id,
            ProposalStatus.Accepted,
            CancellationToken.None));

        var stored = await TestData.GetProjectAsync(Mongo, project.Id);
        Assert.Equal(ProjectStatus.InProgress, stored.Status);
        Assert.Equal(first.Id, stored.AssignedTo);
    }

    [Fact]
    public async Task ProjetDejaAttribue_UneNouvelleAcceptationEstRefusee()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Alice", "Client");
        var assignee = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Bob", "Assignee");
        var candidate = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Carla", "Candidate");

        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.Open, assignee, proposals: 1);
        var candidateProposal = await TestData.InsertProposalAsync(Mongo, project, candidate, ProposalStatus.Pending);

        await Assert.ThrowsAsync<ConflictException>(() => _proposals.ReviewAsync(
            client.Id,
            candidateProposal.Id,
            ProposalStatus.Accepted,
            CancellationToken.None));

        var stored = await TestData.GetProjectAsync(Mongo, project.Id);
        Assert.Equal(assignee.Id, stored.AssignedTo);
        Assert.Equal(ProjectStatus.Open, stored.Status);

        var proposals = await TestData.GetProposalsAsync(Mongo, project.Id);
        Assert.Equal(ProposalStatus.Pending, proposals.Single(p => p.Id == candidateProposal.Id).Status);
    }

    [Fact]
    public async Task AcceptationRefusee_ParUnAutreClientNeModifieRien()
    {
        var owner = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Alice", "Owner");
        var other = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Bob", "Other");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Carla", "Freelancer");

        var project = await TestData.InsertProjectAsync(Mongo, owner, ProjectStatus.Open, proposals: 1);
        var proposal = await TestData.InsertProposalAsync(Mongo, project, freelancer, ProposalStatus.Pending);

        await Assert.ThrowsAsync<NotFoundException>(() => _proposals.ReviewAsync(
            other.Id,
            proposal.Id,
            ProposalStatus.Accepted,
            CancellationToken.None));

        var stored = await TestData.GetProjectAsync(Mongo, project.Id);
        Assert.Equal(ProjectStatus.Open, stored.Status);
        Assert.Null(stored.AssignedTo);
    }
}
