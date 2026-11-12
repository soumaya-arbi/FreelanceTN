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
/// Tests de la vérification on-chain MetaMask / Ethereum Sepolia. Le nœud
/// JSON-RPC est remplacé par un handler en mémoire : aucun appel réseau réel,
/// aucune clé privée, aucune écriture dans la base de développement. Les
/// scénarios couvrent réseau, destinataire, montant, confirmations, rejeu,
/// liaison du portefeuille et impossibilité de contourner la blockchain.
/// </summary>
public class SepoliaPaymentTests : IClassFixture<MongoFixture>
{
    private const string Receiver = "0x1111111111111111111111111111111111111111";
    private const string Sender = "0x2222222222222222222222222222222222222222";
    private const string OtherWallet = "0x3333333333333333333333333333333333333333";
    // Comptes de développement Hardhat (valeurs publiques, sans fonds réel).
    private const string HardhatReceiver = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    private const string HardhatSender = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    private readonly string _txHash =
        "0x" + Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
    // 350 TND au taux de 3 500 TND/ETH = 0,1 ETH.
    private const string ExpectedWei = "100000000000000000";

    private readonly MongoFixture _fixture;

    public SepoliaPaymentTests(MongoFixture fixture)
    {
        _fixture = fixture;
    }

    private MongoContext Mongo => _fixture.Context;

    private IMongoCollection<PaymentTransaction> Payments =>
        Mongo.GetCollection<PaymentTransaction>(Mongo.Settings.PaymentsCollection);

    private IMongoCollection<Invoice> Invoices =>
        Mongo.GetCollection<Invoice>(Mongo.Settings.InvoicesCollection);

    private IMongoCollection<User> Users =>
        Mongo.GetCollection<User>(Mongo.Settings.UsersCollection);

    private static BlockchainSettings DefaultSettings() => new()
    {
        Enabled = true,
        RpcUrl = BlockchainSettings.DefaultRpcUrl,
        ReceiverAddress = Receiver,
        TndPerEth = 3500m,
        MinConfirmations = 2,
    };

    private static BlockchainSettings HardhatSettings() => new()
    {
        Enabled = true,
        Network = "Hardhat",
        Hardhat = new BlockchainNetworkSettings
        {
            RpcUrl = "http://127.0.0.1:8545",
            ReceiverAddress = HardhatReceiver,
        },
        TndPerEth = 3500m,
        MinConfirmations = 2,
    };

    private PaymentService CreateService(SepoliaStub stub, BlockchainSettings? settings = null)
    {
        settings ??= DefaultSettings();
        var http = new HttpClient(stub);
        var rpc = new EthereumRpcClient(http, settings, NullLogger<EthereumRpcClient>.Instance);
        return new PaymentService(
            Mongo,
            new ReceiptPdfService(),
            konnect: null,
            konnectSettings: null,
            rpc: rpc,
            blockchainSettings: settings);
    }

