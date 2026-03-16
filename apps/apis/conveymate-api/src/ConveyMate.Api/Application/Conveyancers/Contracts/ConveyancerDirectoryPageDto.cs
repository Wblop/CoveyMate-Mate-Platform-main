namespace ConveyMate.Api.Application.Conveyancers.Contracts;

/// <summary>
/// Paginated conveyancer directory API payload.
/// </summary>
public sealed record ConveyancerDirectoryPageDto(
    IReadOnlyList<ConveyancerDirectoryItemDto> Items,
    int Page,
    int PageSize,
    int TotalCount,
    IReadOnlyList<string> RegulatorTypes);
