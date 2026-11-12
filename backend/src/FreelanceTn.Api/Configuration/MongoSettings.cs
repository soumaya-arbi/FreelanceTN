namespace FreelanceTn.Api.Configuration;

public class MongoSettings
{
    public const string SectionName = "Mongo";

    public string ConnectionString { get; set; } = string.Empty;
    public string DatabaseName { get; set; } = string.Empty;
    public string UsersCollection { get; set; } = "users";
    public string FreelancerProfilesCollection { get; set; } = "freelancerProfiles";
    public string ServicesCollection { get; set; } = "services";
    public string ProjectsCollection { get; set; } = "projects";
    public string ProposalsCollection { get; set; } = "proposals";
public string InvitationsCollection { get; set; } = "invitations";
    public string TasksCollection { get; set; } = "tasks";
    public string TaskCommentsCollection { get; set; } = "task_comments";
    public string NotificationsCollection { get; set; } = "notifications";
    public string QuotesCollection { get; set; } = "quotes";
    public string InvoicesCollection { get; set; } = "invoices";
    public string PaymentsCollection { get; set; } = "paymentTransactions";
    public string PaymentAuditsCollection { get; set; } = "paymentAudits";
    public string FeedbackCollection { get; set; } = "feedback";
    public string CommentsCollection { get; set; } = "comments";
    public string PortfolioCollection { get; set; } = "portfolio";
    public string CountersCollection { get; set; } = "counters";

    // --- Module Account Settings -------------------------------------------
    public string TeamMembersCollection { get; set; } = "teamMembers";
    public string BillingProfilesCollection { get; set; } = "billingProfiles";
    public string UserPreferencesCollection { get; set; } = "userPreferences";
    public string NotificationPreferencesCollection { get; set; } = "notificationPreferences";
    public string AuthSessionsCollection { get; set; } = "authSessions";
    public string AccountChangesCollection { get; set; } = "accountChanges";
}