    private async Task<Invoice> InsertInvoiceAsync(
        User freelancer,
        User client,
        decimal total = 1000m)
    {
        var invoice = new Invoice
        {
            Id = MongoFixture.NewId(),
            Number = $"FAC-SEPOLIA-{MongoFixture.NewId()[..6]}",
            OwnerId = freelancer.Id,
            ClientId = client.Id,
            Client = $"{client.FirstName} {client.LastName}",
            ProjectId = MongoFixture.NewId(),
            Project = "Projet Sepolia",
            IssueDate = DateTime.UtcNow.ToString("yyyy-MM-dd"),
            DueDate = DateTime.UtcNow.AddDays(30).ToString("yyyy-MM-dd"),
            Status = InvoiceStatus.Unpaid,
            Lines = [],
            Notes = string.Empty,
            Subtotal = total,
            DiscountTotal = 0m,
            TaxTotal = 0m,
            Total = total,
            AmountPaid = 0m,
            BalanceDue = total,
            Payments = [],
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        await Invoices.InsertOneAsync(invoice);
        return invoice;
    }

    private async Task<(User Freelancer, User Client, Invoice Invoice)> SeedAsync(decimal total = 1000m)
    {
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Sepolia", "Paye");
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Sepolia", "Client");
        var invoice = await InsertInvoiceAsync(freelancer, client, total);
        return (freelancer, client, invoice);
    }

    private static Task<PaymentTransactionResponse> PayAsync(
        PaymentService service,
        User client,
        Invoice invoice,
        decimal amount = 350m,
        string provider = PaymentProvider.Blockchain) =>
        service.CreateAsync(client.Id, new CreatePaymentRequest
        {
            InvoiceId = invoice.Id,
            Amount = amount,
            Method = PaymentMethod.MetaMask,
            Provider = provider,
            Note = "Test Sepolia",
        }, CancellationToken.None);

    private Task<PaymentTransactionResponse> VerifyAsync(
        PaymentService service,
        User client,
        PaymentTransactionResponse transaction,
        string? hash = null) =>
        service.VerifyBlockchainAsync(
            client.Id,
            transaction.Id,
            hash ?? _txHash,
            CancellationToken.None);

    private async Task<Invoice> ReloadInvoiceAsync(Invoice invoice) =>
        await Invoices.Find(i => i.Id == invoice.Id).FirstAsync();

    private async Task<PaymentTransaction> ReloadTransactionAsync(PaymentTransactionResponse transaction) =>
        await Payments.Find(t => t.Id == transaction.Id).FirstAsync();

    [Fact]
    public async Task CreateMetaMask_WithoutProof_StaysPending_AndNeverCreditsInvoice()
    {
        var (_, client, invoice) = await SeedAsync();
        var service = CreateService(new SepoliaStub());

        var transaction = await PayAsync(service, client, invoice);

        Assert.Equal(PaymentTransactionStatus.Pending, transaction.Status);
        Assert.Equal(PaymentProvider.Blockchain, transaction.Provider);
        Assert.Equal(PaymentMethod.MetaMask, transaction.Method);
        Assert.Equal(BlockchainSettings.SepoliaChainId, transaction.BlockchainChainId);
        Assert.Equal(Receiver, transaction.BlockchainReceiver);
        Assert.Equal(ExpectedWei, transaction.BlockchainAmountWei);
        Assert.Equal(0.1m, transaction.BlockchainAmountEth);
        Assert.Null(transaction.BlockchainTxHash);
        Assert.False(transaction.ReceiptAvailable);

        var stored = await ReloadInvoiceAsync(invoice);
        Assert.Equal(0m, stored.AmountPaid);
        Assert.Equal(1000m, stored.BalanceDue);
    }

    [Fact]
    public async Task Verify_AcceptsOnlyAfterRequiredConfirmations_ThenCreditsOnce()
    {
        const long block = 500;
        var (_, client, invoice) = await SeedAsync();
        var stub = new SepoliaStub
        {
            LatestBlock = block, // 1 confirmation : insuffisant
            TransactionJson = SepoliaStub.Transaction(_txHash, Sender, Receiver, ExpectedWei, block),
            ReceiptJson = SepoliaStub.Receipt(block),
        };
        var service = CreateService(stub);

        var transaction = await PayAsync(service, client, invoice);
        var first = await VerifyAsync(service, client, transaction);

        Assert.Equal(PaymentTransactionStatus.Pending, first.Status);
        // Le hash est conservé même avant le seuil de confirmations : le client
        // peut revérifier sans redemander un transfert MetaMask.
        Assert.Equal(_txHash, first.BlockchainTxHash);
        Assert.Equal(0m, (await ReloadInvoiceAsync(invoice)).AmountPaid);

        stub.LatestBlock = block + 1; // 2 confirmations
        var second = await VerifyAsync(service, client, transaction);

        Assert.Equal(PaymentTransactionStatus.Succeeded, second.Status);
        Assert.Equal(_txHash, second.BlockchainTxHash);
        Assert.Equal(Sender, second.WalletAddress);
        Assert.True(second.ReceiptAvailable);
        Assert.NotNull(second.ReceiptNumber);
        Assert.Equal(2, second.BlockchainConfirmations);
        Assert.Equal(
            $"{BlockchainSettings.ExplorerBaseUrl}/tx/{_txHash}",
            second.BlockchainExplorerUrl);

        var storedInvoice = await ReloadInvoiceAsync(invoice);
        Assert.Equal(350m, storedInvoice.AmountPaid);
        Assert.Equal(650m, storedInvoice.BalanceDue);

        // Une seconde vérification ne recrédite rien.
        await VerifyAsync(service, client, transaction);
        Assert.Equal(350m, (await ReloadInvoiceAsync(invoice)).AmountPaid);
    }

    [Fact]
    public async Task Verify_RejectsTransactionSentToAnotherRecipient()
    {
        const long block = 500;
        var (_, client, invoice) = await SeedAsync();
        var stub = new SepoliaStub
        {
            LatestBlock = block + 5,
            TransactionJson = SepoliaStub.Transaction(_txHash, Sender, OtherWallet, ExpectedWei, block),
            ReceiptJson = SepoliaStub.Receipt(block),
        };
        var service = CreateService(stub);

        var transaction = await PayAsync(service, client, invoice);
        var result = await VerifyAsync(service, client, transaction);

        Assert.Equal(PaymentTransactionStatus.Failed, result.Status);
        Assert.Equal("blockchain_wrong_recipient", result.ErrorCode);
        Assert.Null(result.BlockchainTxHash);
        Assert.Equal(0m, (await ReloadInvoiceAsync(invoice)).AmountPaid);
    }

    [Fact]
    public async Task Verify_RejectsWrongAmount_EvenOneWeiShort()
    {
        const long block = 500;
        var (_, client, invoice) = await SeedAsync();
        var stub = new SepoliaStub
        {
            LatestBlock = block + 5,
            TransactionJson = SepoliaStub.Transaction(
                _txHash, Sender, Receiver, "99999999999999999", block),
            ReceiptJson = SepoliaStub.Receipt(block),
        };
        var service = CreateService(stub);

        var transaction = await PayAsync(service, client, invoice);
        var result = await VerifyAsync(service, client, transaction);

        Assert.Equal(PaymentTransactionStatus.Failed, result.Status);
        Assert.Equal("blockchain_wrong_amount", result.ErrorCode);
        Assert.Equal(0m, (await ReloadInvoiceAsync(invoice)).AmountPaid);
    }

    [Fact]
    public async Task Verify_RejectsFailedOnChainTransaction()
    {
        const long block = 500;
        var (_, client, invoice) = await SeedAsync();
        var stub = new SepoliaStub
        {
            LatestBlock = block + 5,
            TransactionJson = SepoliaStub.Transaction(_txHash, Sender, Receiver, ExpectedWei, block),
            ReceiptJson = SepoliaStub.Receipt(block, "0x0"),
        };
        var service = CreateService(stub);

        var transaction = await PayAsync(service, client, invoice);
        var result = await VerifyAsync(service, client, transaction);

        Assert.Equal(PaymentTransactionStatus.Failed, result.Status);
        Assert.Equal("blockchain_tx_failed", result.ErrorCode);
        Assert.Equal(0m, (await ReloadInvoiceAsync(invoice)).AmountPaid);
    }

    [Fact]
    public async Task Verify_RejectsRpcThatIsNotSepolia()
    {
        var (_, client, invoice) = await SeedAsync();
        var stub = new SepoliaStub { ChainId = "0x1" };
        var service = CreateService(stub);

        var transaction = await PayAsync(service, client, invoice);
        var result = await VerifyAsync(service, client, transaction);

        Assert.Equal(PaymentTransactionStatus.Failed, result.Status);
        Assert.Equal("blockchain_wrong_network", result.ErrorCode);
        Assert.Equal(0m, (await ReloadInvoiceAsync(invoice)).AmountPaid);
    }

    [Fact]
    public async Task Verify_KeepsPending_WhenTransactionIsNotMinedYet()
    {
        var (_, client, invoice) = await SeedAsync();
        var stub = new SepoliaStub { TransactionJson = null, ReceiptJson = null };
        var service = CreateService(stub);

        var transaction = await PayAsync(service, client, invoice);
        var result = await VerifyAsync(service, client, transaction);

        Assert.Equal(PaymentTransactionStatus.Pending, result.Status);
        Assert.Null(result.BlockchainTxHash);
        Assert.Equal(0m, (await ReloadInvoiceAsync(invoice)).AmountPaid);
    }

    [Fact]
    public async Task Verify_BlocksReplayOfTheSameHashOnAnotherInvoice()
    {
        const long block = 700;
        var (freelancer, client, firstInvoice) = await SeedAsync();
        var secondInvoice = await InsertInvoiceAsync(freelancer, client);
        var stub = new SepoliaStub
        {
            LatestBlock = block + 5,
            TransactionJson = SepoliaStub.Transaction(_txHash, Sender, Receiver, ExpectedWei, block),
            ReceiptJson = SepoliaStub.Receipt(block),
        };
        var service = CreateService(stub);

        var first = await PayAsync(service, client, firstInvoice);
        var firstResult = await VerifyAsync(service, client, first);
        Assert.Equal(PaymentTransactionStatus.Succeeded, firstResult.Status);

        var second = await PayAsync(service, client, secondInvoice);
        var secondResult = await VerifyAsync(service, client, second);

        // Le rejeu est refusé sans bloquer le paiement en « pending » : le
        // second paiement est clôturé et la facture reste intacte.
        Assert.Equal(PaymentTransactionStatus.Failed, secondResult.Status);
        Assert.Equal("blockchain_tx_already_credited", secondResult.ErrorCode);
        Assert.Equal(first.Id, secondResult.BlockchainReplayOfPaymentId);
        Assert.Equal(0m, (await ReloadInvoiceAsync(secondInvoice)).AmountPaid);
        Assert.Equal(350m, (await ReloadInvoiceAsync(firstInvoice)).AmountPaid);
    }

    [Fact]
    public async Task Verify_RejectsWalletDifferentFromTheOneBoundToAccount()
    {
        const long block = 500;
        var (_, client, invoice) = await SeedAsync();
        await Users.UpdateOneAsync(
            u => u.Id == client.Id,
            Builders<User>.Update.Set(u => u.WalletAddress, OtherWallet));

        var stub = new SepoliaStub
        {
            LatestBlock = block + 5,
            TransactionJson = SepoliaStub.Transaction(_txHash, Sender, Receiver, ExpectedWei, block),
            ReceiptJson = SepoliaStub.Receipt(block),
        };
        var service = CreateService(stub);

        var transaction = await PayAsync(service, client, invoice);
        var result = await VerifyAsync(service, client, transaction);

        Assert.Equal(PaymentTransactionStatus.Failed, result.Status);
        Assert.Equal("blockchain_wallet_mismatch", result.ErrorCode);
        Assert.Equal(0m, (await ReloadInvoiceAsync(invoice)).AmountPaid);
    }

    [Fact]
    public async Task Verify_BindsTheSenderWallet_OnFirstSuccessfulPayment()
    {
        const long block = 500;
        var (_, client, invoice) = await SeedAsync();
        var stub = new SepoliaStub
        {
            LatestBlock = block + 5,
            TransactionJson = SepoliaStub.Transaction(_txHash, Sender, Receiver, ExpectedWei, block),
            ReceiptJson = SepoliaStub.Receipt(block),
        };
        var service = CreateService(stub);

        var transaction = await PayAsync(service, client, invoice);
        var result = await VerifyAsync(service, client, transaction);

        Assert.Equal(PaymentTransactionStatus.Succeeded, result.Status);
        var storedUser = await Users.Find(u => u.Id == client.Id).FirstAsync();
        Assert.Equal(Sender, storedUser.WalletAddress);
    }

    [Fact]
    public async Task CreateOnHardhat_FreezesChain31337AndHardhatReceiver()
    {
        var (_, client, invoice) = await SeedAsync();
        var service = CreateService(new SepoliaStub { ChainId = "0x7a69" }, HardhatSettings());

        var transaction = await PayAsync(service, client, invoice);

        Assert.Equal(PaymentTransactionStatus.Pending, transaction.Status);
        Assert.Equal(PaymentProvider.Blockchain, transaction.Provider);
        Assert.Equal(BlockchainSettings.HardhatChainId, transaction.BlockchainChainId);
        Assert.Equal(HardhatReceiver, transaction.BlockchainReceiver);
        Assert.Equal(ExpectedWei, transaction.BlockchainAmountWei);
        Assert.Null(transaction.BlockchainTxHash);
        Assert.Null(transaction.BlockchainExplorerUrl);
        Assert.Equal(0m, (await ReloadInvoiceAsync(invoice)).AmountPaid);
    }

    [Fact]
    public async Task VerifyOnHardhat_CreditsOnceAfterConfirmations()
    {
        const long block = 42;
        var (_, client, invoice) = await SeedAsync();
        var stub = new SepoliaStub
        {
            ChainId = BlockchainSettings.HardhatChainIdHex,
            LatestBlock = block,
            TransactionJson = SepoliaStub.Transaction(
                _txHash, HardhatSender, HardhatReceiver, ExpectedWei, block),
            ReceiptJson = SepoliaStub.Receipt(block),
        };
        var service = CreateService(stub, HardhatSettings());

        var transaction = await PayAsync(service, client, invoice);
        var first = await VerifyAsync(service, client, transaction);
        Assert.Equal(PaymentTransactionStatus.Pending, first.Status);
        Assert.Equal(_txHash, first.BlockchainTxHash);
        Assert.Equal(0m, (await ReloadInvoiceAsync(invoice)).AmountPaid);

        stub.LatestBlock = block + 1;
        var second = await VerifyAsync(service, client, transaction);

        Assert.Equal(PaymentTransactionStatus.Succeeded, second.Status);
        Assert.Equal(BlockchainSettings.HardhatChainId, second.BlockchainChainId);
        Assert.Equal(2, second.BlockchainConfirmations);
        Assert.Null(second.BlockchainExplorerUrl);
        Assert.Equal("MetaMask (Hardhat Local)", second.MethodLabel);
        Assert.Equal(350m, (await ReloadInvoiceAsync(invoice)).AmountPaid);

        await VerifyAsync(service, client, transaction);
        Assert.Equal(350m, (await ReloadInvoiceAsync(invoice)).AmountPaid);
    }

    [Fact]
    public async Task HardhatIntent_IsRejectedByASepoliaNode()
    {
        const long block = 500;
        var (_, client, invoice) = await SeedAsync();
        var stub = new SepoliaStub
        {
            ChainId = BlockchainSettings.SepoliaChainIdHex,
            LatestBlock = block + 5,
            TransactionJson = SepoliaStub.Transaction(
                _txHash, HardhatSender, HardhatReceiver, ExpectedWei, block),
            ReceiptJson = SepoliaStub.Receipt(block),
        };
        var service = CreateService(stub, HardhatSettings());

        var transaction = await PayAsync(service, client, invoice);
        var result = await VerifyAsync(service, client, transaction);

        Assert.Equal(PaymentTransactionStatus.Failed, result.Status);
        Assert.Equal("blockchain_wrong_network", result.ErrorCode);
        Assert.Equal(0m, (await ReloadInvoiceAsync(invoice)).AmountPaid);
    }

    [Fact]
    public async Task Create_ForcesBlockchainProvider_EvenIfClientRequestsInternal()
    {
        var (_, client, invoice) = await SeedAsync();
        var service = CreateService(new SepoliaStub());

        var transaction = await PayAsync(
            service, client, invoice, provider: PaymentProvider.Internal);

        Assert.Equal(PaymentProvider.Blockchain, transaction.Provider);
        Assert.Equal(PaymentTransactionStatus.Pending, transaction.Status);
    }

    [Fact]
    public async Task Create_RejectsBlockchainProvider_ForNonMetaMaskMethod()
    {
        var (_, client, invoice) = await SeedAsync();
        var service = CreateService(new SepoliaStub());

        await Assert.ThrowsAsync<BadRequestException>(() =>
            service.CreateAsync(client.Id, new CreatePaymentRequest
            {
                InvoiceId = invoice.Id,
                Amount = 100m,
                Method = PaymentMethod.Card,
                Provider = PaymentProvider.Blockchain,
            }, CancellationToken.None));
    }

    [Fact]
    public async Task Create_RefusesMetaMask_WhenReceiverIsNotConfigured()
    {
        var (_, client, invoice) = await SeedAsync();
        var settings = DefaultSettings();
        settings.ReceiverAddress = string.Empty;
        var service = CreateService(new SepoliaStub(), settings);

        await Assert.ThrowsAsync<PaymentGatewayException>(() =>
            PayAsync(service, client, invoice));

        Assert.Empty(await Payments.Find(t => t.InvoiceId == invoice.Id).ToListAsync());
    }

    [Fact]
    public async Task Verify_RejectsMalformedHash_WithoutCallingTheNode()
    {
        var (_, client, invoice) = await SeedAsync();
        var stub = new SepoliaStub();
        var service = CreateService(stub);

        var transaction = await PayAsync(service, client, invoice);
        var callsAfterCreate = stub.Calls;

        await Assert.ThrowsAsync<BadRequestException>(() =>
            VerifyAsync(service, client, transaction, hash: "0x1234"));
        // La validation du hash précède tout appel au nœud : aucun RPC de
        // vérification n'est émis (les appels de création d'intention sont
        // antérieurs et ne comptent pas ici).
        Assert.Equal(callsAfterCreate, stub.Calls);
    }

    [Fact]
    public async Task Process_RetryAndCancel_AreRefusedForMetaMask()
    {
        var (_, client, invoice) = await SeedAsync();
        var service = CreateService(new SepoliaStub());
        var transaction = await PayAsync(service, client, invoice);

        // Même une transaction déjà marquée échouée ne peut pas repasser par
        // le moteur interne : la blockchain est la seule source de vérité.
        await Payments.UpdateOneAsync(
            t => t.Id == transaction.Id,
            Builders<PaymentTransaction>.Update.Set(
                t => t.Status, PaymentTransactionStatus.Failed));

        await Assert.ThrowsAsync<ConflictException>(() =>
            service.ProcessAsync(client.Id, transaction.Id, null, CancellationToken.None));
        await Assert.ThrowsAsync<ConflictException>(() =>
            service.RetryAsync(client.Id, transaction.Id, null, CancellationToken.None));
        await Assert.ThrowsAsync<ConflictException>(() =>
            service.CancelAsync(client.Id, transaction.Id, "test", CancellationToken.None));

        var stored = await ReloadTransactionAsync(transaction);
        Assert.Equal(PaymentTransactionStatus.Failed, stored.Status);
        Assert.Equal(0m, (await ReloadInvoiceAsync(invoice)).AmountPaid);
    }

    [Fact]
    public async Task FreelancerCannotVerifyAPayment()
    {
        var (freelancer, client, invoice) = await SeedAsync();
        var service = CreateService(new SepoliaStub());
        var transaction = await PayAsync(service, client, invoice);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            service.VerifyBlockchainAsync(
                freelancer.Id, transaction.Id, _txHash, CancellationToken.None));
    }

