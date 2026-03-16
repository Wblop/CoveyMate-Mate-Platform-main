using System.Security.Claims;
using ConveyMate.Api.Application.Audit;
using ConveyMate.Api.Application.Audit.Abstractions;
using ConveyMate.Api.Application.Configuration.Contracts;
using ConveyMate.Api.Application.Configuration.EnabledStates;
using ConveyMate.Api.Application.Reviews;
using ConveyMate.Api.Application.Reviews.Abstractions;
using ConveyMate.Api.Application.Reviews.Contracts;
using ConveyMate.Api.Application.Users.Abstractions;
using ConveyMate.Api.Application.Users.Contracts;

namespace ConveyMate.Api.Tests;

public sealed class ReviewHandlersBuyerContextTests
{
    private static readonly ClaimsPrincipal Principal = new(new ClaimsIdentity());

    [Fact]
    public async Task CreateReview_AllowsLegacyPayloadWithoutBuyerContext()
    {
        var repository = new StubReviewJobRepository();
        var handler = BuildCreateHandler(repository);
        var request = BuildRequest(buyerContext: null);

        var response = await handler.HandleAsync(Principal, request, CancellationToken.None);

        Assert.NotEqual(Guid.Empty, response.JobId);
        Assert.Null(repository.LastCreatedBuyerContextJson);
    }

