using FreelanceTn.Api.Data;
using FreelanceTn.Api.Dtos.Quotes;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using MongoDB.Bson;
using MongoDB.Driver;

namespace FreelanceTn.Api.Services;

public class QuoteService
{
    private readonly MongoContext _mongo;

    public QuoteService(MongoContext mongo)
    {
        _mongo = mongo;
    }

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
        catch { }
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

    private async Task<string?> ResolveClientIdAsync(Quote quote, CancellationToken cancellationToken)
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

    private static bool ApplyExpiry(Quote quote)
    {
        if (!string.IsNullOrEmpty(quote.ConvertedTo)) return false;
        if (quote.Status == QuoteStatus.Accepted || quote.Status == QuoteStatus.Refused || quote.Status == QuoteStatus.Draft || quote.Status == QuoteStatus.Expired) return false;
        if (QuoteStatus.IsExpired(quote.ValidUntil, DateTime.UtcNow))
        {
            quote.Status = QuoteStatus.Expired;
            quote.UpdatedAt = DateTime.UtcNow;
            return true;
        }
        return false;
    }

    public async Task<List<QuoteResponse>> ListAsync(string ownerId, CancellationToken cancellationToken)
    {
        var quotes = await Quotes
            .Find(q => q.OwnerId == ownerId)
            .SortByDescending(q => q.CreatedAt)
            .ToListAsync(cancellationToken);

        var changed = new List<WriteModel<Quote>>();
        foreach (var quote in quotes)
        {
            if (ApplyExpiry(quote)) changed.Add(new ReplaceOneModel<Quote>(Builders<Quote>.Filter.Eq(q => q.Id, quote.Id), quote));
        }
        if (changed.Count > 0) await Quotes.BulkWriteAsync(changed, cancellationToken: cancellationToken);
        return quotes.Select(ToResponse).ToList();
    }

    public async Task<List<QuoteResponse>> ListForClientAsync(string clientUserId, CancellationToken cancellationToken)
    {
        var quotes = await Quotes
            .Find(q => q.ClientId == clientUserId)
            .SortByDescending(q => q.CreatedAt)
            .ToListAsync(cancellationToken);

        var changed = new List<WriteModel<Quote>>();
        foreach (var quote in quotes)
        {
            if (ApplyExpiry(quote)) changed.Add(new ReplaceOneModel<Quote>(Builders<Quote>.Filter.Eq(q => q.Id, quote.Id), quote));
        }
        if (changed.Count > 0) await Quotes.BulkWriteAsync(changed, cancellationToken: cancellationToken);
        return quotes.Select(ToResponse).ToList();
    }

    public async Task<QuoteResponse> GetAsync(string userId, string quoteId, CancellationToken cancellationToken)
    {
        var quote = await FindAsync(quoteId, cancellationToken);
        await ResolveClientIdAsync(quote, cancellationToken);
        if (quote.OwnerId != userId && quote.ClientId != userId)
        {
            throw new ForbiddenException("Accès refusé.");
        }
        if (ApplyExpiry(quote))
        {
            await Quotes.ReplaceOneAsync(q => q.Id == quote.Id, quote, cancellationToken: cancellationToken);
        }
        return ToResponse(quote);
    }

    public async Task<QuoteResponse> CreateAsync(string ownerId, CreateQuoteRequest request, CancellationToken cancellationToken)
    {
        await EnsureUserRoleAsync(ownerId, UserRole.Freelancer, "Seul un freelancer peut créer un devis.", cancellationToken);

        var projectId = request.ProjectId.Trim();
        if (!ObjectId.TryParse(projectId, out _))
        {
            throw new BadRequestException("Identifiant de projet invalide.");
        }

        var project = await Projects.Find(p => p.Id == projectId).FirstOrDefaultAsync(cancellationToken);
        if (project == null)
        {
            throw new NotFoundException("Projet introuvable.");
        }
        if (project.AssignedTo != ownerId)
        {
            throw new ForbiddenException("Seul le freelancer assigné au projet peut créer un devis pour ce projet.");
        }

        var clientId = string.IsNullOrWhiteSpace(request.ClientId) ? project.OwnerId : request.ClientId.Trim();
        if (string.IsNullOrWhiteSpace(clientId) || !ObjectId.TryParse(clientId, out _))
        {
            throw new ConflictException("Le devis doit être associé à un client réel.");
        }
        var clientUser = await Users.Find(u => u.Id == clientId).FirstOrDefaultAsync(cancellationToken);
        if (clientUser == null || !string.Equals(UserRole.Normalize(clientUser.Role), UserRole.Client, StringComparison.OrdinalIgnoreCase))
        {
            throw new ConflictException("Le destinataire du devis doit être un compte client réel associé au projet.");
        }

        var resolvedName = string.Join(" ", new[] { clientUser.FirstName, clientUser.LastName }
            .Where(s => !string.IsNullOrWhiteSpace(s))).Trim();
        if (string.IsNullOrWhiteSpace(resolvedName)) resolvedName = clientUser.CompanyName?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(resolvedName)) resolvedName = clientUser.Email?.Trim() ?? "Client";
        var clientDisplayName = !string.IsNullOrWhiteSpace(request.Client)
            ? request.Client.Trim()
            : resolvedName;