    [Fact]
    public void GetBlockchainConfig_ExposesSepoliaAndFixedRate()
    {
        var settings = DefaultSettings();
        var service = CreateService(new SepoliaStub(), settings);

        var config = service.GetBlockchainConfig();

        Assert.True(config.Enabled);
        Assert.Equal(BlockchainSettings.SepoliaChainId, config.ChainId);
        Assert.Equal(BlockchainSettings.SepoliaChainIdHex, config.ChainIdHex);
        Assert.Equal(BlockchainSettings.SepoliaNetworkName, config.Network);
        Assert.Equal("sepolia", config.NetworkKey);
        Assert.Equal(Receiver, config.Receiver);
        Assert.Equal(3500m, config.TndPerEth);
        Assert.Equal(2, config.MinConfirmations);
    }

    [Fact]
    public async Task GetBlockchainBalance_ReadsRealReceiverBalance()
    {
        var stub = new SepoliaStub { BalanceWei = "1234500000000000000", LatestBlock = 4242 };
        var service = CreateService(stub, DefaultSettings());

        var balance = await service.GetBlockchainBalanceAsync(null, CancellationToken.None);

        Assert.Equal(BlockchainSettings.SepoliaNetworkName, balance.Network);
        Assert.Equal(BlockchainSettings.SepoliaChainId, balance.ChainId);
        Assert.Equal(Receiver, balance.Address);
        Assert.Equal("1234500000000000000", balance.BalanceWei);
        Assert.Equal(1.2345m, balance.BalanceEth);
        Assert.Equal(4242, balance.BlockNumber);
        Assert.NotEqual(default, balance.CheckedAt);
    }

    [Fact]
    public async Task GetBlockchainBalance_AcceptsExplicitClientAddress()
    {
        var stub = new SepoliaStub { BalanceWei = "500000000000000000" };
        var service = CreateService(stub, DefaultSettings());

        var balance = await service.GetBlockchainBalanceAsync(Sender, CancellationToken.None);

        Assert.Equal(Sender, balance.Address);
        Assert.Equal(0.5m, balance.BalanceEth);
    }

    [Fact]
    public async Task GetBlockchainBalance_RejectsInvalidAddress_WithoutCallingRpc()
    {
        var stub = new SepoliaStub();
        var service = CreateService(stub, DefaultSettings());

        await Assert.ThrowsAsync<BadRequestException>(() =>
            service.GetBlockchainBalanceAsync("0xnot-an-address", CancellationToken.None));
        Assert.Equal(0, stub.Calls);
    }

    [Fact]
    public async Task GetBlockchainBalance_RejectsWrongNetwork()
    {
        var stub = new SepoliaStub { ChainId = "0x1" };
        var service = CreateService(stub, DefaultSettings());

        var error = await Assert.ThrowsAsync<PaymentGatewayException>(() =>
            service.GetBlockchainBalanceAsync(null, CancellationToken.None));
        Assert.Contains("ne sert pas Sepolia", error.Message);
    }