    [Fact]
    public async Task CreateReview_PersistsValidBuyerContext()
    {
        var repository = new StubReviewJobRepository();
        var handler = BuildCreateHandler(repository);
        var request = BuildRequest(new ReviewBuyerContextDto(
            IsFirstHomeBuyer: true,
            ConcessionIntent: "yes",
            ContractExchanged: false,
            AgreedPriceAud: null,
            EstimatedPriceAud: 845000m));

        await handler.HandleAsync(Principal, request, CancellationToken.None);

        Assert.NotNull(repository.LastCreatedBuyerContextJson);
        Assert.Contains("\"IsFirstHomeBuyer\":true", repository.LastCreatedBuyerContextJson!, StringComparison.Ordinal);
        Assert.Contains("\"ContractExchanged\":false", repository.LastCreatedBuyerContextJson!, StringComparison.Ordinal);
        Assert.Contains("\"EstimatedPriceAud\":845000", repository.LastCreatedBuyerContextJson!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task CreateReview_RejectsInvalidBuyerContextCombinations()
    {
        var handler = BuildCreateHandler(new StubReviewJobRepository());

        var bothPrices = BuildRequest(new ReviewBuyerContextDto(
            IsFirstHomeBuyer: null,
            ConcessionIntent: "unsure",
            ContractExchanged: true,
            AgreedPriceAud: 900000m,
            EstimatedPriceAud: 880000m));
        await Assert.ThrowsAsync<InvalidOperationException>(() => handler.HandleAsync(Principal, bothPrices, CancellationToken.None));

        var missingAgreed = BuildRequest(new ReviewBuyerContextDto(
            IsFirstHomeBuyer: null,
            ConcessionIntent: "unsure",
            ContractExchanged: true,
            AgreedPriceAud: null,
            EstimatedPriceAud: null));
        await Assert.ThrowsAsync<InvalidOperationException>(() => handler.HandleAsync(Principal, missingAgreed, CancellationToken.None));

        var negativeEstimate = BuildRequest(new ReviewBuyerContextDto(
            IsFirstHomeBuyer: null,
            ConcessionIntent: "unsure",
            ContractExchanged: false,
            AgreedPriceAud: null,
            EstimatedPriceAud: -1m));
        await Assert.ThrowsAsync<InvalidOperationException>(() => handler.HandleAsync(Principal, negativeEstimate, CancellationToken.None));

        var exchangedFalseWithAgreed = BuildRequest(new ReviewBuyerContextDto(
            IsFirstHomeBuyer: null,
            ConcessionIntent: "unsure",
            ContractExchanged: false,
            AgreedPriceAud: 700000m,
            EstimatedPriceAud: null));
        await Assert.ThrowsAsync<InvalidOperationException>(() => handler.HandleAsync(Principal, exchangedFalseWithAgreed, CancellationToken.None));
    }

    [Fact]
    public async Task CreateReview_RejectsTooManyFiles()
    {
        var handler = BuildCreateHandler(new StubReviewJobRepository());
        var request = BuildRequest(
            buyerContext: null,
            files: Enumerable.Range(1, 6)
                .Select(index => new CreateReviewFileRequest($"contract-{index}.pdf", "application/pdf", 1024))
                .ToArray());

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() => handler.HandleAsync(Principal, request, CancellationToken.None));

        Assert.Contains("up to 5 PDF files", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task CreateReview_RejectsOversizedFiles()
    {
        var handler = BuildCreateHandler(new StubReviewJobRepository());
        var request = BuildRequest(
            buyerContext: null,
            files:
            [
                new CreateReviewFileRequest("contract.pdf", "application/pdf", ReviewUploadLimits.MaxDocumentSizeBytes + 1)
            ]);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() => handler.HandleAsync(Principal, request, CancellationToken.None));

        Assert.Contains("30 MB", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task GetReview_ReturnsBuyerContextWhenPersisted()
    {
        var repository = new StubReviewJobRepository
        {
            JobToReturn = new ReviewJobRecord(
                Id: Guid.NewGuid(),
                UserId: StubCurrentUserAccessor.UserId,
                PropertyAddress: "10 Example Street, Canberra ACT",
                BuyerType: "owner-occupier",
                BuyerContextJson: "{\"IsFirstHomeBuyer\":true,\"ConcessionIntent\":\"yes\",\"ContractExchanged\":false,\"AgreedPriceAud\":null,\"EstimatedPriceAud\":810000}",
                StateOrTerritory: "ACT",
                LocalGovernmentArea: null,
                PropertyTenureType: "Unknown",
                PackType: "standard",
                Status: "AwaitingPayment",
                PaymentStatus: "Unpaid",
                StripePaymentIntentId: null,
                AmountAudCents: 1999,
                CreatedAt: DateTimeOffset.UtcNow.AddMinutes(-5),
                UpdatedAt: DateTimeOffset.UtcNow,
                StartedAt: null,
                CompletedAt: null,
                ErrorMessage: null,
                ReportS3Key: null,
                DisclaimerVersion: null,
                DisclaimerAcceptedAtUtc: null,
                ProgressJson: "{\"percent\":15,\"currentStep\":\"AwaitingPayment\",\"currentSubStep\":\"Awaiting payment\",\"lastUpdatedUtc\":\"2026-03-01T00:00:00Z\"}",
                SummaryJson: null,
                ArchivedAtUtc: null)
        };
        var queryHandler = new GetReviewQueryHandler(new StubCurrentUserAccessor(), repository);

        var result = await queryHandler.HandleAsync(Principal, repository.JobToReturn.Id, CancellationToken.None);

        Assert.NotNull(result);
        Assert.NotNull(result!.BuyerContext);
        Assert.True(result.BuyerContext!.IsFirstHomeBuyer);
        Assert.Equal("yes", result.BuyerContext.ConcessionIntent);
        Assert.False(result.BuyerContext.ContractExchanged);
        Assert.Equal(810000m, result.BuyerContext.EstimatedPriceAud);
    }

    [Fact]
    public async Task FinalizeUploads_RejectsOversizedStoredFiles()
    {
        var repository = new StubReviewJobRepository
        {
            JobToReturn = BuildJobRecord()
        };
        var storage = new StubReviewStorageService();
        storage.SetMetadata("raw/test/job/doc-1-contract.pdf", new ReviewStorageObjectMetadata(ReviewUploadLimits.MaxDocumentSizeBytes + 1, "application/pdf"));
        var handler = new FinalizeReviewUploadsCommandHandler(new StubCurrentUserAccessor(), repository, storage, new StubAuditTrail());

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() => handler.HandleAsync(
            Principal,
            repository.JobToReturn.Id,
            new FinalizeReviewUploadsRequest(
            [
                new FinalizeReviewDocumentRequest(Guid.NewGuid(), "contract.pdf", "application/pdf", "raw/test/job/doc-1-contract.pdf")
            ]),
            CancellationToken.None));

        Assert.Contains("30 MB", exception.Message, StringComparison.Ordinal);
        Assert.Equal(["raw/test/job/doc-1-contract.pdf"], storage.DeletedKeys);
    }

    private static CreateReviewCommandHandler BuildCreateHandler(IReviewJobRepository repository)
    {
        return new CreateReviewCommandHandler(
            new StubCurrentUserAccessor(),
            repository,
            new StubReviewStorageService(),
            new EnabledStatesProviderStub(),
            new StubAuditTrail());
    }

    private static CreateReviewRequest BuildRequest(
        ReviewBuyerContextDto? buyerContext,
        IReadOnlyList<CreateReviewFileRequest>? files = null)
    {
        return new CreateReviewRequest(
            PropertyAddress: "10 Example Street, Canberra ACT",
            BuyerType: "owner-occupier",
            BuyerContext: buyerContext,
            StateOrTerritory: "ACT",
            LocalGovernmentArea: null,
            PropertyTenureType: "Unknown",
            PackType: "standard",
            Files: files ??
                   [
                       new CreateReviewFileRequest("contract.pdf", "application/pdf", 1024)
                   ]);
    }

    private static ReviewJobRecord BuildJobRecord()
    {
        return new ReviewJobRecord(
            Id: Guid.NewGuid(),
            UserId: StubCurrentUserAccessor.UserId,
            PropertyAddress: "10 Example Street, Canberra ACT",
            BuyerType: "owner-occupier",
            BuyerContextJson: null,
            StateOrTerritory: "ACT",
            LocalGovernmentArea: null,
            PropertyTenureType: "Unknown",
            PackType: "standard",
            Status: "AwaitingUpload",
            PaymentStatus: "Unpaid",
            StripePaymentIntentId: null,
            AmountAudCents: 1999,
            CreatedAt: DateTimeOffset.UtcNow.AddMinutes(-5),
            UpdatedAt: DateTimeOffset.UtcNow,
            StartedAt: null,
            CompletedAt: null,
            ErrorMessage: null,
            ReportS3Key: null,
            DisclaimerVersion: null,
            DisclaimerAcceptedAtUtc: null,
            ProgressJson: "{\"percent\":0,\"currentStep\":\"AwaitingUpload\",\"currentSubStep\":\"Awaiting upload\",\"lastUpdatedUtc\":\"2026-03-01T00:00:00Z\"}",
            SummaryJson: null,
            ArchivedAtUtc: null);
    }

    private sealed class StubCurrentUserAccessor : ICurrentUserAccessor
    {
        internal static readonly Guid UserId = Guid.Parse("11111111-1111-1111-1111-111111111111");

        public Task<UserInfoDto> GetCurrentUserAsync(ClaimsPrincipal principal, CancellationToken cancellationToken)
        {
            return Task.FromResult(new UserInfoDto(
                Id: UserId,
                FullName: "Test User",
                Email: "test@example.com",
                CreatedAt: DateTimeOffset.UtcNow.AddDays(-1),
                LastLoginAtUtc: DateTimeOffset.UtcNow,
                IsAdmin: false));
        }
    }

    private sealed class StubReviewStorageService : IReviewStorageService
    {
        private readonly Dictionary<string, ReviewStorageObjectMetadata> metadataByKey = new(StringComparer.Ordinal);

        public List<string> DeletedKeys { get; } = [];

        public (string Url, DateTimeOffset ExpiresAtUtc) CreateUploadUrl(string s3Key, string contentType)
            => ($"https://upload.example/{s3Key}", DateTimeOffset.UtcNow.AddMinutes(15));

        public (string Url, DateTimeOffset ExpiresAtUtc) CreateDownloadUrl(string s3Key)
            => ($"https://download.example/{s3Key}", DateTimeOffset.UtcNow.AddMinutes(15));

        public Task<ReviewStorageDownloadObject?> OpenReadAsync(string s3Key, CancellationToken cancellationToken)
        {
            return Task.FromResult<ReviewStorageDownloadObject?>(null);
        }

        public Task<ReviewStorageObjectMetadata?> GetObjectMetadataAsync(string s3Key, CancellationToken cancellationToken)
        {
            metadataByKey.TryGetValue(s3Key, out var metadata);
            return Task.FromResult(metadata);
        }

        public Task DeleteObjectsAsync(IReadOnlyCollection<string> s3Keys, CancellationToken cancellationToken)
        {
            DeletedKeys.AddRange(s3Keys);
            return Task.CompletedTask;
        }

        public void SetMetadata(string s3Key, ReviewStorageObjectMetadata metadata)
        {
            metadataByKey[s3Key] = metadata;
        }
    }

    private sealed class EnabledStatesProviderStub : IEnabledStatesProvider
    {
        public EnabledStatesConfigurationResponse GetSnapshot()
            => new("ACT", ["ACT", "NSW", "VIC", "QLD", "WA", "SA", "TAS", "NT"], ["ACT", "NSW", "VIC", "QLD", "WA", "SA", "TAS", "NT"]);

        public bool IsStateEnabled(string stateOrTerritory) => true;
    }

    private sealed class StubReviewJobRepository : IReviewJobRepository
    {
        public string? LastCreatedBuyerContextJson { get; private set; }

        public ReviewJobRecord? JobToReturn { get; set; }

        public Task<ReviewJobRecord> CreateJobAsync(
            Guid jobId,
            Guid userId,
            string propertyAddress,
            string buyerType,
            string? buyerContextJson,
            string stateOrTerritory,
            string? localGovernmentArea,
            string propertyTenureType,
            string packType,
            string status,
            string paymentStatus,
            string progressJson,
            CancellationToken cancellationToken)
        {
            LastCreatedBuyerContextJson = buyerContextJson;
            var record = new ReviewJobRecord(
                Id: jobId,
                UserId: userId,
                PropertyAddress: propertyAddress,
                BuyerType: buyerType,
                BuyerContextJson: buyerContextJson,
                StateOrTerritory: stateOrTerritory,
                LocalGovernmentArea: localGovernmentArea,
                PropertyTenureType: propertyTenureType,
                PackType: packType,
                Status: status,
                PaymentStatus: paymentStatus,
                StripePaymentIntentId: null,
                AmountAudCents: 0,
                CreatedAt: DateTimeOffset.UtcNow,
                UpdatedAt: DateTimeOffset.UtcNow,
                StartedAt: null,
                CompletedAt: null,
                ErrorMessage: null,
                ReportS3Key: null,
                DisclaimerVersion: null,
                DisclaimerAcceptedAtUtc: null,
                ProgressJson: progressJson,
                SummaryJson: null,
                ArchivedAtUtc: null);
            JobToReturn = record;
            return Task.FromResult(record);
        }

        public Task<ReviewJobRecord?> GetJobForUserAsync(Guid jobId, Guid userId, CancellationToken cancellationToken)
        {
            if (JobToReturn is null)
            {
                return Task.FromResult<ReviewJobRecord?>(null);
            }

            return Task.FromResult(JobToReturn.Id == jobId && JobToReturn.UserId == userId
                ? JobToReturn
                : null);
        }

        public Task<IReadOnlyList<ReviewJobRecord>> ListJobsForUserAsync(Guid userId, bool includeArchived, CancellationToken cancellationToken)
            => Task.FromResult<IReadOnlyList<ReviewJobRecord>>(Array.Empty<ReviewJobRecord>());

        public Task<ReviewJobArchiveRecord?> SetArchivedAsync(Guid jobId, Guid userId, bool archived, CancellationToken cancellationToken)
            => Task.FromResult<ReviewJobArchiveRecord?>(null);

        public Task<ReviewJobDeleteCandidateRecord?> GetDeleteCandidateForUserAsync(Guid jobId, Guid userId, CancellationToken cancellationToken)
            => Task.FromResult<ReviewJobDeleteCandidateRecord?>(null);

        public Task<bool> DeleteJobForUserAsync(Guid jobId, Guid userId, CancellationToken cancellationToken)
            => Task.FromResult(false);

        public Task<int> CountDocumentsAsync(Guid jobId, Guid userId, CancellationToken cancellationToken)
            => Task.FromResult(1);

        public Task SaveUploadedDocumentsAsync(Guid jobId, Guid userId, IReadOnlyList<ReviewDocumentRecord> documents, CancellationToken cancellationToken)
            => Task.CompletedTask;

        public Task<bool> TransitionToAwaitingPaymentAsync(Guid jobId, Guid userId, CancellationToken cancellationToken)
            => Task.FromResult(true);

        public Task<ReviewJobRecord?> SetPaymentIntentAsync(
            Guid jobId,
            Guid userId,
            string paymentIntentId,
            int amountAudCents,
            CancellationToken cancellationToken)
            => Task.FromResult(JobToReturn);

        public Task<ReviewJobPaymentTransition?> MarkPaidAndQueuedAsync(string paymentIntentId, CancellationToken cancellationToken)
            => Task.FromResult<ReviewJobPaymentTransition?>(null);

        public Task<ReviewDisclaimerAcceptanceRecord?> RecordDisclaimerAcceptanceAsync(
            Guid jobId,
            Guid userId,
            string disclaimerVersion,
            CancellationToken cancellationToken)
            => Task.FromResult<ReviewDisclaimerAcceptanceRecord?>(null);

        public Task<IReadOnlyList<ReviewProgressEventRecord>> ListProgressEventsForUserAsync(
            Guid jobId,
            Guid userId,
            DateTimeOffset? sinceUtc,
            int limit,
            CancellationToken cancellationToken)
            => Task.FromResult<IReadOnlyList<ReviewProgressEventRecord>>(Array.Empty<ReviewProgressEventRecord>());

        public Task<bool> RegisterWebhookEventAsync(string eventId, string paymentIntentId, string eventType, CancellationToken cancellationToken)
            => Task.FromResult(true);
    }

    private sealed class StubStripePaymentService : IStripePaymentService
    {
        public Task<StripePaymentIntentResult> CreateOrGetPaymentIntentAsync(
            string? existingPaymentIntentId,
            Guid jobId,
            Guid userId,
            string userEmail,
            string userFullName,
            CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public Task<StripePaymentIntentStatusResult> GetPaymentIntentStatusAsync(string paymentIntentId, CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public Task CancelPaymentIntentIfPendingAsync(string paymentIntentId, CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }
    }

    private sealed class StubAuditTrail : IAuditTrail
    {
        public Task WriteAsync(AuditEventWriteRequest request, CancellationToken cancellationToken)
            => Task.CompletedTask;
    }
}
