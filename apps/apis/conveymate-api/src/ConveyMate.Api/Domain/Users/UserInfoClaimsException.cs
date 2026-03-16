namespace ConveyMate.Api.Domain.Users;

/// <summary>
/// Raised when required identity claims are missing for user-info resolution.
/// </summary>
public sealed class UserInfoClaimsException(string message) : Exception(message);
