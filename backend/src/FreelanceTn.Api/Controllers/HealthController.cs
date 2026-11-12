using FreelanceTn.Api.Data;
using Microsoft.AspNetCore.Mvc;

namespace FreelanceTn.Api.Controllers;

[ApiController]
[Route("api/health")]
public class HealthController : ControllerBase
{
    private readonly MongoContext _mongo;

    public HealthController(MongoContext mongo)
    {
        _mongo = mongo;
    }

    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken cancellationToken)
    {
        var databaseConfigured = !string.IsNullOrWhiteSpace(_mongo.Settings.DatabaseName);
        var mongoReachable = await _mongo.PingAsync(cancellationToken);
        var healthy = databaseConfigured && mongoReachable;

        var payload = new
        {
            status = healthy ? "healthy" : "unhealthy",
            database = new
            {
                configured = databaseConfigured,
                name = _mongo.Settings.DatabaseName,
                reachable = mongoReachable,
            },
            timestamp = DateTime.UtcNow,
        };

        return healthy
            ? Ok(payload)
            : StatusCode(StatusCodes.Status503ServiceUnavailable, payload);
    }
}
