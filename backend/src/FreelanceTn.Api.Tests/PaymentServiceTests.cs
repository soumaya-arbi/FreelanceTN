using FreelanceTn.Api.Data;
using FreelanceTn.Api.Dtos.Payments;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using FreelanceTn.Api.Services;
using MongoDB.Bson;
using MongoDB.Driver;

// Le modèle « Task » du module Tasks entre en conflit avec
// System.Threading.Tasks.Task : l'alias garde « Task » pour l'asynchrone.
using Task = System.Threading.Tasks.Task;

namespace FreelanceTn.Api.Tests;

/// <summary>
/// Tests du moteur de transactions interne : soldes atomiques, paiements
/// successifs, échecs sans impact financier, annulation, idempotence,
/// permissions et reçus PDF. Toutes les écritures restent dans la base
/// éphémère du fixture.
/// </summary>
public class PaymentServiceTests : IClassFixture<MongoFixture>
{
    private readonly MongoFixture _fixture;
    private readonly PaymentService _payments;

    public PaymentServiceTests(MongoFixture fixture)
    {
        _fixture = fixture;
        _payments = new PaymentService(fixture.Context, new ReceiptPdfService());
    }

    private MongoContext Mongo => _fixture.Context;

    private async Task<Invoice> InsertInvoiceAsync(
        User freelancer,
        User client,
        decimal total = 1000m,
        decimal amountPaid = 0m,
        string status = InvoiceStatus.Unpaid,
        List<InvoicePayment>? legacyPayments = null)
    {
        var invoice = new Invoice
        {
            Id = MongoFixture.NewId(),
            Number = $"FAC-TEST-{MongoFixture.NewId()[..6]}",
            OwnerId = freelancer.Id,
            ClientId = client.Id,
            Client = $"{client.FirstName} {client.LastName}",
            ProjectId = MongoFixture.NewId(),
            Project = "Projet paiement",
            IssueDate = DateTime.UtcNow.ToString("yyyy-MM-dd"),
            DueDate = DateTime.UtcNow.AddDays(30).ToString("yyyy-MM-dd"),
            Status = status,
            Lines = [],
            Notes = string.Empty,
            Subtotal = total,
            DiscountTotal = 0m,
            TaxTotal = 0m,
            Total = total,
            AmountPaid = amountPaid,
            BalanceDue = total - amountPaid,
            Payments = legacyPayments ?? [],
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        await Mongo.GetCollection<Invoice>(Mongo.Settings.InvoicesCollection).InsertOneAsync(invoice);
        return invoice;
    }

    private async Task<Invoice> ReloadInvoiceAsync(Invoice invoice) =>
        await Mongo.GetCollection<Invoice>(Mongo.Settings.InvoicesCollection)
            .Find(i => i.Id == invoice.Id)
            .FirstAsync();

    private Task<PaymentTransactionResponse> PayAsync(
        User client,
        Invoice invoice,
        decimal amount,
        string? method = PaymentMethod.Card,
        string? outcome = null,
        string? idempotencyKey = null,
        bool defer = false) =>
        _payments.CreateAsync(client.Id, new CreatePaymentRequest
        {
            InvoiceId = invoice.Id,
            Amount = amount,
            Method = method ?? PaymentMethod.Card,
            Note = "Test moteur de paiement",
            SimulateOutcome = outcome,
            IdempotencyKey = idempotencyKey,
            DeferProcessing = defer,
        }, CancellationToken.None);

    [Fact]
    public async Task FullPayment_UpdatesInvoiceAndGeneratesReceipt()
    {
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Freelance", "Paye");
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Client", "Paye");
        var invoice = await InsertInvoiceAsync(freelancer, client);

        var transaction = await PayAsync(client, invoice, 1000m);

        Assert.Equal(PaymentTransactionStatus.Succeeded, transaction.Status);
        Assert.StartsWith("PAY-", transaction.Reference);
        Assert.StartsWith("REC-", transaction.ReceiptNumber);
        Assert.True(transaction.ReceiptAvailable);
        Assert.NotNull(transaction.CompletedAt);
        Assert.Equal(0m, transaction.BalanceAfter!.Value);

        var stored = await ReloadInvoiceAsync(invoice);
        Assert.Equal(1000m, stored.AmountPaid);
        Assert.Equal(0m, stored.BalanceDue);
        Assert.Equal(InvoiceStatus.Paid, stored.Status);

        var (_, pdf) = await _payments.GenerateReceiptAsync(client.Id, transaction.Id, CancellationToken.None);
        Assert.True(pdf.Length > 1000);
        Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(pdf, 0, 4));

        // Le freelancer dispose du même reçu, sans pouvoir payer.
        var (_, freelancerPdf) = await _payments.GenerateReceiptAsync(freelancer.Id, transaction.Id, CancellationToken.None);
        Assert.Equal(pdf.Length, freelancerPdf.Length);

        var notifications = Mongo.GetCollection<Notification>(Mongo.Settings.NotificationsCollection);
        Assert.Equal(1L, await notifications.CountDocumentsAsync(n => n.RecipientId == client.Id && n.Type == "invoice_billing"));
        Assert.Equal(1L, await notifications.CountDocumentsAsync(n => n.RecipientId == freelancer.Id && n.Type == "invoice_billing"));
    }

