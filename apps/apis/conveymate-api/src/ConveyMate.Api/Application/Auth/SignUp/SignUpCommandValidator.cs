using FluentValidation;

namespace ConveyMate.Api.Application.Auth.SignUp;

public sealed class SignUpCommandValidator : AbstractValidator<SignUpCommand>
{
    public SignUpCommandValidator()
    {
        RuleFor(command => command.Request.FullName)
            .NotEmpty()
            .WithMessage("Enter your full name.");

        RuleFor(command => command.Request.Email)
            .Must(value => !string.IsNullOrWhiteSpace(value) && value.Contains('@', StringComparison.Ordinal))
            .WithMessage("Enter a valid email address.");

        RuleFor(command => command.Request.Password)
            .MinimumLength(12)
            .WithMessage("Use a password with at least 12 characters.");
    }
}
