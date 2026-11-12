using System.Globalization;
using System.Numerics;
using FreelanceTn.Api.Configuration;
using FreelanceTn.Api.Data;
using FreelanceTn.Api.Dtos.Payments;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using MongoDB.Bson;
using MongoDB.Driver;

// Le modèle « Task » du module Tasks entre en conflit avec
// System.Threading.Tasks.Task : l'alias garde « Task » pour l'asynchrone.
using Task = System.Threading.Tasks.Task;

namespace FreelanceTn.Api.Services;

/// <summary>
/// Moteur de transactions interne FreelanceTN.
///
/// Règles structurantes :
/// - seul le client propriétaire de la facture peut créer/relancer/annuler une transaction ;
/// - le montant est toujours revalidé côté serveur contre le solde réel ;
/// - une transaction échouée ou annulée ne touche jamais <c>amountPaid</c> / <c>balanceDue</c> ;
/// - la mise à jour du solde est atomique (filtre sur <c>balanceDue</c> + <c>$inc</c>) ;
/// - les doublons de soumission sont neutralisés par une clé d'idempotence unique ;
/// - l'historique complet et les tentatives vivent dans la collection dédiée.
/// </summary>
public class PaymentService
{
    private readonly MongoContext _mongo;
    private readonly ReceiptPdfService _receiptPdf;
    private readonly KonnectPaymentClient? _konnect;
    private readonly KonnectSettings? _konnectSettings;
    private readonly EthereumRpcClient? _rpc;
    private readonly BlockchainSettings? _blockchainSettings;

    public PaymentService(
        MongoContext mongo,
        ReceiptPdfService receiptPdf,
        KonnectPaymentClient? konnect = null,
        KonnectSettings? konnectSettings = null,
        EthereumRpcClient? rpc = null,
        BlockchainSettings? blockchainSettings = null)
    {
        _mongo = mongo;
        _receiptPdf = receiptPdf;
        _konnect = konnect;
        _konnectSettings = konnectSettings;
        _rpc = rpc;
        _blockchainSettings = blockchainSettings;
    }

    private IMongoCollection<PaymentTransaction> Payments =>
        _mongo.GetCollection<PaymentTransaction>(_mongo.Settings.PaymentsCollection);

    private IMongoCollection<Invoice> Invoices =>
        _mongo.GetCollection<Invoice>(_mongo.Settings.InvoicesCollection);

    private IMongoCollection<Project> Projects =>
        _mongo.GetCollection<Project>(_mongo.Settings.ProjectsCollection);

    private IMongoCollection<User> Users =>
        _mongo.GetCollection<User>(_mongo.Settings.UsersCollection);

    private IMongoCollection<Notification> Notifications =>
        _mongo.GetCollection<Notification>(_mongo.Settings.NotificationsCollection);

    private IMongoCollection<PaymentAuditEntry> PaymentAudits =>
        _mongo.GetCollection<PaymentAuditEntry>(_mongo.Settings.PaymentAuditsCollection);

    private IMongoCollection<BsonDocument> Counters => _mongo.Counters;

    // ---------------------------------------------------------------------
    // Lecture
    // ---------------------------------------------------------------------

    public async Task<List<PaymentTransactionResponse>> ListAsync(
        string userId,
        string? invoiceId,
        CancellationToken cancellationToken)
    {
        FilterDefinition<PaymentTransaction> filter;
        if (!string.IsNullOrWhiteSpace(invoiceId))
        {
            var invoice = await FindInvoiceAsync(invoiceId, cancellationToken);
            await EnsureInvoiceAccessAsync(userId, invoice, cancellationToken);
            filter = Builders<PaymentTransaction>.Filter.Eq(t => t.InvoiceId, invoice.Id);
        }
        else
        {
            filter = Builders<PaymentTransaction>.Filter.Or(
                Builders<PaymentTransaction>.Filter.Eq(t => t.ClientId, userId),
                Builders<PaymentTransaction>.Filter.Eq(t => t.FreelancerId, userId));
        }

        var items = await Payments
            .Find(filter)
            .SortByDescending(t => t.CreatedAt)
            .ToListAsync(cancellationToken);

        return items.Select(ToResponse).ToList();
    }

    public async Task<List<PaymentTransaction>> ListEntitiesForInvoicesAsync(
        IReadOnlyCollection<string> invoiceIds,
        CancellationToken cancellationToken)
    {
        if (invoiceIds.Count == 0) return [];
        var filter = Builders<PaymentTransaction>.Filter.In(t => t.InvoiceId, invoiceIds);
        return await Payments.Find(filter).SortBy(t => t.CreatedAt).ToListAsync(cancellationToken);
    }

    public async Task<PaymentTransactionResponse> GetAsync(
        string userId,
        string transactionId,
        CancellationToken cancellationToken)
    {
        var transaction = await FindAsync(transactionId, cancellationToken);
        EnsureAccess(userId, transaction);
        return ToResponse(transaction);
    }

    public async Task<(PaymentTransaction Transaction, byte[] Pdf)> GenerateReceiptAsync(
        string userId,
        string transactionId,
        CancellationToken cancellationToken)
    {
        var transaction = await FindAsync(transactionId, cancellationToken);
        EnsureAccess(userId, transaction);
        if (!string.Equals(transaction.Status, PaymentTransactionStatus.Succeeded, StringComparison.Ordinal))
        {
            throw new ConflictException("Un reçu n'est généré que pour un paiement réussi.");
        }
        return (transaction, _receiptPdf.Generate(transaction));
    }

    // ---------------------------------------------------------------------
    // Création / traitement
    // ---------------------------------------------------------------------

    public async Task<PaymentTransactionResponse> CreateAsync(
        string userId,
        CreatePaymentRequest request,
        CancellationToken cancellationToken)
    {
        await EnsureClientRoleAsync(userId, cancellationToken);
        if (string.IsNullOrWhiteSpace(request.InvoiceId)) throw new BadRequestException("Facture obligatoire.");

        // La méthode est normalisée avant le provider : MetaMask impose la
        // blockchain côté serveur (réseau actif), quel que soit le provider demandé.
        var method = PaymentMethod.Normalize(request.Method);
        var provider = ResolveProvider(request.Provider, method);

        var invoice = await FindInvoiceAsync(request.InvoiceId, cancellationToken);
        await EnsureInvoiceAccessAsync(userId, invoice, cancellationToken);
        if (string.IsNullOrWhiteSpace(invoice.ClientId) && !string.Equals(invoice.OwnerId, userId, StringComparison.Ordinal))
        {
            // Facture historique sans clientId : l'acheteur est identifié une
            // fois pour toutes au premier paiement, sans modifier les montants.
            await Invoices.UpdateOneAsync(
                i => i.Id == invoice.Id && (i.ClientId == null || i.ClientId == string.Empty),
                Builders<Invoice>.Update.Set(i => i.ClientId, userId),
                cancellationToken: cancellationToken);
            invoice.ClientId = userId;
        }

        var idempotencyKey = string.IsNullOrWhiteSpace(request.IdempotencyKey) ? null : request.IdempotencyKey.Trim();
        if (idempotencyKey is { Length: > 120 }) throw new BadRequestException("Clé d'idempotence invalide.");

        if (idempotencyKey != null)
        {
            var existing = await Payments
                .Find(t => t.IdempotencyKey == idempotencyKey)
                .FirstOrDefaultAsync(cancellationToken);
            if (existing != null)
            {
                if (!string.Equals(existing.ClientId, userId, StringComparison.Ordinal)
                    || !string.Equals(existing.InvoiceId, invoice.Id, StringComparison.Ordinal))
                {
                    throw new ConflictException("Cette clé d'idempotence est déjà utilisée.");
                }
                return ToResponse(existing);
            }
        }

        if (string.Equals(invoice.Status, InvoiceStatus.Draft, StringComparison.Ordinal))
        {
            throw new ConflictException("Une facture brouillon ne peut pas être payée.");
        }
        if (string.Equals(invoice.Status, InvoiceStatus.Paid, StringComparison.Ordinal) || invoice.BalanceDue <= 0.0005m)
        {
            throw new ConflictException("Cette facture est déjà entièrement réglée.");
        }

        var amount = decimal.Round(request.Amount, 3, MidpointRounding.AwayFromZero);
        if (amount <= 0) throw new ConflictException("Le montant du paiement doit être supérieur à 0.");
        if (amount > invoice.BalanceDue + 0.0005m)
        {
            throw new ConflictException("Le montant du paiement dépasse le solde restant.");
        }

        EthereumBlockInfo? blockchainGenesis = null;
        if (provider == PaymentProvider.Blockchain)
        {
            if (_blockchainSettings is null || !_blockchainSettings.IsConfigured || _rpc is null)
            {
                // Aucun montant n'est engagé : mieux vaut refuser explicitement
                // que créer une intention que personne ne pourrait honorer.
                throw new PaymentGatewayException(
                    "Le paiement MetaMask n'est pas disponible : l'adresse de réception ou le nœud " +
                    "du réseau actif n'est pas configuré. Aucun montant n'a été engagé.");
            }

            // L'empreinte Genesis identifie l'instance de chaîne. Sans elle,
            // aucun transfert ne peut être rattaché de façon fiable à cette
            // instance : l'intention n'est pas créée (échec fermé).
            blockchainGenesis = await _rpc.GetGenesisAsync(cancellationToken);
            if (blockchainGenesis is null
                || !BlockchainSettings.IsValidGenesisHash(blockchainGenesis.Hash))
            {
                throw new PaymentGatewayException(
                    "Le nœud blockchain n'a pas fourni d'empreinte Genesis fiable. " +
                    "Aucun montant n'a été engagé.");
            }
        }

        // Anti-double paiement : une tentative carte encore valide pour la même
        // facture est reprise telle quelle (même URL hébergée), au lieu
        // d'ouvrir un second paiement chez Konnect.
        if (provider == PaymentProvider.Konnect)
        {
            var reusable = await FindReusableGatewayTransactionAsync(userId, invoice.Id, cancellationToken);
            if (reusable != null) return ToResponse(reusable);
        }

        // Même logique pour MetaMask : une intention en attente avec le même
        // montant et la même instance de chaîne est réutilisée (même
        // destinataire, même montant en wei). Une intention créée avant un
        // redémarrage de chaîne n'est jamais réutilisée.
        if (provider == PaymentProvider.Blockchain)
        {
            var reusable = await FindReusableBlockchainTransactionAsync(
                userId, invoice.Id, amount, blockchainGenesis!.Hash, cancellationToken);
            if (reusable != null) return ToResponse(reusable);
        }

        var client = await Users.Find(u => u.Id == userId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");
        var freelancer = await Users.Find(u => u.Id == invoice.OwnerId).FirstOrDefaultAsync(cancellationToken);

        var now = DateTime.UtcNow;
        var transaction = new PaymentTransaction
        {
            Reference = GenerateReference(),
            InvoiceId = invoice.Id,
            InvoiceNumber = invoice.Number,
            ClientId = userId,
            ClientName = DisplayName(client),
            FreelancerId = invoice.OwnerId,
            FreelancerName = DisplayName(freelancer),
            ProjectId = invoice.ProjectId,
            ProjectTitle = invoice.Project,
            Amount = amount,
            Currency = "TND",
            Method = method,
            Status = PaymentTransactionStatus.Pending,
            Note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim(),
            InvoiceTotal = invoice.Total,
            BalanceBefore = invoice.BalanceDue,
            IdempotencyKey = idempotencyKey,
            Provider = provider,
            Attempts =
            [
                new PaymentAttempt
                {
                    AttemptNumber = 1,
                    Status = PaymentAttemptStatus.Pending,
                    StartedAt = now
                }
            ],
            CreatedAt = now,
            UpdatedAt = now
        };

        if (provider == PaymentProvider.Blockchain)
        {
            // Instantané de l'intention : le réseau, le destinataire, le
            // montant et l'instance de chaîne (Genesis) sont figés. La
            // vérification contrôlera exactement ces valeurs, même si la
            // configuration change ensuite.
            transaction.BlockchainChainId = _blockchainSettings!.ActiveChainId;
            transaction.BlockchainReceiver = _blockchainSettings.ActiveReceiverAddress;
            transaction.BlockchainTndPerEth = _blockchainSettings.TndPerEth;
            transaction.BlockchainAmountWei = BlockchainSettings.ComputeWei(amount, _blockchainSettings.TndPerEth);
            // Toujours normalisé (minuscules) : l'identité (Genesis, hash) et
            // l'index unique comparent des chaînes exactes.
            transaction.BlockchainGenesisHash = BlockchainSettings.NormalizeTxHash(blockchainGenesis!.Hash);
            transaction.BlockchainGenesisTimestamp = blockchainGenesis.Timestamp;
            transaction.ProviderStatus = "awaiting_wallet";
        }

        try
        {
            await Payments.InsertOneAsync(transaction, cancellationToken: cancellationToken);
        }
        catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            // Deux soumissions simultanées avec la même clé : la seconde relit la
            // transaction gagnante au lieu de créer un doublon.
            if (idempotencyKey != null)
            {
                var existing = await Payments
                    .Find(t => t.IdempotencyKey == idempotencyKey)
                    .FirstOrDefaultAsync(cancellationToken);
                if (existing != null) return ToResponse(existing);
            }
            throw new ConflictException("Une transaction identique est déjà en cours.");
        }

        if (request.DeferProcessing)
        {
            return ToResponse(transaction);
        }

        // MetaMask : la transaction reste « pending » jusqu'à la preuve
        // on-chain. Aucun crédit n'est appliqué à la création.
        if (provider == PaymentProvider.Blockchain)
        {
            return ToResponse(transaction);
        }

        if (provider == PaymentProvider.Konnect)
        {
            return await StartGatewayAsync(transaction, invoice, client, cancellationToken);
        }

        return await ProcessInternalAsync(transaction.Id, request.SimulateOutcome, cancellationToken);
    }

    public async Task<PaymentTransactionResponse> ProcessAsync(
        string userId,
        string transactionId,
        string? simulateOutcome,
        CancellationToken cancellationToken)
    {
        var transaction = await FindAsync(transactionId, cancellationToken);
        EnsureAccess(userId, transaction);
        if (!string.Equals(transaction.ClientId, userId, StringComparison.Ordinal))
        {
            throw new ForbiddenException("Seul le client peut traiter une transaction.");
        }
        if (PaymentProvider.IsGateway(transaction.Provider))
        {
            throw new ConflictException(
                "Cette transaction relève de la passerelle Konnect : seul l'état officiel vérifié côté serveur peut la valider.");
        }
        if (PaymentProvider.IsBlockchain(transaction.Provider))
        {
            throw new ConflictException(
                "Cette transaction relève de la blockchain : seul l'état vérifié on-chain peut la valider.");
        }
        return await ProcessInternalAsync(transactionId, simulateOutcome, cancellationToken);
    }

    public async Task<PaymentTransactionResponse> RetryAsync(
        string userId,
        string transactionId,
        string? simulateOutcome,
        CancellationToken cancellationToken)
    {
        var transaction = await FindAsync(transactionId, cancellationToken);
        EnsureAccess(userId, transaction);
        if (!string.Equals(transaction.ClientId, userId, StringComparison.Ordinal))
        {
            throw new ForbiddenException("Seul le client peut relancer une transaction.");
        }
        if (transaction.Status is not (PaymentTransactionStatus.Failed or PaymentTransactionStatus.Cancelled))
        {
            throw new ConflictException("Seule une transaction échouée ou annulée peut être relancée.");
        }
        if (PaymentProvider.IsGateway(transaction.Provider))
        {
            throw new ConflictException(
                "Cette transaction relève de la passerelle Konnect : créez une nouvelle tentative depuis le paiement par carte.");
        }
        if (PaymentProvider.IsBlockchain(transaction.Provider))
        {
            throw new ConflictException(
                "Cette transaction relève de la blockchain : créez un nouveau paiement MetaMask.");
        }
        return await ProcessInternalAsync(transactionId, simulateOutcome, cancellationToken);
    }