    [Fact]
    public async Task SuccessivePartialPayments_AccumulateWithoutLosingBalance()
    {
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Freelance", "Partiel");
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Client", "Partiel");
        var invoice = await InsertInvoiceAsync(freelancer, client);

        var first = await PayAsync(client, invoice, 300m);
        var second = await PayAsync(client, invoice, 200.5m);

        Assert.Equal(PaymentTransactionStatus.Succeeded, first.Status);
        Assert.Equal(PaymentTransactionStatus.Succeeded, second.Status);
        Assert.Equal(700m, second.BalanceBefore);
        Assert.Equal(499.5m, second.BalanceAfter!.Value);

        var stored = await ReloadInvoiceAsync(invoice);
        Assert.Equal(500.5m, stored.AmountPaid);
        Assert.Equal(499.5m, stored.BalanceDue);
        Assert.Equal(InvoiceStatus.PartiallyPaid, stored.Status);

        var transactions = await _payments.ListAsync(client.Id, invoice.Id, CancellationToken.None);
        Assert.Equal(2, transactions.Count);
    }

    [Fact]
    public async Task Failure_DoesNotModifyBalance_AndRetryCanSucceed()
    {
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Freelance", "Echec");
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Client", "Echec");
        var invoice = await InsertInvoiceAsync(freelancer, client);

        var failed = await PayAsync(client, invoice, 400m, outcome: "failed");

        Assert.Equal(PaymentTransactionStatus.Failed, failed.Status);
        Assert.Equal("payment_declined", failed.ErrorCode);
        Assert.Single(failed.Attempts);

        var afterFailure = await ReloadInvoiceAsync(invoice);
        Assert.Equal(0m, afterFailure.AmountPaid);
        Assert.Equal(1000m, afterFailure.BalanceDue);
        Assert.Equal(InvoiceStatus.Unpaid, afterFailure.Status);

        var retried = await _payments.RetryAsync(client.Id, failed.Id, null, CancellationToken.None);

        Assert.Equal(PaymentTransactionStatus.Succeeded, retried.Status);
        Assert.Equal(2, retried.Attempts.Count);
        Assert.Contains(retried.Attempts, attempt => attempt.Status == PaymentAttemptStatus.Failed);
        Assert.Contains(retried.Attempts, attempt => attempt.Status == PaymentAttemptStatus.Succeeded);

        var afterRetry = await ReloadInvoiceAsync(invoice);
        Assert.Equal(400m, afterRetry.AmountPaid);
        Assert.Equal(600m, afterRetry.BalanceDue);
    }

    [Fact]
    public async Task Cancellation_OfPendingTransaction_DoesNotModifyBalance()
    {
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Freelance", "Annule");
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Client", "Annule");
        var invoice = await InsertInvoiceAsync(freelancer, client);

        var pending = await PayAsync(client, invoice, 250m, defer: true);
        Assert.Equal(PaymentTransactionStatus.Pending, pending.Status);

        var cancelled = await _payments.CancelAsync(client.Id, pending.Id, "Annulation test", CancellationToken.None);
        Assert.Equal(PaymentTransactionStatus.Cancelled, cancelled.Status);
        Assert.Equal("cancelled_by_client", cancelled.ErrorCode);

        var stored = await ReloadInvoiceAsync(invoice);
        Assert.Equal(0m, stored.AmountPaid);
        Assert.Equal(1000m, stored.BalanceDue);

        await Assert.ThrowsAsync<ConflictException>(() =>
            _payments.CancelAsync(client.Id, pending.Id, "deuxième annulation", CancellationToken.None));
    }

    [Fact]
    public async Task OverBalanceAlreadyPaidAndDraftInvoices_AreRejected()
    {
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Freelance", "Refus");
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Client", "Refus");
        var invoice = await InsertInvoiceAsync(freelancer, client);

        await Assert.ThrowsAsync<ConflictException>(() => PayAsync(client, invoice, 1000.01m));
        await Assert.ThrowsAsync<ConflictException>(() => PayAsync(client, invoice, 0m));

        var draft = await InsertInvoiceAsync(freelancer, client, status: InvoiceStatus.Draft);
        await Assert.ThrowsAsync<ConflictException>(() => PayAsync(client, draft, 10m));

        await PayAsync(client, invoice, 1000m);
        await Assert.ThrowsAsync<ConflictException>(() => PayAsync(client, invoice, 1m));
    }

    [Fact]
    public async Task IdempotencyKey_DoubleSubmissionChargesOnlyOnce()
    {
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Freelance", "Idem");
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Client", "Idem");
        var invoice = await InsertInvoiceAsync(freelancer, client);
        const string key = "same-submission-key";

        var first = await PayAsync(client, invoice, 200m, idempotencyKey: key);
        var second = await PayAsync(client, invoice, 200m, idempotencyKey: key);

        Assert.Equal(first.Id, second.Id);
        Assert.Equal(first.Reference, second.Reference);

        var stored = await ReloadInvoiceAsync(invoice);
        Assert.Equal(200m, stored.AmountPaid);
        Assert.Equal(800m, stored.BalanceDue);

        var transactions = await _payments.ListAsync(client.Id, invoice.Id, CancellationToken.None);
        Assert.Single(transactions);
    }

