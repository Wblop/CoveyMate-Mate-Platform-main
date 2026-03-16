using System.Security.Claims;
using ErrorOr;
using MediatR;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using ConveyMate.Api.Application;
using ConveyMate.Api.Application.Audit;
using ConveyMate.Api.Application.Audit.Abstractions;
using ConveyMate.Api.Application.Admin.Contracts;
using ConveyMate.Api.Application.Conveyancers;
using ConveyMate.Api.Application.Conveyancers.Abstractions;
using ConveyMate.Api.Application.Conveyancers.Queries;
using ConveyMate.Api.Application.Users.Abstractions;

namespace ConveyMate.Api.Application.Admin;

public sealed record ListAdminConveyancersQuery(
    ClaimsPrincipal Principal,
    int Page,
    int PageSize,
    string? Search,
    string? Jurisdiction) : IRequest<ErrorOr<AdminConveyancersPageDto>>;

public sealed record CreateAdminConveyancerCommand(
    ClaimsPrincipal Principal,
    CreateAdminConveyancerRequest Request) : IRequest<ErrorOr<AdminConveyancerDto>>;

public sealed record UpdateAdminConveyancerCommand(
    ClaimsPrincipal Principal,
    Guid ConveyancerId,
    UpdateAdminConveyancerRequest Request) : IRequest<ErrorOr<AdminConveyancerDto>>;

public sealed record SetAdminConveyancerActiveCommand(
    ClaimsPrincipal Principal,
    Guid ConveyancerId,
    SetAdminConveyancerActiveRequest Request) : IRequest<ErrorOr<AdminConveyancerDto>>;

public sealed record SetAdminConveyancerQuoteRequestsEnabledCommand(
    ClaimsPrincipal Principal,
    Guid ConveyancerId,
    SetAdminConveyancerQuoteRequestsEnabledRequest Request) : IRequest<ErrorOr<AdminConveyancerDto>>;

public sealed class ListAdminConveyancersQueryHandler(
    ICurrentUserAccessor currentUserAccessor,
    IConveyancerDirectoryRepository conveyancerDirectoryRepository)
    : IRequestHandler<ListAdminConveyancersQuery, ErrorOr<AdminConveyancersPageDto>>
{
    public Task<ErrorOr<AdminConveyancersPageDto>> Handle(ListAdminConveyancersQuery request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            var page = Math.Max(1, request.Page);
            var pageSize = Math.Clamp(request.PageSize <= 0 ? 25 : request.PageSize, 1, 100);
            var jurisdiction = AdminConveyancerHandlerHelpers.NormalizeJurisdiction(request.Jurisdiction);
            if (!string.IsNullOrWhiteSpace(request.Jurisdiction) && jurisdiction is null)
            {
                throw new InvalidOperationException("Jurisdiction filter must be one of ACT, NSW, VIC, QLD, WA, SA, TAS, NT.");
            }

            var list = await conveyancerDirectoryRepository.ListForAdminAsync(
                page,
                pageSize,
                AdminConsoleHandlerHelpers.NormalizeSearch(request.Search),
                jurisdiction,
                cancellationToken);

            var totalPages = list.TotalCount <= 0
                ? 0
                : (int)Math.Ceiling(list.TotalCount / (double)pageSize);

            return new AdminConveyancersPageDto(
                list.Conveyancers.Select(AdminConveyancerHandlerHelpers.ToDto).ToArray(),
                page,
                pageSize,
                list.TotalCount,
                totalPages);
        });
    }
}