    public async Task<PaymentTransactionResponse> CancelAsync(
        string userId,
        string transactionId,
        string? reason,
        CancellationToken cancellationToken)
    {
        var transaction = await FindAsync(transactionId, cancellationToken);
        EnsureAccess(userId, transaction);
        if (!string.Equals(transaction.ClientId, userId, StringComparison.Ordinal))
        {
            throw new ForbiddenException("Seul le client peut annuler une transaction.");
        }
        if (PaymentProvider.IsBlockchain(transaction.Provider))
        {
            // Un transfert blockchain peut déjà être parti : annuler localement
            // donnerait la fausse impression qu'aucun montant n'a été engagé.
            throw new ConflictException(
                "Un paiement MetaMask en attente ne peut pas être annulé ici. " +
                "Vérifiez la transaction sur la blockchain avant de recommencer.");
        }
        if (!string.Equals(transaction.Status, PaymentTransactionStatus.Pending, StringComparison.Ordinal))
        {
            throw new ConflictException("Seule une transaction en attente peut être annulée.");
        }

        var now = DateTime.UtcNow;
        var last = transaction.Attempts.LastOrDefault();
        if (last != null)
        {
            last.Status = PaymentAttemptStatus.Cancelled;
            last.CompletedAt = now;
            last.ErrorMessage = string.IsNullOrWhiteSpace(reason) ? "Transaction annulée par le client." : reason.Trim();
        }
        transaction.Status = PaymentTransactionStatus.Cancelled;
        transaction.ErrorCode = "cancelled_by_client";
        transaction.ErrorMessage = string.IsNullOrWhiteSpace(reason) ? "Transaction annulée par le client." : reason.Trim();
        transaction.UpdatedAt = now;
        transaction.CompletedAt = now;

        var result = await Payments.ReplaceOneAsync(
            t => t.Id == transaction.Id && t.Status == PaymentTransactionStatus.Pending,
            transaction,
            cancellationToken: cancellationToken);
        if (result.ModifiedCount == 0)
        {
            throw new ConflictException("Cette transaction a déjà été traitée.");
        }

        await NotifyBothAsync(
            transaction,
            "Paiement annulé",
            $"La transaction {transaction.Reference} de {FormatAmount(transaction.Amount)} pour la facture {transaction.InvoiceNumber} a été annulée. Aucun montant n'a été prélevé.",
            cancellationToken);

        return ToResponse(transaction);
    }

    private async Task<PaymentTransactionResponse> ProcessInternalAsync(
        string transactionId,
        string? simulateOutcome,
        CancellationToken cancellationToken)
    {
        // Relecture fraîche : la date de mise à jour sert de jeton de concurrence.
        var transaction = await FindAsync(transactionId, cancellationToken);
        if (PaymentProvider.IsGateway(transaction.Provider))
        {
            throw new ConflictException(
                "Cette transaction relève de la passerelle Konnect : seul l'état officiel vérifié côté serveur peut la valider.");
        }
        if (PaymentProvider.IsBlockchain(transaction.Provider))
        {
            throw new ConflictException(
                "Cette transaction relève de la blockchain : seul l'état vérifié on-chain peut la valider.");
        }
        if (string.Equals(transaction.Status, PaymentTransactionStatus.Succeeded, StringComparison.Ordinal))
        {
            return ToResponse(transaction);
        }
        if (string.Equals(transaction.Status, PaymentTransactionStatus.Processing, StringComparison.Ordinal))
        {
            return ToResponse(transaction);
        }

        var invoice = await FindInvoiceAsync(transaction.InvoiceId, cancellationToken);
        var now = DateTime.UtcNow;

        // Revendication optimiste : une seule exécution peut passer de
        // pending/failed/cancelled à processing.
        var claimedFromStatus = transaction.Status;
        var claimedFromUpdatedAt = transaction.UpdatedAt;
        var lastAttempt = transaction.Attempts.LastOrDefault();
        if (lastAttempt != null && lastAttempt.Status == PaymentAttemptStatus.Pending)
        {
            lastAttempt.Status = PaymentAttemptStatus.Processing;
            lastAttempt.StartedAt = now;
        }
        else
        {
            var nextNumber = (transaction.Attempts.Count == 0 ? 1 : transaction.Attempts.Max(a => a.AttemptNumber) + 1);
            transaction.Attempts.Add(new PaymentAttempt
            {
                AttemptNumber = nextNumber,
                Status = PaymentAttemptStatus.Processing,
                StartedAt = now
            });
        }
        transaction.Status = PaymentTransactionStatus.Processing;
        transaction.ErrorCode = null;
        transaction.ErrorMessage = null;
        transaction.UpdatedAt = now;

        var claim = await Payments.ReplaceOneAsync(
            t => t.Id == transactionId
                 && t.Status == claimedFromStatus
                 && t.UpdatedAt == claimedFromUpdatedAt,
            transaction,
            cancellationToken: cancellationToken);
        if (claim.ModifiedCount == 0)
        {
            // Une autre exécution a pris la main : on renvoie l'état courant.
            return ToResponse(await FindAsync(transactionId, cancellationToken));
        }

        var normalizedOutcome = (simulateOutcome ?? "success").Trim().ToLowerInvariant();
        if (normalizedOutcome is "failed" or "failure" or "declined" or "error")
        {
            return await FailAsync(transaction, "payment_declined",
                "Le paiement n'a pas pu être traité par le parcours FreelanceTN. Le solde de la facture reste inchangé.",
                cancellationToken);
        }

        if (invoice.BalanceDue <= 0.0005m
            || string.Equals(invoice.Status, InvoiceStatus.Paid, StringComparison.Ordinal))
        {
            return await FailAsync(transaction, "already_paid",
                "Cette facture a déjà été entièrement réglée. Aucun montant n'a été prélevé.",
                cancellationToken);
        }
        if (transaction.Amount > invoice.BalanceDue + 0.0005m)
        {
            return await FailAsync(transaction, "insufficient_balance",
                "Le solde restant a changé entre-temps. Aucun montant n'a été prélevé.",
                cancellationToken);
        }

        // Application atomique au solde : le filtre empêche tout dépassement si
        // deux paiements concurrents arrivent en même temps.
        var invoiceFilter = Builders<Invoice>.Filter.And(
            Builders<Invoice>.Filter.Eq(i => i.Id, invoice.Id),
            Builders<Invoice>.Filter.Gte(i => i.BalanceDue, transaction.Amount),
            Builders<Invoice>.Filter.Ne(i => i.Status, InvoiceStatus.Paid),
            Builders<Invoice>.Filter.Ne(i => i.Status, InvoiceStatus.Draft));

        var applied = await Invoices.UpdateOneAsync(
            invoiceFilter,
            Builders<Invoice>.Update
                .Inc(i => i.AmountPaid, transaction.Amount)
                .Inc(i => i.BalanceDue, -transaction.Amount),
            cancellationToken: cancellationToken);

        if (applied.ModifiedCount == 0)
        {
            return await FailAsync(transaction, "insufficient_balance",
                "Le solde restant a changé entre-temps. Aucun montant n'a été prélevé.",
                cancellationToken);
        }

        await RecomputeInvoiceStatusAsync(invoice.Id, cancellationToken);

        var updatedInvoice = await Invoices.Find(i => i.Id == invoice.Id).FirstOrDefaultAsync(cancellationToken)
            ?? invoice;

        var receiptNumber = await GenerateReceiptNumberAsync(cancellationToken);
        var completedAt = DateTime.UtcNow;
        var successAttempt = transaction.Attempts.LastOrDefault();
        if (successAttempt != null)
        {
            successAttempt.Status = PaymentAttemptStatus.Succeeded;
            successAttempt.CompletedAt = completedAt;
        }
        transaction.Status = PaymentTransactionStatus.Succeeded;
        transaction.BalanceBefore = invoice.BalanceDue;
        transaction.BalanceAfter = updatedInvoice.BalanceDue;
        transaction.InvoiceTotal = updatedInvoice.Total;
        transaction.ReceiptNumber = receiptNumber;
        transaction.ErrorCode = null;
        transaction.ErrorMessage = null;
        transaction.CompletedAt = completedAt;
        transaction.UpdatedAt = completedAt;

        await Payments.ReplaceOneAsync(
            t => t.Id == transaction.Id,
            transaction,
            cancellationToken: cancellationToken);

        var paidLabel = updatedInvoice.BalanceDue <= 0.0005m ? "Facture réglée" : "Paiement reçu";
        await NotifyAsync(
            transaction.FreelancerId,
            "invoice_billing",
            paidLabel,
            $"{FormatAmount(transaction.Amount)} reçus pour la facture {transaction.InvoiceNumber} ({PaymentMethod.Label(transaction.Method)}, réf. {transaction.Reference}). Solde restant : {FormatAmount(updatedInvoice.BalanceDue)}.",
            transaction,
            cancellationToken);
        await NotifyAsync(
            transaction.ClientId,
            "invoice_billing",
            updatedInvoice.BalanceDue <= 0.0005m ? "Facture réglée" : "Paiement enregistré",
            $"Votre paiement de {FormatAmount(transaction.Amount)} pour la facture {transaction.InvoiceNumber} a été enregistré (réf. {transaction.Reference}). Reçu {receiptNumber}. Solde restant : {FormatAmount(updatedInvoice.BalanceDue)}.",
            transaction,
            cancellationToken);

        return ToResponse(transaction);
    }

    // ---------------------------------------------------------------------
    // Passerelle Konnect Sandbox
    // ---------------------------------------------------------------------

    /// <summary>
    /// Vérification serveur déclenchée au retour du client. Le frontend ne
    /// transmet jamais ni statut ni montant : uniquement l'identifiant de sa
    /// propre transaction, relu puis confronté à l'API officielle Konnect.
    /// </summary>
    public async Task<PaymentTransactionResponse> VerifyAsync(
        string userId,
        string transactionId,
        CancellationToken cancellationToken)
    {
        var transaction = await FindAsync(transactionId, cancellationToken);
        EnsureAccess(userId, transaction);
        if (!string.Equals(transaction.ClientId, userId, StringComparison.Ordinal))
        {
            throw new ForbiddenException("Le freelancer consulte les paiements en lecture seule.");
        }

        if (!PaymentProvider.IsGateway(transaction.Provider))
        {
            return ToResponse(transaction);
        }
        if (string.Equals(transaction.Status, PaymentTransactionStatus.Succeeded, StringComparison.Ordinal))
        {
            return ToResponse(transaction);
        }
        if (string.IsNullOrWhiteSpace(transaction.ProviderPaymentRef))
        {
            throw new ConflictException(
                "Cette tentative n'a pas de référence de passerelle : elle ne peut pas être vérifiée.");
        }
        EnsureGatewayConfigured();

        var details = await _konnect!.GetPaymentAsync(transaction.ProviderPaymentRef, cancellationToken);
        var reconciled = await ReconcileAsync(transaction, details, webhook: false, cancellationToken);
        return ToResponse(reconciled);
    }

    // ---------------------------------------------------------------------
    // Blockchain Ethereum de test (MetaMask : Sepolia / Hardhat Local)
    // ---------------------------------------------------------------------

    /// <summary>Configuration publique utilisée par le frontend (réseau, taux, réception).</summary>
    public BlockchainConfigResponse GetBlockchainConfig()
    {
        var settings = _blockchainSettings ?? new BlockchainSettings { Enabled = false };
        var configured = settings.IsConfigured;
        return new BlockchainConfigResponse
        {
            Enabled = configured,
            Network = settings.ActiveNetworkName,
            NetworkKey = settings.ActiveNetworkKey,
            ChainId = settings.ActiveChainId,
            ChainIdHex = settings.ActiveChainIdHex,
            RpcUrl = settings.ActiveRpcUrl,
            Receiver = configured ? settings.ActiveReceiverAddress : string.Empty,
            TndPerEth = settings.TndPerEth,
            MinConfirmations = Math.Clamp(settings.ActiveMinConfirmations, 1, 20),
            ExplorerBaseUrl = settings.ActiveExplorerBaseUrl,
        };
    }

    /// <summary>
    /// Solde ETH réel d'une adresse (ou du destinataire configuré) sur le réseau
    /// actif. Lecture JSON-RPC stricte : réseau, adresse et valeur viennent de la
    /// blockchain, jamais d'un cumul de paiements en base.
    /// </summary>
    public async Task<BlockchainBalanceResponse> GetBlockchainBalanceAsync(
        string? address,
        CancellationToken cancellationToken)
    {
        var settings = _blockchainSettings;
        if (_rpc is null || settings is null || !settings.IsConfigured)
        {
            throw new PaymentGatewayException(
                "Le portefeuille blockchain n'est pas disponible : le réseau actif n'est pas configuré. " +
                "Aucun solde n'est affiché sans lecture on-chain fiable.");
        }

        // Adresse vide = destinataire configuré pour le réseau actif. Une adresse
        // fournie est validée avant tout appel RPC.
        var target = string.IsNullOrWhiteSpace(address)
            ? settings.ActiveReceiverAddress
            : address.Trim();
        if (!BlockchainSettings.IsValidAddress(target))
        {
            throw new BadRequestException("Adresse Ethereum invalide : solde non consultable.");
        }

        // Garde réseau : le nœud doit réellement servir le réseau de la config.
        var chainId = await _rpc.GetChainIdAsync(cancellationToken);
        if (chainId != settings.ActiveChainId)
        {
            throw new PaymentGatewayException(
                $"Le nœud RPC ne sert pas {settings.ActiveNetworkName} (chainId observé : {chainId}). " +
                "Impossible d'afficher un solde fiable.");
        }

        var balanceWei = await _rpc.GetBalanceWeiAsync(target, cancellationToken);
        var blockNumber = await _rpc.GetBlockNumberAsync(cancellationToken);

        return new BlockchainBalanceResponse
        {
            Network = settings.ActiveNetworkName,
            NetworkKey = settings.ActiveNetworkKey,
            ChainId = chainId,
            Address = target,
            BalanceWei = balanceWei,
            BalanceEth = BlockchainSettings.ToEth(balanceWei),
            BlockNumber = blockNumber,
            CheckedAt = DateTime.UtcNow,
        };
    }

