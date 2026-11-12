namespace FreelanceTn.Api.Exceptions;

public class ConflictException : Exception
{
    public ConflictException(string message) : base(message) { }
}

public class BadRequestException : Exception
{
    public BadRequestException(string message) : base(message) { }
}

public class UnauthorizedException : Exception
{
    public UnauthorizedException(string message) : base(message) { }
}

public class NotFoundException : Exception
{
    public NotFoundException(string message) : base(message) { }
}

public class ForbiddenException : Exception
{
    public ForbiddenException(string message) : base(message) { }
}

/// <summary>
/// L'envoi d'un e-mail transactionnel a échoué (SMTP injoignable, aucun
/// fournisseur configuré...). Traduit en 502 pour ne pas faire croire à un succès.
/// </summary>
public class EmailDeliveryException : Exception
{
    public EmailDeliveryException(string message) : base(message) { }

    public EmailDeliveryException(string message, Exception innerException)
        : base(message, innerException) { }
}

/// <summary>
/// La passerelle de paiement Sandbox est injoignable, mal configurée ou a
/// répondu de façon inattendue. Traduit en 502 : le paiement n'est jamais
/// considéré comme réussi sans vérification serveur.
/// </summary>
public class PaymentGatewayException : Exception
{
    public PaymentGatewayException(string message) : base(message) { }

    public PaymentGatewayException(string message, Exception innerException)
        : base(message, innerException) { }
}
