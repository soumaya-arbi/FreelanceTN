using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using FreelanceTn.Api.Dtos.Payments;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FreelanceTn.Api.Controllers;

[ApiController]
[Route("api/payments")]
public class PaymentsController : ControllerBase
{
    private readonly PaymentService _payments;
    private readonly InvoiceService _invoices;

    public PaymentsController(PaymentService payments, InvoiceService invoices)
    {
        _payments = payments;
        _invoices = invoices;
    }

    private string CurrentUserId =>
        User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
        ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value
        ?? throw new UnauthorizedException("Session invalide.");

    [HttpGet]
    [Authorize]
    public async Task<IActionResult> List([FromQuery] string? invoiceId, CancellationToken cancellationToken)
    {
        var transactions = await _payments.ListAsync(CurrentUserId, invoiceId, cancellationToken);
        return Ok(transactions);
    }

    [HttpGet("{id}")]
    [Authorize]
    public async Task<IActionResult> Get(string id, CancellationToken cancellationToken)
    {
        var transaction = await _payments.GetAsync(CurrentUserId, id, cancellationToken);
        return Ok(transaction);
    }

    [HttpPost]
    [Authorize]
    public async Task<IActionResult> Create([FromBody] CreatePaymentRequest request, CancellationToken cancellationToken)
    {
        var transaction = await _payments.CreateAsync(CurrentUserId, request, cancellationToken);
        var invoice = await _invoices.GetAsync(CurrentUserId, request.InvoiceId, cancellationToken);
        var result = new PaymentResultResponse { Transaction = transaction, Invoice = invoice };
        return CreatedAtAction(nameof(Get), new { id = transaction.Id }, result);
    }

    [HttpPost("{id}/process")]
    [Authorize]
    public async Task<IActionResult> Process(string id, [FromBody] ProcessPaymentRequest? request, CancellationToken cancellationToken)
    {
        var transaction = await _payments.ProcessAsync(CurrentUserId, id, request?.SimulateOutcome, cancellationToken);
        var invoice = await _invoices.GetAsync(CurrentUserId, transaction.InvoiceId, cancellationToken);
        return Ok(new PaymentResultResponse { Transaction = transaction, Invoice = invoice });
    }

    [HttpPost("{id}/retry")]
    [Authorize]
    public async Task<IActionResult> Retry(string id, [FromBody] RetryPaymentRequest? request, CancellationToken cancellationToken)
    {
        var transaction = await _payments.RetryAsync(CurrentUserId, id, request?.SimulateOutcome, cancellationToken);
        var invoice = await _invoices.GetAsync(CurrentUserId, transaction.InvoiceId, cancellationToken);
        return Ok(new PaymentResultResponse { Transaction = transaction, Invoice = invoice });
    }

    [HttpPost("{id}/cancel")]
    [Authorize]
    public async Task<IActionResult> Cancel(string id, [FromBody] CancelPaymentRequest? request, CancellationToken cancellationToken)
    {
        var transaction = await _payments.CancelAsync(CurrentUserId, id, request?.Reason, cancellationToken);
        var invoice = await _invoices.GetAsync(CurrentUserId, transaction.InvoiceId, cancellationToken);
        return Ok(new PaymentResultResponse { Transaction = transaction, Invoice = invoice });
    }

    /// <summary>
    /// Vérification serveur d'un paiement carte au retour de la page hébergée.
    /// Le frontend ne transmet que l'identifiant de sa transaction : le statut
    /// et le montant sont relus auprès de l'API officielle Konnect.
    /// </summary>
    [HttpPost("{id}/verify")]
    [Authorize]
    public async Task<IActionResult> Verify(string id, CancellationToken cancellationToken)
    {
        var transaction = await _payments.VerifyAsync(CurrentUserId, id, cancellationToken);
        var invoice = await _invoices.GetAsync(CurrentUserId, transaction.InvoiceId, cancellationToken);
        return Ok(new PaymentResultResponse { Transaction = transaction, Invoice = invoice });
    }

