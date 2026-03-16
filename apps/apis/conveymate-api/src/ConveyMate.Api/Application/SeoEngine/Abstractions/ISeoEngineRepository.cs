namespace ConveyMate.Api.Application.SeoEngine.Abstractions;

public interface ISeoEngineRepository
{
    Task<SeoEngineOverviewRecord> GetOverviewAsync(CancellationToken cancellationToken);

    Task<IReadOnlyList<SeoEngineJobRecord>> ListJobsAsync(int limit, CancellationToken cancellationToken);

    Task<SeoEngineJobRecord?> GetJobAsync(Guid jobId, CancellationToken cancellationToken);

    Task<IReadOnlyList<SeoEngineArticleListRecord>> ListArticlesAsync(string? status, int limit, CancellationToken cancellationToken);

    Task<SeoEngineArticleRecord?> GetArticleAsync(Guid articleId, CancellationToken cancellationToken);

    Task<SeoEngineJobRecord> CreateJobAsync(
        string jobType,
        string requestedSource,
        Guid? requestedByUserId,
        string? requestedByEmail,
        string? requestedByName,
        CancellationToken cancellationToken);

    Task<SeoEngineJobRecord> EnsureJobAsync(
        Guid jobId,
        string jobType,
        string requestedSource,
        Guid? requestedByUserId,
        string? requestedByEmail,
        string? requestedByName,
        CancellationToken cancellationToken);

    Task UpdateJobStatusAsync(
        Guid jobId,
        string status,
        Guid? articleId,
        string? errorMessage,
        CancellationToken cancellationToken);

    Task<bool> DeleteTerminalJobAsync(Guid jobId, CancellationToken cancellationToken);

    Task<int> ClearTerminalJobsAsync(CancellationToken cancellationToken);

    Task<SeoEngineArticleRecord> SaveArticleAsync(SeoEngineArticleSaveRecord record, CancellationToken cancellationToken);

    Task<SeoEngineArticleRecord?> PublishArticleAsync(Guid articleId, Guid publishedByUserId, CancellationToken cancellationToken);

    Task<bool> DeleteArticleAsync(Guid articleId, Guid deletedByUserId, CancellationToken cancellationToken);

    Task<IReadOnlyList<SeoEngineDuplicateWarningRecord>> FindDuplicateWarningsAsync(
        Guid? excludeArticleId,
        string slug,
        string title,
        string bodyPlainText,
        string bodyFingerprintSha256,
        IReadOnlyList<string> sourceUrls,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<PublishedInsightArticleRecord>> ListPublishedArticlesAsync(CancellationToken cancellationToken);
}

public sealed record SeoEngineOverviewRecord(
    int DraftCount,
    int PublishedCount,
    int RunningJobCount,
    int FailedJobCount);

public sealed record SeoEngineJobRecord(
    Guid Id,
    string JobType,
    string Status,
    string RequestedSource,
    string? RequestedByEmail,
    string? RequestedByName,
    Guid? ArticleId,
    DateTimeOffset CreatedAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? CompletedAt,
    string? ErrorMessage);

public sealed record SeoEngineDuplicateWarningRecord(
    string Severity,
    string MatchType,
    string Message,
    Guid? ExistingArticleId,
    string? ExistingArticleTitle,
    string? ExistingArticleSlug,
    decimal SimilarityScore);

public sealed record SeoEngineArticleSectionRecord(
    string SectionId,
    string Heading,
    string[] Paragraphs,
    string[] Bullets,
    int Position);

public sealed record SeoEngineArticleSourceRecord(
    string SourceName,
    string Publisher,
    string Headline,
    string SourceUrl,
    DateTimeOffset? PublishedAt,
    string Summary,
    int Position);

public sealed record SeoEngineArticleListRecord(
    Guid Id,
    string Status,
    string Title,
    string Slug,
    string Excerpt,
    string MetaTitle,
    string MetaDescription,
    string[] Tags,
    string[] Keywords,
    int SourceCount,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? PublishedAt,
    IReadOnlyList<SeoEngineDuplicateWarningRecord> DuplicateWarnings);

public sealed record SeoEngineArticleRecord(
    Guid Id,
    string Status,
    string Title,
    string Slug,
    string Excerpt,
    string BodyMarkdown,
    string BodyHtml,
    string BodyPlainText,
    string MetaTitle,
    string MetaDescription,
    string[] Tags,
    string[] Keywords,
    int SourceCount,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? LastGeneratedAt,
    DateTimeOffset? PublishedAt,
    IReadOnlyList<SeoEngineDuplicateWarningRecord> DuplicateWarnings,
    IReadOnlyList<SeoEngineArticleSectionRecord> Sections,
    IReadOnlyList<SeoEngineArticleSourceRecord> Sources);

public sealed record SeoEngineArticleSaveRecord(
    Guid Id,
    string Status,
    string Title,
    string Slug,
    string Excerpt,
    string BodyMarkdown,
    string BodyHtml,
    string BodyPlainText,
    string BodyFingerprintSha256,
    string MetaTitle,
    string MetaDescription,
    string[] Tags,
    string[] Keywords,
    int SourceCount,
    DateTimeOffset? LastGeneratedAt,
    Guid? CreatedByUserId,
    Guid? UpdatedByUserId,
    IReadOnlyList<SeoEngineDuplicateWarningRecord> DuplicateWarnings,
    IReadOnlyList<SeoEngineArticleSectionRecord> Sections,
    IReadOnlyList<SeoEngineArticleSourceRecord> Sources);

public sealed record PublishedInsightArticleRecord(
    Guid Id,
    string Title,
    string Slug,
    string Excerpt,
    string BodyHtml,
    string MetaTitle,
    string MetaDescription,
    string[] Tags,
    string[] Keywords,
    DateTimeOffset PublishedAt,
    DateTimeOffset UpdatedAt,
    IReadOnlyList<SeoEngineArticleSectionRecord> Sections,
    IReadOnlyList<SeoEngineArticleSourceRecord> Sources);
