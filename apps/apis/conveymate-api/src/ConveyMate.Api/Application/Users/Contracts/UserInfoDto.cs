namespace ConveyMate.Api.Application.Users.Contracts;

/// <summary>
/// Public user profile payload returned to authenticated frontend clients.
/// </summary>
public sealed record UserInfoDto(
    Guid Id,
    string FullName,
    string Email,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastLoginAtUtc,
    bool IsAdmin);
