using System.Security.Claims;
using ErrorOr;
using MediatR;
using ConveyMate.Api.Application.Users.Contracts;

namespace ConveyMate.Api.Application.Users.Queries.GetUserInfo;

/// <summary>
/// CQRS query for resolving caller claims into an application user profile.
/// </summary>
public sealed record GetUserInfoQuery(ClaimsPrincipal Principal) : IRequest<ErrorOr<UserInfoDto>>;
