using ConveyMate.Api.Application.Users.Contracts;

namespace ConveyMate.Api.Application.Audit;

public sealed record AuditEventWriteRequest(
    string ActionCode,
    string ActionGroup,
    string ActionLabel,
    string? Description,
    string Source,
    string ActorType,
    Guid? ActorUserId,
    string? ActorEmail,
    string? ActorName,
    Guid? SubjectUserId,
    string? SubjectEmail,
    string? SubjectName,
    string? EntityType,
    string? EntityId,
    string? EntityLabel,
    object? Metadata = null);

public static class AuditActorTypes
{
    public const string User = "user";
    public const string Admin = "admin";
    public const string Conveyancer = "conveyancer";
    public const string Anonymous = "anonymous";
    public const string System = "system";
}

public static class AuditEventSources
{
    public const string Server = "server";
    public const string Client = "client";
}

public static class AuditEventFactory
{
    public static AuditEventWriteRequest ForAuthenticatedUser(
        UserInfoDto actor,
        string actionCode,
        string actionLabel,
        string? description,
        Guid? subjectUserId = null,
        string? subjectEmail = null,
        string? subjectName = null,
        string? entityType = null,
        string? entityId = null,
        string? entityLabel = null,
        object? metadata = null,
        string source = AuditEventSources.Server)
    {
        return new AuditEventWriteRequest(
            actionCode,
            InferActionGroup(actionCode),
            actionLabel,
            description,
            source,
            actor.IsAdmin ? AuditActorTypes.Admin : AuditActorTypes.User,
            actor.Id,
            actor.Email,
            actor.FullName,
            subjectUserId ?? actor.Id,
            subjectEmail ?? actor.Email,
            subjectName ?? actor.FullName,
            entityType,
            entityId,
            entityLabel,
            metadata);
    }

    public static AuditEventWriteRequest ForConveyancer(
        string actionCode,
        string actionLabel,
        string? description,
        string? actorEmail,
        string? actorName,
        Guid? subjectUserId = null,
        string? subjectEmail = null,
        string? subjectName = null,
        string? entityType = null,
        string? entityId = null,
        string? entityLabel = null,
        object? metadata = null,
        string source = AuditEventSources.Server)
    {
        return new AuditEventWriteRequest(
            actionCode,
            InferActionGroup(actionCode),
            actionLabel,
            description,
            source,
            AuditActorTypes.Conveyancer,
            null,
            actorEmail,
            actorName,
            subjectUserId,
            subjectEmail,
            subjectName,
            entityType,
            entityId,
            entityLabel,
            metadata);
    }

    public static AuditEventWriteRequest ForAnonymous(
        string actionCode,
        string actionLabel,
        string? description,
        string? actorEmail = null,
        string? actorName = null,
        Guid? subjectUserId = null,
        string? subjectEmail = null,
        string? subjectName = null,
        string? entityType = null,
        string? entityId = null,
        string? entityLabel = null,
        object? metadata = null,
        string source = AuditEventSources.Server)
    {
        return new AuditEventWriteRequest(
            actionCode,
            InferActionGroup(actionCode),
            actionLabel,
            description,
            source,
            AuditActorTypes.Anonymous,
            null,
            actorEmail,
            actorName,
            subjectUserId,
            subjectEmail,
            subjectName,
            entityType,
            entityId,
            entityLabel,
            metadata);
    }

    public static AuditEventWriteRequest ForSystem(
        string actionCode,
        string actionLabel,
        string? description,
        Guid? subjectUserId = null,
        string? subjectEmail = null,
        string? subjectName = null,
        string? entityType = null,
        string? entityId = null,
        string? entityLabel = null,
        object? metadata = null)
    {
        return new AuditEventWriteRequest(
            actionCode,
            InferActionGroup(actionCode),
            actionLabel,
            description,
            AuditEventSources.Server,
            AuditActorTypes.System,
            null,
            null,
            "ConveyMate",
            subjectUserId,
            subjectEmail,
            subjectName,
            entityType,
            entityId,
            entityLabel,
            metadata);
    }

    private static string InferActionGroup(string actionCode)
    {
        if (string.IsNullOrWhiteSpace(actionCode))
        {
            return "general";
        }

        var separatorIndex = actionCode.IndexOf('.');
        return separatorIndex <= 0
            ? actionCode.Trim().ToLowerInvariant()
            : actionCode[..separatorIndex].Trim().ToLowerInvariant();
    }
}