    [Fact]
    public async Task IdempotencyKey_IsRejectedForAnotherClientOrInvoice()
    {
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Freelance", "Reuse");
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Client", "Reuse");
        var other = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Autre", "Client");
        var invoice = await InsertInvoiceAsync(freelancer, client);
        var otherInvoice = await InsertInvoiceAsync(freelancer, other);

        await PayAsync(client, invoice, 50m, idempotencyKey: "reused-key");

        // Un autre client n'a même pas accès à la facture.
        await Assert.ThrowsAsync<ForbiddenException>(() =>
            PayAsync(other, invoice, 50m, idempotencyKey: "reused-key"));
        // Sur sa propre facture, la clé d'idempotence déjà utilisée est refusée.
        await Assert.ThrowsAsync<ConflictException>(() =>
            PayAsync(other, otherInvoice, 50m, idempotencyKey: "reused-key"));
    }

    [Fact]
    public async Task Permissions_OnlyInvoiceClientCanPay_AndStrangerCannotReadReceipt()
    {
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Freelance", "Droits");
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Client", "Droits");
        var otherClient = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Intrus", "Client");
        var invoice = await InsertInvoiceAsync(freelancer, client);

        await Assert.ThrowsAsync<ForbiddenException>(() => PayAsync(freelancer, invoice, 100m));
        await Assert.ThrowsAsync<ForbiddenException>(() => PayAsync(otherClient, invoice, 100m));

        var paid = await PayAsync(client, invoice, 100m);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            _payments.GenerateReceiptAsync(otherClient.Id, paid.Id, CancellationToken.None));
        await Assert.ThrowsAsync<ForbiddenException>(() =>
            _payments.GetAsync(otherClient.Id, paid.Id, CancellationToken.None));
        await Assert.ThrowsAsync<ConflictException>(() =>
            _payments.RetryAsync(client.Id, paid.Id, null, CancellationToken.None));
    }

    [Fact]
    public async Task ConcurrentPayments_NeverExceedInvoiceBalance()
    {
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Freelance", "Concurrent");
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Client", "Concurrent");
        var invoice = await InsertInvoiceAsync(freelancer, client);

        var attempts = await Task.WhenAll(
            PayAsync(client, invoice, 600m).ContinueWith(t => (t.IsCompletedSuccessfully, Transaction: t.IsCompletedSuccessfully ? t.Result : null), TaskScheduler.Default),
            PayAsync(client, invoice, 600m).ContinueWith(t => (t.IsCompletedSuccessfully, Transaction: t.IsCompletedSuccessfully ? t.Result : null), TaskScheduler.Default));

        var succeeded = attempts.Count(a => a.Transaction?.Status == PaymentTransactionStatus.Succeeded);
        var failed = attempts.Count(a => a.Transaction?.Status == PaymentTransactionStatus.Failed);
        Assert.Equal(1, succeeded);
        Assert.Equal(1, failed);

        var stored = await ReloadInvoiceAsync(invoice);
        Assert.Equal(600m, stored.AmountPaid);
        Assert.Equal(400m, stored.BalanceDue);
        Assert.True(stored.BalanceDue >= 0);
    }

    [Fact]
    public async Task LegacyEmbeddedPayments_ArePreservedAndMergedByInvoiceService()
    {
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Freelance", "Legacy");
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Client", "Legacy");
        var legacy = new InvoicePayment
        {
            Amount = 100m,
            Date = "2026-01-10",
            Status = InvoicePaymentStatus.Completed,
            Method = "card_simulated",
            Reference = "OLD-PAYMENT-1",
            CreatedAt = DateTime.UtcNow.AddMonths(-6),
        };
        var invoice = await InsertInvoiceAsync(
            freelancer, client, total: 1000m, amountPaid: 100m,
            status: InvoiceStatus.PartiallyPaid, legacyPayments: [legacy]);

        await PayAsync(client, invoice, 200m);

        var invoiceService = new InvoiceService(Mongo, _payments);
        var response = await invoiceService.GetAsync(client.Id, invoice.Id, CancellationToken.None);

        Assert.Equal(300m, response.AmountPaid);
        Assert.Equal(700m, response.BalanceDue);
        Assert.Equal(2, response.Payments.Count);
        Assert.Contains(response.Payments, item => item.Legacy && !item.ReceiptAvailable);
        Assert.Contains(response.Payments, item => !item.Legacy && item.ReceiptAvailable);

        // Les paiements embarqués d'origine ne sont jamais supprimés.
        var stored = await ReloadInvoiceAsync(invoice);
        Assert.Single(stored.Payments);
        Assert.Equal("OLD-PAYMENT-1", stored.Payments[0].Reference);
    }
}