        var lines = NormalizeLines(request.Lines);
        var totals = Calculate(lines);
        var status = request.Status == null ? QuoteStatus.Draft : ResolveStatus(request.Status);
        if (status is not QuoteStatus.Draft and not QuoteStatus.Sent)
        {
            throw new ConflictException("Un nouveau devis ne peut être créé qu'en brouillon ou envoyé.");
        }
        if (status == QuoteStatus.Sent && QuoteStatus.IsExpired(request.ValidUntil, DateTime.UtcNow))
        {
            throw new ConflictException("Un devis expiré ne peut pas être envoyé.");
        }

        var quote = new Quote
        {
            Number = await GenerateNumberAsync(cancellationToken),
            OwnerId = ownerId,
            ClientId = clientId,
            Client = clientDisplayName,
            ProjectId = projectId,
            Project = string.IsNullOrWhiteSpace(request.Project) ? project.Title : request.Project.Trim(),
            IssueDate = request.IssueDate.Trim(),
            ValidUntil = request.ValidUntil.Trim(),
            Status = status,
            ConvertedTo = null,
            Lines = lines,
            Notes = request.Notes ?? string.Empty,
            Subtotal = totals.Subtotal,
            DiscountTotal = totals.DiscountTotal,
            TaxTotal = totals.TaxTotal,
            Total = totals.Total,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        await Quotes.InsertOneAsync(quote, cancellationToken: cancellationToken);
        if (quote.Status == QuoteStatus.Sent)
        {
            await NotifyAsync(quote.ClientId, "quote_billing", "Nouveau devis reçu", $"Vous avez reçu le devis {quote.Number} pour le projet {quote.Project}.", quote.ProjectId, quote.Project, cancellationToken);
        }
        return ToResponse(quote);
    }

    public async Task<QuoteResponse> UpdateAsync(string userId, string quoteId, UpdateQuoteRequest request, CancellationToken cancellationToken)
    {
        var quote = await FindAsync(quoteId, cancellationToken);
        if (quote.OwnerId != userId)
        {
            throw new ForbiddenException("Seul le propriétaire peut modifier ce devis.");
        }
        if (!string.IsNullOrEmpty(quote.ConvertedTo))
        {
            throw new ConflictException("Impossible de modifier un devis déjà converti en facture.");
        }
        if (quote.Abandoned)
        {
            throw new ConflictException("Un devis définitivement abandonné ne peut pas être modifié.");
        }

        if (request.ClientId != null) quote.ClientId = string.IsNullOrWhiteSpace(request.ClientId) ? null : request.ClientId.Trim();
        if (request.Client != null) quote.Client = request.Client.Trim();
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
            quote.ProjectId = projectId;
        }
        if (request.Project != null) quote.Project = request.Project.Trim();
        if (request.IssueDate != null) quote.IssueDate = request.IssueDate.Trim();
        if (request.ValidUntil != null) quote.ValidUntil = request.ValidUntil.Trim();
        if (request.Notes != null) quote.Notes = request.Notes;

