using ConveyMate.Api.Application.Conveyancers.Abstractions;
using ConveyMate.Api.Application.QuoteRequests;
using ConveyMate.Api.Application.QuoteRequests.Abstractions;
using ConveyMate.Api.Domain.QuoteRequests;

namespace ConveyMate.Api.Tests;

public sealed class QuoteRequestEmailComposerTests
{
    [Fact]
    public void BuildQuoteRequestEmail_UsesPublishedPngLogo_WiderShell_AndSinglePrimaryCta()
    {
        var expiresAtUtc = DateTimeOffset.Parse("2026-03-13T04:30:00Z");
        var request = CreateQuoteRequestRecord(
            message: "Need a fee estimate\nASAP please.",
            expiresAtUtc: expiresAtUtc,
            shareReportPdf: true);
        var brief = new QuoteRequestBriefPayload(
            "The buyer wants a fixed-fee quote and a fast turnaround before exchange.",
            ["Fixed-fee pricing clarity", "Turnaround timing before exchange"],
            ["Can you confirm your fixed fee and disbursements?", "Can you act before Friday?"]);

        var message = QuoteRequestEmailComposer.BuildQuoteRequestEmail(
            CreateConveyancerRecord(),
            "Daimen Rees",
            request,
            brief,
            "https://app.conveymate.com.au/quote/respond/test-token",
            "https://app.conveymate.com.au/quote/unsubscribe/test-token",
            "https://app.conveymate.com.au/",
            expiresAtUtc);

        Assert.NotNull(message.HtmlBody);
        Assert.Contains("https://app.conveymate.com.au/assets/logo-email.png", message.HtmlBody!, StringComparison.Ordinal);
        Assert.DoesNotContain("/assets/logo.svg", message.HtmlBody!, StringComparison.Ordinal);
        Assert.Contains("max-width:720px", message.HtmlBody!, StringComparison.Ordinal);
        Assert.Contains(">Review request and submit quote<", message.HtmlBody!, StringComparison.Ordinal);
        Assert.Contains(">Unsubscribe from future quote requests<", message.HtmlBody!, StringComparison.Ordinal);
        Assert.Contains("https://app.conveymate.com.au/quote/unsubscribe/test-token", message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain(">Submit quote<", message.HtmlBody!, StringComparison.Ordinal);
        Assert.DoesNotContain("Review brief & documents", message.HtmlBody!, StringComparison.Ordinal);
        Assert.Contains("Need a fee estimate<br>ASAP please.", message.HtmlBody!, StringComparison.Ordinal);
    }

    [Fact]
    public void BuildDocumentAccessOtpEmail_UsesPublishedPngLogo()
    {
        var expiresAtUtc = DateTimeOffset.Parse("2026-03-13T04:30:00Z");
        var target = CreateTargetDetailRecord();

        var message = QuoteRequestEmailComposer.BuildDocumentAccessOtpEmail(
            target,
            "23A Ogilby Crescent, Garran ACT 2605",
            "654321",
            expiresAtUtc,
            "https://app.conveymate.com.au");

        Assert.NotNull(message.HtmlBody);
        Assert.Contains("https://app.conveymate.com.au/assets/logo-email.png", message.HtmlBody!, StringComparison.Ordinal);
        Assert.DoesNotContain("/assets/logo.svg", message.HtmlBody!, StringComparison.Ordinal);
        Assert.Contains("max-width:640px", message.HtmlBody!, StringComparison.Ordinal);
        Assert.Contains(">654321<", message.HtmlBody!, StringComparison.Ordinal);
    }

    [Fact]
    public void BuildBuyerQuoteReceivedEmail_IncludesWorkflowLink_AndQuoteSnapshot()
    {
        var message = QuoteRequestEmailComposer.BuildBuyerQuoteReceivedEmail(
            "buyer@example.com",
            "Daimen Rees",
            CreateQuoteRequestDetailRecord(
                message: null,
                expiresAtUtc: DateTimeOffset.Parse("2026-03-13T04:30:00Z"),
                shareReportPdf: true),
            CreateTargetDetailRecord(withResponse: true),
            "https://app.conveymate.com.au/quotes/11111111-1111-1111-1111-111111111111",
            "https://app.conveymate.com.au");

        Assert.Equal("buyer@example.com", message.ToEmail);
        Assert.Equal("Quote received from Northside Conveyancing", message.Subject);
        Assert.NotNull(message.HtmlBody);
        Assert.Contains("https://app.conveymate.com.au/assets/logo-email.png", message.HtmlBody!, StringComparison.Ordinal);
        Assert.Contains(">Open quote workflow<", message.HtmlBody!, StringComparison.Ordinal);
        Assert.Contains("https://app.conveymate.com.au/quotes/11111111-1111-1111-1111-111111111111", message.TextBody, StringComparison.Ordinal);
        Assert.Contains("Professional fee: $1,950.00 incl. GST", message.TextBody, StringComparison.Ordinal);
        Assert.Contains("Estimated turnaround: 5 business days", message.TextBody, StringComparison.Ordinal);
        Assert.Contains("Northside Conveyancing", message.HtmlBody!, StringComparison.Ordinal);
    }

    private static ConveyancerDirectoryRecord CreateConveyancerRecord()
    {
        return new ConveyancerDirectoryRecord(
            Guid.Parse("44444444-4444-4444-4444-444444444444"),
            "ACT",
            "law_society",
            "Northside Conveyancing",
            "Jordan Smith",
            "Northside Conveyancing",
            "1 Example Street",
            "(02) 5555 5555",
            "quotes@northside.example.com",
            "https://northside.example.com",
            ["Conveyancing"],
            "https://directory.example.com/northside",
            "northside-1",
            true,
            true,
            null,
            DateTimeOffset.Parse("2026-03-10T00:00:00Z"));
    }

    private static QuoteRequestCreateRecord CreateQuoteRequestRecord(
        string? message,
        DateTimeOffset expiresAtUtc,
        bool shareReportPdf)
    {
        return new QuoteRequestCreateRecord(
            Guid.NewGuid(),
            Guid.NewGuid(),
            Guid.NewGuid(),
            "23A Ogilby Crescent, Garran ACT 2605",
            "ACT",
            "full-conveyancing",
            message,
            shareReportPdf,
            "{}",
            QuoteRequestStatus.Open,
            DateTimeOffset.Parse("2026-03-10T00:00:00Z"),
            expiresAtUtc);
    }

    private static QuoteRequestRecord CreateQuoteRequestDetailRecord(
        string? message,
        DateTimeOffset expiresAtUtc,
        bool shareReportPdf)
    {
        var now = DateTimeOffset.Parse("2026-03-10T00:00:00Z");

        return new QuoteRequestRecord(
            Guid.NewGuid(),
            Guid.NewGuid(),
            Guid.NewGuid(),
            "23A Ogilby Crescent, Garran ACT 2605",
            "ACT",
            "full-conveyancing",
            message,
            shareReportPdf,
            "{}",
            QuoteRequestStatus.Open,
            now,
            now,
            now,
            expiresAtUtc,
            null);
    }

    private static QuoteRequestTargetDetailRecord CreateTargetDetailRecord(bool withResponse = false)
    {
        var now = DateTimeOffset.Parse("2026-03-10T00:00:00Z");

        return new QuoteRequestTargetDetailRecord(
            Guid.NewGuid(),
            Guid.NewGuid(),
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
            QuoteRequestTargetStatus.Prepared,
            now,
            now,
            now,
            null,
            null,
            null,
            withResponse
                ? new QuoteRequestResponseRecord(
                    Guid.NewGuid(),
                    Guid.NewGuid(),
                    "Jordan Smith",
                    "jordan@northside.example.com",
                    "(02) 5555 1111",
                    1950m,
                    true,
                    420m,
                    5,
                    "Fixed-fee quote covering contract review and settlement coordination.",
                    ["PEXA workspace fee"],
                    DateTimeOffset.Parse("2026-03-20T00:00:00Z"),
                    now,
                    now)
                : null,
            QuoteRequestTargetDocumentAccessRecord.Empty(2));
    }
}