public sealed class CreateAdminConveyancerCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    IConveyancerDirectoryRepository conveyancerDirectoryRepository,
    IMemoryCache cache,
    ILogger<CreateAdminConveyancerCommandHandler> logger,
    IAuditTrail auditTrail)
    : IRequestHandler<CreateAdminConveyancerCommand, ErrorOr<AdminConveyancerDto>>
{
    public Task<ErrorOr<AdminConveyancerDto>> Handle(CreateAdminConveyancerCommand request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            var jurisdiction = AdminConveyancerHandlerHelpers.NormalizeJurisdiction(request.Request.Jurisdiction)
                ?? throw new InvalidOperationException("Jurisdiction must be one of ACT, NSW, VIC, QLD, WA, SA, TAS, NT.");
            var organizationName = AdminConveyancerHandlerHelpers.RequireNonEmpty(
                request.Request.OrganizationName,
                "Organization name is required.");
            var contactName = AdminConveyancerHandlerHelpers.NormalizeNullable(request.Request.ContactName);
            var address = AdminConveyancerHandlerHelpers.NormalizeNullable(request.Request.Address);
            var phone = AdminConveyancerHandlerHelpers.NormalizeNullable(request.Request.Phone);
            var email = AdminConveyancerHandlerHelpers.NormalizeNullable(request.Request.Email);
            var website = AdminConveyancerHandlerHelpers.NormalizeNullable(request.Request.Website);
            var now = DateTimeOffset.UtcNow;
            var conveyancerId = Guid.NewGuid();
            var sourceIdentifier = $"manual-{conveyancerId:N}";

            var created = await conveyancerDirectoryRepository.CreateManualAsync(
                new ConveyancerDirectoryCreateRecord(
                    conveyancerId,
                    jurisdiction,
                    "manual",
                    contactName ?? organizationName,
                    contactName,
                    organizationName,
                    address,
                    phone,
                    email,
                    website,
                    AdminConveyancerHandlerHelpers.NormalizeAreas(request.Request.AreasOfPractice),
                    AdminConveyancerHandlerHelpers.ResolveSourceUrl(website, sourceIdentifier),
                    sourceIdentifier,
                    true,
                    request.Request.QuoteRequestsEnabled,
                    now,
                    now,
                    now),
                cancellationToken);

            cache.Remove(ConveyancerDirectoryCacheKeys.BuildJurisdictionKey(created.Jurisdiction));

            logger.LogInformation(
                "AUDIT: Admin {ActorId} ({ActorEmail}) created conveyancer {ConveyancerId} for {Jurisdiction}.",
                actor.Id,
                actor.Email,
                created.Id,
                created.Jurisdiction);

            await auditTrail.WriteAsync(
                AuditEventFactory.ForAuthenticatedUser(
                    actor,
                    "admin.conveyancer_created",
                    "Create conveyancer",
                    $"Created conveyancer {created.OrganizationName ?? created.Name}.",
                    entityType: "conveyancer",
                    entityId: created.Id.ToString(),
                    entityLabel: created.OrganizationName ?? created.Name,
                    metadata: new
                    {
                        created.Jurisdiction,
                        created.QuoteRequestsEnabled
                    }),
                cancellationToken);

            return AdminConveyancerHandlerHelpers.ToDto(created);
        });
    }
}

public sealed class UpdateAdminConveyancerCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    IConveyancerDirectoryRepository conveyancerDirectoryRepository,
    IMemoryCache cache,
    ILogger<UpdateAdminConveyancerCommandHandler> logger,
    IAuditTrail auditTrail)
    : IRequestHandler<UpdateAdminConveyancerCommand, ErrorOr<AdminConveyancerDto>>
{
    public async Task<ErrorOr<AdminConveyancerDto>> Handle(
        UpdateAdminConveyancerCommand request,
        CancellationToken cancellationToken)
    {
        var result = await ErrorOrExecution.TryAsync(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            var organizationName = AdminConveyancerHandlerHelpers.RequireNonEmpty(
                request.Request.OrganizationName,
                "Organization name is required.");
            var contactName = AdminConveyancerHandlerHelpers.NormalizeNullable(request.Request.ContactName);
            var address = AdminConveyancerHandlerHelpers.NormalizeNullable(request.Request.Address);
            var phone = AdminConveyancerHandlerHelpers.NormalizeNullable(request.Request.Phone);
            var email = AdminConveyancerHandlerHelpers.NormalizeNullable(request.Request.Email);
            var website = AdminConveyancerHandlerHelpers.NormalizeNullable(request.Request.Website);

            var updated = await conveyancerDirectoryRepository.UpdateAsync(
                request.ConveyancerId,
                new ConveyancerDirectoryUpdateRecord(
                    contactName ?? organizationName,
                    contactName,
                    organizationName,
                    address,
                    phone,
                    email,
                    website,
                    AdminConveyancerHandlerHelpers.NormalizeAreas(request.Request.AreasOfPractice),
                    request.Request.QuoteRequestsEnabled),
                cancellationToken);
            if (updated is null)
            {
                return null;
            }

            cache.Remove(ConveyancerDirectoryCacheKeys.BuildJurisdictionKey(updated.Jurisdiction));

            logger.LogInformation(
                "AUDIT: Admin {ActorId} ({ActorEmail}) updated conveyancer {ConveyancerId}.",
                actor.Id,
                actor.Email,
                updated.Id);

            await auditTrail.WriteAsync(
                AuditEventFactory.ForAuthenticatedUser(
                    actor,
                    "admin.conveyancer_updated",
                    "Update conveyancer",
                    $"Updated conveyancer {updated.OrganizationName ?? updated.Name}.",
                    entityType: "conveyancer",
                    entityId: updated.Id.ToString(),
                    entityLabel: updated.OrganizationName ?? updated.Name,
                    metadata: new
                    {
                        updated.QuoteRequestsEnabled
                    }),
                cancellationToken);

            return AdminConveyancerHandlerHelpers.ToDto(updated);
        });

        if (result.IsError)
        {
            return result.Errors;
        }

        return result.Value is null
            ? Error.NotFound(description: "Conveyancer was not found.")
            : result.Value;
    }
}

public sealed class SetAdminConveyancerActiveCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    IConveyancerDirectoryRepository conveyancerDirectoryRepository,
    IMemoryCache cache,
    ILogger<SetAdminConveyancerActiveCommandHandler> logger,
    IAuditTrail auditTrail)
    : IRequestHandler<SetAdminConveyancerActiveCommand, ErrorOr<AdminConveyancerDto>>
{
    public async Task<ErrorOr<AdminConveyancerDto>> Handle(
        SetAdminConveyancerActiveCommand request,
        CancellationToken cancellationToken)
    {
        var result = await ErrorOrExecution.TryAsync(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            var updated = await conveyancerDirectoryRepository.SetActiveAsync(
                request.ConveyancerId,
                request.Request.IsActive,
                cancellationToken);
            if (updated is null)
            {
                return null;
            }

            cache.Remove(ConveyancerDirectoryCacheKeys.BuildJurisdictionKey(updated.Jurisdiction));

            logger.LogInformation(
                "AUDIT: Admin {ActorId} ({ActorEmail}) set conveyancer {ConveyancerId} active={IsActive}.",
                actor.Id,
                actor.Email,
                updated.Id,
                updated.IsActive);

            await auditTrail.WriteAsync(
                AuditEventFactory.ForAuthenticatedUser(
                    actor,
                    "admin.conveyancer_active_changed",
                    updated.IsActive ? "Activate conveyancer" : "Deactivate conveyancer",
                    $"{(updated.IsActive ? "Activated" : "Deactivated")} conveyancer {updated.OrganizationName ?? updated.Name}.",
                    entityType: "conveyancer",
                    entityId: updated.Id.ToString(),
                    entityLabel: updated.OrganizationName ?? updated.Name,
                    metadata: new
                    {
                        updated.IsActive
                    }),
                cancellationToken);

            return AdminConveyancerHandlerHelpers.ToDto(updated);
        });

        if (result.IsError)
        {
            return result.Errors;
        }

        return result.Value is null
            ? Error.NotFound(description: "Conveyancer was not found.")
            : result.Value;
    }
}

