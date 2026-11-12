using System.Globalization;
using System.Numerics;
using System.Text.RegularExpressions;

namespace FreelanceTn.Api.Configuration;

/// <summary>
/// Paramètres du réseau Ethereum utilisé pour un paiement MetaMask.
/// <c>RpcUrl</c> et <c>ReceiverAddress</c> sont propres à un réseau.
/// </summary>
public class BlockchainNetworkSettings
{
    /// <summary>URL JSON-RPC du réseau.</summary>
    public string RpcUrl { get; set; } = string.Empty;

    /// <summary>Adresse qui reçoit les ETH de ce réseau (configurée hors dépôt).</summary>
    public string ReceiverAddress { get; set; } = string.Empty;

    /// <summary>
    /// Nombre de confirmations propre à ce réseau. <c>null</c> = valeur globale
    /// <see cref="BlockchainSettings.MinConfirmations"/>. Utile pour Hardhat,
    /// où chaque transaction crée un bloc unique.
    /// </summary>
    public int? MinConfirmations { get; set; }
}

/// <summary>
/// Paramètres de l'intégration MetaMask. Deux réseaux de test sont pris en
/// charge : <b>Sepolia</b> (testnet public) et <b>Hardhat Local</b> (chaîne
/// locale, chainId 31337). Le réseau actif est choisi explicitement par
/// <c>Blockchain:Network</c> ; les configurations des deux réseaux sont
/// conservées séparément et aucune ne remplace l'autre.
///
/// Aucun parcours Mainnet n'existe : l'URL RPC du réseau actif est vérifiée au
/// démarrage, et le <c>chainId</c> est recontrôlé à chaque vérification de
/// paiement. Aucune clé privée n'est stockée côté serveur : le backend se
/// contente de lire la blockchain.
/// </summary>
public class BlockchainSettings
{
    public const string SectionName = "Blockchain";

    /// <summary>Identifiant officiel du réseau Sepolia.</summary>
    public const long SepoliaChainId = 11155111;

    public const string SepoliaChainIdHex = "0xaa36a7";

    /// <summary>Identifiant du réseau local Hardhat.</summary>
    public const long HardhatChainId = 31337;

    public const string HardhatChainIdHex = "0x7a69";

    /// <summary>Nœud public Sepolia utilisé par défaut (lecture seule).</summary>
    public const string DefaultRpcUrl = "https://ethereum-sepolia-rpc.publicnode.com";

    /// <summary>Nœud Hardhat local par défaut (lecture seule côté backend).</summary>
    public const string DefaultHardhatRpcUrl = "http://127.0.0.1:8545";

    public const string ExplorerBaseUrl = "https://sepolia.etherscan.io";

    public const string SepoliaNetworkName = "Sepolia";

    public const string HardhatNetworkName = "Hardhat Local";

    private static readonly Regex TxHashPattern = new("^0x[0-9a-fA-F]{64}$", RegexOptions.Compiled);
    private static readonly Regex AddressPattern = new("^0x[0-9a-fA-F]{40}$", RegexOptions.Compiled);

    /// <summary>Active le moyen de paiement MetaMask.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Réseau actif : « Sepolia » (défaut) ou « Hardhat » (local). La valeur est
    /// validée au démarrage : aucun réseau inconnu n'est accepté silencieusement.
    /// </summary>
    public string Network { get; set; } = SepoliaNetworkName;

    /// <summary>
    /// Ancienne configuration plate, conservée comme repli pour Sepolia afin de
    /// ne pas casser les installations existantes. Les nouvelles configurations
    /// utilisent les blocs <see cref="Sepolia"/> et <see cref="Hardhat"/>.
    /// </summary>
    public string RpcUrl { get; set; } = DefaultRpcUrl;

    /// <summary>Repli Sepolia de l'ancienne configuration plate.</summary>
    public string ReceiverAddress { get; set; } = string.Empty;

    /// <summary>Configuration du réseau Sepolia (conservée même en mode Hardhat).</summary>
    public BlockchainNetworkSettings Sepolia { get; set; } = new();

    /// <summary>Configuration du réseau Hardhat local (conservée même en mode Sepolia).</summary>
    public BlockchainNetworkSettings Hardhat { get; set; } = new() { RpcUrl = DefaultHardhatRpcUrl };

    /// <summary>
    /// Taux de démonstration : nombre de TND pour 1 ETH. Fixe et déterministe,
    /// il n'appelle aucun oracle externe. Partagé par les deux réseaux.
    /// </summary>
    public decimal TndPerEth { get; set; } = 3500m;

    /// <summary>Nombre de confirmations exigées avant de créditer la facture.</summary>
    public int MinConfirmations { get; set; } = 2;

