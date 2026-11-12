using System.Net;
using System.Text;
using System.Text.Json;
using FreelanceTn.Api.Configuration;
using FreelanceTn.Api.Data;
using FreelanceTn.Api.Dtos.Payments;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using FreelanceTn.Api.Services;
using Microsoft.Extensions.Logging.Abstractions;
using MongoDB.Driver;

// Le modèle « Task » du module Tasks entre en conflit avec
// System.Threading.Tasks.Task : l'alias garde « Task » pour l'asynchrone.
using Task = System.Threading.Tasks.Task;

namespace FreelanceTn.Api.Tests;

/// <summary>
/// Tests de la passerelle Konnect Sandbox. Le client HTTP est remplacé par un
/// handler en mémoire : aucun appel réseau réel, aucune transaction factice
/// dans la base de développement (les écritures restent dans la base éphémère
/// du fixture). Les scénarios couvrent succès, refus, montant falsifié,
/// webhook répété, paiement partiel et anti-double paiement.
/// </summary>
public class KonnectPaymentTests : IClassFixture<MongoFixture>
{
    private readonly MongoFixture _fixture;

    public KonnectPaymentTests(MongoFixture fixture)
    {
        _fixture = fixture;
    }

    private MongoContext Mongo => _fixture.Context;

    private IMongoCollection<PaymentTransaction> Payments =>
        Mongo.GetCollection<PaymentTransaction>(Mongo.Settings.PaymentsCollection);

    private IMongoCollection<Invoice> Invoices =>
        Mongo.GetCollection<Invoice>(Mongo.Settings.InvoicesCollection);

    private static KonnectSettings DefaultSettings() => new()
    {
        Enabled = true,
        ApiKey = "sandbox-test-key",
        ReceiverWalletId = "sandbox-wallet-id",
        FrontendBaseUrl = "http://localhost:8443",
        AppBaseUrl = "http://localhost:5080",
    };

    private PaymentService CreateService(KonnectStub stub, KonnectSettings? settings = null)
    {
        settings ??= DefaultSettings();
        var http = new HttpClient(stub) { BaseAddress = new Uri(KonnectSettings.SandboxBaseUrl) };
        var client = new KonnectPaymentClient(http, settings, NullLogger<KonnectPaymentClient>.Instance);
        return new PaymentService(Mongo, new ReceiptPdfService(), client, settings);
    }

