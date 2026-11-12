using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using FreelanceTn.Api.Dtos.Invoices;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FreelanceTn.Api.Controllers;

[ApiController]
[Route("api/invoices")]
public class InvoicesController : ControllerBase
{
    private readonly InvoiceService _invoiceService;

    public InvoicesController(InvoiceService invoiceService)
    {
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
        var invoices = await _invoiceService.ListAsync(CurrentUserId, cancellationToken);
        return Ok(invoices);
    }

    [HttpGet("{id}")]
    [Authorize]
    public async Task<IActionResult> Get(string id, CancellationToken cancellationToken)
    {
        var invoice = await _invoiceService.GetAsync(CurrentUserId, id, cancellationToken);
        return Ok(invoice);
    }

    [HttpPost]
    [Authorize]
    public async Task<IActionResult> Create([FromBody] CreateInvoiceRequest request, CancellationToken cancellationToken)
    {
        var invoice = await _invoiceService.CreateAsync(CurrentUserId, request, cancellationToken);
        return CreatedAtAction(nameof(Get), new { id = invoice.Id }, invoice);
    }

    [HttpPost("from-quote/{quoteId}")]
    [Authorize]
    public async Task<IActionResult> CreateFromQuote(string quoteId, [FromBody] CreateInvoiceFromQuoteRequest? request, CancellationToken cancellationToken)
    {
        var invoice = await _invoiceService.CreateFromQuoteAsync(CurrentUserId, quoteId, request ?? new CreateInvoiceFromQuoteRequest(), cancellationToken);
        return CreatedAtAction(nameof(Get), new { id = invoice.Id }, invoice);
    }

    [HttpPut("{id}")]
    [Authorize]
    public async Task<IActionResult> Update(string id, [FromBody] UpdateInvoiceRequest request, CancellationToken cancellationToken)
    {
        var invoice = await _invoiceService.UpdateAsync(CurrentUserId, id, request, cancellationToken);
        return Ok(invoice);
    }

    [HttpDelete("{id}")]
    [Authorize]
    public async Task<IActionResult> Delete(string id, CancellationToken cancellationToken)
    {
        await _invoiceService.DeleteAsync(CurrentUserId, id, cancellationToken);
        return NoContent();
    }

    [HttpPatch("{id}/status")]
    [Authorize]
    public async Task<IActionResult> UpdateStatus(string id, [FromBody] UpdateStatusRequest request, CancellationToken cancellationToken)
    {
        var invoice = await _invoiceService.UpdateStatusAsync(CurrentUserId, id, request.Status, cancellationToken);
        return Ok(invoice);
    }

    [HttpPost("{id}/payments")]
    [Authorize]
    public async Task<IActionResult> RecordPayment(string id, [FromBody] RecordPaymentRequest request, CancellationToken cancellationToken)
    {
        var invoice = await _invoiceService.RecordPaymentAsync(CurrentUserId, id, request, cancellationToken);
        return Ok(invoice);
    }

    public class UpdateStatusRequest
    {
        public string Status { get; set; } = string.Empty;
    }
}