    /// <summary>Délai maximal des appels RPC (secondes).</summary>
    public int TimeoutSeconds { get; set; } = 20;

    /// <summary>Le réseau actif est Hardhat Local.</summary>
    public bool IsHardhat => ParseNetwork(Network) == BlockchainNetwork.Hardhat;

    /// <summary>Nom lisible du réseau actif.</summary>
    public string ActiveNetworkName => IsHardhat ? HardhatNetworkName : SepoliaNetworkName;

    /// <summary>Clé technique du réseau actif (« sepolia » ou « hardhat »).</summary>
    public string ActiveNetworkKey => IsHardhat ? "hardhat" : "sepolia";

    /// <summary>chainId du réseau actif.</summary>
    public long ActiveChainId => IsHardhat ? HardhatChainId : SepoliaChainId;

    /// <summary>chainId du réseau actif au format hexadécimal RPC.</summary>
    public string ActiveChainIdHex => IsHardhat ? HardhatChainIdHex : SepoliaChainIdHex;

    /// <summary>
    /// URL RPC du réseau actif. En mode Sepolia, l'ancien réglage plat
    /// <c>Blockchain:RpcUrl</c> reste utilisé s'il n'existe pas de bloc dédié.
    /// </summary>
    public string ActiveRpcUrl => IsHardhat
        ? FirstNonEmpty(Hardhat.RpcUrl, DefaultHardhatRpcUrl)
        : FirstNonEmpty(Sepolia.RpcUrl, RpcUrl, DefaultRpcUrl);

    /// <summary>
    /// Adresse de réception du réseau actif. En mode Hardhat, on n'utilise
    /// jamais l'adresse Sepolia : les deux réseaux restent strictement séparés.
    /// </summary>
    public string ActiveReceiverAddress => (IsHardhat
        ? Hardhat.ReceiverAddress
        : FirstNonEmpty(Sepolia.ReceiverAddress, ReceiverAddress)).Trim();

    /// <summary>Explorateur du réseau actif (aucun explorateur public pour Hardhat).</summary>
    public string ActiveExplorerBaseUrl => IsHardhat ? string.Empty : ExplorerBaseUrl;

    /// <summary>
    /// Confirmations exigées sur le réseau actif : la valeur du réseau prime,
    /// sinon la valeur globale. Toujours bornée entre 1 et 20 à l'usage.
    /// </summary>
    public int ActiveMinConfirmations => (IsHardhat
        ? Hardhat.MinConfirmations
        : Sepolia.MinConfirmations) ?? MinConfirmations;

    /// <summary>L'intégration est réellement utilisable sur le réseau actif.</summary>
    public bool IsConfigured =>
        Enabled
        && IsValidAddress(ActiveReceiverAddress)
        && TndPerEth > 0m
        && IsActiveRpcUrlAllowed;

    /// <summary>L'URL du réseau actif respecte les garde-fous du réseau.</summary>
    public bool IsActiveRpcUrlAllowed =>
        Uri.TryCreate(ActiveRpcUrl, UriKind.Absolute, out var uri)
        && (IsHardhat ? IsLocalRpcUri(uri) : IsSepoliaRpcUri(uri));

    /// <summary>Ancien nom conservé pour la compatibilité des appels existants.</summary>
    public bool IsSepoliaRpcUrl => !IsHardhat && IsActiveRpcUrlAllowed;

    /// <summary>
    /// Refuse toute configuration incohérente au démarrage : Mainnet ou HTTP
    /// non local pour Sepolia, hôte non local pour Hardhat. Appelée au
    /// démarrage, il n'existe aucun chemin de code permettant de viser le
    /// réseau principal.
    /// </summary>
    public void EnsureSupportedNetwork()
    {
        var network = ParseNetwork(Network);

        if (!Uri.TryCreate(ActiveRpcUrl, UriKind.Absolute, out var uri))
        {
            throw new InvalidOperationException(
                $"Blockchain:RpcUrl n'est pas une URL absolue valide (valeur refusée : {ActiveRpcUrl}).");
        }

        if (network == BlockchainNetwork.Hardhat)
        {
            if (!IsLocalRpcUri(uri))
            {
                throw new InvalidOperationException(
                    "En mode Hardhat, Blockchain:Hardhat:RpcUrl doit pointer vers la boucle locale " +
                    "(http://127.0.0.1:8545, http://localhost:8545 ou http://[::1]:8545). " +
                    "Un réseau public est formellement refusé.");
            }
            return;
        }

        if (!string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                "En mode Sepolia, Blockchain:RpcUrl doit utiliser HTTPS. " +
                "Le projet est limité aux réseaux de test Sepolia et Hardhat local.");
        }