public sealed class SetAdminConveyancerQuoteRequestsEnabledCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    IConveyancerDirectoryRepository conveyancerDirectoryRepository,
    IMemoryCache cache,
    ILogger<SetAdminConveyancerQuoteRequestsEnabledCommandHandler> logger,
    IAuditTrail auditTrail)
    : IRequestHandler<SetAdminConveyancerQuoteRequestsEnabledCommand, ErrorOr<AdminConveyancerDto>>
{
    public async Task<ErrorOr<AdminConveyancerDto>> Handle(
        SetAdminConveyancerQuoteRequestsEnabledCommand request,
        CancellationToken cancellationToken)
    {
        var result = await ErrorOrExecution.TryAsync(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            var updated = await conveyancerDirectoryRepository.SetQuoteRequestsEnabledAsync(
                request.ConveyancerId,
                request.Request.IsEnabled,
                cancellationToken);
            if (updated is null)
            {
                return null;
            }

            cache.Remove(ConveyancerDirectoryCacheKeys.BuildJurisdictionKey(updated.Jurisdiction));

            logger.LogInformation(
                "AUDIT: Admin {ActorId} ({ActorEmail}) set conveyancer {ConveyancerId} quote_requests_enabled={IsEnabled}.",
                actor.Id,
                actor.Email,
                updated.Id,
                updated.QuoteRequestsEnabled);

            await auditTrail.WriteAsync(
                AuditEventFactory.ForAuthenticatedUser(
                    actor,
                    "admin.conveyancer_quote_requests_changed",
                    updated.QuoteRequestsEnabled ? "Enable quote requests" : "Disable quote requests",
                    $"{(updated.QuoteRequestsEnabled ? "Enabled" : "Disabled")} quote requests for {updated.OrganizationName ?? updated.Name}.",
                    entityType: "conveyancer",
                    entityId: updated.Id.ToString(),
                    entityLabel: updated.OrganizationName ?? updated.Name,
                    metadata: new
                    {
                        updated.QuoteRequestsEnabled
                    }),
                cancellationToken);

            return AdminConveyancerHandlerHelpers.ToDto(updated);
        });

        if (result.IsError)
        {
            return result.Errors;
        }

        return result.Value is null
            ? Error.NotFound(description: "Conveyancer was not found.")
            : result.Value;
    }
}

internal static class AdminConveyancerHandlerHelpers
{
    public static AdminConveyancerDto ToDto(ConveyancerDirectoryRecord record)
    {
        return new AdminConveyancerDto(
            record.Id,
            record.Jurisdiction,
            record.RegulatorType,
            record.Name,
            record.ContactName,
            record.OrganizationName,
            record.Address,
            record.Phone,
            record.Email,
            record.Website,
            record.AreasOfPractice,
            record.SourceUrl,
            record.SourceIdentifier,
            record.IsActive,
            record.QuoteRequestsEnabled,
            record.QuoteRequestsDisabledAtUtc,
            record.LastSeenUtc);
    }

    public static string? NormalizeJurisdiction(string? jurisdiction)
    {
        return string.IsNullOrWhiteSpace(jurisdiction)
            ? null
            : GetConveyancersQueryHandler.NormalizeJurisdiction(jurisdiction);
    }

    public static string RequireNonEmpty(string? value, string errorMessage)
    {
        var normalized = NormalizeNullable(value);
        return normalized ?? throw new InvalidOperationException(errorMessage);
    }

    public static string? NormalizeNullable(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrWhiteSpace(trimmed) ? null : trimmed;
    }

    public static IReadOnlyList<string> NormalizeAreas(IReadOnlyList<string>? values)
    {
        var normalized = (values ?? [])
            .Select(value => value?.Trim() ?? string.Empty)
            .Where(value => value.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(12)
            .ToArray();

        return normalized.Length > 0 ? normalized : ["Conveyancing"];
    }

    public static string ResolveSourceUrl(string? website, string sourceIdentifier)
    {
        var normalizedWebsite = NormalizeNullable(website);
        if (!string.IsNullOrWhiteSpace(normalizedWebsite))
        {
            if (normalizedWebsite.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                normalizedWebsite.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                return normalizedWebsite;
            }

            return $"https://{normalizedWebsite}";
        }

        return $"https://app.conveymate.com.au/conveyancers?source=manual:{sourceIdentifier}";
    }
}