    /// <summary>
    /// Vérifie un paiement MetaMask sur le réseau Ethereum actif (Sepolia ou
    /// Hardhat local). Le frontend ne transmet que le hash : réseau,
    /// destinataire, montant et statut sont relus sur la blockchain. Aucun
    /// crédit n'est appliqué tant que toutes les conditions ne sont pas réunies.
    /// </summary>
    public async Task<PaymentTransactionResponse> VerifyBlockchainAsync(
        string userId,
        string transactionId,
        string txHash,
        CancellationToken cancellationToken)
    {
        var transaction = await FindAsync(transactionId, cancellationToken);
        EnsureAccess(userId, transaction);
        if (!string.Equals(transaction.ClientId, userId, StringComparison.Ordinal))
        {
            throw new ForbiddenException("Seul le client peut vérifier un paiement.");
        }
        if (!PaymentProvider.IsBlockchain(transaction.Provider))
        {
            throw new ConflictException("Cette transaction n'est pas un paiement MetaMask.");
        }
        if (string.Equals(transaction.Status, PaymentTransactionStatus.Succeeded, StringComparison.Ordinal))
        {
            // Un paiement réussi peut avoir été interrompu après sa
            // finalisation (audit ou notifications manquants). La reprise est
            // idempotente ; les paiements historiques sans identifiant de
            // règlement ne sont jamais réécrits.
            if (!string.IsNullOrWhiteSpace(transaction.BlockchainSettlementId))
            {
                await EnsureBlockchainSuccessAuditAsync(transaction, cancellationToken);
                await EnsureBlockchainNotificationsAsync(
                    transaction,
                    BlockchainSettings.NetworkName(transaction.BlockchainChainId),
                    cancellationToken);
            }
            return ToResponse(transaction);
        }

        var hash = BlockchainSettings.NormalizeTxHash(txHash);
        if (!BlockchainSettings.IsValidTxHash(hash))
        {
            throw new BadRequestException("Hash de transaction blockchain invalide.");
        }
        if (_rpc is null || _blockchainSettings?.IsConfigured != true)
        {
            throw new PaymentGatewayException(
                "Le paiement MetaMask n'est pas configuré pour le réseau actif. Aucun montant n'a été appliqué.");
        }

        var expectedWei = transaction.BlockchainAmountWei;
        if (string.IsNullOrWhiteSpace(expectedWei)
            || !BlockchainSettings.IsValidAddress(transaction.BlockchainReceiver)
            || !BlockchainSettings.IsSupportedChainId(transaction.BlockchainChainId))
        {
            throw new ConflictException(
                "Cette intention de paiement MetaMask est incomplète : recommencez le paiement.");
        }

        // Traitement strict des intentions historiques : sans empreinte
        // Genesis, aucun crédit n'est possible. Le seul fait qu'un hash existe
        // sur le nœud courant ne prouve pas qu'il appartient à cette instance.
        // Un rapprochement explicite et audité est requis (jamais automatique).
        if (!BlockchainSettings.IsValidGenesisHash(transaction.BlockchainGenesisHash))
        {
            return ToResponse(await MarkGatewayFailureAsync(
                transaction,
                PaymentTransactionStatus.Failed,
                "blockchain_genesis_unknown",
                "Cette intention MetaMask a été créée avant l'enregistrement de l'empreinte Genesis. " +
                "Aucun montant n'a été appliqué : un rapprochement explicite est nécessaire.",
                notify: true,
                force: true,
                cancellationToken));
        }

        // Réseau figé au moment de l'intention : la vérification ne peut pas
        // être détournée vers un autre réseau après coup.
        var expectedChainId = transaction.BlockchainChainId!.Value;
        var networkLabel = BlockchainSettings.NetworkName(expectedChainId);

        // Garde réseau : le nœud doit réellement servir le réseau de l'intention.
        var chainId = await _rpc.GetChainIdAsync(cancellationToken);
        if (chainId != expectedChainId)
        {
            return ToResponse(await MarkGatewayFailureAsync(
                transaction,
                PaymentTransactionStatus.Failed,
                "blockchain_wrong_network",
                $"Le nœud RPC ne sert pas {networkLabel} (chainId observé : {chainId}). " +
                "Aucun montant n'a été appliqué.",
                notify: true,
                force: false,
                cancellationToken));
        }

        // Empreinte de l'instance servie par le nœud. Sans elle, aucune
        // vérification fiable n'est possible : échec fermé.
        var currentGenesis = await _rpc.GetGenesisAsync(cancellationToken);
        if (currentGenesis is null
            || !BlockchainSettings.IsValidGenesisHash(currentGenesis.Hash))
        {
            throw new PaymentGatewayException(
                "Le nœud blockchain n'a pas fourni d'empreinte Genesis fiable. " +
                "Aucun montant n'a été appliqué.");
        }

        var currentNodeGenesis = BlockchainSettings.NormalizeTxHash(currentGenesis.Hash);
        var recordedGenesis = BlockchainSettings.NormalizeTxHash(transaction.BlockchainGenesisHash);

        var onChain = await _rpc.GetTransactionAsync(hash, cancellationToken);
        if (onChain is null)
        {
            await TouchBlockchainObservationAsync(
                transaction, "not_found", null, null, null, cancellationToken);
            return ToResponse(await FindAsync(transaction.Id, cancellationToken));
        }

        if (!BlockchainSettings.AddressEquals(onChain.To, transaction.BlockchainReceiver))
        {
            return ToResponse(await MarkGatewayFailureAsync(
                transaction,
                PaymentTransactionStatus.Failed,
                "blockchain_wrong_recipient",
                $"La transaction {networkLabel} ne cible pas l'adresse de réception FreelanceTN. " +
                "Aucun montant n'a été appliqué.",
                notify: true,
                force: false,
                cancellationToken));
        }

        if (!WeiEquals(onChain.ValueHex, expectedWei))
        {
            return ToResponse(await MarkGatewayFailureAsync(
                transaction,
                PaymentTransactionStatus.Failed,
                "blockchain_wrong_amount",
                $"Le montant transféré sur {networkLabel} ne correspond pas exactement au montant attendu. " +
                "Aucun montant n'a été appliqué.",
                notify: true,
                force: false,
                cancellationToken));
        }

        var receipt = await _rpc.GetReceiptAsync(hash, cancellationToken);
        if (receipt is null)
        {
            await TouchBlockchainObservationAsync(
                transaction, "pending_confirmation", null, hash, onChain.From, cancellationToken);
            return ToResponse(await FindAsync(transaction.Id, cancellationToken));
        }
        if (!receipt.Success)
        {
            return ToResponse(await MarkGatewayFailureAsync(
                transaction,
                PaymentTransactionStatus.Failed,
                "blockchain_tx_failed",
                $"La transaction {networkLabel} a échoué (statut 0x0). Aucun montant n'a été appliqué.",
                notify: true,
                force: false,
                cancellationToken));
        }

        var latestBlock = await _rpc.GetBlockNumberAsync(cancellationToken);
        var confirmations = (int)Math.Max(1L, latestBlock - receipt.BlockNumber + 1L);
        var required = Math.Clamp(_blockchainSettings.ActiveMinConfirmations, 1, 20);
        if (confirmations < required)
        {
            await TouchBlockchainObservationAsync(
                transaction, "confirming", confirmations, hash, onChain.From, cancellationToken);
            return ToResponse(await FindAsync(transaction.Id, cancellationToken));
        }

        // Liaison du portefeuille : si le compte a déjà payé sur la blockchain,
        // l'adresse émettrice doit rester la même.
        var user = await Users.Find(u => u.Id == userId).FirstOrDefaultAsync(cancellationToken);
        if (user != null
            && !string.IsNullOrWhiteSpace(user.WalletAddress)
            && !BlockchainSettings.AddressEquals(user.WalletAddress, onChain.From))
        {
            return ToResponse(await MarkGatewayFailureAsync(
                transaction,
                PaymentTransactionStatus.Failed,
                "blockchain_wallet_mismatch",
                $"La transaction {networkLabel} provient d'un portefeuille différent de celui lié à votre compte. " +
                "Aucun montant n'a été appliqué.",
                notify: true,
                force: false,
                cancellationToken));
        }

        // L'instance de chaîne doit être exactement celle de l'intention. Un
        // Genesis différent signifie que le nœud a été réinitialisé : le hash
        // observé appartient à une autre chaîne, aucun crédit n'est possible.
        if (!string.Equals(recordedGenesis, currentNodeGenesis, StringComparison.Ordinal))
        {
            return ToResponse(await MarkGatewayFailureAsync(
                transaction,
                PaymentTransactionStatus.Failed,
                "blockchain_chain_reset",
                $"Le nœud {networkLabel} a été réinitialisé depuis la création de cette intention " +
                "(empreinte Genesis différente). Aucun montant n'a été appliqué. Recommencez le paiement.",
                notify: true,
                force: true,
                cancellationToken));
        }

        var claimAt = DateTime.UtcNow;
        string settlementId;

        // Reprise : un règlement interrompu porte déjà ProviderAppliedAt et un
        // identifiant de règlement stable. Il est repris sans nouvelle
        // revendication, sinon une panne entre le crédit et la finalisation
        // laisserait le paiement bloqué en « processing ».
        //
        // Un paiement déjà tranché (échec/annulation) n'est jamais repris : la
        // reprise ne concerne que l'état « processing » laissé par une
        // interruption. Cela empêche qu'un crédit explicitement refusé soit
        // appliqué plus tard par une simple nouvelle vérification.
        if (transaction.ProviderAppliedAt != null
            && PaymentTransactionStatus.IsTerminal(transaction.Status))
        {
            return ToResponse(transaction);
        }

        if (transaction.ProviderAppliedAt != null)
        {
            if (string.IsNullOrWhiteSpace(transaction.BlockchainSettlementId)
                || !string.Equals(
                    BlockchainSettings.NormalizeTxHash(transaction.BlockchainTxHash),
                    hash,
                    StringComparison.Ordinal))
            {
                throw new ConflictException(
                    "Ce paiement blockchain est déjà en cours de règlement sans identifiant de reprise " +
                    "exploitable. Aucun montant supplémentaire n'a été appliqué : un rapprochement explicite est requis.");
            }

            settlementId = transaction.BlockchainSettlementId!;
            claimAt = transaction.ProviderAppliedAt.Value;
        }
        else
        {
            // Anti-rejeu : identité = (empreinte Genesis, hash normalisé). Un
            // hash identique sur une autre instance n'est jamais accepté sur la
            // seule comparaison du hash ; tous les contrôles on-chain ci-dessus
            // restent obligatoires.
            var replay = await FindBlockchainReplayAsync(
                transaction.Id, hash, currentNodeGenesis, currentGenesis.Timestamp, cancellationToken);
            if (replay.Duplicate != null)
            {
                return ToResponse(await MarkBlockchainDuplicateAsync(
                    transaction,
                    replay.Duplicate,
                    currentNodeGenesis,
                    replay.ReasonCode!,
                    cancellationToken));
            }

            var crossGenesis = replay.CrossGenesis;
            settlementId = Guid.NewGuid().ToString("N");
            var reason = crossGenesis == null
                ? null
                : BuildCrossGenesisReason(crossGenesis, currentNodeGenesis, currentGenesis.Timestamp);

            try
            {
                var claim = await Payments.UpdateOneAsync(
                    t => t.Id == transaction.Id
                         && t.Status != PaymentTransactionStatus.Succeeded
                         && t.ProviderAppliedAt == null,
                    Builders<PaymentTransaction>.Update
                        .Set(t => t.BlockchainTxHash, hash)
                        .Set(t => t.BlockchainGenesisHash, currentNodeGenesis)
                        .Set(t => t.BlockchainGenesisTimestamp, currentGenesis.Timestamp)
                        .Set(t => t.BlockchainSettlementId, settlementId)
                        .Set(t => t.BlockchainCrossGenesis, crossGenesis != null)
                        .Set(t => t.BlockchainReplayOfPaymentId, crossGenesis?.Id)
                        .Set(t => t.BlockchainReplayReason, reason)
                        .Set(t => t.WalletAddress, onChain.From)
                        .Set(t => t.BlockchainConfirmations, confirmations)
                        .Set(t => t.BlockchainVerifiedAt, claimAt)
                        .Set(t => t.ProviderAppliedAt, claimAt)
                        .Set(t => t.ProviderStatus, "confirmed")
                        .Set(t => t.Status, PaymentTransactionStatus.Processing)
                        .Set(t => t.ErrorCode, (string?)null)
                        .Set(t => t.ErrorMessage, (string?)null)
                        .Set(t => t.ProviderLastCheckedAt, claimAt)
                        .Set(t => t.UpdatedAt, claimAt),
                    cancellationToken: cancellationToken);

                if (claim.ModifiedCount == 0)
                {
                    var current = await FindAsync(transaction.Id, cancellationToken);
                    if (string.Equals(current.Status, PaymentTransactionStatus.Succeeded, StringComparison.Ordinal))
                    {
                        return ToResponse(current);
                    }

                    // Une vérification concurrente a gagné la course : reprendre
                    // son règlement s'il est identifiable, sinon ne rien écrire.
                    if (current.ProviderAppliedAt != null
                        && !string.IsNullOrWhiteSpace(current.BlockchainSettlementId)
                        && string.Equals(
                            BlockchainSettings.NormalizeTxHash(current.BlockchainTxHash),
                            hash,
                            StringComparison.Ordinal))
                    {
                        settlementId = current.BlockchainSettlementId!;
                        claimAt = current.ProviderAppliedAt.Value;
                    }
                    else
                    {
                        return ToResponse(current);
                    }
                }
            }
            catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
            {
                // L'index unique (genesis, hash) a refusé la revendication : un
                // autre paiement a déjà crédité ce transfert sur cette instance.
                var winner = await Payments
                    .Find(t => t.BlockchainGenesisHash == currentNodeGenesis
                               && t.BlockchainTxHash == hash
                               && t.Id != transaction.Id)
                    .FirstOrDefaultAsync(cancellationToken);
                return ToResponse(await MarkBlockchainDuplicateAsync(
                    transaction,
                    winner,
                    currentNodeGenesis,
                    winner == null ? "index_conflict" : "same_genesis",
                    cancellationToken));
            }
        }

        // Premier paiement réussi : le portefeuille est lié au compte pour
        // empêcher qu'un autre wallet ne paie les factures de ce client.
        // La liaison intervient seulement après la revendication : un refus
        // (chaîne réinitialisée, hash déjà crédité) ne lie pas définitivement
        // un portefeuille au compte.
        if (user != null && string.IsNullOrWhiteSpace(user.WalletAddress))
        {
            await Users.UpdateOneAsync(
                u => u.Id == user.Id && u.WalletAddress == null,
                Builders<User>.Update.Set(u => u.WalletAddress, onChain.From),
                cancellationToken: cancellationToken);
        }

        var claimed = await FindAsync(transaction.Id, cancellationToken);
        claimed.ProviderStatus = "confirmed";
        claimed.ProviderAppliedAt ??= claimAt;
        claimed.ProviderLastCheckedAt = claimAt;
        claimed.Status = PaymentTransactionStatus.Processing;

        return ToResponse(await SettleBlockchainCreditAsync(
            claimed,
            settlementId,
            claimAt,
            networkLabel,
            hash,
            currentNodeGenesis,
            currentGenesis.Timestamp,
            cancellationToken));
    }