    [Fact]
    public async Task GetBlockchainBalance_FailsClosedWhenRpcIsDown()
    {
        var stub = new SepoliaStub { FailBalance = true };
        var service = CreateService(stub, DefaultSettings());

        await Assert.ThrowsAsync<PaymentGatewayException>(() =>
            service.GetBlockchainBalanceAsync(null, CancellationToken.None));
    }

    [Fact]
    public async Task GetBlockchainBalance_FailsClosedWhenReceiverIsMissing()
    {
        var settings = DefaultSettings();
        settings.ReceiverAddress = string.Empty;
        var service = CreateService(new SepoliaStub(), settings);

        await Assert.ThrowsAsync<PaymentGatewayException>(() =>
            service.GetBlockchainBalanceAsync(null, CancellationToken.None));
    }

    [Fact]
    public void GetBlockchainConfig_IsDisabled_WhenReceiverIsMissing()
    {
        var settings = DefaultSettings();
        settings.ReceiverAddress = string.Empty;
        var service = CreateService(new SepoliaStub(), settings);

        var config = service.GetBlockchainConfig();

        Assert.False(config.Enabled);
        Assert.Equal(string.Empty, config.Receiver);
    }

    [Fact]
    public void SepoliaGuard_RefusesMainnetRpc()
    {
        var settings = DefaultSettings();
        settings.RpcUrl = "https://ethereum-mainnet-rpc.example.com";

        Assert.Throws<InvalidOperationException>(settings.EnsureSupportedNetwork);
        Assert.False(settings.IsConfigured);
    }

    [Fact]
    public void SepoliaGuard_RefusesPlainHttp()
    {
        var settings = DefaultSettings();
        settings.RpcUrl = "http://sepolia.example.com";

        Assert.Throws<InvalidOperationException>(settings.EnsureSupportedNetwork);
        Assert.False(settings.IsConfigured);
    }

    [Fact]
    public void HardhatGuard_RefusesPublicRpc()
    {
        var settings = HardhatSettings();
        settings.Hardhat.RpcUrl = "https://ethereum-sepolia-rpc.publicnode.com";

        Assert.Throws<InvalidOperationException>(settings.EnsureSupportedNetwork);
        Assert.False(settings.IsConfigured);
    }

    [Fact]
    public void HardhatGuard_AcceptsLoopbackRpc()
    {
        var settings = HardhatSettings();

        settings.EnsureSupportedNetwork();

        Assert.True(settings.IsConfigured);
        Assert.Equal(BlockchainSettings.HardhatChainId, settings.ActiveChainId);
        Assert.Equal(BlockchainSettings.HardhatChainIdHex, settings.ActiveChainIdHex);
        Assert.Equal(HardhatReceiver, settings.ActiveReceiverAddress);
        Assert.Empty(settings.ActiveExplorerBaseUrl);
    }

    [Fact]
    public void UnknownNetwork_IsRefusedExplicitly()
    {
        var settings = DefaultSettings();
        settings.Network = "Polygon";

        Assert.Throws<InvalidOperationException>(settings.EnsureSupportedNetwork);
    }

    [Fact]
    public void HardhatConfig_IsExposedWithChain31337()
    {
        var service = CreateService(new SepoliaStub(), HardhatSettings());

        var config = service.GetBlockchainConfig();

        Assert.True(config.Enabled);
        Assert.Equal("Hardhat Local", config.Network);
        Assert.Equal("hardhat", config.NetworkKey);
        Assert.Equal(BlockchainSettings.HardhatChainId, config.ChainId);
        Assert.Equal("0x7a69", config.ChainIdHex);
        Assert.Equal("http://127.0.0.1:8545", config.RpcUrl);
        Assert.Equal(HardhatReceiver, config.Receiver);
        Assert.Equal(string.Empty, config.ExplorerBaseUrl);
    }

    [Fact]
    public void PerNetworkMinConfirmations_OverrideGlobalValue()
    {
        var hardhat = HardhatSettings();
        hardhat.MinConfirmations = 2;
        hardhat.Hardhat.MinConfirmations = 1;

        var sepolia = DefaultSettings();
        sepolia.MinConfirmations = 3;

        Assert.Equal(1, hardhat.ActiveMinConfirmations);
        Assert.Equal(3, sepolia.ActiveMinConfirmations);
    }

    [Theory]
    [InlineData("350", "100000000000000000")]
    [InlineData("100", "28571428571428572")]
    [InlineData("0.35", "100000000000000")]
    public void ComputeWei_RoundsUp_NeverUnderCharges(string tnd, string expected)
    {
        var amount = decimal.Parse(tnd, System.Globalization.CultureInfo.InvariantCulture);
        Assert.Equal(expected, BlockchainSettings.ComputeWei(amount, 3500m));
    }

    [Fact]
    public void ToEth_ConvertsWeiForDisplay()
    {
        Assert.Equal(0.1m, BlockchainSettings.ToEth(ExpectedWei));
        Assert.Equal(0m, BlockchainSettings.ToEth("not-a-number"));
    }

    [Fact]
    public async Task CreateMetaMask_RefusesWhenNodeHasNoGenesis()
    {
        var (_, client, invoice) = await SeedAsync();
        var stub = new SepoliaStub { GenesisHash = null };
        var service = CreateService(stub);

        await Assert.ThrowsAsync<PaymentGatewayException>(() => PayAsync(service, client, invoice));

        Assert.Empty(await Payments.Find(t => t.InvoiceId == invoice.Id).ToListAsync());
        Assert.Equal(0m, (await ReloadInvoiceAsync(invoice)).AmountPaid);
    }

    [Fact]
    public async Task Verify_AcceptsUppercaseHash_AndStoresNormalizedHash()
    {
        const long block = 500;
        var (_, client, invoice) = await SeedAsync();
        var stub = new SepoliaStub
        {
            LatestBlock = block + 5,
            TransactionJson = SepoliaStub.Transaction(_txHash, Sender, Receiver, ExpectedWei, block),
            ReceiptJson = SepoliaStub.Receipt(block),
        };
        var service = CreateService(stub);

        var transaction = await PayAsync(service, client, invoice);
        var result = await VerifyAsync(service, client, transaction, hash: _txHash.ToUpperInvariant());

        Assert.Equal(PaymentTransactionStatus.Succeeded, result.Status);
        Assert.Equal(_txHash.ToLowerInvariant(), result.BlockchainTxHash);
    }

    [Fact]
    public async Task Verify_AllowsSameHashOnADifferentGenesisInstance_AfterFullChecks()
    {
        const long block = 800;
        var (freelancer, client, firstInvoice) = await SeedAsync();
        var secondInvoice = await InsertInvoiceAsync(freelancer, client);
        var stub = new SepoliaStub
        {
            GenesisHash = "0x" + new string('a', 64),
            LatestBlock = block + 5,
            TransactionJson = SepoliaStub.Transaction(_txHash, Sender, Receiver, ExpectedWei, block),
            ReceiptJson = SepoliaStub.Receipt(block),
        };
        var service = CreateService(stub);

        var first = await PayAsync(service, client, firstInvoice);
        var firstResult = await VerifyAsync(service, client, first);
        Assert.Equal(PaymentTransactionStatus.Succeeded, firstResult.Status);

        // Nouvelle instance Hardhat : même hash, Genesis différent, tous les
        // contrôles on-chain restent valides. Il s'agit d'un second transfert.
        stub.GenesisHash = "0x" + new string('b', 64);
        stub.GenesisTimestamp = DateTimeOffset.UtcNow.AddMinutes(1).ToUnixTimeSeconds();
        var second = await PayAsync(service, client, secondInvoice);
        var secondResult = await VerifyAsync(service, client, second);

        Assert.Equal(PaymentTransactionStatus.Succeeded, secondResult.Status);
        Assert.True(secondResult.BlockchainCrossGenesis);
        Assert.Equal(first.Id, secondResult.BlockchainReplayOfPaymentId);
        Assert.Equal(stub.GenesisHash, secondResult.BlockchainGenesisHash);
        Assert.Equal(350m, (await ReloadInvoiceAsync(firstInvoice)).AmountPaid);
        Assert.Equal(350m, (await ReloadInvoiceAsync(secondInvoice)).AmountPaid);

        // Le premier paiement et son reçu restent inchangés.
        var storedFirst = await ReloadTransactionAsync(first);
        Assert.Equal(PaymentTransactionStatus.Succeeded, storedFirst.Status);
        Assert.Equal(firstResult.ReceiptNumber, storedFirst.ReceiptNumber);
        Assert.False(storedFirst.BlockchainCrossGenesis);
    }

