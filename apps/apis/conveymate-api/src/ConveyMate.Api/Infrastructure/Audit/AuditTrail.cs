using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using ConveyMate.Api.Application.Audit;
using ConveyMate.Api.Application.Audit.Abstractions;

namespace ConveyMate.Api.Infrastructure.Audit;

public sealed class AuditTrail(
    IAuditRepository auditRepository,
    IHttpContextAccessor httpContextAccessor,
    ILogger<AuditTrail> logger)
    : IAuditTrail
{
    public async Task WriteAsync(AuditEventWriteRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var httpContext = httpContextAccessor.HttpContext;
            var metadataJson = request.Metadata is null
                ? "{}"
                : JsonSerializer.Serialize(request.Metadata);

            await auditRepository.InsertAsync(
                new AuditEventCreateRecord(
                    DateTimeOffset.UtcNow,
                    request.ActionCode.Trim(),
                    request.ActionGroup.Trim().ToLowerInvariant(),
                    NormalizeRequired(request.ActionLabel, 160),
                    NormalizeOptional(request.Description, 1200),
                    NormalizeRequired(request.Source, 32),
                    NormalizeRequired(request.ActorType, 32),
                    request.ActorUserId,
                    NormalizeOptional(request.ActorEmail, 320),
                    NormalizeOptional(request.ActorName, 320),
                    request.SubjectUserId,
                    NormalizeOptional(request.SubjectEmail, 320),
                    NormalizeOptional(request.SubjectName, 320),
                    NormalizeOptional(request.EntityType, 80),
                    NormalizeOptional(request.EntityId, 160),
                    NormalizeOptional(request.EntityLabel, 320),
                    NormalizeOptional(httpContext?.Request.Path.Value, 512),
                    NormalizeOptional(httpContext?.Request.Method, 16),
                    NormalizeOptional(ResolveIpAddress(httpContext), 128),
                    NormalizeOptional(httpContext?.Request.Headers.UserAgent.ToString(), 1024),
                    metadataJson),
                cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception error)
        {
            logger.LogWarning(
                error,
                "Audit write failed for action {ActionCode}. The primary request completed without a persisted audit record.",
                request.ActionCode);
        }
    }

    private static string? ResolveIpAddress(HttpContext? httpContext)
    {
        if (httpContext is null)
        {
            return null;
        }

        var forwardedFor = httpContext.Request.Headers["X-Forwarded-For"].ToString();
        if (!string.IsNullOrWhiteSpace(forwardedFor))
        {
            return forwardedFor.Split(',')[0].Trim();
        }

        return httpContext.Connection.RemoteIpAddress?.ToString();
    }

    private static string NormalizeRequired(string? value, int maxLength)
    {
        var normalized = NormalizeOptional(value, maxLength);
        return string.IsNullOrWhiteSpace(normalized)
            ? throw new InvalidOperationException("Audit fields cannot be empty.")
            : normalized;
    }

    private static string? NormalizeOptional(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var trimmed = value.Trim();
        return trimmed.Length <= maxLength
            ? trimmed
            : trimmed[..maxLength];
    }
}
