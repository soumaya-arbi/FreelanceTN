using FreelanceTn.Api.Data;
using FreelanceTn.Api.Dtos.Invoices;
using FreelanceTn.Api.Dtos.Payments;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using MongoDB.Bson;
using MongoDB.Driver;

namespace FreelanceTn.Api.Services;

public class InvoiceService
{
    private readonly MongoContext _mongo;
    private readonly PaymentService _payments;

    public InvoiceService(MongoContext mongo, PaymentService payments)
    {
        _mongo = mongo;
        _payments = payments;
    }

    private IMongoCollection<Invoice> Invoices => _mongo.GetCollection<Invoice>(_mongo.Settings.InvoicesCollection);
    private IMongoCollection<Quote> Quotes => _mongo.GetCollection<Quote>(_mongo.Settings.QuotesCollection);
    private IMongoCollection<Project> Projects => _mongo.GetCollection<Project>(_mongo.Settings.ProjectsCollection);
    private IMongoCollection<User> Users => _mongo.GetCollection<User>(_mongo.Settings.UsersCollection);
    private IMongoCollection<Notification> Notifications => _mongo.GetCollection<Notification>(_mongo.Settings.NotificationsCollection);
    private IMongoCollection<BsonDocument> Counters => _mongo.Counters;

    private async System.Threading.Tasks.Task NotifyAsync(string? recipientId, string type, string title, string message, string projectId = "", string projectTitle = "", CancellationToken cancellationToken = default)
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
                ProjectId = projectId ?? string.Empty,
                ProjectTitle = projectTitle ?? string.Empty,
                TaskId = string.Empty,
                TaskTitle = string.Empty,
                ActorName = string.Empty,
                IsRead = false,
                CreatedAt = DateTime.UtcNow
            }, cancellationToken: cancellationToken);
        }
        catch
        {
            // Les notifications ne doivent pas bloquer le flux métier principal.
        }
    }

    public async Task<List<InvoiceResponse>> ListAsync(string ownerId, CancellationToken cancellationToken)
    {
        var invoices = await Invoices
            .Find(i => i.OwnerId == ownerId || i.ClientId == ownerId)
            .SortByDescending(i => i.CreatedAt)
            .ToListAsync(cancellationToken);

        var updated = new List<Invoice>();
        foreach (var inv in invoices)
        {
            var changed = ApplyOverdueIfNeeded(inv);
            if (changed) updated.Add(inv);
        }
        if (updated.Count > 0)
        {
            var bulk = new List<WriteModel<Invoice>>();
            foreach (var inv in updated)
            {
                bulk.Add(new ReplaceOneModel<Invoice>(Builders<Invoice>.Filter.Eq(i => i.Id, inv.Id), inv));
            }
            await Invoices.BulkWriteAsync(bulk, cancellationToken: cancellationToken);
        }

        var transactions = await _payments.ListEntitiesForInvoicesAsync(
            invoices.Select(i => i.Id).ToList(), cancellationToken);
        var byInvoice = transactions
            .GroupBy(t => t.InvoiceId)
            .ToDictionary(g => g.Key, g => (IReadOnlyCollection<PaymentTransaction>)g.OrderBy(t => t.CreatedAt).ToList());

        return invoices
            .Select(invoice => ToResponse(invoice, byInvoice.TryGetValue(invoice.Id, out var list) ? list : []))
            .ToList();
    }

    public async Task<InvoiceResponse> GetAsync(string userId, string invoiceId, CancellationToken cancellationToken)
    {
        var invoice = await FindAsync(invoiceId, cancellationToken);
        if (invoice.OwnerId != userId && invoice.ClientId != userId)
        {
            throw new ForbiddenException("Accès refusé.");
        }
        var changed = ApplyOverdueIfNeeded(invoice);
        if (changed)
        {
            await Invoices.ReplaceOneAsync(i => i.Id == invoice.Id, invoice, cancellationToken: cancellationToken);
        }
        var transactions = await _payments.ListEntitiesForInvoicesAsync([invoice.Id], cancellationToken);
        return ToResponse(invoice, transactions);
    }

    public Task<InvoiceResponse> CreateAsync(string ownerId, CreateInvoiceRequest request, CancellationToken cancellationToken)
    {
        // Règle métier stricte : seul le client crée une facture, exclusivement
        // depuis un devis accepté et non converti.
        throw new ForbiddenException("La création manuelle de facture n'est pas autorisée. Seul le client peut créer une facture à partir d'un devis accepté.");
    }

    public async Task<InvoiceResponse> CreateFromQuoteAsync(string clientUserId, string quoteId, CreateInvoiceFromQuoteRequest request, CancellationToken cancellationToken)
    {
        await EnsureUserRoleAsync(clientUserId, UserRole.Client, "Seul le client peut créer une facture à partir d'un devis accepté.", cancellationToken);
        if (!ObjectId.TryParse(quoteId, out _)) throw new NotFoundException("Devis introuvable.");
        var quote = await Quotes.Find(q => q.Id == quoteId).FirstOrDefaultAsync(cancellationToken);
        if (quote == null) throw new NotFoundException("Devis introuvable.");

        var resolvedClientId = await ResolveQuoteClientIdAsync(quote, cancellationToken);
        if (!string.Equals(resolvedClientId, clientUserId, StringComparison.Ordinal))
        {
            throw new ForbiddenException("Vous ne pouvez créer une facture qu'à partir de vos devis acceptés.");
        }
        if (!string.IsNullOrEmpty(quote.ConvertedTo))
        {
            throw new ConflictException("Ce devis a déjà été converti en facture.");
        }
        if (quote.Status == QuoteStatus.Refused || quote.Status == QuoteStatus.Draft)
        {
            throw new ConflictException("Un devis en attente, refusé ou expiré ne peut pas générer de facture.");
        }
        if (QuoteStatus.IsExpired(quote.ValidUntil, DateTime.UtcNow) || quote.Status == QuoteStatus.Expired)
        {
            if (quote.Status != QuoteStatus.Expired && string.IsNullOrEmpty(quote.ConvertedTo))
            {
                await Quotes.UpdateOneAsync(q => q.Id == quote.Id, Builders<Quote>.Update.Set(q => q.Status, QuoteStatus.Expired).Set(q => q.UpdatedAt, DateTime.UtcNow), cancellationToken: cancellationToken);
            }
            throw new ConflictException("Un devis expiré ne peut pas générer de facture.");
        }
        if (quote.Status != QuoteStatus.Accepted)
        {
            throw new ConflictException("Seul un devis accepté peut être utilisé pour créer une facture.");
        }

        var project = await Projects.Find(p => p.Id == quote.ProjectId).FirstOrDefaultAsync(cancellationToken);
        if (project == null) throw new NotFoundException("Projet introuvable.");
        if (!string.Equals(project.OwnerId, clientUserId, StringComparison.Ordinal) && !string.Equals(resolvedClientId, clientUserId, StringComparison.Ordinal))
        {
            throw new ForbiddenException("Accès refusé au projet.");
        }

        var issueDate = DateTime.UtcNow.ToString("yyyy-MM-dd");
        var dueDate = string.IsNullOrWhiteSpace(request.DueDate) ? DateTime.UtcNow.AddDays(30).ToString("yyyy-MM-dd") : request.DueDate.Trim();
        if (!DateTime.TryParse(dueDate, out _)) throw new BadRequestException("Date d'échéance invalide.");

        var lines = quote.Lines.Select(l => new DocumentLine
        {
            Id = string.IsNullOrWhiteSpace(l.Id) ? Guid.NewGuid().ToString("N") : l.Id,
            Description = l.Description,
            Quantity = l.Quantity,
            UnitPrice = l.UnitPrice,
            TaxRate = l.TaxRate,
            Discount = l.Discount
        }).ToList();
        var totals = Calculate(lines);

        var invoice = new Invoice
        {
            Number = await GenerateNumberAsync(cancellationToken),
            OwnerId = quote.OwnerId,
            ClientId = clientUserId,
            Client = quote.Client,
            ProjectId = quote.ProjectId,
            Project = string.IsNullOrWhiteSpace(quote.Project) ? project.Title : quote.Project,
            QuoteId = quote.Id,
            IssueDate = issueDate,
            DueDate = dueDate,
            Status = InvoiceStatus.Unpaid,
            Lines = lines,
            Notes = string.IsNullOrWhiteSpace(request.Notes) ? quote.Notes : request.Notes.Trim(),
            Subtotal = totals.Subtotal,
            DiscountTotal = totals.DiscountTotal,
            TaxTotal = totals.TaxTotal,
            Total = totals.Total,
            AmountPaid = 0,
            BalanceDue = totals.Total,
            Payments = [],
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        ApplyOverdueIfNeeded(invoice);
        await Invoices.InsertOneAsync(invoice, cancellationToken: cancellationToken);

        var claimed = await Quotes.UpdateOneAsync(
            q => q.Id == quote.Id && q.Status == QuoteStatus.Accepted && (q.ConvertedTo == null || q.ConvertedTo == string.Empty),
            Builders<Quote>.Update
                .Set(q => q.ConvertedTo, invoice.Id)
                .Set(q => q.ClientId, clientUserId)
                .Set(q => q.UpdatedAt, DateTime.UtcNow),
            cancellationToken: cancellationToken);
        if (claimed.ModifiedCount == 0)
        {
            await Invoices.DeleteOneAsync(i => i.Id == invoice.Id, cancellationToken);
            throw new ConflictException("Ce devis ne peut plus être converti en facture (déjà utilisé, expiré ou statut invalide).");
        }

        await NotifyAsync(quote.OwnerId, "invoice_billing", "Facture créée par le client", $"Le client a créé la facture {invoice.Number} à partir du devis {quote.Number}.", invoice.ProjectId, invoice.Project, cancellationToken);
        return ToResponse(invoice, []);
    }

    private async System.Threading.Tasks.Task EnsureUserRoleAsync(string userId, string role, string message, CancellationToken cancellationToken)
    {
        var user = await Users.Find(u => u.Id == userId).FirstOrDefaultAsync(cancellationToken);
        if (user == null) throw new UnauthorizedException("Session invalide.");
        if (!string.Equals(UserRole.Normalize(user.Role), UserRole.Normalize(role), StringComparison.OrdinalIgnoreCase))
        {
            throw new ForbiddenException(message);
        }
    }

    private async Task<string?> ResolveQuoteClientIdAsync(Quote quote, CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(quote.ClientId)) return quote.ClientId;
        if (!ObjectId.TryParse(quote.ProjectId, out _)) return null;
        var project = await Projects.Find(p => p.Id == quote.ProjectId).FirstOrDefaultAsync(cancellationToken);
        if (project == null) return null;
        var inferred = !string.IsNullOrWhiteSpace(project.OwnerId) && project.OwnerId != quote.OwnerId ? project.OwnerId : null;
        if (inferred != null)
        {
            await Quotes.UpdateOneAsync(q => q.Id == quote.Id && (q.ClientId == null || q.ClientId == ""), Builders<Quote>.Update.Set(q => q.ClientId, inferred).Set(q => q.UpdatedAt, DateTime.UtcNow), cancellationToken: cancellationToken);
            quote.ClientId = inferred;
        }
        return inferred;
    }

    public async Task<InvoiceResponse> UpdateAsync(string userId, string invoiceId, UpdateInvoiceRequest request, CancellationToken cancellationToken)
    {
        var invoice = await FindAsync(invoiceId, cancellationToken);
        if (invoice.OwnerId != userId)
        {
            throw new ForbiddenException("Seul le propri�taire peut modifier cette facture.");
        }
        if (invoice.Status == InvoiceStatus.Paid)
        {
            throw new ConflictException("Impossible de modifier une facture d�j� pay�e.");
        }

        if (request.ClientId != null) invoice.ClientId = string.IsNullOrWhiteSpace(request.ClientId) ? null : request.ClientId.Trim();
        if (request.Client != null) invoice.Client = request.Client.Trim();
        if (request.ProjectId != null)
        {
            var projectId = request.ProjectId.Trim();
            if (!ObjectId.TryParse(projectId, out _))
            {
                throw new BadRequestException("Identifiant de projet invalide.");
            }
            var project = await Projects.Find(p => p.Id == projectId).FirstOrDefaultAsync(cancellationToken);
            if (project == null) throw new NotFoundException("Projet introuvable.");
            if (project.AssignedTo != userId && project.OwnerId != userId)
            {
                throw new ForbiddenException("Accès refusé au projet.");
            }
            invoice.ProjectId = projectId;
        }
        if (request.Project != null) invoice.Project = request.Project.Trim();
        if (request.IssueDate != null) invoice.IssueDate = request.IssueDate.Trim();
        if (request.DueDate != null) invoice.DueDate = request.DueDate.Trim();
        if (request.Notes != null) invoice.Notes = request.Notes;

        if (request.Status != null)
        {
            var requested = ResolveStatus(request.Status);
            if (requested == InvoiceStatus.Paid)
            {
                throw new ConflictException("Le statut « payée » est calculé automatiquement à partir des paiements enregistrés.");
            }
            invoice.Status = requested;
        }

        if (request.Lines != null)
        {
            var lines = NormalizeLines(request.Lines);
            var totals = Calculate(lines);
            if (invoice.AmountPaid > totals.Total + 0.0001m)
            {
                throw new ConflictException("Le total ne peut pas être inférieur aux paiements déjà enregistrés.");
            }
            invoice.Lines = lines;
            invoice.Subtotal = totals.Subtotal;
            invoice.DiscountTotal = totals.DiscountTotal;
            invoice.TaxTotal = totals.TaxTotal;
            invoice.Total = totals.Total;
            invoice.BalanceDue = Math.Max(0, invoice.Total - invoice.AmountPaid);
        }
        RefreshStatusFromAmounts(invoice);

        ApplyOverdueIfNeeded(invoice);
        invoice.UpdatedAt = DateTime.UtcNow;
        await Invoices.ReplaceOneAsync(i => i.Id == invoice.Id, invoice, cancellationToken: cancellationToken);
        var transactions = await _payments.ListEntitiesForInvoicesAsync([invoice.Id], cancellationToken);
        return ToResponse(invoice, transactions);
    }

    public async System.Threading.Tasks.Task DeleteAsync(string userId, string invoiceId, CancellationToken cancellationToken)
    {
        var invoice = await FindAsync(invoiceId, cancellationToken);
        if (invoice.OwnerId != userId)
        {
            throw new ForbiddenException("Seul le propri�taire peut supprimer cette facture.");
        }
        if (invoice.Status == InvoiceStatus.Paid || invoice.AmountPaid > 0)
        {
            throw new ConflictException("Impossible de supprimer une facture pay�e ou partiellement pay�e.");
        }
        await Invoices.DeleteOneAsync(i => i.Id == invoiceId, cancellationToken);
    }

    public async Task<InvoiceResponse> UpdateStatusAsync(string userId, string invoiceId, string status, CancellationToken cancellationToken)
    {
        var invoice = await FindAsync(invoiceId, cancellationToken);
        var isOwner = invoice.OwnerId == userId;
        var isClient = invoice.ClientId == userId;
        if (!isOwner && !isClient)
        {
            throw new ForbiddenException("Accès refusé.");
        }
        var normalized = ResolveStatus(status);
        if (normalized == InvoiceStatus.Paid)
        {
            throw new ConflictException("Le statut « payée » est calculé automatiquement à partir des paiements enregistrés.");
        }
        if (invoice.Status == InvoiceStatus.Paid)
        {
            throw new ConflictException("Une facture payée ne peut pas être rouverte.");
        }
        invoice.Status = normalized;
        RefreshStatusFromAmounts(invoice);
        ApplyOverdueIfNeeded(invoice);
        invoice.UpdatedAt = DateTime.UtcNow;
        await Invoices.ReplaceOneAsync(i => i.Id == invoice.Id, invoice, cancellationToken: cancellationToken);
        var transactions = await _payments.ListEntitiesForInvoicesAsync([invoice.Id], cancellationToken);
        return ToResponse(invoice, transactions);
    }

    /// <summary>
    /// Alias historique de <see cref="PaymentService.CreateAsync"/> pour les
    /// clients déjà déployés. Toute la logique transactions/soldes/reçus vit
    /// désormais dans le moteur de paiement.
    /// </summary>
    public async Task<InvoiceResponse> RecordPaymentAsync(string userId, string invoiceId, RecordPaymentRequest request, CancellationToken cancellationToken)
    {
        var invoice = await FindAsync(invoiceId, cancellationToken);
        if (invoice.OwnerId != userId && invoice.ClientId != userId)
        {
            throw new ForbiddenException("Accès refusé.");
        }
        if (string.Equals(invoice.OwnerId, userId, StringComparison.Ordinal)
            && !string.Equals(invoice.ClientId, userId, StringComparison.Ordinal))
        {
            throw new ForbiddenException("Le paiement d'une facture est réservé au client.");
        }

        var note = request.Note;
        if (!string.IsNullOrWhiteSpace(request.Reference))
        {
            note = string.IsNullOrWhiteSpace(note) ? $"Réf. client : {request.Reference.Trim()}" : $"{note.Trim()} (réf. client : {request.Reference.Trim()})";
        }

        var transaction = await _payments.CreateAsync(userId, new CreatePaymentRequest
        {
            InvoiceId = invoiceId,
            Amount = request.Amount,
            Method = request.Method,
            Note = note,
            IdempotencyKey = request.IdempotencyKey,
            SimulateOutcome = request.SimulateOutcome
        }, cancellationToken);

        return await GetAsync(userId, transaction.InvoiceId, cancellationToken);
    }

    private static bool ApplyOverdueIfNeeded(Invoice invoice)
    {
        if (invoice.Status == InvoiceStatus.Paid || invoice.Status == InvoiceStatus.Draft) return false;
        if (DateTime.TryParse(invoice.DueDate, out var dueDate))
        {
            if (dueDate.Date < DateTime.UtcNow.Date && invoice.BalanceDue > 0)
            {
                if (invoice.Status != InvoiceStatus.Overdue)
                {
                    invoice.Status = InvoiceStatus.Overdue;
                    return true;
                }
            }
        }
        return false;
    }

    /// <summary>
    /// Le montant payé et le solde sont la source de vérité (mis à jour
    /// atomiquement par le moteur de paiement). On ne recalcule ici que le
    /// statut visible, jamais les montants.
    /// </summary>
    private static void RefreshStatusFromAmounts(Invoice invoice)
    {
        if (invoice.AmountPaid >= invoice.Total - 0.0001m && invoice.Total >= 0)
        {
            invoice.AmountPaid = invoice.Total;
            invoice.BalanceDue = 0;
            invoice.Status = InvoiceStatus.Paid;
        }
        else if (invoice.AmountPaid > 0.0001m && invoice.BalanceDue > 0.0001m)
        {
            invoice.Status = InvoiceStatus.PartiallyPaid;
        }
        else if (invoice.AmountPaid <= 0.0001m)
        {
            if (invoice.Status == InvoiceStatus.Paid || invoice.Status == InvoiceStatus.PartiallyPaid)
            {
                invoice.Status = InvoiceStatus.Unpaid;
            }
        }
    }

    private async Task<Invoice> FindAsync(string invoiceId, CancellationToken cancellationToken)
    {
        if (!ObjectId.TryParse(invoiceId, out _))
        {
            throw new NotFoundException("Facture introuvable.");
        }
        var invoice = await Invoices.Find(i => i.Id == invoiceId).FirstOrDefaultAsync(cancellationToken);
        if (invoice == null) throw new NotFoundException("Facture introuvable.");
        return invoice;
    }

    private static string ResolveStatus(string? status)
    {
        if (string.IsNullOrWhiteSpace(status))
        {
            throw new BadRequestException("Statut de facture invalide.");
        }
        var value = status.Trim().ToLowerInvariant();
        if (value == "issued" || value == "sent") value = InvoiceStatus.Emise;
        if (!InvoiceStatus.All.Contains(value))
        {
            throw new BadRequestException("Statut de facture invalide.");
        }
        return value;
    }

    private List<DocumentLine> NormalizeLines(List<InvoiceLineRequest> lines)
    {
        if (lines == null || lines.Count == 0) throw new ConflictException("Au moins une ligne est obligatoire.");
        var result = new List<DocumentLine>();
        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line.Description)) throw new ConflictException("La description de la ligne est obligatoire.");
            if (line.Quantity <= 0) throw new ConflictException("La quantit� doit �tre sup�rieure � 0.");
            if (line.UnitPrice < 0) throw new ConflictException("Le prix unitaire ne peut pas �tre n�gatif.");
            if (line.TaxRate < 0) throw new ConflictException("Le taux de TVA ne peut pas �tre n�gatif.");
            if (line.Discount < 0 || line.Discount > 100) throw new ConflictException("La remise doit �tre comprise entre 0 et 100.");
            result.Add(new DocumentLine
            {
                Id = string.IsNullOrWhiteSpace(line.Id) ? Guid.NewGuid().ToString("N") : line.Id.Trim(),
                Description = line.Description.Trim(),
                Quantity = line.Quantity,
                UnitPrice = line.UnitPrice,
                TaxRate = line.TaxRate,
                Discount = line.Discount
            });
        }
        return result;
    }

    private static (decimal Subtotal, decimal DiscountTotal, decimal TaxTotal, decimal Total) Calculate(List<DocumentLine> lines)
    {
        decimal subtotal = 0;
        decimal discountTotal = 0;
        decimal taxTotal = 0;
        foreach (var line in lines)
        {
            var lineGross = line.Quantity * line.UnitPrice;
            var lineDiscount = lineGross * (line.Discount / 100m);
            var lineNet = lineGross - lineDiscount;
            var lineTax = lineNet * (line.TaxRate / 100m);
            subtotal += lineGross;
            discountTotal += lineDiscount;
            taxTotal += lineTax;
        }
        var total = subtotal - discountTotal + taxTotal;
        if (total < 0) total = 0;
        return (Math.Round(subtotal, 3), Math.Round(discountTotal, 3), Math.Round(taxTotal, 3), Math.Round(total, 3));
    }

    private async Task<string> GenerateNumberAsync(CancellationToken cancellationToken)
    {
        var year = DateTime.UtcNow.Year;
        var filter = Builders<BsonDocument>.Filter.Eq("_id", $"invoice-{year}");
        var update = Builders<BsonDocument>.Update.Inc("seq", 1);
        var options = new FindOneAndUpdateOptions<BsonDocument> { IsUpsert = true, ReturnDocument = ReturnDocument.After };
        var result = await Counters.FindOneAndUpdateAsync(filter, update, options, cancellationToken);
        if (result != null && result.Contains("seq"))
        {
            var seq = result["seq"].ToInt32();
            return $"FAC-{year}-{seq.ToString("000")}";
        }
        // Unexpected: counter upsert did not return a document
        throw new InvalidOperationException($"Unable to generate invoice number for year {year}.");
    }

    private static InvoiceResponse ToResponse(
        Invoice invoice,
        IReadOnlyCollection<PaymentTransaction>? transactions = null)
    {
        var lines = invoice.Lines.Select(line => {
            var lineGross = line.Quantity * line.UnitPrice;
            var lineDiscount = lineGross * (line.Discount / 100m);
            var lineNet = lineGross - lineDiscount;
            var lineTax = lineNet * (line.TaxRate / 100m);
            var lineTotal = lineNet + lineTax;
            return new InvoiceLineResponse
            {
                Id = line.Id,
                Description = line.Description,
                Quantity = line.Quantity,
                UnitPrice = line.UnitPrice,
                TaxRate = line.TaxRate,
                Discount = line.Discount,
                LineSubtotal = Math.Round(lineGross, 3),
                LineDiscount = Math.Round(lineDiscount, 3),
                LineTax = Math.Round(lineTax, 3),
                LineTotal = Math.Round(lineTotal, 3)
            };
        }).ToList();

        var payments = new List<InvoicePaymentResponse>();
        var knownReferences = new HashSet<string>(StringComparer.Ordinal);
        // Un paiement crédité est enregistré dans invoice.Payments avec
        // TransactionId = identifiant interne de la transaction, alors que la
        // réponse expose Reference (PAY-...). Les deux identités doivent être
        // reconnues pour ne jamais afficher deux fois le même paiement.
        var knownTransactionIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var transaction in (transactions ?? []).OrderBy(t => t.CreatedAt))
        {
            knownReferences.Add(transaction.Reference);
            knownTransactionIds.Add(transaction.Id);
            payments.Add(new InvoicePaymentResponse
            {
                Id = transaction.Id,
                Amount = transaction.Amount,
                Date = (transaction.CompletedAt ?? transaction.CreatedAt).ToLocalTime().ToString("yyyy-MM-dd"),
                Note = transaction.Note,
                Reference = transaction.Reference,
                Status = PaymentTransactionStatus.Normalize(transaction.Status),
                Method = PaymentMethod.Normalize(transaction.Method),
                TransactionId = transaction.Reference,
                IdempotencyKey = transaction.IdempotencyKey,
                CreatedAt = transaction.CreatedAt,
                ReceiptNumber = transaction.ReceiptNumber,
                ReceiptAvailable = string.Equals(transaction.Status, PaymentTransactionStatus.Succeeded, StringComparison.Ordinal),
                Attempts = transaction.Attempts.Select(a => new PaymentAttemptResponse
                {
                    AttemptNumber = a.AttemptNumber,
                    Status = a.Status,
                    ErrorCode = a.ErrorCode,
                    ErrorMessage = a.ErrorMessage,
                    StartedAt = a.StartedAt,
                    CompletedAt = a.CompletedAt
                }).ToList()
            });
        }

        // Historique antérieur au moteur : les paiements embarqués ne sont
        // jamais supprimés. Ils restent visibles, sans doublon avec les
        // transactions déjà migrées.
        for (var index = 0; index < invoice.Payments.Count; index++)
        {
            var legacy = invoice.Payments[index];
            var reference = legacy.TransactionId ?? legacy.Reference;
            if (!string.IsNullOrWhiteSpace(reference)
                && (knownReferences.Contains(reference!)
                    || knownTransactionIds.Contains(reference!)))
            {
                continue;
            }
            if (!string.IsNullOrWhiteSpace(legacy.Reference)
                && knownReferences.Contains(legacy.Reference!))
            {
                continue;
            }
            payments.Add(new InvoicePaymentResponse
            {
                Id = $"legacy-{invoice.Id}-{index}",
                Amount = legacy.Amount,
                Date = legacy.Date,
                Note = legacy.Note,
                Reference = reference,
                Status = InvoicePaymentStatus.Normalize(legacy.Status) == InvoicePaymentStatus.Failed
                    ? PaymentTransactionStatus.Failed
                    : PaymentTransactionStatus.Succeeded,
                Method = PaymentMethod.Normalize(legacy.Method),
                TransactionId = reference,
                IdempotencyKey = legacy.IdempotencyKey,
                CreatedAt = legacy.CreatedAt,
                ReceiptAvailable = false,
                Legacy = true
            });
        }
        payments = payments
            .OrderBy(p => p.CreatedAt ?? DateTime.MinValue)
            .ToList();

        return new InvoiceResponse
        {
            Id = invoice.Id,
            Number = invoice.Number,
            OwnerId = invoice.OwnerId,
            ClientId = invoice.ClientId,
            Client = invoice.Client,
            ProjectId = invoice.ProjectId,
            Project = invoice.Project,
            QuoteId = invoice.QuoteId,
            IssueDate = invoice.IssueDate,
            DueDate = invoice.DueDate,
            Status = invoice.Status,
            Lines = lines,
            Notes = invoice.Notes,
            Subtotal = invoice.Subtotal,
            DiscountTotal = invoice.DiscountTotal,
            TaxTotal = invoice.TaxTotal,
            Total = invoice.Total,
            AmountPaid = invoice.AmountPaid,
            BalanceDue = invoice.BalanceDue,
            Payments = payments,
            CreatedAt = invoice.CreatedAt,
            UpdatedAt = invoice.UpdatedAt
        };
    }
}