    [Fact]
    public async Task Verify_RejectsWhenChainWasResetAfterTheIntention()
    {
        const long block = 500;
        var (_, client, invoice) = await SeedAsync();
        var stub = new SepoliaStub
        {
            GenesisHash = "0x" + new string('a', 64),
            LatestBlock = block + 5,
            TransactionJson = SepoliaStub.Transaction(_txHash, Sender, Receiver, ExpectedWei, block),
            ReceiptJson = SepoliaStub.Receipt(block),
        };
        var service = CreateService(stub);

        var transaction = await PayAsync(service, client, invoice);
        stub.GenesisHash = "0x" + new string('c', 64);
        var result = await VerifyAsync(service, client, transaction);

        Assert.Equal(PaymentTransactionStatus.Failed, result.Status);
        Assert.Equal("blockchain_chain_reset", result.ErrorCode);
        Assert.Equal(0m, (await ReloadInvoiceAsync(invoice)).AmountPaid);
    }

    [Fact]
    public async Task Verify_RejectsHistoricalIntentionWithoutGenesis()
    {
        const long block = 500;
        var (_, client, invoice) = await SeedAsync();
        var stub = new SepoliaStub
        {
            LatestBlock = block + 5,
            TransactionJson = SepoliaStub.Transaction(_txHash, Sender, Receiver, ExpectedWei, block),
            ReceiptJson = SepoliaStub.Receipt(block),
        };
        var service = CreateService(stub);

        var transaction = await PayAsync(service, client, invoice);
        await Payments.UpdateOneAsync(
            t => t.Id == transaction.Id,
            Builders<PaymentTransaction>.Update.Set(t => t.BlockchainGenesisHash, (string?)null));

        var result = await VerifyAsync(service, client, transaction);

        Assert.Equal(PaymentTransactionStatus.Failed, result.Status);
        Assert.Equal("blockchain_genesis_unknown", result.ErrorCode);
        Assert.Equal(0m, (await ReloadInvoiceAsync(invoice)).AmountPaid);
    }

    [Fact]
    public async Task Verify_RejectsHashAlreadyUsedByHistoricalPaymentWithoutGenesis()
    {
        const long block = 700;
        var (freelancer, client, firstInvoice) = await SeedAsync();
        var secondInvoice = await InsertInvoiceAsync(freelancer, client);
        var stub = new SepoliaStub
        {
            LatestBlock = block + 5,
            TransactionJson = SepoliaStub.Transaction(_txHash, Sender, Receiver, ExpectedWei, block),
            ReceiptJson = SepoliaStub.Receipt(block),
        };
        var service = CreateService(stub);

        var first = await PayAsync(service, client, firstInvoice);
        var firstResult = await VerifyAsync(service, client, first);
        Assert.Equal(PaymentTransactionStatus.Succeeded, firstResult.Status);

        // Le premier paiement est historique (Genesis inconnu) : impossible de
        // prouver que le hash appartient à une autre instance. Refus strict.
        await Payments.UpdateOneAsync(
            t => t.Id == first.Id,
            Builders<PaymentTransaction>.Update.Set(t => t.BlockchainGenesisHash, (string?)null));

        var second = await PayAsync(service, client, secondInvoice);
        var secondResult = await VerifyAsync(service, client, second);

        Assert.Equal(PaymentTransactionStatus.Failed, secondResult.Status);
        Assert.Equal("blockchain_tx_previous_genesis_unknown", secondResult.ErrorCode);
        Assert.Equal(0m, (await ReloadInvoiceAsync(secondInvoice)).AmountPaid);
    }

    [Fact]
    public async Task Verify_ResumesInterruptedSettlement_WithoutCreditingTwice()
    {
        const long block = 500;
        var (_, client, invoice) = await SeedAsync();
        var stub = new SepoliaStub
        {
            LatestBlock = block + 5,
            TransactionJson = SepoliaStub.Transaction(_txHash, Sender, Receiver, ExpectedWei, block),
            ReceiptJson = SepoliaStub.Receipt(block),
        };
        var service = CreateService(stub);

        var transaction = await PayAsync(service, client, invoice);

        // Simule une panne après le crédit de la facture mais avant la
        // finalisation du paiement : le règlement porte déjà son identifiant.
        const string settlementId = "settlement-interrompu";
        var appliedAt = DateTime.UtcNow.AddMinutes(-1);
        await Payments.UpdateOneAsync(
            t => t.Id == transaction.Id,
            Builders<PaymentTransaction>.Update
                .Set(t => t.Status, PaymentTransactionStatus.Processing)
                .Set(t => t.ProviderAppliedAt, appliedAt)
                .Set(t => t.BlockchainSettlementId, settlementId)
                .Set(t => t.BlockchainTxHash, _txHash)
                .Set(t => t.BlockchainGenesisHash, stub.GenesisHash)
                .Set(t => t.BlockchainGenesisTimestamp, stub.GenesisTimestamp)
                .Set(t => t.ProviderStatus, "confirmed"));

        await Invoices.UpdateOneAsync(
            i => i.Id == invoice.Id,
            Builders<Invoice>.Update
                .Inc(i => i.AmountPaid, 350m)
                .Inc(i => i.BalanceDue, -350m)
                .Push(i => i.Payments, new InvoicePayment
                {
                    Amount = 350m,
                    Date = DateTime.UtcNow.ToString("yyyy-MM-dd"),
                    Reference = transaction.Reference,
                    Status = InvoicePaymentStatus.Completed,
                    Method = PaymentMethod.MetaMask,
                    TransactionId = transaction.Id,
                    CreatedAt = DateTime.UtcNow,
                }));

        var result = await VerifyAsync(service, client, transaction);

        Assert.Equal(PaymentTransactionStatus.Succeeded, result.Status);
        Assert.NotNull(result.ReceiptNumber);
        var storedInvoice = await ReloadInvoiceAsync(invoice);
        Assert.Equal(350m, storedInvoice.AmountPaid);
        Assert.Equal(650m, storedInvoice.BalanceDue);
        Assert.Single(storedInvoice.Payments, p => p.TransactionId == transaction.Id);

        var audits = await Mongo
            .GetCollection<PaymentAuditEntry>(Mongo.Settings.PaymentAuditsCollection)
            .Find(a => a.PaymentId == transaction.Id)
            .ToListAsync();
        Assert.Contains(audits, a => a.Action == "blockchain_credit_applied");
    }

    [Fact]
    public async Task Verify_RefusesToResumeWithoutSettlementId()
    {
        const long block = 500;
        var (_, client, invoice) = await SeedAsync();
        var stub = new SepoliaStub
        {
            LatestBlock = block + 5,
            TransactionJson = SepoliaStub.Transaction(_txHash, Sender, Receiver, ExpectedWei, block),
            ReceiptJson = SepoliaStub.Receipt(block),
        };
        var service = CreateService(stub);

        var transaction = await PayAsync(service, client, invoice);
        await Payments.UpdateOneAsync(
            t => t.Id == transaction.Id,
            Builders<PaymentTransaction>.Update
                .Set(t => t.Status, PaymentTransactionStatus.Processing)
                .Set(t => t.ProviderAppliedAt, DateTime.UtcNow)
                .Set(t => t.BlockchainTxHash, _txHash));

        await Assert.ThrowsAsync<ConflictException>(() => VerifyAsync(service, client, transaction));
        Assert.Equal(0m, (await ReloadInvoiceAsync(invoice)).AmountPaid);
    }

    [Fact]
    public async Task Verify_DoesNotResumeASettlementAlreadyRejected()
    {
        const long block = 500;
        var (_, client, invoice) = await SeedAsync();
        var stub = new SepoliaStub
        {
            LatestBlock = block + 5,
            TransactionJson = SepoliaStub.Transaction(_txHash, Sender, Receiver, ExpectedWei, block),
            ReceiptJson = SepoliaStub.Receipt(block),
        };
        var service = CreateService(stub);

        var transaction = await PayAsync(service, client, invoice);

        // Crédit explicitement refusé (conflit de solde) : le paiement est
        // terminal mais conserve son jeton de revendication. Une nouvelle
        // vérification ne doit jamais transformer ce refus en crédit.
        await Payments.UpdateOneAsync(
            t => t.Id == transaction.Id,
            Builders<PaymentTransaction>.Update
                .Set(t => t.Status, PaymentTransactionStatus.Failed)
                .Set(t => t.ErrorCode, "blockchain_paid_balance_conflict")
                .Set(t => t.ProviderAppliedAt, DateTime.UtcNow.AddMinutes(-1))
                .Set(t => t.BlockchainSettlementId, "settlement-refuse")
                .Set(t => t.BlockchainTxHash, _txHash)
                .Set(t => t.BlockchainGenesisHash, stub.GenesisHash)
                .Set(t => t.BlockchainGenesisTimestamp, stub.GenesisTimestamp)
                .Set(t => t.ProviderStatus, "confirmed"));

        var result = await VerifyAsync(service, client, transaction);

        Assert.Equal(PaymentTransactionStatus.Failed, result.Status);
        Assert.Equal("blockchain_paid_balance_conflict", result.ErrorCode);
        Assert.Equal(0m, (await ReloadInvoiceAsync(invoice)).AmountPaid);
    }

