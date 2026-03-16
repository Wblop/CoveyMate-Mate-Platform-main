using ErrorOr;
using MediatR;
using ConveyMate.Api.Application.Audit;
using ConveyMate.Api.Application.Audit.Abstractions;
using ConveyMate.Api.Application.Auth.Abstractions;

namespace ConveyMate.Api.Application.Auth.SignUp;

public sealed class SignUpCommandHandler(
    ICognitoSignUpService cognitoSignUpService,
    IAuditTrail auditTrail)
    : IRequestHandler<SignUpCommand, ErrorOr<PublicSignUpResponse>>
{
    public async Task<ErrorOr<PublicSignUpResponse>> Handle(SignUpCommand request, CancellationToken cancellationToken)
    {
        var normalizedName = request.Request.FullName.Trim();
        var normalizedEmail = request.Request.Email.Trim().ToLowerInvariant();

        var result = await cognitoSignUpService.SignUpAsync(
            normalizedName,
            normalizedEmail,
            request.Request.Password,
            cancellationToken);

        if (result.IsError)
        {
            return result.Errors;
        }

        await auditTrail.WriteAsync(
            AuditEventFactory.ForAnonymous(
                "auth.sign_up_completed",
                "Sign up",
                result.Value.UserConfirmed
                    ? "Created and confirmed a new account."
                    : "Created a new account pending email confirmation.",
                actorEmail: normalizedEmail,
                actorName: normalizedName,
                subjectEmail: normalizedEmail,
                subjectName: normalizedName,
                entityType: "account",
                entityLabel: normalizedEmail,
                metadata: new
                {
                    userConfirmed = result.Value.UserConfirmed
                }),
            cancellationToken);

        return new PublicSignUpResponse(result.Value.UserConfirmed);
    }
}
