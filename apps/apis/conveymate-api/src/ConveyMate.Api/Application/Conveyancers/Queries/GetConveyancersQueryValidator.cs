using FluentValidation;

namespace ConveyMate.Api.Application.Conveyancers.Queries;

/// <summary>
/// Validates conveyancer directory query options accepted by the API.
/// </summary>
public sealed class GetConveyancersQueryValidator : AbstractValidator<GetConveyancersQuery>
{
    public GetConveyancersQueryValidator()
    {
        RuleFor(query => query.Jurisdiction)
            .Must(jurisdiction => GetConveyancersQueryHandler.NormalizeJurisdiction(jurisdiction) is not null)
            .WithMessage("Jurisdiction must be one of ACT, NSW, VIC, QLD, WA, SA, TAS, NT.");
    }
}