    private async Task ResetCrossGenesisExceptionAsync()
    {
        var audits = Mongo.GetCollection<PaymentAuditEntry>(Mongo.Settings.PaymentAuditsCollection);
        await audits.DeleteManyAsync(a => a.Action == "blockchain_cross_genesis_reconciled");
    }

    private async Task SetInvoicePaidAsync(Invoice invoice, decimal amountPaid)
    {
        await Invoices.UpdateOneAsync(
            i => i.Id == invoice.Id,
            Builders<Invoice>.Update
                .Set(i => i.AmountPaid, amountPaid)
                .Set(i => i.BalanceDue, invoice.Total - amountPaid)
                .Set(i => i.Status, InvoiceStatus.PartiallyPaid));
        invoice.AmountPaid = amountPaid;
        invoice.BalanceDue = invoice.Total - amountPaid;
        invoice.Status = InvoiceStatus.PartiallyPaid;
    }

    /// <summary>
    /// Paiement historique réussi, crédité avant l'enregistrement du Genesis,
    /// portant le même hash que le transfert à réconcilier.
    /// </summary>
    private async Task<PaymentTransaction> InsertHistoricalPaymentAsync(
        User freelancer,
        User client,
        Invoice invoice,
        string hash,
        decimal amount = 350m,
        string? genesis = null)
    {
        var completedAt = DateTime.UtcNow.AddHours(-2);
        var payment = new PaymentTransaction
        {
            Id = MongoFixture.NewId(),
            Reference = $"PAY-HIST-{Guid.NewGuid().ToString("N")[..8]}",
            InvoiceId = invoice.Id,
            InvoiceNumber = invoice.Number,
            ClientId = client.Id,
            ClientName = $"{client.FirstName} {client.LastName}",
            FreelancerId = freelancer.Id,
            FreelancerName = $"{freelancer.FirstName} {freelancer.LastName}",
            ProjectId = invoice.ProjectId,
            ProjectTitle = invoice.Project,
            Amount = amount,
            Currency = "TND",
            Method = PaymentMethod.MetaMask,
            Status = PaymentTransactionStatus.Succeeded,
            Provider = PaymentProvider.Blockchain,
            ReceiptNumber = $"REC-HIST-{Guid.NewGuid().ToString("N")[..8]}",
            ProviderStatus = "completed",
            ProviderAppliedAt = completedAt,
            BlockchainTxHash = hash,
            BlockchainChainId = BlockchainSettings.SepoliaChainId,
            BlockchainReceiver = Receiver,
            BlockchainAmountWei = ExpectedWei,
            BlockchainTndPerEth = 3500m,
            BlockchainConfirmations = 2,
            BlockchainVerifiedAt = completedAt,
            BlockchainGenesisHash = genesis,
            BlockchainGenesisTimestamp = null,
            Attempts =
            [
                new PaymentAttempt
                {
                    AttemptNumber = 1,
                    Status = PaymentAttemptStatus.Succeeded,
                    StartedAt = completedAt,
                    CompletedAt = completedAt,
                }
            ],
            CreatedAt = completedAt,
            UpdatedAt = completedAt,
            CompletedAt = completedAt,
        };
        await Payments.InsertOneAsync(payment);
        return payment;
    }

    /// <summary>
    /// Intention MetaMask pending insérée directement (sans passer par la
    /// réutilisation d'intention), pour tester le verrou d'usage unique.
    /// </summary>
    private async Task<PaymentTransaction> InsertPendingBlockchainIntentionAsync(
        User freelancer,
        User client,
        Invoice invoice,
        decimal amount = 350m)
    {
        var now = DateTime.UtcNow;
        var payment = new PaymentTransaction
        {
            Id = MongoFixture.NewId(),
            Reference = $"PAY-PENDING-{Guid.NewGuid().ToString("N")[..8]}",
            InvoiceId = invoice.Id,
            InvoiceNumber = invoice.Number,
            ClientId = client.Id,
            ClientName = $"{client.FirstName} {client.LastName}",
            FreelancerId = freelancer.Id,
            FreelancerName = $"{freelancer.FirstName} {freelancer.LastName}",
            ProjectId = invoice.ProjectId,
            ProjectTitle = invoice.Project,
            Amount = amount,
            Currency = "TND",
            Method = PaymentMethod.MetaMask,
            Status = PaymentTransactionStatus.Pending,
            Provider = PaymentProvider.Blockchain,
            ProviderStatus = "awaiting_wallet",
            BlockchainChainId = BlockchainSettings.SepoliaChainId,
            BlockchainReceiver = Receiver,
            BlockchainAmountWei = ExpectedWei,
            BlockchainTndPerEth = 3500m,
            BalanceBefore = invoice.BalanceDue,
            InvoiceTotal = invoice.Total,
            Attempts =
            [
                new PaymentAttempt
                {
                    AttemptNumber = 1,
                    Status = PaymentAttemptStatus.Pending,
                    StartedAt = now,
                }
            ],
            CreatedAt = now,
            UpdatedAt = now,
        };
        await Payments.InsertOneAsync(payment);
        return payment;
    }

    private Task<PaymentTransactionResponse> ReconcileAsync(
        PaymentService service,
        User freelancer,
        PaymentTransactionResponse target,
        PaymentTransaction previous,
        string? hash = null) =>
        service.ReconcileBlockchainCrossGenesisAsync(
            freelancer.Id,
            target.Id,
            new ReconcileBlockchainCrossGenesisRequest
            {
                PreviousPaymentId = previous.Id,
                TxHash = hash ?? _txHash,
                Confirm = true,
            },
            CancellationToken.None);

    [Fact]
    public async Task Reconcile_HistoricalPaymentWithoutGenesis_CreditsOnceAndAudits()
    {
        await Mongo.EnsureIndexesAsync();
        await ResetCrossGenesisExceptionAsync();
        const long block = 900;
        var (freelancer, client, invoice) = await SeedAsync();
        await SetInvoicePaidAsync(invoice, 350m);
        var previous = await InsertHistoricalPaymentAsync(freelancer, client, invoice, _txHash);

        var stub = new SepoliaStub
        {
            GenesisHash = "0x" + new string('a', 64),
            GenesisTimestamp = DateTimeOffset.UtcNow.AddMinutes(-1).ToUnixTimeSeconds(),
            LatestBlock = block + 5,
            TransactionJson = SepoliaStub.Transaction(_txHash, Sender, Receiver, ExpectedWei, block),
            ReceiptJson = SepoliaStub.Receipt(block),
        };
        var service = CreateService(stub);

        var target = await PayAsync(service, client, invoice);
        await Payments.UpdateOneAsync(
            t => t.Id == target.Id,
            Builders<PaymentTransaction>.Update
                .Set(t => t.BlockchainGenesisHash, (string?)null)
                .Set(t => t.BlockchainGenesisTimestamp, (long?)null));

        var result = await ReconcileAsync(service, freelancer, target, previous);

        Assert.Equal(PaymentTransactionStatus.Succeeded, result.Status);
        Assert.True(result.BlockchainCrossGenesis);
        Assert.Equal(previous.Id, result.BlockchainReplayOfPaymentId);
        Assert.Equal(stub.GenesisHash, result.BlockchainGenesisHash);
        Assert.NotNull(result.ReceiptNumber);
        Assert.NotEqual(previous.ReceiptNumber, result.ReceiptNumber);

        var storedInvoice = await ReloadInvoiceAsync(invoice);
        Assert.Equal(700m, storedInvoice.AmountPaid);
        Assert.Equal(300m, storedInvoice.BalanceDue);
        Assert.Equal(InvoiceStatus.PartiallyPaid, storedInvoice.Status);
        Assert.Single(storedInvoice.Payments, p => p.TransactionId == target.Id);

        // Le paiement historique reste strictement inchangé : aucun Genesis
        // inventé, aucun reçu modifié, aucun double crédit.
        var storedPrevious = await Payments.Find(t => t.Id == previous.Id).FirstAsync();
        Assert.Equal(PaymentTransactionStatus.Succeeded, storedPrevious.Status);
        Assert.Equal(previous.ReceiptNumber, storedPrevious.ReceiptNumber);
        Assert.Null(storedPrevious.BlockchainGenesisHash);
        Assert.False(storedPrevious.BlockchainCrossGenesis);

        var audits = await Mongo
            .GetCollection<PaymentAuditEntry>(Mongo.Settings.PaymentAuditsCollection)
            .Find(a => a.PaymentId == target.Id)
            .ToListAsync();
        Assert.Contains(audits, a => a.Action == "blockchain_cross_genesis_reconciled");
        Assert.Contains(audits, a => a.Action == "blockchain_credit_applied");

        // Seconde exécution : aucun crédit ni reçu supplémentaire.
        var second = await ReconcileAsync(service, freelancer, target, previous);
        Assert.Equal(PaymentTransactionStatus.Succeeded, second.Status);
        Assert.Equal(result.ReceiptNumber, second.ReceiptNumber);

        var after = await ReloadInvoiceAsync(invoice);
        Assert.Equal(700m, after.AmountPaid);
        Assert.Equal(300m, after.BalanceDue);
        Assert.Single(after.Payments, p => p.TransactionId == target.Id);

        var reconciliations = await Mongo
            .GetCollection<PaymentAuditEntry>(Mongo.Settings.PaymentAuditsCollection)
            .Find(a => a.Action == "blockchain_cross_genesis_reconciled")
            .ToListAsync();
        Assert.Single(reconciliations);
    }

