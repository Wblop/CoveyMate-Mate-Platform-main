namespace ConveyMate.Api.Domain.Users;

/// <summary>
/// Domain entity representing an application user persisted from Cognito claims.
/// </summary>
public sealed record AppUser(
    Guid Id,
    string CognitoSub,
    string Email,
    string FullName,
    bool IsAdmin,
    bool IsSuspended,
    DateTimeOffset? LastLoginAt,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);
