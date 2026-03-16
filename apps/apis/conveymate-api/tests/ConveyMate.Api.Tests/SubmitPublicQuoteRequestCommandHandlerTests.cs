using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using ConveyMate.Api.Application.Audit;
using ConveyMate.Api.Application.Audit.Abstractions;
using ConveyMate.Api.Application.QuoteRequests;
using ConveyMate.Api.Application.QuoteRequests.Abstractions;
using ConveyMate.Api.Application.QuoteRequests.Contracts;
using ConveyMate.Api.Application.Users.Abstractions;
using ConveyMate.Api.Configuration;
using ConveyMate.Api.Domain.QuoteRequests;
using ConveyMate.Api.Domain.Users;

namespace ConveyMate.Api.Tests;

public sealed class SubmitPublicQuoteRequestCommandHandlerTests
{
    [Fact]
    public async Task Sends_Buyer_Notification_After_Response_Is_Submitted()
    {
        var buyerId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var requestId = Guid.Parse("22222222-2222-2222-2222-222222222222");
        var repository = new StubQuoteRequestRepository(CreatePublicTargetRecord(requestId, buyerId));
        var userRepository = new StubUserRepository(new AppUser(
            buyerId,
            "buyer-sub",
            "buyer@example.com",
            "Daimen Rees",
            false,
            false,
            DateTimeOffset.Parse("2026-03-10T00:00:00Z"),
            DateTimeOffset.Parse("2026-03-10T00:00:00Z"),
            DateTimeOffset.Parse("2026-03-10T00:00:00Z")));
        var emailSender = new CapturingEmailSender();
        var handler = new SubmitPublicQuoteRequestCommandHandler(
            repository,
            userRepository,
            emailSender,
            Options.Create(new ReviewPipelineOptions
            {
                AppBaseUrl = "https://app.conveymate.com.au"
            }),
            NullLogger<SubmitPublicQuoteRequestCommandHandler>.Instance,
            new StubAuditTrail());

        var result = await handler.Handle(
            new SubmitPublicQuoteRequestCommand(
                "public-response-token",
                new SubmitPublicQuoteRequestResponse(
                    "Jordan Smith",
                    "jordan@northside.example.com",
                    "(02) 5555 1111",
                    1950m,
                    true,
                    420m,
                    5,
                    "Fixed-fee quote covering contract review and settlement coordination.",
                    ["PEXA workspace fee"],
                    DateTimeOffset.Parse("2026-03-20T00:00:00Z"))),
            CancellationToken.None);

        Assert.False(result.IsError);
        Assert.Equal(1, repository.SubmitResponseCalls);
        var email = Assert.Single(emailSender.Messages);
        Assert.Equal("buyer@example.com", email.ToEmail);
        Assert.Equal("Quote received from Northside Conveyancing", email.Subject);
        Assert.Contains($"https://app.conveymate.com.au/quotes/{requestId}", email.TextBody, StringComparison.Ordinal);
        Assert.Contains("Professional fee: $1,950.00 incl. GST", email.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Returns_Success_When_Buyer_Notification_Email_Fails()
    {
        var buyerId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
        var repository = new StubQuoteRequestRepository(CreatePublicTargetRecord(
            Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
            buyerId));
        var userRepository = new StubUserRepository(new AppUser(
            buyerId,
            "buyer-sub",
            "buyer@example.com",
            "Daimen Rees",
            false,
            false,
            DateTimeOffset.Parse("2026-03-10T00:00:00Z"),
            DateTimeOffset.Parse("2026-03-10T00:00:00Z"),
            DateTimeOffset.Parse("2026-03-10T00:00:00Z")));
        var emailSender = new CapturingEmailSender
        {
            NextResult = new QuoteRequestEmailSendResult(false, null, "SES failure")
        };
        var handler = new SubmitPublicQuoteRequestCommandHandler(
            repository,
            userRepository,
            emailSender,
            Options.Create(new ReviewPipelineOptions
            {
                AppBaseUrl = "https://app.conveymate.com.au"
            }),
            NullLogger<SubmitPublicQuoteRequestCommandHandler>.Instance,
            new StubAuditTrail());

        var result = await handler.Handle(
            new SubmitPublicQuoteRequestCommand(
                "public-response-token",
                new SubmitPublicQuoteRequestResponse(
                    "Jordan Smith",
                    "jordan@northside.example.com",
                    null,
                    1950m,
                    true,
                    null,
                    null,
                    "Fixed-fee quote covering contract review and settlement coordination.",
                    [],
                    null)),
            CancellationToken.None);

        Assert.False(result.IsError);
        Assert.Single(emailSender.Messages);
    }

    private static QuoteRequestPublicTargetRecord CreatePublicTargetRecord(Guid requestId, Guid buyerId)
    {
        var now = DateTimeOffset.Parse("2026-03-10T00:00:00Z");

        return new QuoteRequestPublicTargetRecord(
            new QuoteRequestRecord(
                requestId,
                buyerId,
                Guid.Parse("33333333-3333-3333-3333-333333333333"),
                "23A Ogilby Crescent, Garran ACT 2605",
                "ACT",
                "full-conveyancing",
                "Need a fast settlement timeline.",
                true,
                "{}",
                QuoteRequestStatus.Open,
                now,
                now,
                now,
                DateTimeOffset.Parse("2026-03-13T04:30:00Z"),
                null),
            new QuoteRequestTargetDetailRecord(
                Guid.Parse("44444444-4444-4444-4444-444444444444"),
                requestId,
                "ACT",
                "law_society",
                "northside-1",
                "Northside Conveyancing",
                "Jordan Smith",
                "Northside Conveyancing",
                "quotes@northside.example.com",
                "(02) 5555 5555",
                "https://northside.example.com",
                "https://directory.example.com/northside",
                QuoteRequestTargetStatus.Sent,
                now,
                now,
                now,
                now,
                null,
                null,
                null,
                QuoteRequestTargetDocumentAccessRecord.Empty(2)),
            null,
            []);
    }

    private sealed class StubQuoteRequestRepository(QuoteRequestPublicTargetRecord currentRecord) : IQuoteRequestRepository
    {
        public int SubmitResponseCalls { get; private set; }

        public Task CreateAsync(
            QuoteRequestCreateRecord request,
            IReadOnlyList<QuoteRequestTargetCreateRecord> targets,
            CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public Task<IReadOnlyList<QuoteRequestSummaryRecord>> ListForUserAsync(Guid userId, bool includeArchived, CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public Task<QuoteRequestSummaryRecord?> GetSummaryForUserByReviewJobAsync(
            Guid userId,
            Guid reviewJobId,
            CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public Task<QuoteRequestDetailRecord?> GetForUserAsync(Guid requestId, Guid userId, CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public Task<QuoteRequestArchiveRecord?> SetArchivedAsync(Guid requestId, Guid userId, bool archived, CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public Task<bool> DeleteForUserAsync(Guid requestId, Guid userId, CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public Task ApplyDeliveryUpdatesAsync(
            Guid quoteRequestId,
            IReadOnlyList<QuoteRequestTargetDeliveryUpdate> updates,
            CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public Task<QuoteRequestPublicTargetRecord?> GetPublicTargetByTokenHashAsync(string tokenHash, CancellationToken cancellationToken)
        {
            return Task.FromResult<QuoteRequestPublicTargetRecord?>(currentRecord);
        }

        public Task MarkTargetOpenedAsync(Guid targetId, CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public Task UpdateDocumentAccessOtpAsync(
            Guid targetId,
            string otpHash,
            DateTimeOffset requestedAtUtc,
            DateTimeOffset expiresAtUtc,
            CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public Task MarkDocumentAccessVerifiedAsync(Guid targetId, DateTimeOffset verifiedAtUtc, CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public Task CreateDocumentAccessSessionAsync(
            QuoteRequestDocumentAccessSessionCreateRecord session,
            CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public Task<QuoteRequestDocumentAccessSessionRecord?> GetActiveDocumentAccessSessionAsync(
            Guid targetId,
            string accessTokenHash,
            CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public Task RecordDocumentDownloadAsync(
            QuoteRequestDocumentDownloadUpsertRecord record,
            CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public Task<QuoteRequestPublicTargetRecord?> SubmitResponseAsync(
            Guid targetId,
            QuoteRequestResponseCreateRecord response,
            CancellationToken cancellationToken)
        {
            SubmitResponseCalls += 1;

            var responseRecord = new QuoteRequestResponseRecord(
                response.Id,
                response.TargetId,
                response.ResponderName,
                response.ResponderEmail,
                response.ResponderPhone,
                response.ProfessionalFeeAud,
                response.IncludesGst,
                response.DisbursementsEstimateAud,
                response.TurnaroundBusinessDays,
                response.ScopeNotes,
                response.ExcludedItems,
                response.ValidUntilUtc,
                response.CreatedAtUtc,
                response.CreatedAtUtc);

            currentRecord = currentRecord with
            {
                Target = currentRecord.Target with
                {
                    Status = QuoteRequestTargetStatus.Responded,
                    UpdatedAtUtc = response.CreatedAtUtc,
                    RespondedAtUtc = response.CreatedAtUtc,
                    Response = responseRecord
                }
            };

            return Task.FromResult<QuoteRequestPublicTargetRecord?>(currentRecord);
        }
    }

    private sealed class StubUserRepository(AppUser user) : IUserRepository
    {
        public Task<AppUser?> GetByIdAsync(Guid userId, CancellationToken cancellationToken)
        {
            return Task.FromResult<AppUser?>(user.Id == userId ? user : null);
        }

        public Task<AppUser?> GetByCognitoSubAsync(string cognitoSub, CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public Task<AppUser?> TouchLastLoginAsync(Guid userId, CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public Task<AppUser> UpsertFromClaimsAsync(string cognitoSub, string email, string fullName, CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }
    }

    private sealed class CapturingEmailSender : IQuoteRequestEmailSender
    {
        public List<QuoteRequestEmailMessage> Messages { get; } = [];

        public QuoteRequestEmailSendResult NextResult { get; set; } = new(true, "provider-message-id", null);

        public Task<QuoteRequestEmailSendResult> SendAsync(QuoteRequestEmailMessage message, CancellationToken cancellationToken)
        {
            Messages.Add(message);
            return Task.FromResult(NextResult);
        }
    }

    private sealed class StubAuditTrail : IAuditTrail
    {
        public Task WriteAsync(AuditEventWriteRequest request, CancellationToken cancellationToken)
            => Task.CompletedTask;
    }
}