    /// <summary>
    /// Réconciliation manuelle, explicite et auditée d'un transfert blockchain
    /// dont le hash a déjà crédité un paiement historique dont l'empreinte
    /// Genesis est inconnue (paiement créé avant l'enregistrement du Genesis).
    ///
    /// Cette procédure ne remplace jamais la règle générale
    /// <c>previous_genesis_unknown</c> : elle est réservée au bénéficiaire de la
    /// facture, exige des preuves on-chain complètes sur l'instance courante et
    /// ne peut être utilisée qu'une seule fois, pour un seul paiement. Aucun
    /// Genesis historique n'est inventé : seule l'empreinte de l'instance
    /// courante est enregistrée, avec la justification complète.
    /// </summary>
    public async Task<PaymentTransactionResponse> ReconcileBlockchainCrossGenesisAsync(
        string userId,
        string transactionId,
        ReconcileBlockchainCrossGenesisRequest request,
        CancellationToken cancellationToken)
    {
        if (request is null || !request.Confirm)
        {
            throw new BadRequestException(
                "La réconciliation exige une confirmation explicite (confirm = true). Aucun montant n'a été appliqué.");
        }
        if (string.IsNullOrWhiteSpace(request.PreviousPaymentId)
            || !ObjectId.TryParse(request.PreviousPaymentId, out _))
        {
            throw new BadRequestException("Identifiant du paiement antérieur invalide.");
        }

        var hash = BlockchainSettings.NormalizeTxHash(request.TxHash);
        if (!BlockchainSettings.IsValidTxHash(hash))
        {
            throw new BadRequestException("Hash de transaction blockchain invalide.");
        }

        var transaction = await FindAsync(transactionId, cancellationToken);
        EnsureAccess(userId, transaction);

        // Opération réservée au bénéficiaire : elle n'est jamais exposée au
        // parcours client de vérification.
        if (!string.Equals(transaction.FreelancerId, userId, StringComparison.Ordinal))
        {
            throw new ForbiddenException(
                "Seul le freelance bénéficiaire de la facture peut exécuter une réconciliation explicite.");
        }

        if (!PaymentProvider.IsBlockchain(transaction.Provider)
            || !string.Equals(transaction.Method, PaymentMethod.MetaMask, StringComparison.OrdinalIgnoreCase))
        {
            throw new ConflictException("Cette transaction n'est pas un paiement MetaMask.");
        }

        var normalizedPreviousId = request.PreviousPaymentId.Trim();

        // Reprise idempotente : un paiement déjà réglé par cette même exception
        // n'est jamais crédité une seconde fois et ne crée pas un second reçu.
        if (string.Equals(transaction.Status, PaymentTransactionStatus.Succeeded, StringComparison.Ordinal))
        {
            if (transaction.BlockchainCrossGenesis
                && string.Equals(transaction.BlockchainReplayOfPaymentId, normalizedPreviousId, StringComparison.Ordinal)
                && string.Equals(
                    BlockchainSettings.NormalizeTxHash(transaction.BlockchainTxHash),
                    hash,
                    StringComparison.Ordinal))
            {
                await EnsureBlockchainSuccessAuditAsync(transaction, cancellationToken);
                await EnsureBlockchainNotificationsAsync(
                    transaction,
                    BlockchainSettings.NetworkName(transaction.BlockchainChainId),
                    cancellationToken);
                return ToResponse(transaction);
            }

            throw new ConflictException(
                "Ce paiement est déjà réglé ; aucune réconciliation supplémentaire n'est possible.");
        }

        // Un paiement explicitement refusé ou annulé n'est jamais repris : la
        // réconciliation ne doit pas transformer un refus en crédit.
        if (PaymentTransactionStatus.IsTerminal(transaction.Status))
        {
            throw new ConflictException(
                "Ce paiement est déjà terminé (échec ou annulation) : aucune réconciliation n'est possible.");
        }

        var expectedWei = transaction.BlockchainAmountWei;
        if (string.IsNullOrWhiteSpace(expectedWei)
            || !BlockchainSettings.IsValidAddress(transaction.BlockchainReceiver)
            || !BlockchainSettings.IsSupportedChainId(transaction.BlockchainChainId))
        {
            throw new ConflictException(
                "Cette intention de paiement MetaMask est incomplète : réconciliation impossible.");
        }

        var recordedHash = BlockchainSettings.NormalizeTxHash(transaction.BlockchainTxHash);
        if (recordedHash.Length > 0 && !string.Equals(recordedHash, hash, StringComparison.Ordinal))
        {
            throw new ConflictException(
                "Ce paiement porte déjà un hash différent : réconciliation impossible.");
        }

        var recordedGenesis = BlockchainSettings.NormalizeTxHash(transaction.BlockchainGenesisHash);
        var recordedGenesisValid = BlockchainSettings.IsValidGenesisHash(recordedGenesis);

        // Un règlement déjà commencé n'est repris que s'il s'agit exactement de
        // cette réconciliation (même paiement antérieur, même hash).
        var alreadyClaimed = transaction.ProviderAppliedAt != null
            || !string.IsNullOrWhiteSpace(transaction.BlockchainSettlementId);
        if (alreadyClaimed
            && (!transaction.BlockchainCrossGenesis
                || !string.Equals(transaction.BlockchainReplayOfPaymentId, normalizedPreviousId, StringComparison.Ordinal)
                || !string.Equals(recordedHash, hash, StringComparison.Ordinal)))
        {
            throw new ConflictException(
                "Ce paiement porte déjà un règlement qui n'est pas cette réconciliation. " +
                "Aucun montant n'a été appliqué.");
        }

        if (_rpc is null || _blockchainSettings?.IsConfigured != true)
        {
            throw new PaymentGatewayException(
                "Le paiement MetaMask n'est pas configuré pour le réseau actif. Aucun montant n'a été appliqué.");
        }

        // Paiement antérieur : il doit être réussi, porter le même hash et ne
        // pas avoir d'empreinte Genesis exploitable. C'est précisément ce cas
        // que la règle générale refuse : la réconciliation est l'unique issue.
        var previous = await Payments
            .Find(t => t.Id == normalizedPreviousId)
            .FirstOrDefaultAsync(cancellationToken)
            ?? throw new NotFoundException("Paiement antérieur introuvable.");

        if (string.Equals(previous.Id, transaction.Id, StringComparison.Ordinal))
        {
            throw new BadRequestException("Le paiement antérieur doit être distinct du paiement à réconcilier.");
        }
        if (!PaymentProvider.IsBlockchain(previous.Provider))
        {
            throw new ConflictException("Le paiement antérieur n'est pas un paiement blockchain.");
        }
        if (!string.Equals(previous.Status, PaymentTransactionStatus.Succeeded, StringComparison.Ordinal))
        {
            throw new ConflictException("Le paiement antérieur n'est pas réussi : aucun crédit antérieur à confirmer.");
        }
        if (string.IsNullOrWhiteSpace(previous.ReceiptNumber) && previous.ProviderAppliedAt == null)
        {
            throw new ConflictException("Le paiement antérieur ne porte aucune preuve de crédit.");
        }
        var previousHash = BlockchainSettings.NormalizeTxHash(previous.BlockchainTxHash);
        if (!BlockchainSettings.IsValidTxHash(previousHash)
            || !string.Equals(previousHash, hash, StringComparison.Ordinal))
        {
            throw new ConflictException(
                "Le hash fourni ne correspond pas exactement au paiement antérieur.");
        }
        if (BlockchainSettings.IsValidGenesisHash(previous.BlockchainGenesisHash))
        {
            throw new ConflictException(
                "Le paiement antérieur possède déjà une empreinte Genesis : la procédure normale s'applique, " +
                "sans exception de réconciliation.");
        }
        if (previous.BlockchainCrossGenesis)
        {
            throw new ConflictException(
                "Le paiement antérieur est lui-même issu d'une réconciliation : l'exception ne peut pas être rejouée.");
        }
        if (!string.Equals(previous.InvoiceId, transaction.InvoiceId, StringComparison.Ordinal)
            || !string.Equals(previous.ClientId, transaction.ClientId, StringComparison.Ordinal))
        {
            throw new ConflictException(
                "Le paiement antérieur et le paiement à réconcilier ne concernent pas la même facture et le même client.");
        }
        if (previous.Amount != transaction.Amount
            || !string.Equals(previous.BlockchainAmountWei, expectedWei, StringComparison.Ordinal))
        {
            throw new ConflictException(
                "Le montant du paiement antérieur ne correspond pas exactement à celui du transfert à réconcilier.");
        }

        // Exception à usage unique : un audit de réconciliation ne peut jamais
        // désigner un autre paiement.
        var usedByAnotherPayment = await PaymentAudits
            .Find(a => a.Action == "blockchain_cross_genesis_reconciled" && a.PaymentId != transaction.Id)
            .AnyAsync(cancellationToken);
        if (usedByAnotherPayment)
        {
            throw new ConflictException(
                "L'exception de réconciliation a déjà été utilisée pour un autre paiement. " +
                "Aucun montant n'a été appliqué.");
        }

        // Preuves on-chain sur l'instance actuellement servie par le nœud.
        var expectedChainId = transaction.BlockchainChainId!.Value;
        var networkLabel = BlockchainSettings.NetworkName(expectedChainId);

        var chainId = await _rpc.GetChainIdAsync(cancellationToken);
        if (chainId != expectedChainId)
        {
            throw new ConflictException(
                $"Le nœud RPC ne sert pas {networkLabel} (chainId observé : {chainId}). " +
                "Aucun montant n'a été appliqué.");
        }

        var currentGenesis = await _rpc.GetGenesisAsync(cancellationToken);
        if (currentGenesis is null || !BlockchainSettings.IsValidGenesisHash(currentGenesis.Hash))
        {
            throw new PaymentGatewayException(
                "Le nœud blockchain n'a pas fourni d'empreinte Genesis fiable. " +
                "Aucun montant n'a été appliqué.");
        }
        var currentNodeGenesis = BlockchainSettings.NormalizeTxHash(currentGenesis.Hash);
        var genesisTime = DateTimeOffset.FromUnixTimeSeconds(currentGenesis.Timestamp).UtcDateTime;

        if (genesisTime > DateTime.UtcNow.AddMinutes(5))
        {
            throw new ConflictException(
                "L'horodatage du Genesis courant est incohérent. Aucun montant n'a été appliqué.");
        }

        // L'instance courante doit être postérieure au crédit antérieur : c'est
        // ce qui prouve que le même hash désigne un transfert distinct, et non
        // le transfert déjà crédité. Un simple timestamp plus récent ne suffit
        // pas : tous les contrôles on-chain ci-dessous restent obligatoires.
        var previousCreditedAt = previous.CompletedAt
            ?? previous.ProviderAppliedAt
            ?? previous.UpdatedAt;
        if (genesisTime <= previousCreditedAt)
        {
            throw new ConflictException(
                "L'instance de chaîne courante n'est pas postérieure au crédit du paiement antérieur : " +
                "le transfert ne peut pas être distingué. Aucun montant n'a été appliqué.");
        }

        // L'intention doit avoir été créée sur l'instance courante. Si elle porte
        // déjà un Genesis, il doit être exactement celui du nœud.
        if (recordedGenesisValid)
        {
            if (!string.Equals(recordedGenesis, currentNodeGenesis, StringComparison.Ordinal))
            {
                throw new ConflictException(
                    "L'intention porte une empreinte Genesis différente de l'instance courante : " +
                    "la chaîne a été réinitialisée. Aucun montant n'a été appliqué.");
            }
        }
        else if (transaction.CreatedAt < genesisTime)
        {
            throw new ConflictException(
                "L'intention a été créée avant l'instance de chaîne courante : " +
                "le transfert ne peut pas lui être rattaché. Aucun montant n'a été appliqué.");
        }

        var onChain = await _rpc.GetTransactionAsync(hash, cancellationToken);
        if (onChain is null)
        {
            throw new ConflictException(
                $"La transaction {hash} est introuvable sur l'instance {networkLabel} courante. " +
                "Aucun montant n'a été appliqué.");
        }
        if (!BlockchainSettings.AddressEquals(onChain.To, transaction.BlockchainReceiver))
        {
            throw new ConflictException(
                $"La transaction {networkLabel} ne cible pas l'adresse de réception FreelanceTN. " +
                "Aucun montant n'a été appliqué.");
        }
        if (!WeiEquals(onChain.ValueHex, expectedWei))
        {
            throw new ConflictException(
                $"Le montant transféré sur {networkLabel} ne correspond pas exactement au montant attendu. " +
                "Aucun montant n'a été appliqué.");
        }

        var receipt = await _rpc.GetReceiptAsync(hash, cancellationToken);
        if (receipt is null)
        {
            throw new ConflictException(
                $"La transaction {networkLabel} n'a pas encore de reçu : réconciliation impossible. " +
                "Aucun montant n'a été appliqué.");
        }
        if (!receipt.Success)
        {
            throw new ConflictException(
                $"La transaction {networkLabel} a échoué (statut 0x0). Aucun montant n'a été appliqué.");
        }

        var latestBlock = await _rpc.GetBlockNumberAsync(cancellationToken);
        var confirmations = (int)Math.Max(1L, latestBlock - receipt.BlockNumber + 1L);
        var required = Math.Clamp(_blockchainSettings.ActiveMinConfirmations, 1, 20);
        if (confirmations < required)
        {
            throw new ConflictException(
                $"La transaction {networkLabel} n'a pas encore assez de confirmations " +
                $"({confirmations}/{required}). Aucun montant n'a été appliqué.");
        }

        var transactionBlock = await _rpc.GetBlockAsync(receipt.BlockNumber, cancellationToken);
        if (transactionBlock is null)
        {
            throw new PaymentGatewayException(
                "Le bloc contenant la transaction n'a pas pu être lu. Aucun montant n'a été appliqué.");
        }
        var blockTime = DateTimeOffset.FromUnixTimeSeconds(transactionBlock.Timestamp).UtcDateTime;
        if (blockTime < transaction.CreatedAt)
        {
            throw new ConflictException(
                "Le bloc contenant la transaction est antérieur à la création de l'intention : " +
                "incohérence temporelle. Aucun montant n'a été appliqué.");
        }

        // Liaison du portefeuille : le payeur doit être celui déjà lié au compte
        // client, comme dans le parcours normal.
        var client = await Users.Find(u => u.Id == transaction.ClientId).FirstOrDefaultAsync(cancellationToken);
        if (client != null
            && !string.IsNullOrWhiteSpace(client.WalletAddress)
            && !BlockchainSettings.AddressEquals(client.WalletAddress, onChain.From))
        {
            throw new ConflictException(
                $"La transaction {networkLabel} provient d'un portefeuille différent de celui lié au compte. " +
                "Aucun montant n'a été appliqué.");
        }

        var reason =
            $"Réconciliation manuelle auditée d'un hash déjà crédité sur une instance de chaîne antérieure : " +
            $"paiement antérieur {previous.Reference} ({FormatAmount(previous.Amount)}, " +
            $"reçu {previous.ReceiptNumber ?? "inconnu"}) dont l'empreinte Genesis est inconnue ; " +
            $"instance courante {currentNodeGenesis} " +
            $"(Genesis {genesisTime:O}, postérieur au crédit antérieur du {previousCreditedAt:O}) ; " +
            $"transaction {hash} vérifiée on-chain sur {networkLabel} " +
            $"(destinataire {onChain.To}, montant exact {expectedWei} wei, reçu 0x1, " +
            $"{confirmations} confirmation(s), bloc {receipt.BlockNumber} du {blockTime:O}) ; " +
            $"intention {transaction.Reference} créée le {transaction.CreatedAt:O}, postérieure à l'instance courante. " +
            "Aucun Genesis historique n'a été inventé.";

        // Réservation atomique de l'exception : la clé fixe rend l'usage unique
        // même en cas d'appels concurrents sur deux paiements différents.
        const string exceptionKey = "blockchain_cross_genesis_exception:global";
        var reservation = await PaymentAudits
            .Find(a => a.DedupeKey == exceptionKey)
            .FirstOrDefaultAsync(cancellationToken);

        string settlementId;
        DateTime claimAt;

        if (reservation != null)
        {
            if (!string.Equals(reservation.PaymentId, transaction.Id, StringComparison.Ordinal))
            {
                throw new ConflictException(
                    "L'exception de réconciliation a déjà été utilisée pour un autre paiement. " +
                    "Aucun montant n'a été appliqué.");
            }
            if (!string.IsNullOrWhiteSpace(transaction.BlockchainSettlementId)
                && !string.Equals(transaction.BlockchainSettlementId, reservation.SettlementId, StringComparison.Ordinal))
            {
                throw new ConflictException(
                    "Le règlement du paiement ne correspond pas à la réservation de réconciliation. " +
                    "Aucun montant n'a été appliqué.");
            }

            settlementId = transaction.BlockchainSettlementId
                ?? reservation.SettlementId
                ?? throw new ConflictException(
                    "La réservation de réconciliation existe sans identifiant de règlement exploitable. " +
                    "Aucun montant n'a été appliqué.");
            claimAt = transaction.ProviderAppliedAt ?? DateTime.UtcNow;
        }
        else
        {
            settlementId = transaction.BlockchainSettlementId ?? Guid.NewGuid().ToString("N");
            claimAt = transaction.ProviderAppliedAt ?? DateTime.UtcNow;

            var reserved = new PaymentAuditEntry
            {
                DedupeKey = exceptionKey,
                PaymentId = transaction.Id,
                PaymentReference = transaction.Reference,
                Action = "blockchain_cross_genesis_reconciled",
                Reason = reason,
                PreviousPaymentId = previous.Id,
                PreviousGenesisHash = previous.BlockchainGenesisHash,
                CurrentGenesisHash = currentNodeGenesis,
                CurrentGenesisTimestamp = currentGenesis.Timestamp,
                TxHash = hash,
                SettlementId = settlementId,
                CreatedAt = DateTime.UtcNow,
            };

            try
            {
                await PaymentAudits.InsertOneAsync(reserved, cancellationToken: cancellationToken);
            }
            catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
            {
                var winner = await PaymentAudits
                    .Find(a => a.DedupeKey == exceptionKey)
                    .FirstOrDefaultAsync(cancellationToken);
                if (winner == null || !string.Equals(winner.PaymentId, transaction.Id, StringComparison.Ordinal))
                {
                    throw new ConflictException(
                        "L'exception de réconciliation a déjà été utilisée pour un autre paiement. " +
                        "Aucun montant n'a été appliqué.");
                }

                settlementId = winner.SettlementId
                    ?? throw new ConflictException(
                        "La réservation de réconciliation existe sans identifiant de règlement exploitable. " +
                        "Aucun montant n'a été appliqué.");
                claimAt = transaction.ProviderAppliedAt ?? DateTime.UtcNow;
            }
        }

        if (!alreadyClaimed)
        {
            var claimNow = DateTime.UtcNow;
            try
            {
                var claim = await Payments.UpdateOneAsync(
                    t => t.Id == transaction.Id
                         && t.Status != PaymentTransactionStatus.Succeeded
                         && t.ProviderAppliedAt == null
                         && (t.BlockchainSettlementId == null || t.BlockchainSettlementId == settlementId),
                    Builders<PaymentTransaction>.Update
                        .Set(t => t.BlockchainTxHash, hash)
                        .Set(t => t.BlockchainGenesisHash, currentNodeGenesis)
                        .Set(t => t.BlockchainGenesisTimestamp, currentGenesis.Timestamp)
                        .Set(t => t.BlockchainSettlementId, settlementId)
                        .Set(t => t.BlockchainCrossGenesis, true)
                        .Set(t => t.BlockchainReplayOfPaymentId, previous.Id)
                        .Set(t => t.BlockchainReplayReason, reason)
                        .Set(t => t.WalletAddress, onChain.From)
                        .Set(t => t.BlockchainConfirmations, confirmations)
                        .Set(t => t.BlockchainVerifiedAt, claimNow)
                        .Set(t => t.ProviderAppliedAt, claimNow)
                        .Set(t => t.ProviderStatus, "confirmed")
                        .Set(t => t.Status, PaymentTransactionStatus.Processing)
                        .Set(t => t.ErrorCode, (string?)null)
                        .Set(t => t.ErrorMessage, (string?)null)
                        .Set(t => t.ProviderLastCheckedAt, claimNow)
                        .Set(t => t.UpdatedAt, claimNow),
                    cancellationToken: cancellationToken);

                if (claim.ModifiedCount == 0)
                {
                    var current = await FindAsync(transaction.Id, cancellationToken);
                    if (string.Equals(current.Status, PaymentTransactionStatus.Succeeded, StringComparison.Ordinal))
                    {
                        await EnsureBlockchainSuccessAuditAsync(current, cancellationToken);
                        await EnsureBlockchainNotificationsAsync(current, networkLabel, cancellationToken);
                        return ToResponse(current);
                    }
                    if (current.ProviderAppliedAt == null
                        || !string.Equals(current.BlockchainSettlementId, settlementId, StringComparison.Ordinal))
                    {
                        throw new ConflictException(
                            "Une autre opération a modifié ce paiement. Aucun montant n'a été appliqué.");
                    }
                }

                claimAt = claimNow;
            }
            catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
            {
                throw new ConflictException(
                    "Un autre paiement a déjà crédité ce transfert sur cette instance de chaîne. " +
                    "Aucun montant n'a été appliqué.");
            }
        }

        // Liaison du portefeuille (uniquement si le compte n'en a pas encore).
        if (client != null && string.IsNullOrWhiteSpace(client.WalletAddress))
        {
            await Users.UpdateOneAsync(
                u => u.Id == client.Id && u.WalletAddress == null,
                Builders<User>.Update.Set(u => u.WalletAddress, onChain.From),
                cancellationToken: cancellationToken);
        }

        var claimed = await FindAsync(transaction.Id, cancellationToken);
        claimed.ProviderStatus = "confirmed";
        claimed.ProviderAppliedAt ??= claimAt;
        claimed.ProviderLastCheckedAt = claimAt;
        claimed.Status = PaymentTransactionStatus.Processing;

        return ToResponse(await SettleBlockchainCreditAsync(
            claimed,
            settlementId,
            claimAt,
            networkLabel,
            hash,
            currentNodeGenesis,
            currentGenesis.Timestamp,
            cancellationToken));
    }

