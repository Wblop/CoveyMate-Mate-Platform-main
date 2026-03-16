using ErrorOr;
using FluentValidation;
using MediatR;

namespace ConveyMate.Api.Application;

/// <summary>
/// Runs FluentValidation validators for MediatR requests and returns validation errors as ErrorOr responses.
/// </summary>
public sealed class ValidationBehavior<TRequest, TResponse>(
    IEnumerable<IValidator<TRequest>> validators) : IPipelineBehavior<TRequest, TResponse>
    where TRequest : IRequest<TResponse>
{
    public async Task<TResponse> Handle(
        TRequest request,
        RequestHandlerDelegate<TResponse> next,
        CancellationToken cancellationToken)
    {
        if (!validators.Any())
        {
            return await next();
        }

        var context = new ValidationContext<TRequest>(request);
        var validationResults = await Task.WhenAll(validators.Select(validator => validator.ValidateAsync(context, cancellationToken)));
        var failures = validationResults
            .SelectMany(result => result.Errors)
            .Where(failure => failure is not null)
            .ToArray();

        if (failures.Length == 0)
        {
            return await next();
        }

        var errors = failures
            .Select(failure => Error.Validation(
                code: string.IsNullOrWhiteSpace(failure.PropertyName) ? "validation" : failure.PropertyName,
                description: failure.ErrorMessage))
            .ToList();

        if (IsErrorOrResponseType())
        {
            return (TResponse)(dynamic)errors;
        }

        throw new InvalidOperationException(
            $"Validation behavior requires ErrorOr<T> responses. Request {typeof(TRequest).Name} returned {typeof(TResponse).Name}.");
    }

    private static bool IsErrorOrResponseType()
    {
        return typeof(TResponse).IsGenericType &&
               typeof(TResponse).GetGenericTypeDefinition() == typeof(ErrorOr<>);
    }
}
