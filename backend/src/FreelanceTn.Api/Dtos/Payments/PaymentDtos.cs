namespace FreelanceTn.Api.Dtos.Payments;

public class CreatePaymentRequest
{
    public string InvoiceId { get; set; } = string.Empty;

    /// <summary>
    /// « internal » (défaut), « konnect » ou « blockchain ». Une valeur inconnue
    /// est refusée : aucun repli silencieux vers un autre moteur.
    /// </summary>
    public string? Provider { get; set; }

    /// <summary>Montant demandé. Toujours revalidé côté serveur contre le solde réel.</summary>
    public decimal Amount { get; set; }

    public string? Method { get; set; }
    public string? Note { get; set; }
    public string? IdempotencyKey { get; set; }

    /// <summary>
    /// Résultat attendu du traitement interne. Utilisé uniquement par les
    /// scénarios de test automatisés (échec/reprise) ; l'interface n'expose
    /// jamais cette option.
    /// </summary>
    public string? SimulateOutcome { get; set; }

    /// <summary>
    /// Crée une transaction en attente sans la traiter immédiatement. Permet
    /// de tester l'annulation d'une transaction avant traitement.
    /// </summary>
    public bool DeferProcessing { get; set; }
}

public class ProcessPaymentRequest
{
    public string? SimulateOutcome { get; set; }
}

public class RetryPaymentRequest
{
    public string? SimulateOutcome { get; set; }
}

public class CancelPaymentRequest
{
    public string? Reason { get; set; }
}

public class PaymentAttemptResponse
{
    public int AttemptNumber { get; set; }
    public string Status { get; set; } = string.Empty;
    public string? ErrorCode { get; set; }
    public string? ErrorMessage { get; set; }
    public DateTime StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}

public class PaymentTransactionResponse
{
    public string Id { get; set; } = string.Empty;
    public string Reference { get; set; } = string.Empty;
    public string InvoiceId { get; set; } = string.Empty;
    public string InvoiceNumber { get; set; } = string.Empty;
    public string ClientId { get; set; } = string.Empty;
    public string ClientName { get; set; } = string.Empty;
    public string FreelancerId { get; set; } = string.Empty;
    public string FreelancerName { get; set; } = string.Empty;
    public string ProjectId { get; set; } = string.Empty;
    public string ProjectTitle { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "TND";
    public string Method { get; set; } = string.Empty;
    public string MethodLabel { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string? Note { get; set; }
    public decimal InvoiceTotal { get; set; }
    public decimal BalanceBefore { get; set; }
    public decimal? BalanceAfter { get; set; }
    public string? ReceiptNumber { get; set; }
    public bool ReceiptAvailable { get; set; }
    public string? ErrorCode { get; set; }
    public string? ErrorMessage { get; set; }
    public string? IdempotencyKey { get; set; }
    public bool Legacy { get; set; }

    /// <summary>« internal », « konnect » ou « blockchain ».</summary>
    public string Provider { get; set; } = "internal";

    public string? ProviderPaymentRef { get; set; }
    public string? ProviderPayUrl { get; set; }
    public string? ProviderStatus { get; set; }
    public DateTime? ProviderLastCheckedAt { get; set; }

    // --- Blockchain Ethereum (MetaMask) ----------------------------------
    public string? BlockchainTxHash { get; set; }
    public string? WalletAddress { get; set; }
    public long? BlockchainChainId { get; set; }
    public string? BlockchainReceiver { get; set; }
    public string? BlockchainAmountWei { get; set; }
    public decimal? BlockchainAmountEth { get; set; }
    public decimal? BlockchainTndPerEth { get; set; }
    public string? BlockchainExplorerUrl { get; set; }
    public int? BlockchainConfirmations { get; set; }

    /// <summary>Empreinte Genesis de l'instance de chaîne de l'intention.</summary>
    public string? BlockchainGenesisHash { get; set; }

    /// <summary>Timestamp Unix du bloc Genesis enregistré.</summary>
    public long? BlockchainGenesisTimestamp { get; set; }

    /// <summary>Vrai si le même hash a été crédité sur une autre instance.</summary>
    public bool BlockchainCrossGenesis { get; set; }

    /// <summary>Paiement antérieur portant le même hash sur une autre instance.</summary>
    public string? BlockchainReplayOfPaymentId { get; set; }

    /// <summary>Vrai quand le client doit être redirigé vers la page hébergée.</summary>
    public bool GatewayRedirect { get; set; }

    public List<PaymentAttemptResponse> Attempts { get; set; } = [];
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}

public class VerifyBlockchainRequest
{
    /// <summary>Hash de la transaction fourni par le frontend (jamais un statut).</summary>
    public string TxHash { get; set; } = string.Empty;
}

/// <summary>
/// Réconciliation manuelle et auditée d'un transfert blockchain dont le hash a
/// déjà crédité un paiement historique dont l'empreinte Genesis est inconnue.
/// L'opérateur doit fournir explicitement le paiement antérieur et confirmer.
/// </summary>
public class ReconcileBlockchainCrossGenesisRequest
{
    /// <summary>Identifiant du paiement antérieur déjà réussi (ex. PAY-20261110-C0DCEB).</summary>
    public string PreviousPaymentId { get; set; } = string.Empty;

    /// <summary>Hash du transfert, identique à celui du paiement antérieur.</summary>
    public string TxHash { get; set; } = string.Empty;

    /// <summary>Confirmation explicite de l'opérateur (aucune valeur par défaut).</summary>
    public bool Confirm { get; set; }
}

public class BlockchainBalanceResponse
{
    /// <summary>Nom lisible du réseau actif (« Sepolia » ou « Hardhat Local »).</summary>
    public string Network { get; set; } = string.Empty;

    /// <summary>Clé technique du réseau actif (« sepolia » ou « hardhat »).</summary>
    public string NetworkKey { get; set; } = string.Empty;

    public long ChainId { get; set; }

    /// <summary>Adresse interrogée (celle de réception par défaut si non fournie).</summary>
    public string Address { get; set; } = string.Empty;

    /// <summary>Solde lu par eth_getBalance, en wei (chaîne décimale exacte).</summary>
    public string BalanceWei { get; set; } = "0";

    /// <summary>Même solde converti pour l'affichage.</summary>
    public decimal BalanceEth { get; set; }

    /// <summary>Hauteur de bloc au moment de la lecture.</summary>
    public long BlockNumber { get; set; }

    /// <summary>Horodatage UTC de la lecture RPC.</summary>
    public DateTime CheckedAt { get; set; }
}

public class BlockchainConfigResponse
{
    public bool Enabled { get; set; }

    /// <summary>Nom lisible du réseau actif (« Sepolia » ou « Hardhat Local »).</summary>
    public string Network { get; set; } = string.Empty;

    /// <summary>Clé technique du réseau actif (« sepolia » ou « hardhat »).</summary>
    public string NetworkKey { get; set; } = string.Empty;

    public long ChainId { get; set; }
    public string ChainIdHex { get; set; } = string.Empty;

    /// <summary>URL RPC du réseau actif (publique, jamais une clé privée).</summary>
    public string RpcUrl { get; set; } = string.Empty;

    public string Receiver { get; set; } = string.Empty;
    public decimal TndPerEth { get; set; }
    public int MinConfirmations { get; set; }
    public string ExplorerBaseUrl { get; set; } = string.Empty;
}

public class PaymentResultResponse
{
    public PaymentTransactionResponse Transaction { get; set; } = new();
    public FreelanceTn.Api.Dtos.Invoices.InvoiceResponse Invoice { get; set; } = new();
}
