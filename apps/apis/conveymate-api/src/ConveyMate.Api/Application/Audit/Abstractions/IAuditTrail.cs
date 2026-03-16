namespace ConveyMate.Api.Application.Audit.Abstractions;

public interface IAuditTrail
{
    Task WriteAsync(AuditEventWriteRequest request, CancellationToken cancellationToken);
}