        if (uri.Host.Contains("mainnet", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                "Blockchain:RpcUrl pointe vers Mainnet. Seuls Ethereum Sepolia (chainId 11155111) " +
                "et Hardhat local (chainId 31337) sont autorisés.");
        }
    }

    /// <summary>Nom lisible d'un chainId de test pris en charge.</summary>
    public static string NetworkName(long? chainId) => chainId switch
    {
        HardhatChainId => HardhatNetworkName,
        SepoliaChainId => SepoliaNetworkName,
        _ => "Ethereum"
    };

    /// <summary>Seuls Sepolia et Hardhat local sont des réseaux acceptés.</summary>
    public static bool IsSupportedChainId(long? chainId) =>
        chainId is SepoliaChainId or HardhatChainId;

    /// <summary>
    /// Lien vers l'explorateur. Hardhat n'a pas d'explorateur public : aucun
    /// lien n'est produit pour ce réseau.
    /// </summary>
    public static string? ExplorerUrlForChain(long? chainId, string? txHash)
    {
        if (string.IsNullOrWhiteSpace(txHash) || !IsValidTxHash(txHash))
        {
            return null;
        }

        return chainId == HardhatChainId ? null : $"{ExplorerBaseUrl}/tx/{txHash.Trim()}";
    }

    public static bool IsValidAddress(string? value) =>
        !string.IsNullOrWhiteSpace(value) && AddressPattern.IsMatch(value.Trim());

    public static bool IsValidTxHash(string? value) =>
        !string.IsNullOrWhiteSpace(value) && TxHashPattern.IsMatch(value.Trim());

    /// <summary>
    /// Normalise un hash pour l'identité et l'index : minuscules, sans espace.
    /// Deux écritures de casse différente désignent la même transaction.
    /// </summary>
    public static string NormalizeTxHash(string? value) =>
        (value ?? string.Empty).Trim().ToLowerInvariant();

    /// <summary>
    /// Empreinte Genesis exploitable : 32 octets hexadécimaux, préfixe 0x.
    /// Un nœud qui ne fournit pas cette empreinte ne peut pas identifier une
    /// instance de chaîne : la vérification échoue alors en mode fermé.
    /// </summary>
    public static bool IsValidGenesisHash(string? value) =>
        !string.IsNullOrWhiteSpace(value) && TxHashPattern.IsMatch(value.Trim());

    public static bool AddressEquals(string? left, string? right) =>
        !string.IsNullOrWhiteSpace(left)
        && !string.IsNullOrWhiteSpace(right)
        && string.Equals(left.Trim(), right.Trim(), StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Convertit un montant TND en wei, arrondi au wei supérieur pour ne jamais
    /// sous-facturer. Le calcul est déterministe et n'utilise aucun oracle.
    /// </summary>
    public static string ComputeWei(decimal amountTnd, decimal tndPerEth)
    {
        if (tndPerEth <= 0m)
        {
            throw new InvalidOperationException("Blockchain:TndPerEth doit être strictement positif.");
        }

        var eth = amountTnd / tndPerEth;
        var wei = decimal.Ceiling(eth * 1_000_000_000_000_000_000m);
        return new BigInteger(wei).ToString(CultureInfo.InvariantCulture);
    }

    /// <summary>Convertit une quantité de wei en ETH (affichage).</summary>
    public static decimal ToEth(string? wei)
    {
        if (string.IsNullOrWhiteSpace(wei) || !BigInteger.TryParse(wei, out var value))
        {
            return 0m;
        }

        try
        {
            return (decimal)value / 1_000_000_000_000_000_000m;
        }
        catch (OverflowException)
        {
            return 0m;
        }
    }

    private static BlockchainNetwork ParseNetwork(string? value)
    {
        var normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
        return normalized switch
        {
            "" or "sepolia" or "11155111" or "testnet" => BlockchainNetwork.Sepolia,
            "hardhat" or "hardhat local" or "hardhat-local" or "hardhat_local"
                or "localhost" or "local" or "31337" => BlockchainNetwork.Hardhat,
            _ => throw new InvalidOperationException(
                $"Blockchain:Network « {value} » n'est pas reconnu. " +
                "Valeurs acceptées : Sepolia, Hardhat.")
        };
    }

    private static bool IsLocalRpcUri(Uri uri) =>
        (string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
         || string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        && uri.IsLoopback;

    private static bool IsSepoliaRpcUri(Uri uri) =>
        string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
        && !uri.Host.Contains("mainnet", StringComparison.OrdinalIgnoreCase);

    private static string FirstNonEmpty(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value)) ?? string.Empty;

    private enum BlockchainNetwork
    {
        Sepolia,
        Hardhat
    }
}
