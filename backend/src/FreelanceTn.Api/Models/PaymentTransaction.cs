using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace FreelanceTn.Api.Models;

/// <summary>
/// États du moteur de transactions interne. Une transaction engagée ne peut
/// jamais modifier le solde d'une facture : seules les transitions vers
/// <see cref="Succeeded"/> appliquent le montant au solde, de façon atomique.
/// </summary>
public static class PaymentTransactionStatus
{
    public const string Pending = "pending";
    public const string Processing = "processing";
    public const string Succeeded = "succeeded";
    public const string Failed = "failed";
    public const string Cancelled = "cancelled";

    public static readonly string[] All = [Pending, Processing, Succeeded, Failed, Cancelled];

    public static bool IsValid(string? status) =>
        !string.IsNullOrWhiteSpace(status) && All.Contains(status.Trim().ToLowerInvariant());

    public static string Normalize(string? status)
    {
        var value = status?.Trim().ToLowerInvariant() ?? Pending;
        return All.Contains(value) ? value : Pending;
    }

    public static bool IsTerminal(string? status) =>
        Normalize(status) is Succeeded or Failed or Cancelled;
}

public static class PaymentAttemptStatus
{
    public const string Pending = "pending";
    public const string Processing = "processing";
    public const string Succeeded = "succeeded";
    public const string Failed = "failed";
    public const string Cancelled = "cancelled";
}

/// <summary>
/// Moyens de paiement. Les anciennes valeurs « *_simulated » et le portefeuille
/// interne restent acceptés pour relire les documents historiques, mais toute
/// nouvelle transaction est enregistrée avec les valeurs canoniques ci-dessous.
/// <c>metamask</c> est le seul moyen vérifié on-chain (Sepolia ou Hardhat local).
/// </summary>
public static class PaymentMethod
{
    public const string Card = "card";
    public const string MetaMask = "metamask";
    public const string Wallet = "wallet";
    public const string BankTransfer = "bank_transfer";
    public const string Other = "other";

    public static readonly string[] All = [Card, MetaMask, BankTransfer, Other];

    public static string Normalize(string? method)
    {
        var value = (method ?? Card).Trim().ToLowerInvariant();
        return value switch
        {
            "card" or "card_simulated" or "carte" => Card,
            "metamask" or "metamask_sepolia" or "sepolia" => MetaMask,
            "wallet" or "wallet_simulated" or "portefeuille" => Wallet,
            "bank_transfer" or "bank_transfer_simulated" or "virement" => BankTransfer,
            "other" or "cash" or "cash_simulated" or "autre" => Other,
            _ => Card,
        };
    }

    public static string Label(string? method) => Normalize(method) switch
    {
        BankTransfer => "Virement bancaire",
        MetaMask => "MetaMask (ETH de test)",
        Wallet => "Portefeuille FreelanceTN (historique)",
        Other => "Autre moyen",
        _ => "Carte bancaire",
    };
}

/// <summary>
/// Origine d'une transaction : moteur interne historique, passerelle Konnect
/// Sandbox ou blockchain Ethereum de test (Sepolia / Hardhat local). Une
/// transaction « konnect » ou « blockchain » n'est jamais validée par le
/// frontend : seule la vérification serveur de l'état officiel l'applique.
/// </summary>
public static class PaymentProvider
{
    public const string Internal = "internal";
    public const string Konnect = "konnect";
    public const string Blockchain = "blockchain";

    public static readonly string[] All = [Internal, Konnect, Blockchain];

    public static bool IsGateway(string? provider) =>
        string.Equals(provider?.Trim(), Konnect, StringComparison.OrdinalIgnoreCase);

    public static bool IsBlockchain(string? provider) =>
        string.Equals(provider?.Trim(), Blockchain, StringComparison.OrdinalIgnoreCase);
}

public class PaymentAttempt
{
    [BsonElement("attemptNumber")]
    public int AttemptNumber { get; set; }

    [BsonElement("status")]
    public string Status { get; set; } = PaymentAttemptStatus.Pending;

    [BsonElement("errorCode")]
    public string? ErrorCode { get; set; }

    [BsonElement("errorMessage")]
    public string? ErrorMessage { get; set; }

    [BsonElement("startedAt")]
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("completedAt")]
    public DateTime? CompletedAt { get; set; }
}