    /// <summary>
    /// Vérification on-chain d'un paiement MetaMask. Le frontend ne transmet que
    /// le hash : réseau, destinataire, montant, statut et confirmations sont
    /// relus sur le réseau figé dans l'intention (Sepolia ou Hardhat Local)
    /// avant tout crédit.
    /// </summary>
    [HttpPost("{id}/verify-blockchain")]
    [Authorize]
    public async Task<IActionResult> VerifyBlockchain(
        string id,
        [FromBody] VerifyBlockchainRequest request,
        CancellationToken cancellationToken)
    {
        var transaction = await _payments.VerifyBlockchainAsync(
            CurrentUserId, id, request.TxHash, cancellationToken);
        var invoice = await _invoices.GetAsync(CurrentUserId, transaction.InvoiceId, cancellationToken);
        return Ok(new PaymentResultResponse { Transaction = transaction, Invoice = invoice });
    }

    /// <summary>
    /// Réconciliation manuelle et auditée d'un transfert blockchain dont le
    /// hash a déjà crédité un paiement historique dont l'empreinte Genesis est
    /// inconnue. Réservée au freelance bénéficiaire ; exige explicitement le
    /// paiement antérieur et une confirmation. Aucun crédit n'est appliqué sans
    /// preuves on-chain complètes sur l'instance courante.
    /// </summary>
    [HttpPost("{id}/reconcile-blockchain-cross-genesis")]
    [Authorize]
    public async Task<IActionResult> ReconcileBlockchainCrossGenesis(
        string id,
        [FromBody] ReconcileBlockchainCrossGenesisRequest request,
        CancellationToken cancellationToken)
    {
        var transaction = await _payments.ReconcileBlockchainCrossGenesisAsync(
            CurrentUserId, id, request, cancellationToken);
        var invoice = await _invoices.GetAsync(CurrentUserId, transaction.InvoiceId, cancellationToken);
        return Ok(new PaymentResultResponse { Transaction = transaction, Invoice = invoice });
    }

    /// <summary>
    /// Paramètres publics du paiement blockchain (réseau actif, destinataire,
    /// taux, confirmations). Aucune clé privée n'est exposée : le backend est
    /// en lecture seule.
    /// </summary>
    [HttpGet("blockchain/config")]
    [Authorize]
    public IActionResult BlockchainConfig()
    {
        Response.Headers.CacheControl = "no-store, no-cache, must-revalidate";
        Response.Headers.Pragma = "no-cache";
        return Ok(_payments.GetBlockchainConfig());
    }

    /// <summary>
    /// Solde ETH réel du portefeuille destinataire (ou d'une adresse explicitement
    /// fournie), lu par le backend avec <c>eth_getBalance</c> sur le réseau actif.
    /// Aucun cumul de paiements en base n'est utilisé.
    /// </summary>
    [HttpGet("blockchain/balance")]
    [Authorize]
    public async Task<IActionResult> BlockchainBalance(
        [FromQuery] string? address,
        CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store, no-cache, must-revalidate";
        Response.Headers.Pragma = "no-cache";
        return Ok(await _payments.GetBlockchainBalanceAsync(address, cancellationToken));
    }

    /// <summary>
    /// Webhook Konnect (GET ?payment_ref=...). Aucune confiance dans la requête
    /// entrante : la référence est immédiatement revérifiée auprès de l'API
    /// officielle avant toute application au solde. Une réponse 200 évite les
    /// rejeux en boucle ; l'idempotence est assurée côté service.
    /// </summary>
    [HttpGet("konnect/webhook")]
    [AllowAnonymous]
    public async Task<IActionResult> KonnectWebhook(
        [FromQuery(Name = "payment_ref")] string? paymentRef,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(paymentRef))
        {
            return BadRequest(new
            {
                status = StatusCodes.Status400BadRequest,
                message = "Référence de paiement manquante.",
                errors = Array.Empty<string>(),
            });
        }

        var handled = await _payments.ReconcileByProviderRefAsync(paymentRef, cancellationToken);
        return Ok(new { received = true, handled });
    }

    /// <summary>
    /// Reçu PDF. Le même document est accessible au client et au freelancer
    /// concernés ; tout autre compte reçoit 403.
    /// </summary>
    [HttpGet("{id}/receipt")]
    [Authorize]
    public async Task<IActionResult> Receipt(string id, [FromQuery] bool inline, CancellationToken cancellationToken)
    {
        var (transaction, pdf) = await _payments.GenerateReceiptAsync(CurrentUserId, id, cancellationToken);
        var fileName = $"Recu-{transaction.Reference}.pdf";
        Response.Headers.ContentDisposition = $"{(inline ? "inline" : "attachment")}; filename=\"{fileName}\"";
        return File(pdf, "application/pdf");
    }
}
