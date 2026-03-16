using System.Security.Claims;
using Carter;
using MediatR;
using ConveyMate.Api.Application.Audit;
using ConveyMate.Api.Presentation;

namespace ConveyMate.Api.Presentation.Endpoints;

public sealed record PasswordResetAuditRequest(string Email);

public sealed class AuditEndpoints : ICarterModule
{
    public void AddRoutes(IEndpointRouteBuilder app)
    {
        app.MapPost("/api/audit/sign-in-succeeded", async (
                ClaimsPrincipal principal,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new RecordSignInAuditCommand(principal), cancellationToken);
                return result.Match(
                    _ => Results.NoContent(),
                    errors => errors.ToHttpResult(unauthorizedTitle: "Authentication is required."));
            })
            .RequireAuthorization()
            .WithName("RecordSignInAudit");

        app.MapPost("/api/audit/password-reset-requested", async (
                PasswordResetAuditRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new RecordPasswordResetAuditCommand(request.Email), cancellationToken);
                return result.Match(
                    _ => Results.NoContent(),
                    errors => errors.ToHttpResult(validationTitle: "Invalid password-reset audit payload."));
            })
            .AllowAnonymous()
            .WithName("RecordPasswordResetAudit");
    }
}
