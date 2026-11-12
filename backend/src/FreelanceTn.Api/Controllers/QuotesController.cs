using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using FreelanceTn.Api.Dtos.Quotes;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using FreelanceTn.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FreelanceTn.Api.Controllers;

[ApiController]
[Route("api/quotes")]
public class QuotesController : ControllerBase
{
    private readonly QuoteService _quoteService;
    private readonly InvoiceService _invoiceService;

    public QuotesController(QuoteService quoteService, InvoiceService invoiceService)
    {
        _quoteService = quoteService;
        _invoiceService = invoiceService;
    }

    private string CurrentUserId =>
        User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
        ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value
        ?? throw new UnauthorizedException("Session invalide.");

    [HttpGet]
    [Authorize]
    public async Task<IActionResult> GetAll(CancellationToken cancellationToken)
    {
        var quotes = await _quoteService.ListAsync(CurrentUserId, cancellationToken);
        return Ok(quotes);
    }

    [HttpGet("client")]
    [Authorize]
    public async Task<IActionResult> GetForClient(CancellationToken cancellationToken)
    {
        var quotes = await _quoteService.ListForClientAsync(CurrentUserId, cancellationToken);
        return Ok(quotes);
    }

    [HttpGet("{id}")]
    [Authorize]
    public async Task<IActionResult> Get(string id, CancellationToken cancellationToken)
    {
        var quote = await _quoteService.GetAsync(CurrentUserId, id, cancellationToken);
        return Ok(quote);
    }

    [HttpPost]
    [Authorize]
    public async Task<IActionResult> Create([FromBody] CreateQuoteRequest request, CancellationToken cancellationToken)
    {
        var quote = await _quoteService.CreateAsync(CurrentUserId, request, cancellationToken);
        return CreatedAtAction(nameof(Get), new { id = quote.Id }, quote);
    }

    [HttpPut("{id}")]
    [Authorize]
    public async Task<IActionResult> Update(string id, [FromBody] UpdateQuoteRequest request, CancellationToken cancellationToken)
    {
        var quote = await _quoteService.UpdateAsync(CurrentUserId, id, request, cancellationToken);
        return Ok(quote);
    }

    [HttpDelete("{id}")]
    [Authorize]
    public async Task<IActionResult> Delete(string id, CancellationToken cancellationToken)
    {
        await _quoteService.DeleteAsync(CurrentUserId, id, cancellationToken);
        return NoContent();
    }

    [HttpPatch("{id}/status")]
    [Authorize]
    public async Task<IActionResult> UpdateStatus(string id, [FromBody] UpdateStatusRequest request, CancellationToken cancellationToken)
    {
        var quote = await _quoteService.UpdateStatusAsync(CurrentUserId, id, request.Status, request.Note, request.Abandon ?? false, cancellationToken);
        return Ok(quote);
    }

    [HttpPost("{id}/convert-to-invoice")]
    [Authorize]
    public async Task<IActionResult> ConvertToInvoice(string id, CancellationToken cancellationToken)
    {
        // Règle métier: seul le client peut créer une facture à partir d'un devis accepté.
        var invoice = await _invoiceService.CreateFromQuoteAsync(CurrentUserId, id, new FreelanceTn.Api.Dtos.Invoices.CreateInvoiceFromQuoteRequest(), cancellationToken);
        return Ok(invoice);
    }

    public class UpdateStatusRequest
    {
        public string Status { get; set; } = string.Empty;
        public string? Note { get; set; }
        public bool? Abandon { get; set; }
    }
}