/// <summary>
/// Transaction de paiement interne. Document autonome (collection dédiée) :
/// il porte les instantanés nécessaires aux reçus PDF et l'historique complet
/// des tentatives, indépendamment des évolutions futures de la facture.
/// </summary>
public class PaymentTransaction
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    /// <summary>Référence publique unique (ex. PAY-20261109-A1B2C3).</summary>
    [BsonElement("reference")]
    public string Reference { get; set; } = string.Empty;

    [BsonElement("invoiceId")]
    public string InvoiceId { get; set; } = string.Empty;

    [BsonElement("invoiceNumber")]
    public string InvoiceNumber { get; set; } = string.Empty;

    [BsonElement("clientId")]
    public string ClientId { get; set; } = string.Empty;

    [BsonElement("clientName")]
    public string ClientName { get; set; } = string.Empty;

    [BsonElement("freelancerId")]
    public string FreelancerId { get; set; } = string.Empty;

    [BsonElement("freelancerName")]
    public string FreelancerName { get; set; } = string.Empty;

    [BsonElement("projectId")]
    public string ProjectId { get; set; } = string.Empty;

    [BsonElement("projectTitle")]
    public string ProjectTitle { get; set; } = string.Empty;

    [BsonElement("amount")]
    [BsonRepresentation(BsonType.Decimal128)]
    public decimal Amount { get; set; }

    [BsonElement("currency")]
    public string Currency { get; set; } = "TND";

    [BsonElement("method")]
    public string Method { get; set; } = PaymentMethod.Card;

    [BsonElement("status")]
    public string Status { get; set; } = PaymentTransactionStatus.Pending;

    [BsonElement("note")]
    public string? Note { get; set; }

    [BsonElement("invoiceTotal")]
    [BsonRepresentation(BsonType.Decimal128)]
    public decimal InvoiceTotal { get; set; }

    [BsonElement("balanceBefore")]
    [BsonRepresentation(BsonType.Decimal128)]
    public decimal BalanceBefore { get; set; }

    [BsonElement("balanceAfter")]
    [BsonRepresentation(BsonType.Decimal128)]
    public decimal? BalanceAfter { get; set; }

    [BsonElement("receiptNumber")]
    public string? ReceiptNumber { get; set; }

    [BsonElement("errorCode")]
    public string? ErrorCode { get; set; }

    [BsonElement("errorMessage")]
    public string? ErrorMessage { get; set; }

    [BsonElement("idempotencyKey")]
    [BsonIgnoreIfNull]
    public string? IdempotencyKey { get; set; }

    // --- Passerelle Konnect Sandbox ---------------------------------------
    // Les documents historiques n'ont pas ces champs : les valeurs par défaut
    // garantissent une lecture sans migration ni suppression de données.

    /// <summary>« internal » (historique) ou « konnect » (passerelle Sandbox).</summary>
    [BsonElement("provider")]
    [BsonIgnoreIfNull]
    public string Provider { get; set; } = PaymentProvider.Internal;

    /// <summary>Référence de paiement Konnect (paymentRef), utilisée par le webhook.</summary>
    [BsonElement("providerPaymentRef")]
    [BsonIgnoreIfNull]
    public string? ProviderPaymentRef { get; set; }

    /// <summary>Page de paiement hébergée Konnect (redirection navigateur).</summary>
    [BsonElement("providerPayUrl")]
    [BsonIgnoreIfNull]
    public string? ProviderPayUrl { get; set; }

    /// <summary>Dernier état officiel observé (pending, completed, expired...).</summary>
    [BsonElement("providerStatus")]
    [BsonIgnoreIfNull]
    public string? ProviderStatus { get; set; }

    /// <summary>Montant demandé chez Konnect, en millimes (contrôle anti-falsification).</summary>
    [BsonElement("providerAmountMillimes")]
    [BsonIgnoreIfNull]
    public long? ProviderAmountMillimes { get; set; }

    [BsonElement("providerCurrency")]
    [BsonIgnoreIfNull]
    public string? ProviderCurrency { get; set; }

    /// <summary>Identifiant de la transaction réussie côté Konnect.</summary>
    [BsonElement("providerTransactionRef")]
    [BsonIgnoreIfNull]
    public string? ProviderTransactionRef { get; set; }

    [BsonElement("providerLastCheckedAt")]
    [BsonIgnoreIfNull]
    public DateTime? ProviderLastCheckedAt { get; set; }

    /// <summary>Nombre de notifications webhook reçues (observabilité).</summary>
    [BsonElement("providerWebhookCount")]
    public int ProviderWebhookCount { get; set; }

    /// <summary>
    /// Jeton d'application unique : dès qu'il est posé, le montant a été
    /// appliqué au plus une fois à la facture (protection anti-double webhook).
    /// </summary>
    [BsonElement("providerAppliedAt")]
    [BsonIgnoreIfNull]
    public DateTime? ProviderAppliedAt { get; set; }

    // --- Blockchain Ethereum de test (MetaMask) --------------------------
    // Instantané de l'intention : si la configuration change entre la création
    // et la vérification, c'est bien ce destinataire / ce montant qui est
    // contrôlé. Aucune clé privée n'est jamais stockée.

    /// <summary>Hash de la transaction blockchain (posé uniquement après preuve on-chain).</summary>
    [BsonElement("blockchainTxHash")]
    [BsonIgnoreIfNull]
    public string? BlockchainTxHash { get; set; }

    /// <summary>Adresse émettrice (MetaMask) au moment de la vérification.</summary>
    [BsonElement("walletAddress")]
    [BsonIgnoreIfNull]
    public string? WalletAddress { get; set; }

    /// <summary>Réseau attendu : 11155111 (Sepolia) ou 31337 (Hardhat Local).</summary>
    [BsonElement("blockchainChainId")]
    [BsonIgnoreIfNull]
    public long? BlockchainChainId { get; set; }

    /// <summary>Adresse de réception figée à la création de l'intention.</summary>
    [BsonElement("blockchainReceiver")]
    [BsonIgnoreIfNull]
    public string? BlockchainReceiver { get; set; }

    /// <summary>Montant exact attendu, en wei (chaîne décimale).</summary>
    [BsonElement("blockchainAmountWei")]
    [BsonIgnoreIfNull]
    public string? BlockchainAmountWei { get; set; }

    /// <summary>Taux TND/ETH utilisé pour calculer l'intention.</summary>
    [BsonElement("blockchainTndPerEth")]
    [BsonIgnoreIfNull]
    [BsonRepresentation(BsonType.Decimal128)]
    public decimal? BlockchainTndPerEth { get; set; }

    /// <summary>Confirmations observées lors de la dernière vérification.</summary>
    [BsonElement("blockchainConfirmations")]
    public int BlockchainConfirmations { get; set; }

    /// <summary>Date de la vérification on-chain réussie.</summary>
    [BsonElement("blockchainVerifiedAt")]
    [BsonIgnoreIfNull]
    public DateTime? BlockchainVerifiedAt { get; set; }

    /// <summary>
    /// Empreinte du bloc Genesis de l'instance de chaîne au moment de la
    /// création de l'intention. Un hash de transaction n'identifie un transfert
    /// que sur une instance donnée : Hardhat Local étant éphémère, deux
    /// instances peuvent produire le même hash. <c>null</c> = intention créée
    /// avant cette empreinte : aucun crédit automatique n'est autorisé.
    /// </summary>
    [BsonElement("blockchainGenesisHash")]
    [BsonIgnoreIfNull]
    public string? BlockchainGenesisHash { get; set; }

    /// <summary>Timestamp Unix du bloc Genesis enregistré (audit, détection de reset).</summary>
    [BsonElement("blockchainGenesisTimestamp")]
    [BsonIgnoreIfNull]
    public long? BlockchainGenesisTimestamp { get; set; }

    /// <summary>
    /// Vrai quand le même hash a déjà été crédité sur une autre instance de
    /// chaîne (empreinte Genesis différente). Trace d'audit, jamais une preuve
    /// suffisante à elle seule.
    /// </summary>
    [BsonElement("blockchainCrossGenesis")]
    public bool BlockchainCrossGenesis { get; set; }

    /// <summary>Paiement antérieur portant le même hash sur une autre instance.</summary>
    [BsonElement("blockchainReplayOfPaymentId")]
    [BsonIgnoreIfNull]
    public string? BlockchainReplayOfPaymentId { get; set; }

    /// <summary>Justification d'audit du crédit cross-genesis.</summary>
    [BsonElement("blockchainReplayReason")]
    [BsonIgnoreIfNull]
    public string? BlockchainReplayReason { get; set; }

    /// <summary>
    /// Identifiant stable du règlement blockchain. Contrairement à
    /// <see cref="ProviderAppliedAt"/>, il ne change pas lors d'une reprise :
    /// il permet de reprendre un crédit interrompu sans recréditer la facture.
    /// </summary>
    [BsonElement("blockchainSettlementId")]
    [BsonIgnoreIfNull]
    public string? BlockchainSettlementId { get; set; }

    /// <summary>
    /// Date à laquelle la facture a été créditée pour ce paiement. Marqueur
    /// durable de reprise : le crédit lui-même reste protégé par l'identifiant
    /// de transaction poussé dans la facture.
    /// </summary>
    [BsonElement("blockchainCreditAppliedAt")]
    [BsonIgnoreIfNull]
    public DateTime? BlockchainCreditAppliedAt { get; set; }

    /// <summary>Date d'émission des notifications de succès (anti-doublon).</summary>
    [BsonElement("blockchainNotificationsSentAt")]
    [BsonIgnoreIfNull]
    public DateTime? BlockchainNotificationsSentAt { get; set; }

    [BsonElement("attempts")]
    public List<PaymentAttempt> Attempts { get; set; } = [];

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("completedAt")]
    public DateTime? CompletedAt { get; set; }
}