        if (request.Status != null)
        {
            var next = ResolveStatus(request.Status);
            var previous = quote.Status;
            if (next == QuoteStatus.Sent)
            {
                var canResendCorrection = quote.Status == QuoteStatus.Refused && quote.CorrectionRequested && !quote.Abandoned;
                if (quote.Status is not QuoteStatus.Draft and not QuoteStatus.Sent && !canResendCorrection)
                    throw new ConflictException("Seul un devis brouillon ou un devis en attente de correction peut être envoyé.");
                if (QuoteStatus.IsExpired(quote.ValidUntil, DateTime.UtcNow))
                {
                    quote.Status = QuoteStatus.Expired;
                    quote.UpdatedAt = DateTime.UtcNow;
                    await Quotes.ReplaceOneAsync(q => q.Id == quote.Id, quote, cancellationToken: cancellationToken);
                    throw new ConflictException("Un devis expiré ne peut pas être envoyé. Mettez à jour la date de validité avant de renvoyer.");
                }
                quote.History ??= [];
                if (canResendCorrection)
                {
                    quote.CorrectionRequested = false;
                    quote.Abandoned = false;
                    quote.History.Add(new QuoteHistoryEntry
                    {
                        Action = "resent_after_correction",
                        ActorId = userId,
                        ActorRole = UserRole.Freelancer,
                        FromStatus = previous,
                        ToStatus = next,
                        CreatedAt = DateTime.UtcNow
                    });
                }
                else if (previous != QuoteStatus.Sent)
                {
                    quote.History.Add(new QuoteHistoryEntry
                    {
                        Action = "sent",
                        ActorId = userId,
                        ActorRole = UserRole.Freelancer,
                        FromStatus = previous,
                        ToStatus = next,
                        CreatedAt = DateTime.UtcNow
                    });
                }
                quote.Status = next;
                if (previous != QuoteStatus.Sent)
                {
                    await ResolveClientIdAsync(quote, cancellationToken);
                    var resend = previous == QuoteStatus.Refused;
                    var msg = resend
                        ? $"Le freelancer a corrigé et renvoyé le devis {quote.Number} pour le projet {quote.Project}. Veuillez l'examiner."
                        : $"Vous avez reçu le devis {quote.Number} pour le projet {quote.Project}.";
                    await NotifyAsync(quote.ClientId, "quote_billing", resend ? "Devis corrigé renvoyé" : "Nouveau devis reçu", msg, quote.ProjectId, quote.Project, cancellationToken);
                }
            }
            else if (next == QuoteStatus.Draft)
            {
                if (quote.Status != QuoteStatus.Draft) throw new ConflictException("Le statut du devis ne peut pas revenir en brouillon après envoi.");
                quote.Status = next;
            }
            else
            {
                throw new ForbiddenException("Le statut demandé n'est pas autorisé pour le freelancer.");
            }
        }

        if (request.Lines != null)
        {
            var lines = NormalizeLines(request.Lines);
            var totals = Calculate(lines);
            quote.Lines = lines;
            quote.Subtotal = totals.Subtotal;
            quote.DiscountTotal = totals.DiscountTotal;
            quote.TaxTotal = totals.TaxTotal;
            quote.Total = totals.Total;
        }