    /// <summary>
    /// Réconciliation appelée par le webhook Konnect (GET ?payment_ref=...).
    /// La référence reçue n'est jamais crue sur parole : l'état est relu via
    /// l'API officielle avant toute écriture financière.
    /// </summary>
    public async Task<bool> ReconcileByProviderRefAsync(
        string? paymentRef,
        CancellationToken cancellationToken)
    {
        var reference = paymentRef?.Trim();
        if (string.IsNullOrWhiteSpace(reference) || reference.Length > 200) return false;

        var transaction = await Payments
            .Find(t => t.ProviderPaymentRef == reference)
            .FirstOrDefaultAsync(cancellationToken);
        if (transaction == null) return false;

        EnsureGatewayConfigured();
        var details = await _konnect!.GetPaymentAsync(reference, cancellationToken);
        await ReconcileAsync(transaction, details, webhook: true, cancellationToken);
        return true;
    }

    private async Task<PaymentTransactionResponse> StartGatewayAsync(
        PaymentTransaction transaction,
        Invoice invoice,
        User client,
        CancellationToken cancellationToken)
    {
        if (_konnect == null || _konnectSettings == null || !_konnectSettings.IsConfigured)
        {
            const string message =
                "Le paiement par carte est indisponible : la passerelle Konnect Sandbox n'est pas configurée. " +
                "Aucun montant n'a été engagé.";
            await MarkGatewayFailureAsync(
                transaction,
                PaymentTransactionStatus.Failed,
                "gateway_not_configured",
                message,
                notify: false,
                force: false,
                cancellationToken);
            throw new PaymentGatewayException(message);
        }

        var amountMillimes = ToMillimes(transaction.Amount);
        var initRequest = new KonnectInitPaymentRequest
        {
            ReceiverWalletId = _konnectSettings.ReceiverWalletId,
            Token = "TND",
            Amount = amountMillimes,
            Type = "immediate",
            Description = $"Facture {invoice.Number} - {invoice.Project}".Trim(),
            AcceptedPaymentMethods = AcceptedGatewayMethods(transaction.Method),
            Lifespan = _konnectSettings.LifespanMinutes is > 0 ? _konnectSettings.LifespanMinutes : 15,
            CheckoutForm = true,
            AddPaymentFeesToAmount = false,
            FirstName = string.IsNullOrWhiteSpace(client.FirstName) ? null : client.FirstName.Trim(),
            LastName = string.IsNullOrWhiteSpace(client.LastName) ? null : client.LastName.Trim(),
            Email = string.IsNullOrWhiteSpace(client.Email) ? null : client.Email.Trim(),
            OrderId = transaction.Reference,
            Webhook = BuildWebhookUrl(_konnectSettings.AppBaseUrl),
            SuccessUrl = BuildReturnUrl(_konnectSettings.FrontendBaseUrl, transaction.Id, invoice.Id, "success"),
            FailUrl = BuildReturnUrl(_konnectSettings.FrontendBaseUrl, transaction.Id, invoice.Id, "fail"),
            Theme = string.Equals(_konnectSettings.Theme, "dark", StringComparison.OrdinalIgnoreCase) ? "dark" : "light",
        };

        try
        {
            var init = await _konnect.InitPaymentAsync(initRequest, cancellationToken);
            var now = DateTime.UtcNow;
            transaction.ProviderPaymentRef = init.PaymentRef;
            transaction.ProviderPayUrl = init.PayUrl;
            transaction.ProviderStatus = "initialized";
            transaction.ProviderAmountMillimes = amountMillimes;
            transaction.ProviderCurrency = "TND";
            transaction.ProviderLastCheckedAt = now;
            transaction.UpdatedAt = now;

            var saved = await Payments.ReplaceOneAsync(
                t => t.Id == transaction.Id && t.Status == PaymentTransactionStatus.Pending,
                transaction,
                cancellationToken: cancellationToken);
            if (saved.ModifiedCount == 0)
            {
                // La tentative a été annulée pendant l'appel Konnect : on ne
                // ressuscite pas la transaction, on renvoie son état courant.
                return ToResponse(await FindAsync(transaction.Id, cancellationToken));
            }
            return ToResponse(transaction);
        }
        catch (PaymentGatewayException exception)
        {
            await MarkGatewayFailureAsync(
                transaction,
                PaymentTransactionStatus.Failed,
                "gateway_unavailable",
                exception.Message,
                notify: false,
                force: false,
                cancellationToken);
            throw;
        }
    }

    private async Task<PaymentTransaction> ReconcileAsync(
        PaymentTransaction transaction,
        KonnectPaymentDetails details,
        bool webhook,
        CancellationToken cancellationToken)
    {
        var observedStatus = (details.Status ?? string.Empty).Trim().ToLowerInvariant();
        var now = DateTime.UtcNow;

        var observation = Builders<PaymentTransaction>.Update
            .Set(t => t.ProviderStatus, observedStatus)
            .Set(t => t.ProviderLastCheckedAt, now)
            .Set(t => t.UpdatedAt, now);
        if (webhook)
        {
            // Compteur d'observabilité : un webhook répété est enregistré, mais
            // ne produit jamais une seconde écriture financière.
            observation = observation.Inc(t => t.ProviderWebhookCount, 1);
        }
        await Payments.UpdateOneAsync(t => t.Id == transaction.Id, observation, cancellationToken: cancellationToken);

        var latest = await FindAsync(transaction.Id, cancellationToken);
        if (string.Equals(latest.Status, PaymentTransactionStatus.Succeeded, StringComparison.Ordinal))
        {
            return latest;
        }

        if (observedStatus == "completed")
        {
            var expectedMillimes = latest.ProviderAmountMillimes ?? ToMillimes(latest.Amount);
            var currency = (details.Token ?? latest.ProviderCurrency ?? "TND").Trim();
            if (!string.Equals(currency, "TND", StringComparison.OrdinalIgnoreCase))
            {
                return await MarkGatewayFailureAsync(
                    latest,
                    PaymentTransactionStatus.Failed,
                    "gateway_currency_mismatch",
                    "La devise renvoyée par la passerelle ne correspond pas à la facture. Aucun montant n'a été appliqué.",
                    notify: true,
                    force: false,
                    cancellationToken);
            }

            var amountMismatch =
                (details.Amount.HasValue && details.Amount.Value != expectedMillimes)
                || (details.ReachedAmount.HasValue && details.ReachedAmount.Value != expectedMillimes);
            var successTransaction = details.Transactions
                .FirstOrDefault(item => string.Equals(item.Status, "success", StringComparison.OrdinalIgnoreCase));
            if (successTransaction?.Amount is long successAmount && successAmount != expectedMillimes)
            {
                amountMismatch = true;
            }
            if (amountMismatch)
            {
                return await MarkGatewayFailureAsync(
                    latest,
                    PaymentTransactionStatus.Failed,
                    "gateway_amount_mismatch",
                    "Le montant confirmé par la passerelle ne correspond pas au montant de la transaction. Aucun montant n'a été appliqué.",
                    notify: true,
                    force: false,
                    cancellationToken);
            }
            if (successTransaction == null)
            {
                return await MarkGatewayFailureAsync(
                    latest,
                    PaymentTransactionStatus.Failed,
                    "gateway_no_success_transaction",
                    "La passerelle a signalé un paiement sans transaction réussie. Aucun montant n'a été appliqué.",
                    notify: true,
                    force: false,
                    cancellationToken);
            }

            return await ApplyGatewaySuccessAsync(latest, successTransaction, cancellationToken);
        }

        if (observedStatus is "expired" or "cancelled" or "canceled")
        {
            return await MarkGatewayFailureAsync(
                latest,
                PaymentTransactionStatus.Cancelled,
                "gateway_expired",
                "Le lien de paiement Konnect a expiré ou a été annulé. Aucun montant n'a été prélevé.",
                notify: true,
                force: false,
                cancellationToken);
        }
        if (observedStatus is "failed" or "error")
        {
            return await MarkGatewayFailureAsync(
                latest,
                PaymentTransactionStatus.Failed,
                "gateway_declined",
                "Le paiement a été refusé par la passerelle Konnect. Aucun montant n'a été appliqué.",
                notify: true,
                force: false,
                cancellationToken);
        }

        // pending : la passerelle n'a pas encore tranché. Aucune écriture
        // financière, la transaction reste en attente d'une vérification.
        return latest;
    }

    private async Task<PaymentTransaction> ApplyGatewaySuccessAsync(
        PaymentTransaction transaction,
        KonnectTransactionDetails successTransaction,
        CancellationToken cancellationToken)
    {
        var latest = await FindAsync(transaction.Id, cancellationToken);
        if (string.Equals(latest.Status, PaymentTransactionStatus.Succeeded, StringComparison.Ordinal))
        {
            return latest;
        }

        // Revendication unique : un seul webhook/vérification peut appliquer le
        // montant, même si plusieurs notifications arrivent simultanément.
        var claimAt = DateTime.UtcNow;
        var claim = await Payments.UpdateOneAsync(
            t => t.Id == latest.Id
                 && t.Status != PaymentTransactionStatus.Succeeded
                 && t.ProviderAppliedAt == null,
            Builders<PaymentTransaction>.Update
                .Set(t => t.ProviderAppliedAt, claimAt)
                .Set(t => t.ProviderStatus, "completed")
                .Set(t => t.ProviderTransactionRef, successTransaction.Id)
                .Set(t => t.ProviderLastCheckedAt, claimAt)
                .Set(t => t.Status, PaymentTransactionStatus.Processing)
                .Set(t => t.UpdatedAt, claimAt),
            cancellationToken: cancellationToken);
        if (claim.ModifiedCount == 0)
        {
            return await FindAsync(latest.Id, cancellationToken);
        }

        var claimed = await FindAsync(latest.Id, cancellationToken);
        return await CompleteSuccessAsync(
            claimed,
            claimAt,
            $"carte bancaire Konnect Sandbox, réf. {claimed.Reference}",
            "La passerelle",
            "gateway_paid_balance_conflict",
            cancellationToken);
    }

