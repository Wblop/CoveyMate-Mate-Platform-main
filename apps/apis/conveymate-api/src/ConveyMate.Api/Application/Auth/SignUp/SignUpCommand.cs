using ErrorOr;
using MediatR;

namespace ConveyMate.Api.Application.Auth.SignUp;

public sealed record SignUpCommand(PublicSignUpRequest Request) : IRequest<ErrorOr<PublicSignUpResponse>>;

public sealed record PublicSignUpRequest(
    string FullName,
    string Email,
    string Password);

public sealed record PublicSignUpResponse(
    bool UserConfirmed);