    private async Task<Invoice> InsertInvoiceAsync(
        User freelancer,
        User client,
        decimal total = 1000m,
        decimal amountPaid = 0m)
    {
        var invoice = new Invoice
        {
            Id = MongoFixture.NewId(),
            Number = $"FAC-KONNECT-{MongoFixture.NewId()[..6]}",
            OwnerId = freelancer.Id,
            ClientId = client.Id,
            Client = $"{client.FirstName} {client.LastName}",
            ProjectId = MongoFixture.NewId(),
            Project = "Projet passerelle",
            IssueDate = DateTime.UtcNow.ToString("yyyy-MM-dd"),
            DueDate = DateTime.UtcNow.AddDays(30).ToString("yyyy-MM-dd"),
            Status = amountPaid > 0 ? InvoiceStatus.PartiallyPaid : InvoiceStatus.Unpaid,
            Lines = [],
            Notes = string.Empty,
            Subtotal = total,
            DiscountTotal = 0m,
            TaxTotal = 0m,
            Total = total,
            AmountPaid = amountPaid,
            BalanceDue = total - amountPaid,
            Payments = [],
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        await Invoices.InsertOneAsync(invoice);
        return invoice;
    }

    private static Task<PaymentTransactionResponse> PayGatewayAsync(
        PaymentService service,
        User client,
        Invoice invoice,
        decimal amount,
        string? idempotencyKey = null) =>
        service.CreateAsync(client.Id, new CreatePaymentRequest
        {
            InvoiceId = invoice.Id,
            Amount = amount,
            Method = PaymentMethod.Card,
            Provider = PaymentProvider.Konnect,
            Note = "Test passerelle Konnect",
            IdempotencyKey = idempotencyKey,
        }, CancellationToken.None);

    private async Task<Invoice> ReloadInvoiceAsync(Invoice invoice) =>
        await Invoices.Find(i => i.Id == invoice.Id).FirstAsync();

    private async Task<(User Freelancer, User Client, Invoice Invoice)> SeedAsync(decimal total = 1000m)
    {
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Konnect", "Paye");
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Konnect", "Client");
        var invoice = await InsertInvoiceAsync(freelancer, client, total);
        return (freelancer, client, invoice);
    }

    [Fact]
    public async Task InitPayment_PersistsHostedUrl_AndSendsVerifiedAmountInMillimes()
    {
        var (_, client, invoice) = await SeedAsync();
        var stub = new KonnectStub();
        var service = CreateService(stub);

        var transaction = await PayGatewayAsync(service, client, invoice, 300m);

        Assert.Equal(PaymentTransactionStatus.Pending, transaction.Status);
        Assert.Equal(PaymentProvider.Konnect, transaction.Provider);
        Assert.True(transaction.GatewayRedirect);
        Assert.Equal(stub.PaymentRef, transaction.ProviderPaymentRef);
        Assert.Equal(stub.PayUrl, transaction.ProviderPayUrl);
        Assert.Equal(1, stub.InitCalls);

        using var payload = JsonDocument.Parse(stub.InitBodies[0]);
        var root = payload.RootElement;
        Assert.Equal(300_000, root.GetProperty("amount").GetInt64());
        Assert.Equal("TND", root.GetProperty("token").GetString());
        Assert.Equal("sandbox-wallet-id", root.GetProperty("receiverWalletId").GetString());
        Assert.Equal("bank_card", root.GetProperty("acceptedPaymentMethods")[0].GetString());
        Assert.Equal(transaction.Reference, root.GetProperty("orderId").GetString());
        Assert.Contains("payment=" + transaction.Id, root.GetProperty("successUrl").GetString());

        var stored = await ReloadInvoiceAsync(invoice);
        Assert.Equal(0m, stored.AmountPaid);
        Assert.Equal(1000m, stored.BalanceDue);
    }

    [Fact]
    public async Task VerifiedSuccess_AppliesPartialPaymentOnce_AndDuplicateWebhooksAreIgnored()
    {
        var (freelancer, client, invoice) = await SeedAsync();
        var stub = new KonnectStub
        {
            DetailsJson = KonnectStub.Details("completed", 300_000, "success", 300_000),
        };
        var service = CreateService(stub);

        var transaction = await PayGatewayAsync(service, client, invoice, 300m);
        var verified = await service.VerifyAsync(client.Id, transaction.Id, CancellationToken.None);

        Assert.Equal(PaymentTransactionStatus.Succeeded, verified.Status);
        Assert.True(verified.ReceiptAvailable);
        Assert.StartsWith("REC-", verified.ReceiptNumber);
        Assert.Equal(700m, verified.BalanceAfter!.Value);

        var storedInvoice = await ReloadInvoiceAsync(invoice);
        Assert.Equal(300m, storedInvoice.AmountPaid);
        Assert.Equal(700m, storedInvoice.BalanceDue);
        Assert.Equal(InvoiceStatus.PartiallyPaid, storedInvoice.Status);

        // Notification répétée : deux webhooks et une seconde vérification ne
        // doivent ni recréditer la facture, ni générer un second reçu.
        Assert.True(await service.ReconcileByProviderRefAsync(stub.PaymentRef, CancellationToken.None));
        Assert.True(await service.ReconcileByProviderRefAsync(stub.PaymentRef, CancellationToken.None));
        var secondVerify = await service.VerifyAsync(client.Id, transaction.Id, CancellationToken.None);
        Assert.Equal(PaymentTransactionStatus.Succeeded, secondVerify.Status);

        var storedInvoiceAgain = await ReloadInvoiceAsync(invoice);
        Assert.Equal(300m, storedInvoiceAgain.AmountPaid);
        Assert.Equal(700m, storedInvoiceAgain.BalanceDue);
        Assert.Equal(verified.ReceiptNumber, secondVerify.ReceiptNumber);

        var storedTransaction = await Payments.Find(t => t.Id == transaction.Id).FirstAsync();
        Assert.Equal(2, storedTransaction.ProviderWebhookCount);

        var notifications = Mongo.GetCollection<Notification>(Mongo.Settings.NotificationsCollection);
        Assert.Equal(1L, await notifications.CountDocumentsAsync(
            n => n.RecipientId == client.Id && n.Type == TypeInvoiceBilling));
        Assert.Equal(1L, await notifications.CountDocumentsAsync(
            n => n.RecipientId == freelancer.Id && n.Type == TypeInvoiceBilling));

        var (_, pdf) = await service.GenerateReceiptAsync(client.Id, transaction.Id, CancellationToken.None);
        Assert.True(pdf.Length > 1000);
        Assert.Equal("%PDF", Encoding.ASCII.GetString(pdf, 0, 4));
    }

    [Fact]
    public async Task DeclinedPayment_LeavesBalanceUntouched_AndCannotBeRetriedInternally()
    {
        var (_, client, invoice) = await SeedAsync();
        var stub = new KonnectStub
        {
            // Paiement « completed » sans transaction réussie : refus officiel.
            DetailsJson = KonnectStub.Details("completed", 100_000, "failed", 100_000),
        };
        var service = CreateService(stub);

        var transaction = await PayGatewayAsync(service, client, invoice, 100m);
        var verified = await service.VerifyAsync(client.Id, transaction.Id, CancellationToken.None);

        Assert.Equal(PaymentTransactionStatus.Failed, verified.Status);
        Assert.Equal("gateway_no_success_transaction", verified.ErrorCode);

        var stored = await ReloadInvoiceAsync(invoice);
        Assert.Equal(0m, stored.AmountPaid);
        Assert.Equal(1000m, stored.BalanceDue);
        Assert.Equal(InvoiceStatus.Unpaid, stored.Status);

        await Assert.ThrowsAsync<ConflictException>(() =>
            service.RetryAsync(client.Id, transaction.Id, null, CancellationToken.None));
    }

    [Fact]
    public async Task AmountMismatchFromGateway_IsRejectedWithoutApplyingMoney()
    {
        var (_, client, invoice) = await SeedAsync();
        var stub = new KonnectStub
        {
            // Le client ne peut pas modifier le montant, mais on vérifie aussi
            // qu'une réponse fournisseur incohérente n'est jamais appliquée.
            DetailsJson = KonnectStub.Details("completed", 999_000, "success", 999_000),
        };
        var service = CreateService(stub);

        var transaction = await PayGatewayAsync(service, client, invoice, 100m);
        var verified = await service.VerifyAsync(client.Id, transaction.Id, CancellationToken.None);

        Assert.Equal(PaymentTransactionStatus.Failed, verified.Status);
        Assert.Equal("gateway_amount_mismatch", verified.ErrorCode);

        var stored = await ReloadInvoiceAsync(invoice);
        Assert.Equal(0m, stored.AmountPaid);
        Assert.Equal(1000m, stored.BalanceDue);
    }

    [Fact]
    public async Task PendingGatewayState_KeepsTransactionPending_ThenWebhookCompletesIt()
    {
        var (_, client, invoice) = await SeedAsync();
        var stub = new KonnectStub
        {
            DetailsJson = KonnectStub.Details("pending", 250_000, "pending", 250_000),
        };
        var service = CreateService(stub);

        var transaction = await PayGatewayAsync(service, client, invoice, 250m);
        var pending = await service.VerifyAsync(client.Id, transaction.Id, CancellationToken.None);

        Assert.Equal(PaymentTransactionStatus.Pending, pending.Status);
        Assert.Equal("pending", pending.ProviderStatus);
        Assert.True((await ReloadInvoiceAsync(invoice)).AmountPaid == 0m);

        // Le webhook arrive plus tard : il relit l'état officiel et applique.
        stub.DetailsJson = KonnectStub.Details("completed", 250_000, "success", 250_000);
        Assert.True(await service.ReconcileByProviderRefAsync(stub.PaymentRef, CancellationToken.None));

        var stored = await ReloadInvoiceAsync(invoice);
        Assert.Equal(250m, stored.AmountPaid);
        Assert.Equal(750m, stored.BalanceDue);
    }

    [Fact]
    public async Task DoubleSubmission_ReusesTheSamePendingGatewayPayment()
    {
        var (_, client, invoice) = await SeedAsync();
        var stub = new KonnectStub();
        var service = CreateService(stub);

        var first = await PayGatewayAsync(service, client, invoice, 200m);
        var second = await PayGatewayAsync(service, client, invoice, 200m);

        Assert.Equal(first.Id, second.Id);
        Assert.Equal(first.ProviderPaymentRef, second.ProviderPaymentRef);
        Assert.Equal(1, stub.InitCalls);

        // Même avec une nouvelle clé d'idempotence, la tentative carte encore
        // valide est reprise : aucun second paiement n'est ouvert chez Konnect.
        var withKey = await PayGatewayAsync(service, client, invoice, 200m, "gateway-idem-key");
        Assert.Equal(first.Id, withKey.Id);
        Assert.Equal(1, stub.InitCalls);

        var transactions = await Payments.Find(t => t.InvoiceId == invoice.Id).ToListAsync();
        Assert.Single(transactions);

        // Après annulation explicite, une nouvelle tentative peut être créée.
        await service.CancelAsync(client.Id, first.Id, "Nouvelle tentative", CancellationToken.None);
        var fresh = await PayGatewayAsync(service, client, invoice, 200m);
        Assert.NotEqual(first.Id, fresh.Id);
        Assert.Equal(2, stub.InitCalls);
    }

    [Fact]
    public async Task CancellingPendingGatewayPayment_DoesNotModifyBalance()
    {
        var (_, client, invoice) = await SeedAsync();
        var stub = new KonnectStub();
        var service = CreateService(stub);

        var transaction = await PayGatewayAsync(service, client, invoice, 250m);
        Assert.Equal(PaymentTransactionStatus.Pending, transaction.Status);

        var cancelled = await service.CancelAsync(
            client.Id, transaction.Id, "Annulation demandée par le client.", CancellationToken.None);

        Assert.Equal(PaymentTransactionStatus.Cancelled, cancelled.Status);
        Assert.Equal("cancelled_by_client", cancelled.ErrorCode);
        Assert.Equal(0m, (await ReloadInvoiceAsync(invoice)).AmountPaid);
        Assert.Equal(1000m, (await ReloadInvoiceAsync(invoice)).BalanceDue);
    }

    [Fact]
    public async Task FreelancerHasReadOnlyAccess_AndCannotTriggerVerification()
    {
        var (freelancer, client, invoice) = await SeedAsync();
        var stub = new KonnectStub();
        var service = CreateService(stub);

        var transaction = await PayGatewayAsync(service, client, invoice, 100m);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            service.VerifyAsync(freelancer.Id, transaction.Id, CancellationToken.None));
    }