    /// <summary>
    /// Applique un paiement dont la revendication exclusive a déjà été posée
    /// (<c>ProviderAppliedAt = claimAt</c>). Le solde n'est débité qu'une fois,
    /// le reçu et les notifications sont émis ici. Partagé par Konnect et par
    /// la vérification blockchain afin que les deux parcours suivent exactement
    /// les mêmes règles financières.
    /// </summary>
    private async Task<PaymentTransaction> CompleteSuccessAsync(
        PaymentTransaction claimed,
        DateTime claimAt,
        string paymentLabel,
        string sourceLabel,
        string balanceConflictCode,
        CancellationToken cancellationToken)
    {
        var latest = await FindAsync(claimed.Id, cancellationToken);
        if (string.Equals(latest.Status, PaymentTransactionStatus.Succeeded, StringComparison.Ordinal))
        {
            return latest;
        }

        var invoice = await FindInvoiceAsync(latest.InvoiceId, cancellationToken);

        if (invoice.BalanceDue <= 0.0005m
            || string.Equals(invoice.Status, InvoiceStatus.Paid, StringComparison.Ordinal)
            || latest.Amount > invoice.BalanceDue + 0.0005m)
        {
            return await MarkGatewayFailureAsync(
                latest,
                PaymentTransactionStatus.Failed,
                balanceConflictCode,
                $"{sourceLabel} a accepté le paiement mais le solde de la facture a changé entre-temps. " +
                "Aucun montant supplémentaire n'a été appliqué.",
                notify: true,
                force: true,
                cancellationToken);
        }

        var invoiceFilter = Builders<Invoice>.Filter.And(
            Builders<Invoice>.Filter.Eq(i => i.Id, invoice.Id),
            Builders<Invoice>.Filter.Gte(i => i.BalanceDue, latest.Amount),
            Builders<Invoice>.Filter.Ne(i => i.Status, InvoiceStatus.Paid),
            Builders<Invoice>.Filter.Ne(i => i.Status, InvoiceStatus.Draft));

        var applied = await Invoices.UpdateOneAsync(
            invoiceFilter,
            Builders<Invoice>.Update
                .Inc(i => i.AmountPaid, latest.Amount)
                .Inc(i => i.BalanceDue, -latest.Amount),
            cancellationToken: cancellationToken);
        if (applied.ModifiedCount == 0)
        {
            return await MarkGatewayFailureAsync(
                latest,
                PaymentTransactionStatus.Failed,
                balanceConflictCode,
                $"{sourceLabel} a accepté le paiement mais le solde de la facture a changé entre-temps. " +
                "Aucun montant supplémentaire n'a été appliqué.",
                notify: true,
                force: true,
                cancellationToken);
        }

        await RecomputeInvoiceStatusAsync(invoice.Id, cancellationToken);
        var updatedInvoice = await Invoices.Find(i => i.Id == invoice.Id).FirstOrDefaultAsync(cancellationToken)
            ?? invoice;

        var receiptNumber = await GenerateReceiptNumberAsync(cancellationToken);
        var completedAt = DateTime.UtcNow;
        var successAttempt = latest.Attempts.LastOrDefault();
        if (successAttempt != null)
        {
            successAttempt.Status = PaymentAttemptStatus.Succeeded;
            successAttempt.CompletedAt = completedAt;
        }

        latest.Status = PaymentTransactionStatus.Succeeded;
        latest.BalanceBefore = invoice.BalanceDue;
        latest.BalanceAfter = updatedInvoice.BalanceDue;
        latest.InvoiceTotal = updatedInvoice.Total;
        latest.ReceiptNumber = receiptNumber;
        latest.ErrorCode = null;
        latest.ErrorMessage = null;
        latest.CompletedAt = completedAt;
        latest.UpdatedAt = completedAt;
        latest.ProviderStatus = "completed";
        latest.ProviderLastCheckedAt = completedAt;
        latest.ProviderAppliedAt = claimAt;

        await Payments.ReplaceOneAsync(
            t => t.Id == latest.Id && t.ProviderAppliedAt == claimAt,
            latest,
            cancellationToken: cancellationToken);

        var paidLabel = updatedInvoice.BalanceDue <= 0.0005m ? "Facture réglée" : "Paiement reçu";
        await NotifyAsync(
            latest.FreelancerId,
            "invoice_billing",
            paidLabel,
            $"{FormatAmount(latest.Amount)} reçus pour la facture {latest.InvoiceNumber} ({paymentLabel}). Solde restant : {FormatAmount(updatedInvoice.BalanceDue)}.",
            latest,
            cancellationToken);
        await NotifyAsync(
            latest.ClientId,
            "invoice_billing",
            updatedInvoice.BalanceDue <= 0.0005m ? "Facture réglée" : "Paiement enregistré",
            $"Votre paiement de {FormatAmount(latest.Amount)} pour la facture {latest.InvoiceNumber} a été confirmé ({paymentLabel}). Reçu {receiptNumber}. Solde restant : {FormatAmount(updatedInvoice.BalanceDue)}.",
            latest,
            cancellationToken);

        return latest;
    }

    // ---------------------------------------------------------------------
    // Règlement blockchain : reprise durable et idempotente
    // ---------------------------------------------------------------------

    /// <summary>Résultat de l'analyse anti-rejeu d'un hash blockchain.</summary>
    private sealed record BlockchainReplayCheck(
        PaymentTransaction? Duplicate,
        string? ReasonCode,
        PaymentTransaction? CrossGenesis);

    /// <summary>
    /// Analyse les paiements antérieurs portant le même hash normalisé.
    ///
    /// Règles strictes :
    /// - même Genesis → doublon certain, refus ;
    /// - paiement antérieur sans Genesis → impossible de prouver qu'il s'agit
    ///   d'un autre transfert, refus (jamais de crédit sur simple timestamp) ;
    /// - Genesis antérieur connu et différent → transfert distinct possible,
    ///   mais uniquement après tous les contrôles on-chain déjà effectués.
    /// </summary>
    private async Task<BlockchainReplayCheck> FindBlockchainReplayAsync(
        string paymentId,
        string hash,
        string currentGenesisHash,
        long currentGenesisTimestamp,
        CancellationToken cancellationToken)
    {
        // Comparaison insensible à la casse : avant la migration de
        // normalisation, un document historique peut encore porter un hash en
        // majuscules. Le hash reçu est déjà validé hexadécimal, donc le motif
        // ne contient aucun métacaractère.
        var hashPattern = new BsonRegularExpression($"^{hash}$", "i");
        var candidates = await Payments
            .Find(Builders<PaymentTransaction>.Filter.And(
                Builders<PaymentTransaction>.Filter.Ne(t => t.Id, paymentId),
                Builders<PaymentTransaction>.Filter.Regex(t => t.BlockchainTxHash, hashPattern)))
            .ToListAsync(cancellationToken);
        if (candidates.Count == 0)
        {
            return new BlockchainReplayCheck(null, null, null);
        }

        var sameGenesis = candidates.FirstOrDefault(t =>
            string.Equals(
                BlockchainSettings.NormalizeTxHash(t.BlockchainGenesisHash),
                currentGenesisHash,
                StringComparison.Ordinal));
        if (sameGenesis != null)
        {
            return new BlockchainReplayCheck(sameGenesis, "same_genesis", null);
        }

        var unknownGenesis = candidates.FirstOrDefault(t =>
            !BlockchainSettings.IsValidGenesisHash(t.BlockchainGenesisHash));
        if (unknownGenesis != null)
        {
            return new BlockchainReplayCheck(unknownGenesis, "previous_genesis_unknown", null);
        }

        var crossGenesis = candidates
            .OrderByDescending(t => t.CreatedAt)
            .First();

        // Garde supplémentaire : l'instance courante doit être postérieure au
        // paiement antérieur. Ce n'est jamais une preuve à elle seule ; elle
        // écarte une incohérence temporelle manifeste.
        var genesisTime = DateTimeOffset
            .FromUnixTimeSeconds(currentGenesisTimestamp)
            .UtcDateTime;
        if (genesisTime <= crossGenesis.CreatedAt)
        {
            return new BlockchainReplayCheck(crossGenesis, "genesis_not_newer", null);
        }

        return new BlockchainReplayCheck(null, null, crossGenesis);
    }

    /// <summary>
    /// Refuse définitivement un hash déjà utilisé et clôt le paiement courant
    /// en « failed » : l'interface cesse de boucler sur « Vérifier » et peut
    /// proposer un nouveau paiement. Aucun montant n'est appliqué.
    /// </summary>
    private async Task<PaymentTransaction> MarkBlockchainDuplicateAsync(
        PaymentTransaction transaction,
        PaymentTransaction? previous,
        string currentGenesisHash,
        string reasonCode,
        CancellationToken cancellationToken)
    {
        var latest = await FindAsync(transaction.Id, cancellationToken);
        if (string.Equals(latest.Status, PaymentTransactionStatus.Succeeded, StringComparison.Ordinal))
        {
            return latest;
        }

        var (errorCode, message) = reasonCode switch
        {
            "same_genesis" => (
                "blockchain_tx_already_credited",
                "Cette transaction blockchain a déjà été créditée sur cette instance de chaîne. " +
                "Aucun montant n'a été appliqué."),
            "previous_genesis_unknown" => (
                "blockchain_tx_previous_genesis_unknown",
                "Ce hash est déjà associé à un paiement antérieur dont l'empreinte Genesis est inconnue. " +
                "Aucun montant n'a été appliqué : un rapprochement explicite est nécessaire."),
            "genesis_not_newer" => (
                "blockchain_tx_genesis_inconsistent",
                "Ce hash est déjà associé à un paiement antérieur et l'instance courante n'est pas " +
                "postérieure à ce paiement. Aucun montant n'a été appliqué."),
            _ => (
                "blockchain_tx_already_used",
                "Cette transaction blockchain est déjà associée à un autre paiement. " +
                "Aucun montant n'a été appliqué."),
        };

        var now = DateTime.UtcNow;
        var attempt = latest.Attempts.LastOrDefault();
        if (attempt != null)
        {
            attempt.Status = PaymentAttemptStatus.Failed;
            attempt.ErrorCode = errorCode;
            attempt.ErrorMessage = message;
            attempt.CompletedAt = now;
        }

        latest.Status = PaymentTransactionStatus.Failed;
        latest.ErrorCode = errorCode;
        latest.ErrorMessage = message;
        latest.ProviderStatus = "duplicate";
        latest.ProviderLastCheckedAt = now;
        latest.BlockchainReplayOfPaymentId = previous?.Id;
        latest.BlockchainReplayReason = message;
        latest.CompletedAt = now;
        latest.UpdatedAt = now;

        var replaced = await Payments.ReplaceOneAsync(
            t => t.Id == latest.Id
                 && t.Status != PaymentTransactionStatus.Succeeded
                 && t.ProviderAppliedAt == null,
            latest,
            cancellationToken: cancellationToken);
        if (replaced.ModifiedCount == 0)
        {
            return await FindAsync(latest.Id, cancellationToken);
        }

        await InsertBlockchainAuditAsync(
            latest,
            "blockchain_duplicate_hash",
            message,
            currentGenesisHash,
            null,
            cancellationToken);

        await NotifyBothAsync(
            latest,
            "Paiement non appliqué",
            $"La transaction {latest.Reference} de {FormatAmount(latest.Amount)} pour la facture " +
            $"{latest.InvoiceNumber} n'a pas été appliquée : ce transfert est déjà rattaché à un autre " +
            "paiement. Le solde de la facture reste inchangé.",
            cancellationToken);

        return latest;
    }

    /// <summary>
    /// Applique le crédit d'un transfert blockchain avec reprise durable.
    ///
    /// L'environnement MongoDB de développement est un serveur autonome (pas de
    /// replica set) : aucune transaction multi-documents n'est disponible. La
    /// reprise repose donc sur des opérations idempotentes et ordonnées :
    /// 1. le crédit de la facture pousse l'identifiant du paiement dans
    ///    <c>invoices.payments</c> ; le filtre interdit un second passage ;
    /// 2. le reçu et l'état « succeeded » sont posés avec le même identifiant
    ///    de règlement stable ;
    /// 3. l'audit et les notifications sont idempotents.
    /// Une interruption à n'importe quelle étape est reprise sans recréditer.
    /// </summary>
    private async Task<PaymentTransaction> SettleBlockchainCreditAsync(
        PaymentTransaction claimed,
        string settlementId,
        DateTime claimAt,
        string networkLabel,
        string hash,
        string genesisHash,
        long genesisTimestamp,
        CancellationToken cancellationToken)
    {
        var latest = await FindAsync(claimed.Id, cancellationToken);

        // Une exécution précédente a déjà finalisé le paiement : ne réappliquer
        // aucun crédit, mais garantir l'audit et les notifications manquants.
        if (string.Equals(latest.Status, PaymentTransactionStatus.Succeeded, StringComparison.Ordinal))
        {
            await EnsureBlockchainSuccessAuditAsync(latest, cancellationToken);
            await EnsureBlockchainNotificationsAsync(latest, networkLabel, cancellationToken);
            return latest;
        }

        var invoice = await FindInvoiceAsync(latest.InvoiceId, cancellationToken);
        var alreadyRecorded = invoice.Payments.Any(p =>
            string.Equals(p.TransactionId, latest.Id, StringComparison.Ordinal));

        if (!alreadyRecorded)
        {
            if (invoice.BalanceDue <= 0.0005m
                || string.Equals(invoice.Status, InvoiceStatus.Paid, StringComparison.Ordinal)
                || latest.Amount > invoice.BalanceDue + 0.0005m)
            {
                return await RejectBlockchainCreditAsync(
                    latest,
                    genesisHash,
                    "blockchain_paid_balance_conflict",
                    $"La blockchain {networkLabel} a accepté le paiement mais le solde de la facture " +
                    "a changé entre-temps. Aucun montant supplémentaire n'a été appliqué.",
                    cancellationToken);
            }

            var creditAt = DateTime.UtcNow;
            var entry = new InvoicePayment
            {
                Amount = latest.Amount,
                Date = creditAt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                Reference = latest.Reference,
                Status = InvoicePaymentStatus.Completed,
                Method = latest.Method,
                TransactionId = latest.Id,
                IdempotencyKey = latest.IdempotencyKey,
                CreatedAt = creditAt,
            };

            var invoiceFilter = Builders<Invoice>.Filter.And(
                Builders<Invoice>.Filter.Eq(i => i.Id, invoice.Id),
                Builders<Invoice>.Filter.Gte(i => i.BalanceDue, latest.Amount),
                Builders<Invoice>.Filter.Ne(i => i.Status, InvoiceStatus.Paid),
                Builders<Invoice>.Filter.Ne(i => i.Status, InvoiceStatus.Draft),
                // Un paiement ne peut être enregistré qu'une fois : c'est cette
                // condition qui rend la reprise sûre, même sans transaction.
                Builders<Invoice>.Filter.Not(
                    Builders<Invoice>.Filter.ElemMatch(
                        i => i.Payments,
                        p => p.TransactionId == latest.Id)));

            var applied = await Invoices.UpdateOneAsync(
                invoiceFilter,
                Builders<Invoice>.Update
                    .Inc(i => i.AmountPaid, latest.Amount)
                    .Inc(i => i.BalanceDue, -latest.Amount)
                    .Push(i => i.Payments, entry)
                    .Set(i => i.UpdatedAt, creditAt),
                cancellationToken: cancellationToken);

            if (applied.ModifiedCount == 0)
            {
                var reloaded = await FindInvoiceAsync(latest.InvoiceId, cancellationToken);
                var recordedMeanwhile = reloaded.Payments.Any(p =>
                    string.Equals(p.TransactionId, latest.Id, StringComparison.Ordinal));
                if (!recordedMeanwhile)
                {
                    return await RejectBlockchainCreditAsync(
                        latest,
                        genesisHash,
                        "blockchain_paid_balance_conflict",
                        $"La blockchain {networkLabel} a accepté le paiement mais le solde de la facture " +
                        "a changé entre-temps. Aucun montant supplémentaire n'a été appliqué.",
                        cancellationToken);
                }
            }
        }

        // Marqueur durable : la facture est créditée pour ce règlement.
        var markedAt = DateTime.UtcNow;
        await Payments.UpdateOneAsync(
            t => t.Id == latest.Id
                 && t.BlockchainSettlementId == settlementId
                 && t.BlockchainCreditAppliedAt == null,
            Builders<PaymentTransaction>.Update
                .Set(t => t.BlockchainCreditAppliedAt, markedAt)
                .Set(t => t.UpdatedAt, markedAt),
            cancellationToken: cancellationToken);

        await RecomputeInvoiceStatusAsync(invoice.Id, cancellationToken);
        var updatedInvoice = await FindInvoiceAsync(invoice.Id, cancellationToken);

        latest = await FindAsync(latest.Id, cancellationToken);

        // Reçu : réservé une seule fois, réutilisé lors d'une reprise.
        var receiptNumber = latest.ReceiptNumber;
        if (string.IsNullOrWhiteSpace(receiptNumber))
        {
            receiptNumber = await GenerateReceiptNumberAsync(cancellationToken);
            var reserved = await Payments.UpdateOneAsync(
                t => t.Id == latest.Id
                     && t.BlockchainSettlementId == settlementId
                     && t.ReceiptNumber == null,
                Builders<PaymentTransaction>.Update
                    .Set(t => t.ReceiptNumber, receiptNumber)
                    .Set(t => t.UpdatedAt, DateTime.UtcNow),
                cancellationToken: cancellationToken);
            if (reserved.ModifiedCount == 0)
            {
                latest = await FindAsync(latest.Id, cancellationToken);
                receiptNumber = latest.ReceiptNumber ?? receiptNumber;
            }
        }

        var completedAt = DateTime.UtcNow;
        var successAttempt = latest.Attempts.LastOrDefault();
        if (successAttempt != null)
        {
            successAttempt.Status = PaymentAttemptStatus.Succeeded;
            successAttempt.CompletedAt = completedAt;
        }

        latest.Status = PaymentTransactionStatus.Succeeded;
        latest.BalanceAfter = updatedInvoice.BalanceDue;
        latest.InvoiceTotal = updatedInvoice.Total;
        latest.ReceiptNumber = receiptNumber;
        latest.ErrorCode = null;
        latest.ErrorMessage = null;
        latest.CompletedAt = completedAt;
        latest.UpdatedAt = completedAt;
        latest.ProviderStatus = "completed";
        latest.ProviderLastCheckedAt = completedAt;
        latest.ProviderAppliedAt ??= claimAt;
        latest.BlockchainTxHash = hash;
        latest.BlockchainGenesisHash = genesisHash;
        latest.BlockchainGenesisTimestamp = genesisTimestamp;

        var finalized = await Payments.ReplaceOneAsync(
            t => t.Id == latest.Id
                 && t.BlockchainSettlementId == settlementId
                 && t.Status != PaymentTransactionStatus.Succeeded,
            latest,
            cancellationToken: cancellationToken);
        if (finalized.ModifiedCount == 0)
        {
            var current = await FindAsync(latest.Id, cancellationToken);
            if (!string.Equals(current.Status, PaymentTransactionStatus.Succeeded, StringComparison.Ordinal))
            {
                throw new ConflictException(
                    "Le paiement blockchain n'a pas pu être finalisé : un autre règlement a modifié " +
                    "la transaction. Aucun montant supplémentaire n'a été appliqué.");
            }
            latest = current;
        }

        await EnsureBlockchainSuccessAuditAsync(latest, cancellationToken);
        await EnsureBlockchainNotificationsAsync(latest, networkLabel, cancellationToken);
        return latest;
    }