    [Fact]
    public async Task Reconcile_ExceptionCannotBeUsedForAnotherPayment()
    {
        await Mongo.EnsureIndexesAsync();
        await ResetCrossGenesisExceptionAsync();
        const long block = 910;
        var (freelancer, client, invoice) = await SeedAsync();
        await SetInvoicePaidAsync(invoice, 350m);
        var previous = await InsertHistoricalPaymentAsync(freelancer, client, invoice, _txHash);

        var stub = new SepoliaStub
        {
            GenesisHash = "0x" + new string('a', 64),
            GenesisTimestamp = DateTimeOffset.UtcNow.AddMinutes(-1).ToUnixTimeSeconds(),
            LatestBlock = block + 5,
            TransactionJson = SepoliaStub.Transaction(_txHash, Sender, Receiver, ExpectedWei, block),
            ReceiptJson = SepoliaStub.Receipt(block),
        };
        var service = CreateService(stub);

        var firstTarget = await PayAsync(service, client, invoice);
        await Payments.UpdateOneAsync(
            t => t.Id == firstTarget.Id,
            Builders<PaymentTransaction>.Update
                .Set(t => t.BlockchainGenesisHash, (string?)null)
                .Set(t => t.BlockchainGenesisTimestamp, (long?)null));

        var first = await ReconcileAsync(service, freelancer, firstTarget, previous);
        Assert.Equal(PaymentTransactionStatus.Succeeded, first.Status);

        var secondTarget = await InsertPendingBlockchainIntentionAsync(freelancer, client, invoice);

        await Assert.ThrowsAsync<ConflictException>(() =>
            service.ReconcileBlockchainCrossGenesisAsync(
                freelancer.Id,
                secondTarget.Id,
                new ReconcileBlockchainCrossGenesisRequest
                {
                    PreviousPaymentId = previous.Id,
                    TxHash = _txHash,
                    Confirm = true,
                },
                CancellationToken.None));

        var storedSecond = await Payments.Find(t => t.Id == secondTarget.Id).FirstAsync();
        Assert.Equal(PaymentTransactionStatus.Pending, storedSecond.Status);
        Assert.Null(storedSecond.ReceiptNumber);
        Assert.Equal(700m, (await ReloadInvoiceAsync(invoice)).AmountPaid);
    }

    [Fact]
    public async Task Reconcile_RefusesWhenPreviousPaymentAlreadyHasGenesis()
    {
        await ResetCrossGenesisExceptionAsync();
        const long block = 920;
        var (freelancer, client, invoice) = await SeedAsync();
        await SetInvoicePaidAsync(invoice, 350m);
        var previous = await InsertHistoricalPaymentAsync(
            freelancer, client, invoice, _txHash, genesis: "0x" + new string('d', 64));

        var stub = new SepoliaStub
        {
            GenesisHash = "0x" + new string('a', 64),
            GenesisTimestamp = DateTimeOffset.UtcNow.AddMinutes(-1).ToUnixTimeSeconds(),
            LatestBlock = block + 5,
            TransactionJson = SepoliaStub.Transaction(_txHash, Sender, Receiver, ExpectedWei, block),
            ReceiptJson = SepoliaStub.Receipt(block),
        };
        var service = CreateService(stub);
        var target = await PayAsync(service, client, invoice);
        await Payments.UpdateOneAsync(
            t => t.Id == target.Id,
            Builders<PaymentTransaction>.Update
                .Set(t => t.BlockchainGenesisHash, (string?)null)
                .Set(t => t.BlockchainGenesisTimestamp, (long?)null));

        await Assert.ThrowsAsync<ConflictException>(() =>
            ReconcileAsync(service, freelancer, target, previous));

        Assert.Equal(350m, (await ReloadInvoiceAsync(invoice)).AmountPaid);
        Assert.Null((await Payments.Find(t => t.Id == target.Id).FirstAsync()).ReceiptNumber);
    }

    [Fact]
    public async Task Reconcile_RefusesWhenOnChainRecipientOrAmountDiffers()
    {
        await ResetCrossGenesisExceptionAsync();
        const long block = 930;
        var (freelancer, client, invoice) = await SeedAsync();
        await SetInvoicePaidAsync(invoice, 350m);
        var previous = await InsertHistoricalPaymentAsync(freelancer, client, invoice, _txHash);

        var stub = new SepoliaStub
        {
            GenesisHash = "0x" + new string('a', 64),
            GenesisTimestamp = DateTimeOffset.UtcNow.AddMinutes(-1).ToUnixTimeSeconds(),
            LatestBlock = block + 5,
            // Mauvais destinataire : la preuve on-chain ne correspond pas.
            TransactionJson = SepoliaStub.Transaction(_txHash, Sender, OtherWallet, ExpectedWei, block),
            ReceiptJson = SepoliaStub.Receipt(block),
        };
        var service = CreateService(stub);
        var target = await PayAsync(service, client, invoice);
        await Payments.UpdateOneAsync(
            t => t.Id == target.Id,
            Builders<PaymentTransaction>.Update
                .Set(t => t.BlockchainGenesisHash, (string?)null)
                .Set(t => t.BlockchainGenesisTimestamp, (long?)null));

        await Assert.ThrowsAsync<ConflictException>(() =>
            ReconcileAsync(service, freelancer, target, previous));

        Assert.Equal(350m, (await ReloadInvoiceAsync(invoice)).AmountPaid);

        // Montant faux, même destinataire : refus également.
        stub.TransactionJson = SepoliaStub.Transaction(
            _txHash, Sender, Receiver, "99999999999999999", block);
        await Assert.ThrowsAsync<ConflictException>(() =>
            ReconcileAsync(service, freelancer, target, previous));
        Assert.Equal(350m, (await ReloadInvoiceAsync(invoice)).AmountPaid);
    }

    [Fact]
    public async Task Reconcile_RefusesWhenGenesisIsNotNewerThanPreviousCredit()
    {
        await ResetCrossGenesisExceptionAsync();
        const long block = 940;
        var (freelancer, client, invoice) = await SeedAsync();
        await SetInvoicePaidAsync(invoice, 350m);
        var previous = await InsertHistoricalPaymentAsync(freelancer, client, invoice, _txHash);

        var stub = new SepoliaStub
        {
            GenesisHash = "0x" + new string('a', 64),
            // Genesis antérieur au crédit du paiement historique.
            GenesisTimestamp = DateTimeOffset.UtcNow.AddHours(-3).ToUnixTimeSeconds(),
            LatestBlock = block + 5,
            TransactionJson = SepoliaStub.Transaction(_txHash, Sender, Receiver, ExpectedWei, block),
            ReceiptJson = SepoliaStub.Receipt(block),
        };
        var service = CreateService(stub);
        var target = await PayAsync(service, client, invoice);
        await Payments.UpdateOneAsync(
            t => t.Id == target.Id,
            Builders<PaymentTransaction>.Update
                .Set(t => t.BlockchainGenesisHash, (string?)null)
                .Set(t => t.BlockchainGenesisTimestamp, (long?)null));

        await Assert.ThrowsAsync<ConflictException>(() =>
            ReconcileAsync(service, freelancer, target, previous));

        Assert.Equal(350m, (await ReloadInvoiceAsync(invoice)).AmountPaid);
    }