    [Fact]
    public async Task GatewayInitiationFailure_IsReportedAndRecordedWithoutTouchingBalance()
    {
        var (_, client, invoice) = await SeedAsync();
        var stub = new KonnectStub { InitStatusCode = HttpStatusCode.InternalServerError };
        var service = CreateService(stub);

        await Assert.ThrowsAsync<PaymentGatewayException>(() =>
            PayGatewayAsync(service, client, invoice, 100m));

        var transaction = await Payments.Find(t => t.InvoiceId == invoice.Id).FirstAsync();
        Assert.Equal(PaymentTransactionStatus.Failed, transaction.Status);
        Assert.Equal("gateway_unavailable", transaction.ErrorCode);

        var stored = await ReloadInvoiceAsync(invoice);
        Assert.Equal(0m, stored.AmountPaid);
        Assert.Equal(1000m, stored.BalanceDue);
    }

    [Fact]
    public async Task UnconfiguredGateway_FailsExplicitly_WithoutFakeSuccess()
    {
        var (_, client, invoice) = await SeedAsync();
        var stub = new KonnectStub();
        var settings = DefaultSettings();
        settings.Enabled = false;
        var service = CreateService(stub, settings);

        await Assert.ThrowsAsync<PaymentGatewayException>(() =>
            PayGatewayAsync(service, client, invoice, 100m));

        var transaction = await Payments.Find(t => t.InvoiceId == invoice.Id).FirstAsync();
        Assert.Equal(PaymentTransactionStatus.Failed, transaction.Status);
        Assert.Equal("gateway_not_configured", transaction.ErrorCode);
        Assert.Equal(0, stub.InitCalls);
        Assert.Equal(0m, (await ReloadInvoiceAsync(invoice)).AmountPaid);
    }

