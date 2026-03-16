using ErrorOr;

namespace ConveyMate.Api.Application.Auth.Abstractions;

public interface ICognitoSignUpService
{
    Task<ErrorOr<CognitoSignUpResult>> SignUpAsync(string fullName, string email, string password, CancellationToken cancellationToken);
}

public sealed record CognitoSignUpResult(bool UserConfirmed);