    [Fact]
    public async Task Reconcile_RefusesIntentionCreatedBeforeCurrentGenesis()
    {
        await ResetCrossGenesisExceptionAsync();
        const long block = 950;
        var (freelancer, client, invoice) = await SeedAsync();
        await SetInvoicePaidAsync(invoice, 350m);
        var previous = await InsertHistoricalPaymentAsync(freelancer, client, invoice, _txHash);

        var stub = new SepoliaStub
        {
            GenesisHash = "0x" + new string('a', 64),
            GenesisTimestamp = DateTimeOffset.UtcNow.AddMinutes(-1).ToUnixTimeSeconds(),
            LatestBlock = block + 5,
            TransactionJson = SepoliaStub.Transaction(_txHash, Sender, Receiver, ExpectedWei, block),
            ReceiptJson = SepoliaStub.Receipt(block),
        };
        var service = CreateService(stub);
        var target = await PayAsync(service, client, invoice);
        await Payments.UpdateOneAsync(
            t => t.Id == target.Id,
            Builders<PaymentTransaction>.Update
                .Set(t => t.BlockchainGenesisHash, (string?)null)
                .Set(t => t.BlockchainGenesisTimestamp, (long?)null)
                .Set(t => t.CreatedAt, DateTime.UtcNow.AddHours(-2)));

        await Assert.ThrowsAsync<ConflictException>(() =>
            ReconcileAsync(service, freelancer, target, previous));

        Assert.Equal(350m, (await ReloadInvoiceAsync(invoice)).AmountPaid);
    }

    [Fact]
    public async Task Reconcile_IsReservedToTheFreelancerBeneficiary()
    {
        await ResetCrossGenesisExceptionAsync();
        var (freelancer, client, invoice) = await SeedAsync();
        await SetInvoicePaidAsync(invoice, 350m);
        var previous = await InsertHistoricalPaymentAsync(freelancer, client, invoice, _txHash);
        var stub = new SepoliaStub
        {
            GenesisHash = "0x" + new string('a', 64),
            GenesisTimestamp = DateTimeOffset.UtcNow.AddMinutes(-1).ToUnixTimeSeconds(),
            TransactionJson = SepoliaStub.Transaction(_txHash, Sender, Receiver, ExpectedWei, 960),
            ReceiptJson = SepoliaStub.Receipt(960),
        };
        var service = CreateService(stub);
        var target = await PayAsync(service, client, invoice);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            service.ReconcileBlockchainCrossGenesisAsync(
                client.Id,
                target.Id,
                new ReconcileBlockchainCrossGenesisRequest
                {
                    PreviousPaymentId = previous.Id,
                    TxHash = _txHash,
                    Confirm = true,
                },
                CancellationToken.None));

        Assert.Equal(350m, (await ReloadInvoiceAsync(invoice)).AmountPaid);
    }

    [Fact]
    public async Task BlockchainIndex_ProtectsDuplicateGenesisAndHash()
    {
        await Mongo.EnsureIndexesAsync();

        var genesisA = "0x" + new string('a', 64);
        var genesisB = "0x" + new string('b', 64);
        var hash = "0x" + new string('1', 64);
        var otherHash = "0x" + new string('2', 64);

        await Payments.InsertOneAsync(NewPayment("index-1", genesisA, hash));

        // Même instance + même hash : refus atomique.
        await Assert.ThrowsAsync<MongoWriteException>(() =>
            Payments.InsertOneAsync(NewPayment("index-2", genesisA, hash)));

        // Instances différentes + même hash : deux transferts distincts.
        await Payments.InsertOneAsync(NewPayment("index-3", genesisB, hash));

        // Genesis inconnu (null) : les documents historiques restent protégés
        // entre eux, car MongoDB indexe un champ absent comme null.
        await Payments.InsertOneAsync(NewPayment("index-4", null, otherHash));
        await Assert.ThrowsAsync<MongoWriteException>(() =>
            Payments.InsertOneAsync(NewPayment("index-5", null, otherHash)));
    }

    private PaymentTransaction NewPayment(string reference, string? genesis, string hash) => new()
    {
        Id = MongoFixture.NewId(),
        Reference = $"PAY-INDEX-{reference}",
        InvoiceId = MongoFixture.NewId(),
        InvoiceNumber = "FAC-INDEX",
        ClientId = MongoFixture.NewId(),
        FreelancerId = MongoFixture.NewId(),
        Amount = 10m,
        Currency = "TND",
        Method = PaymentMethod.MetaMask,
        Status = PaymentTransactionStatus.Pending,
        Provider = PaymentProvider.Blockchain,
        BlockchainTxHash = hash,
        BlockchainGenesisHash = genesis,
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    /// <summary>
    /// Stub JSON-RPC en mémoire : répond aux quatre méthodes utilisées par le
    /// backend, sans aucun accès réseau.
    /// </summary>
    private sealed class SepoliaStub : HttpMessageHandler
    {
        public string ChainId { get; set; } = BlockchainSettings.SepoliaChainIdHex;

        public long LatestBlock { get; set; } = 1000;

        /// <summary>Empreinte Genesis de l'instance simulée (null = nœud sans Genesis).</summary>
        public string? GenesisHash { get; set; } = "0x" + new string('a', 64);

        /// <summary>Timestamp Unix du bloc Genesis simulé.</summary>
        public long GenesisTimestamp { get; set; } =
            DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        public string? TransactionJson { get; set; }

        public string? ReceiptJson { get; set; }

        /// <summary>
        /// Timestamp Unix du bloc contenant la transaction (bloc &gt; 0). Il doit
        /// être postérieur à la création de l'intention dans les tests de
        /// réconciliation.
        /// </summary>
        public long TransactionBlockTimestamp { get; set; } =
            DateTimeOffset.UtcNow.AddMinutes(5).ToUnixTimeSeconds();

        /// <summary>Solde renvoyé par eth_getBalance, en wei décimal.</summary>
        public string BalanceWei { get; set; } = "0";

        /// <summary>Simule une panne du nœud sur la lecture de solde.</summary>
        public bool FailBalance { get; set; }

        public int Calls { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Calls++;
            var body = request.Content is null
                ? "{}"
                : await request.Content.ReadAsStringAsync(cancellationToken);
            using var document = JsonDocument.Parse(body);
            var method = document.RootElement.TryGetProperty("method", out var methodElement)
                ? methodElement.GetString() ?? string.Empty
                : string.Empty;

            var requestedBlock = 0L;
            if (document.RootElement.TryGetProperty("params", out var paramsElement)
                && paramsElement.ValueKind == JsonValueKind.Array
                && paramsElement.GetArrayLength() > 0
                && paramsElement[0].ValueKind == JsonValueKind.String)
            {
                var blockParam = paramsElement[0].GetString();
                if (blockParam is not null
                    && blockParam.StartsWith("0x", StringComparison.OrdinalIgnoreCase)
                    && long.TryParse(
                        blockParam[2..],
                        System.Globalization.NumberStyles.HexNumber,
                        System.Globalization.CultureInfo.InvariantCulture,
                        out var parsedBlock))
                {
                    requestedBlock = parsedBlock;
                }
            }

            if (method == "eth_getBalance" && FailBalance)
            {
                return new HttpResponseMessage(HttpStatusCode.InternalServerError)
                {
                    Content = new StringContent("{\"error\":\"rpc down\"}", Encoding.UTF8, "application/json"),
                };
            }

            var result = method switch
            {
                "eth_chainId" => $"\"{ChainId}\"",
                "eth_blockNumber" => $"\"0x{LatestBlock:x}\"",
                "eth_getBalance" => $"\"0x{System.Numerics.BigInteger.Parse(BalanceWei):x}\"",
                "eth_getBlockByNumber" => GenesisHash is null
                    ? "null"
                    : requestedBlock == 0
                        ? $"{{\"number\":\"0x0\",\"hash\":\"{GenesisHash}\"," +
                          $"\"timestamp\":\"0x{GenesisTimestamp:x}\"}}"
                        : $"{{\"number\":\"0x{requestedBlock:x}\",\"hash\":\"0x{new string('f', 64)}\"," +
                          $"\"timestamp\":\"0x{TransactionBlockTimestamp:x}\"}}",
                "eth_getTransactionByHash" => TransactionJson ?? "null",
                "eth_getTransactionReceipt" => ReceiptJson ?? "null",
                _ => "null",
            };

            var payload = $"{{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{result}}}";
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json"),
            };
        }

        public static string Transaction(
            string hash,
            string from,
            string to,
            string valueHex,
            long blockNumber) =>
            $"{{\"hash\":\"{hash}\",\"from\":\"{from}\",\"to\":\"{to}\"," +
            $"\"value\":\"0x{ToHex(valueHex)}\",\"blockNumber\":\"0x{blockNumber:x}\"}}";

        public static string Receipt(long blockNumber, string status = "0x1") =>
            $"{{\"status\":\"{status}\",\"blockNumber\":\"0x{blockNumber:x}\"}}";

        private static string ToHex(string decimalValue) =>
            System.Numerics.BigInteger.Parse(decimalValue).ToString("x");
    }
}
