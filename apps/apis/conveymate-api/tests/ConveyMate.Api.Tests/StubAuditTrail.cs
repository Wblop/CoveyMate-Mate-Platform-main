using ConveyMate.Api.Application.Audit;
using ConveyMate.Api.Application.Audit.Abstractions;

namespace ConveyMate.Api.Tests;

internal sealed class StubAuditTrail : IAuditTrail
{
    public List<AuditEventWriteRequest> Events { get; } = [];

    public Task WriteAsync(AuditEventWriteRequest request, CancellationToken cancellationToken)
    {
        Events.Add(request);
        return Task.CompletedTask;
    }
}
