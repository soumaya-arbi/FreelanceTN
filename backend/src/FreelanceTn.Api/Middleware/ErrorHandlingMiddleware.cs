using System.Text.Json;
using FreelanceTn.Api.Exceptions;

namespace FreelanceTn.Api.Middleware;

public class ErrorHandlingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ErrorHandlingMiddleware> _logger;

    public ErrorHandlingMiddleware(RequestDelegate next, ILogger<ErrorHandlingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (BadRequestException exception)
        {
            await WriteAsync(context, StatusCodes.Status400BadRequest, exception.Message);
        }
        catch (ConflictException exception)
        {
            await WriteAsync(context, StatusCodes.Status409Conflict, exception.Message);
        }
        catch (UnauthorizedException exception)
        {
            await WriteAsync(context, StatusCodes.Status401Unauthorized, exception.Message);
        }
        catch (NotFoundException exception)
        {
            await WriteAsync(context, StatusCodes.Status404NotFound, exception.Message);
        }
        catch (ForbiddenException exception)
        {
            await WriteAsync(context, StatusCodes.Status403Forbidden, exception.Message);
        }
        catch (EmailDeliveryException exception)
        {
            _logger.LogWarning(exception, "Un e-mail transactionnel n'a pas pu être envoyé.");
            await WriteAsync(context, StatusCodes.Status502BadGateway, exception.Message);
        }
        catch (PaymentGatewayException exception)
        {
            _logger.LogWarning(exception, "La passerelle de paiement Sandbox n'a pas abouti.");
            await WriteAsync(context, StatusCodes.Status502BadGateway, exception.Message);
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Une erreur non gérée est survenue.");
            await WriteAsync(context, StatusCodes.Status500InternalServerError, "An unexpected error occurred.");
        }
    }

    private static async Task WriteAsync(HttpContext context, int statusCode, string message)
    {
        if (context.Response.HasStarted)
        {
            return;
        }

        context.Response.Clear();
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/json";

        var payload = new
        {
            status = statusCode,
            message,
            errors = Array.Empty<string>(),
        };

        await context.Response.WriteAsync(JsonSerializer.Serialize(payload));
    }
}