        quote.UpdatedAt = DateTime.UtcNow;
        await Quotes.ReplaceOneAsync(q => q.Id == quote.Id, quote, cancellationToken: cancellationToken);
        return ToResponse(quote);
    }

    public async System.Threading.Tasks.Task DeleteAsync(string userId, string quoteId, CancellationToken cancellationToken)
    {
        var quote = await FindAsync(quoteId, cancellationToken);
        if (quote.OwnerId != userId)
        {
            throw new ForbiddenException("Seul le propri�taire peut supprimer ce devis.");
        }
        // Don't allow deletion if already converted? Or just follow rules - be reasonable
        if (!string.IsNullOrEmpty(quote.ConvertedTo))
        {
            throw new ConflictException("Impossible de supprimer un devis d�j� converti en facture.");
        }
        await Quotes.DeleteOneAsync(q => q.Id == quoteId, cancellationToken);
    }

    public async Task<QuoteResponse> UpdateStatusAsync(string userId, string quoteId, string status, string? note, bool abandon, CancellationToken cancellationToken)
    {
        var quote = await FindAsync(quoteId, cancellationToken);
        await ResolveClientIdAsync(quote, cancellationToken);
        ApplyExpiry(quote);
        var isOwner = quote.OwnerId == userId;
        var isClient = quote.ClientId == userId;
        if (!isOwner && !isClient)
        {
            throw new ForbiddenException("Accès refusé.");
        }
        if (!string.IsNullOrEmpty(quote.ConvertedTo))
        {
            throw new ConflictException("Impossible de modifier le statut d'un devis déjà converti en facture.");
        }
        var normalized = ResolveStatus(status);
        var noteText = string.IsNullOrWhiteSpace(note) ? null : note.Trim();

        if (isClient)
        {
            await EnsureUserRoleAsync(userId, UserRole.Client, "Seul le client peut répondre au devis.", cancellationToken);
            if (normalized is not QuoteStatus.Accepted and not QuoteStatus.Refused)
            {
                throw new ForbiddenException("Le client ne peut qu'accepter ou refuser un devis.");
            }
            if (quote.Status == QuoteStatus.Expired || QuoteStatus.IsExpired(quote.ValidUntil, DateTime.UtcNow))
            {
                quote.Status = QuoteStatus.Expired;
                quote.UpdatedAt = DateTime.UtcNow;
                await Quotes.ReplaceOneAsync(q => q.Id == quote.Id, quote, cancellationToken: cancellationToken);
                throw new ConflictException("Un devis expiré ne peut pas être accepté ou refusé.");
            }
            if (quote.Status != QuoteStatus.Sent)
            {
                throw new ConflictException("Seul un devis envoyé peut être accepté ou refusé.");
            }
            if (normalized == QuoteStatus.Refused && string.IsNullOrWhiteSpace(noteText))
            {
                throw new ConflictException("Veuillez indiquer les modifications souhaitées avant de refuser le devis.");
            }
        }

        if (isOwner)
        {
            await EnsureUserRoleAsync(userId, UserRole.Freelancer, "Seul le freelancer peut gérer l'envoi du devis.", cancellationToken);
            if (normalized == QuoteStatus.Sent)
            {
                var canResendCorrection = quote.Status == QuoteStatus.Refused && quote.CorrectionRequested && !quote.Abandoned;
                if (quote.Status is not QuoteStatus.Draft and not QuoteStatus.Sent && !canResendCorrection)
                {
                    throw new ConflictException("Seul un devis brouillon ou un devis en attente de correction peut être envoyé.");
                }
                if (QuoteStatus.IsExpired(quote.ValidUntil, DateTime.UtcNow))
                {
                    quote.Status = QuoteStatus.Expired;
                    quote.UpdatedAt = DateTime.UtcNow;
                    await Quotes.ReplaceOneAsync(q => q.Id == quote.Id, quote, cancellationToken: cancellationToken);
                    throw new ConflictException("Un devis expiré ne peut pas être envoyé. Mettez à jour la date de validité avant de renvoyer.");
                }
            }
            else if (normalized == QuoteStatus.Draft)
            {
                if (quote.Status != QuoteStatus.Draft)
                {
                    throw new ConflictException("Le statut du devis ne peut pas revenir en brouillon après envoi.");
                }
            }
            else
            {
                throw new ForbiddenException("Le freelancer ne peut pas modifier ce statut de devis.");
            }
        }

        var previous = quote.Status;
        quote.Status = normalized;
        quote.UpdatedAt = DateTime.UtcNow;

        quote.History ??= [];

        if (isClient && normalized == QuoteStatus.Refused)
        {
            quote.CorrectionNote = noteText;
            quote.CorrectionRequested = !abandon;
            quote.Abandoned = abandon;
            quote.History.Add(new QuoteHistoryEntry
            {
                Action = abandon ? "abandoned" : "refused_correction_requested",
                Note = noteText,
                ActorId = userId,
                ActorRole = UserRole.Client,
                FromStatus = previous,
                ToStatus = normalized,
                CreatedAt = DateTime.UtcNow
            });
        }
        else if (isClient && normalized == QuoteStatus.Accepted)
        {
            quote.CorrectionRequested = false;
            quote.Abandoned = false;
            quote.History.Add(new QuoteHistoryEntry
            {
                Action = "accepted",
                Note = noteText,
                ActorId = userId,
                ActorRole = UserRole.Client,
                FromStatus = previous,
                ToStatus = normalized,
                CreatedAt = DateTime.UtcNow
            });
        }
        else if (isOwner && normalized == QuoteStatus.Sent)
        {
            if (previous == QuoteStatus.Refused)
            {
                quote.CorrectionRequested = false;
                quote.Abandoned = false;
                quote.History.Add(new QuoteHistoryEntry
                {
                    Action = "resent_after_correction",
                    Note = noteText,
                    ActorId = userId,
                    ActorRole = UserRole.Freelancer,
                    FromStatus = previous,
                    ToStatus = normalized,
                    CreatedAt = DateTime.UtcNow
                });
            }
            else if (previous != QuoteStatus.Sent)
            {
                quote.History.Add(new QuoteHistoryEntry
                {
                    Action = "sent",
                    Note = noteText,
                    ActorId = userId,
                    ActorRole = UserRole.Freelancer,
                    FromStatus = previous,
                    ToStatus = normalized,
                    CreatedAt = DateTime.UtcNow
                });
            }
        }

        await Quotes.ReplaceOneAsync(q => q.Id == quote.Id, quote, cancellationToken: cancellationToken);

        if (isOwner && previous != QuoteStatus.Sent && normalized == QuoteStatus.Sent)
        {
            var resend = previous == QuoteStatus.Refused;
            var msg = resend
                ? $"Le freelancer a corrigé et renvoyé le devis {quote.Number} pour le projet {quote.Project}. Veuillez l'examiner."
                : $"Vous avez reçu le devis {quote.Number} pour le projet {quote.Project}.";
            await NotifyAsync(quote.ClientId, "quote_billing", resend ? "Devis corrigé renvoyé" : "Nouveau devis reçu", msg, quote.ProjectId, quote.Project, cancellationToken);
        }
        if (isClient && normalized == QuoteStatus.Accepted)
        {
            await NotifyAsync(quote.OwnerId, "quote_billing", "Devis accepté", $"Votre devis {quote.Number} a été accepté par le client.", quote.ProjectId, quote.Project, cancellationToken);
        }
        if (isClient && normalized == QuoteStatus.Refused)
        {
            var title = abandon ? "Devis refusé (abandonné)" : "Demande de correction sur un devis";
            var msg = abandon
                ? $"Votre devis {quote.Number} a été refusé par le client."
                : $"Le client a demandé des modifications sur le devis {quote.Number}. Motif : {noteText}";
            await NotifyAsync(quote.OwnerId, "quote_billing", title, msg, quote.ProjectId, quote.Project, cancellationToken);
        }

        return ToResponse(quote);
    }



    private async Task<Quote> FindAsync(string quoteId, CancellationToken cancellationToken)
    {
        if (!ObjectId.TryParse(quoteId, out _))
        {
            throw new NotFoundException("Devis introuvable.");
        }
        var quote = await Quotes.Find(q => q.Id == quoteId).FirstOrDefaultAsync(cancellationToken);
        if (quote == null) throw new NotFoundException("Devis introuvable.");
        return quote;
    }

    private static string ResolveStatus(string? status)
    {
        if (string.IsNullOrWhiteSpace(status) || !QuoteStatus.IsValid(status))
        {
            throw new BadRequestException("Statut de devis invalide.");
        }
        return QuoteStatus.Normalize(status);
    }

    private List<DocumentLine> NormalizeLines(List<QuoteLineRequest> lines)
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
        var filter = Builders<BsonDocument>.Filter.Eq("_id", $"quote-{year}");
        var update = Builders<BsonDocument>.Update.Inc("seq", 1);
        var options = new FindOneAndUpdateOptions<BsonDocument> { IsUpsert = true, ReturnDocument = ReturnDocument.After };
        var result = await Counters.FindOneAndUpdateAsync(filter, update, options, cancellationToken);
        if (result != null && result.Contains("seq"))
        {
            var seq = result["seq"].ToInt32();
            return $"DEV-{year}-{seq:000}";
        }
        throw new InvalidOperationException($"Unable to generate quote number for year {year}.");
    }

    private static QuoteResponse ToResponse(Quote quote)
    {
        var lines = (quote.Lines ?? []).Select(line => {
            var lineGross = line.Quantity * line.UnitPrice;
            var lineDiscount = lineGross * (line.Discount / 100m);
            var lineNet = lineGross - lineDiscount;
            var lineTax = lineNet * (line.TaxRate / 100m);
            var lineTotal = lineNet + lineTax;
            return new QuoteLineResponse
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

        var history = (quote.History ?? []).Select(h => new QuoteHistoryResponse
        {
            Id = h.Id ?? string.Empty,
            Action = h.Action ?? string.Empty,
            Note = h.Note,
            ActorId = h.ActorId,
            ActorRole = h.ActorRole,
            FromStatus = h.FromStatus,
            ToStatus = h.ToStatus,
            CreatedAt = h.CreatedAt
        }).OrderBy(h => h.CreatedAt).ToList();

        return new QuoteResponse
        {
            Id = quote.Id,
            Number = quote.Number,
            OwnerId = quote.OwnerId,
            ClientId = quote.ClientId,
            Client = quote.Client,
            ProjectId = quote.ProjectId,
            Project = quote.Project,
            IssueDate = quote.IssueDate,
            ValidUntil = quote.ValidUntil,
            Status = quote.Status,
            ConvertedTo = quote.ConvertedTo,
            CorrectionNote = quote.CorrectionNote,
            CorrectionRequested = quote.CorrectionRequested,
            Abandoned = quote.Abandoned,
            History = history,
            Lines = lines,
            Notes = quote.Notes,
            Subtotal = quote.Subtotal,
            DiscountTotal = quote.DiscountTotal,
            TaxTotal = quote.TaxTotal,
            Total = quote.Total,
            CreatedAt = quote.CreatedAt,
            UpdatedAt = quote.UpdatedAt
        };
    }
}