    private async Task<PaymentTransaction> RejectBlockchainCreditAsync(
        PaymentTransaction payment,
        string genesisHash,
        string errorCode,
        string message,
        CancellationToken cancellationToken)
    {
        await InsertBlockchainAuditAsync(
            payment,
            "blockchain_credit_rejected",
            message,
            genesisHash,
            null,
            cancellationToken);

        return await MarkGatewayFailureAsync(
            payment,
            PaymentTransactionStatus.Failed,
            errorCode,
            message,
            notify: true,
            force: true,
            cancellationToken);
    }

    /// <summary>Journalise le crédit réussi une seule fois par règlement.</summary>
    private async Task EnsureBlockchainSuccessAuditAsync(
        PaymentTransaction payment,
        CancellationToken cancellationToken)
    {
        var reason = payment.BlockchainCrossGenesis
            ? payment.BlockchainReplayReason
              ?? "Même hash crédité sur une instance de chaîne différente, après contrôle on-chain complet."
            : "Transfert vérifié sur l'instance de chaîne enregistrée à la création de l'intention.";

        await InsertBlockchainAuditAsync(
            payment,
            "blockchain_credit_applied",
            reason,
            payment.BlockchainGenesisHash,
            payment.BlockchainGenesisTimestamp,
            cancellationToken);
    }