    [Fact]
    public void ProductionKonnectUrl_IsImpossibleByConfiguration()
    {
        var settings = new KonnectSettings
        {
            Enabled = true,
            BaseUrl = "https://api.konnect.network/api/v2/",
            ApiKey = "whatever",
            ReceiverWalletId = "whatever",
        };

        Assert.False(settings.IsSandboxUrl);
        Assert.Throws<InvalidOperationException>(settings.EnsureSandboxOnly);

        var http = new HttpClient();
        Assert.Throws<InvalidOperationException>(() =>
            new KonnectPaymentClient(http, settings, NullLogger<KonnectPaymentClient>.Instance));
    }

    private const string TypeInvoiceBilling = "invoice_billing";

    private sealed class KonnectStub : HttpMessageHandler
    {
        public string PaymentRef { get; } = "stub-" + Guid.NewGuid().ToString("N")[..16];
        public string PayUrl => $"https://sandbox.konnect.network/pay?payment_ref={PaymentRef}";
        public string DetailsJson { get; set; } = Details("pending", 0);
        public HttpStatusCode InitStatusCode { get; set; } = HttpStatusCode.OK;
        public int InitCalls { get; private set; }
        public int GetCalls { get; private set; }
        public List<string> InitBodies { get; } = [];
        public List<string> GetPaths { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            var path = request.RequestUri?.AbsolutePath ?? string.Empty;

            if (request.Method == HttpMethod.Post
                && path.EndsWith("/payments/init-payment", StringComparison.Ordinal))
            {
                InitCalls++;
                InitBodies.Add(request.Content is null
                    ? string.Empty
                    : await request.Content.ReadAsStringAsync(cancellationToken));

                if (InitStatusCode != HttpStatusCode.OK)
                {
                    return new HttpResponseMessage(InitStatusCode)
                    {
                        Content = new StringContent("{\"error\":\"stub failure\"}", Encoding.UTF8, "application/json"),
                    };
                }

                return Json(JsonSerializer.Serialize(new { payUrl = PayUrl, paymentRef = PaymentRef }));
            }

            if (request.Method == HttpMethod.Get && path.Contains("/payments/", StringComparison.Ordinal))
            {
                GetCalls++;
                GetPaths.Add(path);
                return Json(DetailsJson);
            }

            return new HttpResponseMessage(HttpStatusCode.NotFound);
        }

        public static string Details(
            string paymentStatus,
            long amountMillimes,
            string transactionStatus = "pending",
            long? transactionAmount = null,
            string token = "TND")
        {
            var payload = new
            {
                payment = new
                {
                    id = "payment-id",
                    status = paymentStatus,
                    amount = amountMillimes,
                    amountDue = amountMillimes,
                    reachedAmount = amountMillimes,
                    token,
                    type = "immediate",
                    transactions = new[]
                    {
                        new
                        {
                            id = "transaction-id",
                            status = transactionStatus,
                            amount = transactionAmount ?? amountMillimes,
                            token,
                            type = "immediate",
                        },
                    },
                },
            };
            return JsonSerializer.Serialize(payload, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        }

        private static HttpResponseMessage Json(string json) => new(HttpStatusCode.OK)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
    }
}
