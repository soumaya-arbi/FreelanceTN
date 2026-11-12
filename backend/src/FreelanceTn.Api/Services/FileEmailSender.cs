using FreelanceTn.Api.Configuration;
using Microsoft.Extensions.Options;

namespace FreelanceTn.Api.Services;

public class FileEmailSender : IEmailSender
{
    private readonly string _outboxPath;
    private readonly ILogger<FileEmailSender> _logger;

    public EmailTransport Transport => EmailTransport.DevOutbox;

    public FileEmailSender(
        IWebHostEnvironment environment,
        IOptions<AuthSettings> authSettings,
        ILogger<FileEmailSender> logger)
    {
        _outboxPath = Path.Combine(environment.ContentRootPath, authSettings.Value.Email.DevOutboxPath);
        _logger = logger;
    }

    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(_outboxPath);

        var fileName = $"{DateTime.UtcNow:yyyyMMdd-HHmmssfff}-{Guid.NewGuid():N}.txt";
        var path = Path.Combine(_outboxPath, fileName);
        var content = $"To: {message.To}{Environment.NewLine}Subject: {message.Subject}{Environment.NewLine}SentAt: {DateTime.UtcNow:O}{Environment.NewLine}{Environment.NewLine}{message.Body}{Environment.NewLine}";

        await File.WriteAllTextAsync(path, content, cancellationToken);
        _logger.LogInformation("E-mail de développement écrit dans {Path}.", path);
    }
}