    /// <summary>
    /// Écrit une entrée d'audit idempotente. La clé de dédoublonnage inclut
    /// l'identifiant de règlement : une reprise ne crée pas de doublon.
    /// </summary>
    private async Task InsertBlockchainAuditAsync(
        PaymentTransaction payment,
        string action,
        string reason,
        string? currentGenesisHash,
        long? currentGenesisTimestamp,
        CancellationToken cancellationToken)
    {
        string? previousGenesis = null;
        if (!string.IsNullOrWhiteSpace(payment.BlockchainReplayOfPaymentId))
        {
            var previous = await Payments
                .Find(t => t.Id == payment.BlockchainReplayOfPaymentId)
                .FirstOrDefaultAsync(cancellationToken);
            previousGenesis = previous?.BlockchainGenesisHash;
        }

        var dedupeKey = $"{action}:{payment.Id}:{payment.BlockchainSettlementId ?? "none"}";

        // Idempotence sans dépendre de l'index : un environnement dont
        // l'index unique n'est pas encore créé (migration en cours, base de
        // test) ne doit jamais accumuler deux fois le même événement. L'index
        // unique reste la garantie atomique en production.
        var alreadyJournaled = await PaymentAudits
            .Find(a => a.DedupeKey == dedupeKey)
            .AnyAsync(cancellationToken);
        if (alreadyJournaled) return;

        var entry = new PaymentAuditEntry
        {
            DedupeKey = dedupeKey,
            PaymentId = payment.Id,
            PaymentReference = payment.Reference,
            Action = action,
            Reason = reason,
            PreviousPaymentId = payment.BlockchainReplayOfPaymentId,
            PreviousGenesisHash = previousGenesis,
            CurrentGenesisHash = currentGenesisHash,
            CurrentGenesisTimestamp = currentGenesisTimestamp,
            TxHash = payment.BlockchainTxHash,
            SettlementId = payment.BlockchainSettlementId,
            CreatedAt = DateTime.UtcNow,
        };

        try
        {
            await PaymentAudits.InsertOneAsync(entry, cancellationToken: cancellationToken);
        }
        catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            // Événement déjà journalisé par une tentative précédente.
        }
    }

    /// <summary>Émet les notifications de succès une seule fois par paiement.</summary>
    private async Task EnsureBlockchainNotificationsAsync(
        PaymentTransaction payment,
        string networkLabel,
        CancellationToken cancellationToken)
    {
        if (payment.BlockchainNotificationsSentAt != null) return;

        var balanceDue = payment.BalanceAfter ?? 0m;
        var paidLabel = balanceDue <= 0.0005m ? "Facture réglée" : "Paiement reçu";
        var paymentLabel = $"MetaMask {networkLabel}, tx {payment.BlockchainTxHash}";

        await NotifyAsync(
            payment.FreelancerId,
            "invoice_billing",
            paidLabel,
            $"{FormatAmount(payment.Amount)} reçus pour la facture {payment.InvoiceNumber} " +
            $"({paymentLabel}). Solde restant : {FormatAmount(balanceDue)}.",
            payment,
            cancellationToken);
        await NotifyAsync(
            payment.ClientId,
            "invoice_billing",
            balanceDue <= 0.0005m ? "Facture réglée" : "Paiement enregistré",
            $"Votre paiement de {FormatAmount(payment.Amount)} pour la facture {payment.InvoiceNumber} " +
            $"a été confirmé ({paymentLabel}). Reçu {payment.ReceiptNumber}. " +
            $"Solde restant : {FormatAmount(balanceDue)}.",
            payment,
            cancellationToken);

        var sentAt = DateTime.UtcNow;
        await Payments.UpdateOneAsync(
            t => t.Id == payment.Id && t.BlockchainNotificationsSentAt == null,
            Builders<PaymentTransaction>.Update
                .Set(t => t.BlockchainNotificationsSentAt, sentAt)
                .Set(t => t.UpdatedAt, sentAt),
            cancellationToken: cancellationToken);
    }

    private static string BuildCrossGenesisReason(
        PaymentTransaction previous,
        string currentGenesisHash,
        long currentGenesisTimestamp) =>
        $"Hash identique observé sur deux instances de chaîne distinctes : " +
        $"paiement antérieur {previous.Reference} (Genesis antérieur différent), " +
        $"instance courante {currentGenesisHash} " +
        $"(Genesis {DateTimeOffset.FromUnixTimeSeconds(currentGenesisTimestamp).UtcDateTime:O}). " +
        "Tous les contrôles on-chain (réseau, destinataire, montant exact, reçu, confirmations, " +
        "portefeuille lié) ont été validés sur l'instance courante avant le crédit.";

    private async Task<PaymentTransaction> MarkGatewayFailureAsync(
        PaymentTransaction transaction,
        string targetStatus,
        string errorCode,
        string errorMessage,
        bool notify,
        bool force,
        CancellationToken cancellationToken)
    {
        var latest = await FindAsync(transaction.Id, cancellationToken);
        if (string.Equals(latest.Status, PaymentTransactionStatus.Succeeded, StringComparison.Ordinal))
        {
            return latest;
        }

        // Un échec déjà enregistré n'est jamais rejoué : webhook répété ou
        // vérification multiple restent sans effet (et sans notification).
        if (PaymentTransactionStatus.IsTerminal(latest.Status))
        {
            return latest;
        }

        var now = DateTime.UtcNow;
        var attempt = latest.Attempts.LastOrDefault();
        if (attempt != null)
        {
            attempt.Status = string.Equals(targetStatus, PaymentTransactionStatus.Cancelled, StringComparison.Ordinal)
                ? PaymentAttemptStatus.Cancelled
                : PaymentAttemptStatus.Failed;
            attempt.ErrorCode = errorCode;
            attempt.ErrorMessage = errorMessage;
            attempt.CompletedAt = now;
        }
        latest.Status = targetStatus;
        latest.ErrorCode = errorCode;
        latest.ErrorMessage = errorMessage;
        latest.CompletedAt = now;
        latest.UpdatedAt = now;

        var filter = force
            ? Builders<PaymentTransaction>.Filter.And(
                Builders<PaymentTransaction>.Filter.Eq(t => t.Id, latest.Id),
                Builders<PaymentTransaction>.Filter.Ne(t => t.Status, PaymentTransactionStatus.Succeeded))
            : Builders<PaymentTransaction>.Filter.And(
                Builders<PaymentTransaction>.Filter.Eq(t => t.Id, latest.Id),
                Builders<PaymentTransaction>.Filter.Ne(t => t.Status, PaymentTransactionStatus.Succeeded),
                Builders<PaymentTransaction>.Filter.Eq(t => t.ProviderAppliedAt, null));

        var replaced = await Payments.ReplaceOneAsync(filter, latest, cancellationToken: cancellationToken);
        if (replaced.ModifiedCount == 0)
        {
            return await FindAsync(latest.Id, cancellationToken);
        }

        if (notify)
        {
            await NotifyBothAsync(
                latest,
                string.Equals(targetStatus, PaymentTransactionStatus.Cancelled, StringComparison.Ordinal)
                    ? "Paiement annulé"
                    : "Paiement échoué",
                $"La transaction {latest.Reference} de {FormatAmount(latest.Amount)} pour la facture {latest.InvoiceNumber} " +
                "n'a pas abouti. Le solde de la facture reste inchangé.",
                cancellationToken);
        }

        return latest;
    }

    private async Task<PaymentTransaction?> FindReusableGatewayTransactionAsync(
        string userId,
        string invoiceId,
        CancellationToken cancellationToken)
    {
        var lifespan = _konnectSettings?.LifespanMinutes is > 0 ? _konnectSettings!.LifespanMinutes : 15;
        var notBefore = DateTime.UtcNow.AddMinutes(-(lifespan + 5));

        var filter = Builders<PaymentTransaction>.Filter.And(
            Builders<PaymentTransaction>.Filter.Eq(t => t.InvoiceId, invoiceId),
            Builders<PaymentTransaction>.Filter.Eq(t => t.ClientId, userId),
            Builders<PaymentTransaction>.Filter.Eq(t => t.Provider, PaymentProvider.Konnect),
            Builders<PaymentTransaction>.Filter.Or(
                Builders<PaymentTransaction>.Filter.Eq(t => t.Status, PaymentTransactionStatus.Pending),
                Builders<PaymentTransaction>.Filter.Eq(t => t.Status, PaymentTransactionStatus.Processing)),
            Builders<PaymentTransaction>.Filter.Ne(t => t.ProviderPayUrl, null),
            Builders<PaymentTransaction>.Filter.Gte(t => t.CreatedAt, notBefore));

        return await Payments
            .Find(filter)
            .SortByDescending(t => t.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);
    }

    /// <summary>
    /// Réutilise une intention MetaMask encore en attente pour la même facture,
    /// le même montant et la même instance de chaîne : le destinataire et le
    /// montant en wei sont figés, il ne faut donc pas en créer une seconde.
    /// Une intention sans hash est reprise elle aussi : aucun transfert n'a
    /// encore été envoyé, la réutiliser évite les doublons.
    /// </summary>
    private async Task<PaymentTransaction?> FindReusableBlockchainTransactionAsync(
        string userId,
        string invoiceId,
        decimal amount,
        string genesisHash,
        CancellationToken cancellationToken)
    {
        var notBefore = DateTime.UtcNow.AddMinutes(-30);
        var normalizedGenesis = BlockchainSettings.NormalizeTxHash(genesisHash);

        var filter = Builders<PaymentTransaction>.Filter.And(
            Builders<PaymentTransaction>.Filter.Eq(t => t.InvoiceId, invoiceId),
            Builders<PaymentTransaction>.Filter.Eq(t => t.ClientId, userId),
            Builders<PaymentTransaction>.Filter.Eq(t => t.Provider, PaymentProvider.Blockchain),
            Builders<PaymentTransaction>.Filter.Eq(t => t.Status, PaymentTransactionStatus.Pending),
            Builders<PaymentTransaction>.Filter.Eq(t => t.Amount, amount),
            Builders<PaymentTransaction>.Filter.Eq(t => t.BlockchainGenesisHash, normalizedGenesis),
            Builders<PaymentTransaction>.Filter.Ne(t => t.BlockchainAmountWei, null),
            Builders<PaymentTransaction>.Filter.Gte(t => t.CreatedAt, notBefore));

        return await Payments
            .Find(filter)
            .SortByDescending(t => t.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);
    }

    /// <summary>
    /// Enregistre une observation on-chain (transaction introuvable, en attente,
    /// en confirmation) sans toucher au statut financier ni créditer quoi que
    /// ce soit.
    /// </summary>
    private async Task TouchBlockchainObservationAsync(
        PaymentTransaction transaction,
        string providerStatus,
        int? confirmations,
        string? txHash,
        string? walletAddress,
        CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var update = Builders<PaymentTransaction>.Update
            .Set(t => t.ProviderStatus, providerStatus)
            .Set(t => t.ProviderLastCheckedAt, now)
            .Set(t => t.UpdatedAt, now);
        if (confirmations.HasValue)
        {
            update = update.Set(t => t.BlockchainConfirmations, confirmations.Value);
        }
        if (!string.IsNullOrWhiteSpace(txHash))
        {
            // La transaction existe et a déjà été contrôlée (destinataire et
            // montant) : associer le hash permet de revérifier les
            // confirmations et bloque son rejeu sur une autre facture.
            update = update
                .Set(t => t.BlockchainTxHash, txHash)
                .Set(t => t.WalletAddress, walletAddress);
        }

        await Payments.UpdateOneAsync(
            t => t.Id == transaction.Id && t.Status != PaymentTransactionStatus.Succeeded,
            update,
            cancellationToken: cancellationToken);
    }

    /// <summary>Compare deux quantités de wei (hexadécimal RPC et décimale stockée).</summary>
    private static bool WeiEquals(string? hexValue, string? decimalExpected) =>
        ParseHexBigInteger(hexValue) == ParseDecimalBigInteger(decimalExpected);

    private static BigInteger ParseHexBigInteger(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return BigInteger.Zero;
        }

        var hex = value.Trim();
        if (hex.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
        {
            hex = hex[2..];
        }

        if (hex.Length == 0)
        {
            return BigInteger.Zero;
        }

        // Les zéros de tête sont équivalents ; BigInteger exige un format valide.
        hex = hex.TrimStart('0');
        if (hex.Length == 0)
        {
            return BigInteger.Zero;
        }

        return BigInteger.Parse("0" + hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture);
    }

    private static BigInteger ParseDecimalBigInteger(string? value) =>
        BigInteger.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : BigInteger.Zero;

    private void EnsureGatewayConfigured()
    {
        if (_konnect == null || _konnectSettings?.IsConfigured != true)
        {
            throw new PaymentGatewayException(
                "La passerelle Konnect Sandbox n'est pas configurée. Le paiement ne peut pas être vérifié pour le moment.");
        }
    }

    private static string ResolveProvider(string? provider, string method)
    {
        var value = (provider ?? string.Empty).Trim().ToLowerInvariant();

        // MetaMask impose la blockchain côté serveur : un client ne peut pas
        // demander un traitement interne pour un paiement MetaMask.
        if (string.Equals(method, PaymentMethod.MetaMask, StringComparison.Ordinal))
        {
            if (value.Length > 0
                && value != PaymentProvider.Blockchain
                && value != PaymentProvider.Internal)
            {
                throw new BadRequestException(
                    "Le paiement MetaMask relève exclusivement de la blockchain (Sepolia ou Hardhat local).");
            }
            return PaymentProvider.Blockchain;
        }

        if (value == PaymentProvider.Blockchain)
        {
            throw new BadRequestException(
                "Le provider « blockchain » est réservé au moyen de paiement MetaMask.");
        }

        if (value.Length == 0 || value == PaymentProvider.Internal) return PaymentProvider.Internal;
        if (value == PaymentProvider.Konnect) return PaymentProvider.Konnect;
        throw new BadRequestException(
            "Passerelle de paiement inconnue. Valeurs acceptées : internal, konnect, blockchain.");
    }

    private static string[] AcceptedGatewayMethods(string? method) =>
        PaymentMethod.Normalize(method) == PaymentMethod.Wallet
            ? ["wallet"]
            : ["bank_card"];

    private static long ToMillimes(decimal amount) =>
        (long)decimal.Round(amount * 1000m, 0, MidpointRounding.AwayFromZero);

    private static string? BuildReturnUrl(
        string? frontendBaseUrl,
        string transactionId,
        string invoiceId,
        string gatewayResult)
    {
        if (string.IsNullOrWhiteSpace(frontendBaseUrl)) return null;
        if (!Uri.TryCreate(frontendBaseUrl.Trim().TrimEnd('/'), UriKind.Absolute, out var baseUri)) return null;
        return $"{baseUri.ToString().TrimEnd('/')}/client/quotes" +
               $"?tab=invoices&payment={Uri.EscapeDataString(transactionId)}" +
               $"&id={Uri.EscapeDataString(invoiceId)}&gateway_result={Uri.EscapeDataString(gatewayResult)}";
    }

    private static string? BuildWebhookUrl(string? appBaseUrl)
    {
        if (string.IsNullOrWhiteSpace(appBaseUrl)) return null;
        if (!Uri.TryCreate(appBaseUrl.Trim().TrimEnd('/'), UriKind.Absolute, out var baseUri)) return null;
        // Un webhook localhost est injoignable depuis Internet : en
        // développement, la vérification se fait au retour du client.
        if (baseUri.IsLoopback
            || baseUri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || baseUri.Host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }
        return $"{baseUri.ToString().TrimEnd('/')}/api/payments/konnect/webhook";
    }

    private async Task<PaymentTransactionResponse> FailAsync(
        PaymentTransaction transaction,
        string errorCode,
        string errorMessage,
        CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var attempt = transaction.Attempts.LastOrDefault();
        if (attempt != null)
        {
            attempt.Status = PaymentAttemptStatus.Failed;
            attempt.ErrorCode = errorCode;
            attempt.ErrorMessage = errorMessage;
            attempt.CompletedAt = now;
        }
        transaction.Status = PaymentTransactionStatus.Failed;
        transaction.ErrorCode = errorCode;
        transaction.ErrorMessage = errorMessage;
        transaction.CompletedAt = now;
        transaction.UpdatedAt = now;

        await Payments.ReplaceOneAsync(t => t.Id == transaction.Id, transaction, cancellationToken: cancellationToken);

        await NotifyBothAsync(
            transaction,
            "Paiement échoué",
            $"La transaction {transaction.Reference} de {FormatAmount(transaction.Amount)} pour la facture {transaction.InvoiceNumber} n'a pas abouti. Le solde de la facture reste inchangé.",
            cancellationToken);

        return ToResponse(transaction);
    }

    private async Task RecomputeInvoiceStatusAsync(string invoiceId, CancellationToken cancellationToken)
    {
        var today = DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var statusExpression = new BsonDocument("$cond", new BsonArray
        {
            new BsonDocument("$lte", new BsonArray { "$balanceDue", 0.0001 }),
            InvoiceStatus.Paid,
            new BsonDocument("$cond", new BsonArray
            {
                new BsonDocument("$gt", new BsonArray { "$amountPaid", 0.0001 }),
                InvoiceStatus.PartiallyPaid,
                new BsonDocument("$cond", new BsonArray
                {
                    new BsonDocument("$and", new BsonArray
                    {
                        new BsonDocument("$ne", new BsonArray { "$status", InvoiceStatus.Draft }),
                        new BsonDocument("$lt", new BsonArray { "$dueDate", today })
                    }),
                    InvoiceStatus.Overdue,
                    new BsonDocument("$cond", new BsonArray
                    {
                        new BsonDocument("$eq", new BsonArray { "$status", InvoiceStatus.Emise }),
                        InvoiceStatus.Emise,
                        InvoiceStatus.Unpaid
                    })
                })
            })
        });

        var pipeline = PipelineDefinition<Invoice, Invoice>.Create(new[]
        {
            new BsonDocument("$set", new BsonDocument
            {
                ["status"] = statusExpression,
                ["updatedAt"] = DateTime.UtcNow
            })
        });

        await Invoices.UpdateOneAsync(i => i.Id == invoiceId, pipeline, cancellationToken: cancellationToken);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    private async Task EnsureClientRoleAsync(string userId, CancellationToken cancellationToken)
    {
        var user = await Users.Find(u => u.Id == userId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");
        if (!string.Equals(UserRole.Normalize(user.Role), UserRole.Client, StringComparison.OrdinalIgnoreCase))
        {
            throw new ForbiddenException("Seul le client peut effectuer un paiement.");
        }
    }

    private async Task<Invoice> FindInvoiceAsync(string invoiceId, CancellationToken cancellationToken)
    {
        if (!ObjectId.TryParse(invoiceId, out _)) throw new NotFoundException("Facture introuvable.");
        var invoice = await Invoices.Find(i => i.Id == invoiceId).FirstOrDefaultAsync(cancellationToken);
        if (invoice == null) throw new NotFoundException("Facture introuvable.");
        return invoice;
    }

    private async Task EnsureInvoiceAccessAsync(string userId, Invoice invoice, CancellationToken cancellationToken)
    {
        if (string.Equals(invoice.ClientId, userId, StringComparison.Ordinal)) return;
        if (string.Equals(invoice.OwnerId, userId, StringComparison.Ordinal))
        {
            // Le freelancer peut consulter, jamais payer.
            return;
        }
        // Repli pour les factures historiques sans clientId : propriétaire du projet.
        if (!string.IsNullOrWhiteSpace(invoice.ProjectId) && ObjectId.TryParse(invoice.ProjectId, out _))
        {
            var project = await Projects.Find(p => p.Id == invoice.ProjectId).FirstOrDefaultAsync(cancellationToken);
            if (project != null && string.Equals(project.OwnerId, userId, StringComparison.Ordinal)) return;
        }
        throw new ForbiddenException("Accès refusé à cette facture.");
    }

    private async Task<PaymentTransaction> FindAsync(string transactionId, CancellationToken cancellationToken)
    {
        if (!ObjectId.TryParse(transactionId, out _)) throw new NotFoundException("Transaction introuvable.");
        var transaction = await Payments.Find(t => t.Id == transactionId).FirstOrDefaultAsync(cancellationToken);
        if (transaction == null) throw new NotFoundException("Transaction introuvable.");
        return transaction;
    }

    private static void EnsureAccess(string userId, PaymentTransaction transaction)
    {
        if (string.Equals(transaction.ClientId, userId, StringComparison.Ordinal)) return;
        if (string.Equals(transaction.FreelancerId, userId, StringComparison.Ordinal)) return;
        throw new ForbiddenException("Accès refusé à cette transaction.");
    }

    private async Task NotifyBothAsync(
        PaymentTransaction transaction,
        string title,
        string message,
        CancellationToken cancellationToken)
    {
        await NotifyAsync(transaction.ClientId, "invoice_billing", title, message, transaction, cancellationToken);
        await NotifyAsync(transaction.FreelancerId, "invoice_billing", title, message, transaction, cancellationToken);
    }

    private async Task NotifyAsync(
        string recipientId,
        string type,
        string title,
        string message,
        PaymentTransaction transaction,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(recipientId) || !ObjectId.TryParse(recipientId, out _)) return;
        try
        {
            await Notifications.InsertOneAsync(new Notification
            {
                RecipientId = recipientId,
                Type = type,
                Title = title,
                Message = message,
                ProjectId = transaction.ProjectId ?? string.Empty,
                ProjectTitle = transaction.ProjectTitle ?? string.Empty,
                TaskId = string.Empty,
                TaskTitle = string.Empty,
                ActorName = string.Empty,
                IsRead = false,
                CreatedAt = DateTime.UtcNow
            }, cancellationToken: cancellationToken);
        }
        catch
        {
            // Les notifications ne doivent jamais bloquer le flux de paiement.
        }
    }

    private async Task<string> GenerateReceiptNumberAsync(CancellationToken cancellationToken)
    {
        var year = DateTime.UtcNow.Year;
        var filter = Builders<BsonDocument>.Filter.Eq("_id", $"receipt-{year}");
        var update = Builders<BsonDocument>.Update.Inc("seq", 1);
        var options = new FindOneAndUpdateOptions<BsonDocument>
        {
            IsUpsert = true,
            ReturnDocument = ReturnDocument.After
        };
        var result = await Counters.FindOneAndUpdateAsync(filter, update, options, cancellationToken);
        if (result == null || !result.Contains("seq"))
        {
            throw new InvalidOperationException($"Unable to generate receipt number for year {year}.");
        }
        return $"REC-{year}-{result["seq"].ToInt32():000000}";
    }

    private static string GenerateReference()
    {
        var suffix = Guid.NewGuid().ToString("N")[..6].ToUpperInvariant();
        return $"PAY-{DateTime.UtcNow:yyyyMMdd}-{suffix}";
    }

    private static string DisplayName(User? user)
    {
        if (user == null) return "—";
        var name = $"{user.FirstName} {user.LastName}".Trim();
        return string.IsNullOrWhiteSpace(name) ? user.Email : name;
    }

    private static string FormatAmount(decimal amount) =>
        $"{amount.ToString("0.000", CultureInfo.InvariantCulture)} TND";

    private static PaymentTransactionResponse ToResponse(PaymentTransaction transaction) => new()
    {
        Id = transaction.Id,
        Reference = transaction.Reference,
        InvoiceId = transaction.InvoiceId,
        InvoiceNumber = transaction.InvoiceNumber,
        ClientId = transaction.ClientId,
        ClientName = transaction.ClientName,
        FreelancerId = transaction.FreelancerId,
        FreelancerName = transaction.FreelancerName,
        ProjectId = transaction.ProjectId,
        ProjectTitle = transaction.ProjectTitle,
        Amount = transaction.Amount,
        Currency = transaction.Currency,
        Method = PaymentMethod.Normalize(transaction.Method),
        MethodLabel = PaymentProvider.IsBlockchain(transaction.Provider)
            ? $"MetaMask ({BlockchainSettings.NetworkName(transaction.BlockchainChainId)})"
            : PaymentMethod.Label(transaction.Method),
        Status = PaymentTransactionStatus.Normalize(transaction.Status),
        Note = transaction.Note,
        InvoiceTotal = transaction.InvoiceTotal,
        BalanceBefore = transaction.BalanceBefore,
        BalanceAfter = transaction.BalanceAfter,
        ReceiptNumber = transaction.ReceiptNumber,
        ReceiptAvailable = string.Equals(transaction.Status, PaymentTransactionStatus.Succeeded, StringComparison.Ordinal),
        ErrorCode = transaction.ErrorCode,
        ErrorMessage = transaction.ErrorMessage,
        IdempotencyKey = transaction.IdempotencyKey,
        Provider = string.IsNullOrWhiteSpace(transaction.Provider) ? PaymentProvider.Internal : transaction.Provider,
        ProviderPaymentRef = transaction.ProviderPaymentRef,
        ProviderPayUrl = transaction.ProviderPayUrl,
        ProviderStatus = transaction.ProviderStatus,
        ProviderLastCheckedAt = transaction.ProviderLastCheckedAt,
        BlockchainTxHash = transaction.BlockchainTxHash,
        WalletAddress = transaction.WalletAddress,
        BlockchainChainId = transaction.BlockchainChainId,
        BlockchainReceiver = transaction.BlockchainReceiver,
        BlockchainAmountWei = transaction.BlockchainAmountWei,
        BlockchainAmountEth = string.IsNullOrWhiteSpace(transaction.BlockchainAmountWei)
            ? null
            : BlockchainSettings.ToEth(transaction.BlockchainAmountWei),
        BlockchainTndPerEth = transaction.BlockchainTndPerEth,
        BlockchainExplorerUrl = BlockchainSettings.ExplorerUrlForChain(
            transaction.BlockchainChainId,
            transaction.BlockchainTxHash),
        BlockchainConfirmations = transaction.BlockchainConfirmations,
        BlockchainGenesisHash = transaction.BlockchainGenesisHash,
        BlockchainGenesisTimestamp = transaction.BlockchainGenesisTimestamp,
        BlockchainCrossGenesis = transaction.BlockchainCrossGenesis,
        BlockchainReplayOfPaymentId = transaction.BlockchainReplayOfPaymentId,
        GatewayRedirect =
            PaymentProvider.IsGateway(transaction.Provider)
            && !string.IsNullOrWhiteSpace(transaction.ProviderPayUrl)
            && string.Equals(transaction.Status, PaymentTransactionStatus.Pending, StringComparison.Ordinal),
        Attempts = transaction.Attempts.Select(a => new PaymentAttemptResponse
        {
            AttemptNumber = a.AttemptNumber,
            Status = a.Status,
            ErrorCode = a.ErrorCode,
            ErrorMessage = a.ErrorMessage,
            StartedAt = a.StartedAt,
            CompletedAt = a.CompletedAt
        }).ToList(),
        CreatedAt = transaction.CreatedAt,
        UpdatedAt = transaction.UpdatedAt,
        CompletedAt = transaction.CompletedAt
    };
}
