using System.Security.Claims;
using ErrorOr;
using MediatR;
using ConveyMate.Api.Application;
using ConveyMate.Api.Application.Audit.Abstractions;
using ConveyMate.Api.Application.Users.Abstractions;

namespace ConveyMate.Api.Application.Audit;

public sealed record RecordSignInAuditCommand(ClaimsPrincipal Principal) : IRequest<ErrorOr<Success>>;

public sealed record RecordPasswordResetAuditCommand(string Email) : IRequest<ErrorOr<Success>>;

public sealed class RecordSignInAuditCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    IAuditTrail auditTrail)
    : IRequestHandler<RecordSignInAuditCommand, ErrorOr<Success>>
{
    public Task<ErrorOr<Success>> Handle(RecordSignInAuditCommand request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            await auditTrail.WriteAsync(
                AuditEventFactory.ForAuthenticatedUser(
                    actor,
                    "auth.sign_in_succeeded",
                    "Sign in",
                    "Signed in to ConveyMate.",
                    entityType: "session",
                    entityLabel: "Authenticated session",
                    source: AuditEventSources.Client),
                cancellationToken);

            return Result.Success;
        });
    }
}

public sealed class RecordPasswordResetAuditCommandHandler(IAuditTrail auditTrail)
    : IRequestHandler<RecordPasswordResetAuditCommand, ErrorOr<Success>>
{
    public Task<ErrorOr<Success>> Handle(RecordPasswordResetAuditCommand request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(async () =>
        {
            var normalizedEmail = request.Email.Trim().ToLowerInvariant();
            if (string.IsNullOrWhiteSpace(normalizedEmail) || !normalizedEmail.Contains('@', StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Enter a valid email address.");
            }

            await auditTrail.WriteAsync(
                AuditEventFactory.ForAnonymous(
                    "auth.password_reset_requested",
                    "Password reset requested",
                    "Requested a password reset email.",
                    actorEmail: normalizedEmail,
                    subjectEmail: normalizedEmail,
                    entityType: "account",
                    entityLabel: normalizedEmail,
                    metadata: new
                    {
                        delivery = "cognito"
                    },
                    source: AuditEventSources.Client),
                cancellationToken);

            return Result.Success;
        });
    }
}
