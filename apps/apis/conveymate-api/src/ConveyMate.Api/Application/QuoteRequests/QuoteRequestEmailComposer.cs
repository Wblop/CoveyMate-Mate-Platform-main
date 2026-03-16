using System.Globalization;
using System.Net;
using ConveyMate.Api.Application.Conveyancers.Abstractions;
using ConveyMate.Api.Application.QuoteRequests.Abstractions;

namespace ConveyMate.Api.Application.QuoteRequests;

internal static class QuoteRequestEmailComposer
{
    private const string EmailLogoPath = "/assets/logo-email.png";

    public static QuoteRequestEmailMessage BuildQuoteRequestEmail(
        ConveyancerDirectoryRecord record,
        string buyerName,
        QuoteRequestCreateRecord request,
        QuoteRequestBriefPayload brief,
        string responseUrl,
        string unsubscribeUrl,
        string appBaseUrl,
        DateTimeOffset expiresAtUtc)
    {
        var logoUrl = ResolveLogoUrl(appBaseUrl);
        var buyerDisplayName = ResolveBuyerDisplayName(buyerName);

        return new QuoteRequestEmailMessage(
            record.Email!,
            record.OrganizationName ?? record.Name,
            $"Request for quote: {request.PropertyAddress}",
            BuildQuoteRequestTextBody(record, buyerDisplayName, request, brief, responseUrl, unsubscribeUrl, expiresAtUtc),
            BuildQuoteRequestHtmlBody(record, buyerDisplayName, request, brief, responseUrl, unsubscribeUrl, logoUrl, expiresAtUtc));
    }

    public static QuoteRequestEmailMessage BuildDocumentAccessOtpEmail(
        QuoteRequestTargetDetailRecord target,
        string propertyAddress,
        string otpCode,
        DateTimeOffset expiresAtUtc,
        string? appBaseUrl)
    {
        var logoUrl = ResolveLogoUrl(appBaseUrl);

        return new QuoteRequestEmailMessage(
            target.Email,
            target.OrganizationName ?? target.Name,
            $"ConveyMate document access code for {propertyAddress}",
            BuildDocumentAccessOtpTextBody(propertyAddress, otpCode, expiresAtUtc),
            BuildDocumentAccessOtpHtmlBody(propertyAddress, otpCode, expiresAtUtc, logoUrl));
    }

    public static QuoteRequestEmailMessage BuildBuyerQuoteReceivedEmail(
        string buyerEmail,
        string buyerName,
        QuoteRequestRecord request,
        QuoteRequestTargetDetailRecord target,
        string workflowUrl,
        string? appBaseUrl)
    {
        var response = target.Response
            ?? throw new InvalidOperationException("Quote response is required to compose a buyer notification email.");
        var logoUrl = ResolveLogoUrl(appBaseUrl);
        var buyerGreeting = ResolvePersonGreeting(buyerName);
        var conveyancerDisplayName = ResolveConveyancerDisplayName(target);

        return new QuoteRequestEmailMessage(
            buyerEmail,
            ResolveBuyerDisplayName(buyerName),
            $"Quote received from {conveyancerDisplayName}",
            BuildBuyerQuoteReceivedTextBody(
                buyerGreeting,
                conveyancerDisplayName,
                request,
                response,
                workflowUrl),
            BuildBuyerQuoteReceivedHtmlBody(
                buyerGreeting,
                conveyancerDisplayName,
                request,
                response,
                workflowUrl,
                logoUrl));
    }

    private static string BuildQuoteRequestTextBody(
        ConveyancerDirectoryRecord record,
        string buyerDisplayName,
        QuoteRequestCreateRecord request,
        QuoteRequestBriefPayload brief,
        string responseUrl,
        string unsubscribeUrl,
        DateTimeOffset expiresAtUtc)
    {
        var lines = new List<string>
        {
            $"Hi {ResolveRecipientGreeting(record)},",
            string.Empty,
            $"We are issuing a request for quote on behalf of {buyerDisplayName}.",
            $"Property: {request.PropertyAddress}",
            $"Requested service: {QuoteRequestMapper.FormatServiceNeed(request.ServiceNeed)}",
            $"Jurisdiction: {request.StateOrTerritory}",
            $"Respond by: {FormatUtcDeadline(expiresAtUtc)}",
            string.Empty,
            "Summary",
            brief.Summary
        };

        if (brief.ConveyancerQuestions.Count > 0)
        {
            lines.Add(string.Empty);
            lines.Add("Questions to address");
            lines.AddRange(brief.ConveyancerQuestions.Select(item => $"- {item}"));
        }

        if (!string.IsNullOrWhiteSpace(request.Message))
        {
            lines.Add(string.Empty);
            lines.Add("Additional notes");
            lines.Add(request.Message.Trim());
        }

        lines.Add(string.Empty);
        lines.Add(request.ShareReportPdf
            ? "Review the request, access buyer-approved documents inside the secure portal, and submit your quote. Documents are not attached directly to this email."
            : "Review the request in the secure portal and submit your quote.");
        lines.Add(responseUrl);
        lines.Add(string.Empty);
        lines.Add("If you do not want to receive future ConveyMate quote requests, unsubscribe here:");
        lines.Add(unsubscribeUrl);

        return string.Join(Environment.NewLine, lines);
    }

    private static string BuildQuoteRequestHtmlBody(
        ConveyancerDirectoryRecord record,
        string buyerDisplayName,
        QuoteRequestCreateRecord request,
        QuoteRequestBriefPayload brief,
        string responseUrl,
        string unsubscribeUrl,
        string? logoUrl,
        DateTimeOffset expiresAtUtc)
    {
        static string Encode(string? value) => WebUtility.HtmlEncode(value ?? string.Empty);

        var greeting = ResolveRecipientGreeting(record);
        var serviceLabel = QuoteRequestMapper.FormatServiceNeed(request.ServiceNeed);
        var responseDeadline = FormatUtcDeadline(expiresAtUtc);
        var questions = BuildHtmlList(
            brief.ConveyancerQuestions,
            "No specific questions were included.");
        var buyerNote = string.IsNullOrWhiteSpace(request.Message)
            ? string.Empty
            : $"""
               <tr>
                 <td style="padding:0 0 18px;">
                   <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border:1px solid #d3dde6;border-radius:16px;background:#f8fbfd;">
                     <tr>
                       <td style="padding:20px;">
                         <p style="margin:0 0 8px;color:#425667;font-size:12px;line-height:1.4;letter-spacing:0.05em;text-transform:uppercase;font-weight:700;">Additional notes</p>
                         <p style="margin:0;color:#172532;font-size:14px;line-height:1.7;">{EncodeMultiline(request.Message)}</p>
                       </td>
                     </tr>
                   </table>
                 </td>
               </tr>
               """;

        var logoMarkup = string.IsNullOrWhiteSpace(logoUrl)
            ? "<span style=\"display:inline-block;font-size:24px;font-weight:700;color:#0b3c5d;letter-spacing:-0.03em;\">ConveyMate</span>"
            : $"""<img src="{Encode(logoUrl)}" alt="ConveyMate" width="210" height="48" style="display:block;width:210px;max-width:100%;height:auto;border:0;">""";

        var accessDetail = request.ShareReportPdf
            ? "<p style=\"margin:10px 0 0;color:#425667;font-size:13px;line-height:1.6;\">Buyer-approved documents are available only inside the secure portal and are not attached directly to this email.</p>"
            : string.Empty;

        return $$"""
                 <!doctype html>
                 <html lang="en">
                 <body style="margin:0;padding:0;background:#eef3f7;font-family:'Segoe UI',Arial,sans-serif;color:#172532;">
                   <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#eef3f7;padding:24px 10px;">
                     <tr>
                       <td align="center">
                         <table role="presentation" width="720" cellspacing="0" cellpadding="0" style="width:100%;max-width:720px;background:#ffffff;border:1px solid #d3dde6;border-radius:20px;">
                           <tr>
                             <td style="padding:24px 28px 18px;background:#eef5fb;border-bottom:1px solid #dbe7f0;">
                               <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                                 <tr>
                                   <td style="padding:0 16px 12px 0;vertical-align:top;">
                                     <p style="margin:0 0 8px;color:#425667;font-size:12px;line-height:1.4;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">Conveyancer quote request</p>
                                     <p style="margin:0;color:#0b3c5d;font-size:16px;line-height:1.5;font-weight:700;">Respond by {{Encode(responseDeadline)}}</p>
                                   </td>
                                   <td align="right" style="vertical-align:top;">
                                     {{logoMarkup}}
                                   </td>
                                 </tr>
                               </table>
                             </td>
                           </tr>
                           <tr>
                             <td style="padding:24px 28px 28px;">
                               <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;">
                                 <tr>
                                   <td style="padding:24px 24px 22px;border:1px solid #d3dde6;border-radius:18px;background:#f8fbfd;">
                                     <p style="margin:0 0 10px;color:#425667;font-size:12px;line-height:1.4;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">Hi {{Encode(greeting)}},</p>
                                     <p style="margin:0 0 10px;color:#0b3c5d;font-size:32px;line-height:1.08;font-weight:700;">Request for quote</p>
                                     <p style="margin:0 0 12px;color:#172532;font-size:15px;line-height:1.7;">
                                       We are issuing a request for quote on behalf of <strong>{{Encode(buyerDisplayName)}}</strong> for <strong>{{Encode(request.PropertyAddress)}}</strong>.
                                     </p>
                                     <p style="margin:0;color:#425667;font-size:14px;line-height:1.7;">
                                       The buyer is seeking <strong>{{Encode(serviceLabel)}}</strong> in <strong>{{Encode(request.StateOrTerritory)}}</strong>. Review the matter summary below, then send pricing and scope back through the secure portal.
                                     </p>
                                   </td>
                                 </tr>
                               </table>

                               <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;">
                                 <tr>
                                   <td style="padding:0 0 12px;">
                                     <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border:1px solid #d3dde6;border-radius:16px;background:#f8fbfd;">
                                       <tr>
                                         <td style="padding:18px 20px;">
                                           <p style="margin:0 0 6px;color:#425667;font-size:11px;line-height:1.4;letter-spacing:0.06em;text-transform:uppercase;font-weight:700;">Property</p>
                                           <p style="margin:0;color:#0b3c5d;font-size:18px;line-height:1.5;font-weight:700;">{{Encode(request.PropertyAddress)}}</p>
                                         </td>
                                       </tr>
                                     </table>
                                   </td>
                                 </tr>
                                 <tr>
                                   <td>
                                     <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                                       <tr>
                                         <td width="50%" style="padding:0 8px 0 0;vertical-align:top;">
                                           <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border:1px solid #d3dde6;border-radius:16px;background:#ffffff;">
                                             <tr>
                                               <td style="padding:18px 20px;">
                                                 <p style="margin:0 0 6px;color:#425667;font-size:11px;line-height:1.4;letter-spacing:0.06em;text-transform:uppercase;font-weight:700;">Service</p>
                                                 <p style="margin:0;color:#0b3c5d;font-size:16px;line-height:1.5;font-weight:700;">{{Encode(serviceLabel)}}</p>
                                               </td>
                                             </tr>
                                           </table>
                                         </td>
                                         <td width="50%" style="padding:0 0 0 8px;vertical-align:top;">
                                           <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border:1px solid #c8d8e5;border-radius:16px;background:#eef5fb;">
                                             <tr>
                                               <td style="padding:18px 20px;">
                                                 <p style="margin:0 0 6px;color:#425667;font-size:11px;line-height:1.4;letter-spacing:0.06em;text-transform:uppercase;font-weight:700;">Respond by</p>
                                                 <p style="margin:0;color:#0b3c5d;font-size:16px;line-height:1.5;font-weight:700;">{{Encode(responseDeadline)}}</p>
                                               </td>
                                             </tr>
                                           </table>
                                         </td>
                                       </tr>
                                     </table>
                                   </td>
                                 </tr>
                               </table>

                               <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                                 <tr>
                                   <td style="padding:0 0 18px;">
                                     <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border:1px solid #d3dde6;border-radius:16px;background:#f8fbfd;">
                                       <tr>
                                         <td style="padding:20px;">
                                           <p style="margin:0 0 8px;color:#425667;font-size:12px;line-height:1.4;letter-spacing:0.05em;text-transform:uppercase;font-weight:700;">Summary</p>
                                           <p style="margin:0;color:#172532;font-size:14px;line-height:1.7;">{{Encode(brief.Summary)}}</p>
                                         </td>
                                       </tr>
                                     </table>
                                   </td>
                                 </tr>
                                 <tr>
                                   <td style="padding:0 0 18px;">
                                     <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border:1px solid #d3dde6;border-radius:16px;background:#f8fbfd;">
                                       <tr>
                                         <td style="padding:20px;">
                                           <p style="margin:0 0 8px;color:#425667;font-size:12px;line-height:1.4;letter-spacing:0.05em;text-transform:uppercase;font-weight:700;">Questions to address</p>
                                           {{questions}}
                                         </td>
                                       </tr>
                                     </table>
                                   </td>
                                 </tr>
                                 {{buyerNote}}
                                 <tr>
                                   <td style="padding:0 0 18px;">
                                     <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border:1px solid #d3dde6;border-radius:16px;background:#ffffff;">
                                       <tr>
                                         <td style="padding:20px;">
                                           <p style="margin:0;color:#172532;font-size:14px;line-height:1.7;">Review the matter summary in the secure portal and submit your quote from there.</p>
                                           {{accessDetail}}
                                         </td>
                                       </tr>
                                     </table>
                                   </td>
                                 </tr>
                                 <tr>
                                   <td align="left" style="padding:0 0 18px;">
                                     <table role="presentation" cellspacing="0" cellpadding="0">
                                       <tr>
                                         <td>
                                           <a href="{{Encode(responseUrl)}}" style="display:inline-block;background:#0b3c5d;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;line-height:1.2;padding:15px 24px;border-radius:999px;">Review request and submit quote</a>
                                         </td>
                                       </tr>
                                     </table>
                                   </td>
                                 </tr>
                                 <tr>
                                   <td style="padding:0;">
                                     <p style="margin:0;color:#425667;font-size:13px;line-height:1.6;">
                                       If the button does not work, copy and paste this link into your browser:<br>
                                       <a href="{{Encode(responseUrl)}}" style="color:#0b3c5d;word-break:break-all;">{{Encode(responseUrl)}}</a>
                                     </p>
                                   </td>
                                 </tr>
                                 <tr>
                                   <td style="padding:24px 0 0;">
                                     <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-top:1px solid #dbe7f0;">
                                       <tr>
                                         <td style="padding-top:18px;">
                                           <p style="margin:0 0 10px;color:#425667;font-size:12px;line-height:1.6;">
                                             If you do not want to receive future ConveyMate quote requests, you can unsubscribe below.
                                           </p>
                                           <table role="presentation" cellspacing="0" cellpadding="0">
                                             <tr>
                                               <td>
                                                 <a href="{{Encode(unsubscribeUrl)}}" style="display:inline-block;background:#ffffff;color:#425667;text-decoration:none;font-size:13px;font-weight:700;line-height:1.2;padding:12px 18px;border-radius:999px;border:1px solid #c8d8e5;">Unsubscribe from future quote requests</a>
                                               </td>
                                             </tr>
                                           </table>
                                         </td>
                                       </tr>
                                     </table>
                                   </td>
                                 </tr>
                               </table>
                             </td>
                           </tr>
                         </table>
                       </td>
                     </tr>
                   </table>
                 </body>
                 </html>
                 """;
    }

    private static string BuildDocumentAccessOtpTextBody(
        string propertyAddress,
        string otpCode,
        DateTimeOffset expiresAtUtc)
    {
        return $"""
                ConveyMate secure document access code

                Property: {propertyAddress}
                Access code: {otpCode}
                Expires: {expiresAtUtc:dddd, d MMM yyyy h:mm tt 'UTC'}

                Enter this code in the secure quote portal to unlock the buyer-approved report and supporting contract documents.
                """;
    }

    private static string BuildBuyerQuoteReceivedTextBody(
        string buyerGreeting,
        string conveyancerDisplayName,
        QuoteRequestRecord request,
        QuoteRequestResponseRecord response,
        string workflowUrl)
    {
        var lines = new List<string>
        {
            $"Hi {buyerGreeting},",
            string.Empty,
            $"{conveyancerDisplayName} has submitted a quote for {request.PropertyAddress}.",
            $"Requested service: {QuoteRequestMapper.FormatServiceNeed(request.ServiceNeed)}",
            $"Submitted by: {response.ResponderName}",
            $"Professional fee: {FormatProfessionalFee(response)}"
        };

        if (response.DisbursementsEstimateAud.HasValue)
        {
            lines.Add($"Estimated disbursements: {FormatAudMoney(response.DisbursementsEstimateAud.Value)}");
        }

        if (response.TurnaroundBusinessDays.HasValue)
        {
            lines.Add($"Estimated turnaround: {FormatTurnaround(response.TurnaroundBusinessDays.Value)}");
        }

        if (response.ValidUntilUtc.HasValue)
        {
            lines.Add($"Quote valid until: {FormatUtcDeadline(response.ValidUntilUtc.Value)}");
        }

        lines.Add(string.Empty);
        lines.Add("Open your ConveyMate quote workflow to review the full scope, exclusions, and compare responses:");
        lines.Add(workflowUrl);

        return string.Join(Environment.NewLine, lines);
    }

    private static string BuildBuyerQuoteReceivedHtmlBody(
        string buyerGreeting,
        string conveyancerDisplayName,
        QuoteRequestRecord request,
        QuoteRequestResponseRecord response,
        string workflowUrl,
        string? logoUrl)
    {
        static string Encode(string? value) => WebUtility.HtmlEncode(value ?? string.Empty);

        var serviceLabel = QuoteRequestMapper.FormatServiceNeed(request.ServiceNeed);
        var disbursements = response.DisbursementsEstimateAud.HasValue
            ? FormatAudMoney(response.DisbursementsEstimateAud.Value)
            : "Not provided";
        var turnaround = response.TurnaroundBusinessDays.HasValue
            ? FormatTurnaround(response.TurnaroundBusinessDays.Value)
            : "Not provided";
        var validUntil = response.ValidUntilUtc.HasValue
            ? FormatUtcDeadline(response.ValidUntilUtc.Value)
            : "No expiry supplied";
        var logoMarkup = string.IsNullOrWhiteSpace(logoUrl)
            ? "<span style=\"display:inline-block;font-size:24px;font-weight:700;color:#0b3c5d;letter-spacing:-0.03em;\">ConveyMate</span>"
            : $"""<img src="{Encode(logoUrl)}" alt="ConveyMate" width="210" height="48" style="display:block;width:210px;max-width:100%;height:auto;border:0;">""";

        return $$"""
                 <!doctype html>
                 <html lang="en">
                 <body style="margin:0;padding:0;background:#eef3f7;font-family:'Segoe UI',Arial,sans-serif;color:#172532;">
                   <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#eef3f7;padding:24px 10px;">
                     <tr>
                       <td align="center">
                         <table role="presentation" width="680" cellspacing="0" cellpadding="0" style="width:100%;max-width:680px;background:#ffffff;border:1px solid #d3dde6;border-radius:20px;">
                           <tr>
                             <td style="padding:24px 28px 18px;background:#eef5fb;border-bottom:1px solid #dbe7f0;">
                               <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                                 <tr>
                                   <td style="padding:0 16px 12px 0;vertical-align:top;">
                                     <p style="margin:0 0 8px;color:#425667;font-size:12px;line-height:1.4;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">Quote workflow update</p>
                                     <p style="margin:0;color:#0b3c5d;font-size:16px;line-height:1.5;font-weight:700;">A conveyancer has responded</p>
                                   </td>
                                   <td align="right" style="vertical-align:top;">
                                     {{logoMarkup}}
                                   </td>
                                 </tr>
                               </table>
                             </td>
                           </tr>
                           <tr>
                             <td style="padding:24px 28px 28px;">
                               <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;">
                                 <tr>
                                   <td style="padding:24px 24px 22px;border:1px solid #d3dde6;border-radius:18px;background:#f8fbfd;">
                                     <p style="margin:0 0 10px;color:#425667;font-size:12px;line-height:1.4;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">Hi {{Encode(buyerGreeting)}},</p>
                                     <p style="margin:0 0 10px;color:#0b3c5d;font-size:32px;line-height:1.08;font-weight:700;">New quote received</p>
                                     <p style="margin:0 0 12px;color:#172532;font-size:15px;line-height:1.7;">
                                       <strong>{{Encode(conveyancerDisplayName)}}</strong> has submitted a quote for <strong>{{Encode(request.PropertyAddress)}}</strong>.
                                     </p>
                                     <p style="margin:0;color:#425667;font-size:14px;line-height:1.7;">
                                       Open your quote workflow to review the pricing, scope notes, exclusions, and compare responses side by side.
                                     </p>
                                   </td>
                                 </tr>
                               </table>

                               <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;">
                                 <tr>
                                   <td style="padding:0 0 12px;">
                                     <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border:1px solid #d3dde6;border-radius:16px;background:#f8fbfd;">
                                       <tr>
                                         <td style="padding:18px 20px;">
                                           <p style="margin:0 0 6px;color:#425667;font-size:11px;line-height:1.4;letter-spacing:0.06em;text-transform:uppercase;font-weight:700;">Property</p>
                                           <p style="margin:0;color:#0b3c5d;font-size:18px;line-height:1.5;font-weight:700;">{{Encode(request.PropertyAddress)}}</p>
                                         </td>
                                       </tr>
                                     </table>
                                   </td>
                                 </tr>
                                 <tr>
                                   <td>
                                     <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                                       <tr>
                                         <td width="50%" style="padding:0 8px 0 0;vertical-align:top;">
                                           <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border:1px solid #d3dde6;border-radius:16px;background:#ffffff;">
                                             <tr>
                                               <td style="padding:18px 20px;">
                                                 <p style="margin:0 0 6px;color:#425667;font-size:11px;line-height:1.4;letter-spacing:0.06em;text-transform:uppercase;font-weight:700;">Service</p>
                                                 <p style="margin:0;color:#0b3c5d;font-size:16px;line-height:1.5;font-weight:700;">{{Encode(serviceLabel)}}</p>
                                               </td>
                                             </tr>
                                           </table>
                                         </td>
                                         <td width="50%" style="padding:0 0 0 8px;vertical-align:top;">
                                           <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border:1px solid #c8d8e5;border-radius:16px;background:#eef5fb;">
                                             <tr>
                                               <td style="padding:18px 20px;">
                                                 <p style="margin:0 0 6px;color:#425667;font-size:11px;line-height:1.4;letter-spacing:0.06em;text-transform:uppercase;font-weight:700;">Submitted by</p>
                                                 <p style="margin:0;color:#0b3c5d;font-size:16px;line-height:1.5;font-weight:700;">{{Encode(response.ResponderName)}}</p>
                                               </td>
                                             </tr>
                                           </table>
                                         </td>
                                       </tr>
                                     </table>
                                   </td>
                                 </tr>
                               </table>

                               <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;">
                                 <tr>
                                   <td style="padding:0 0 18px;">
                                     <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border:1px solid #d3dde6;border-radius:16px;background:#f8fbfd;">
                                       <tr>
                                         <td style="padding:20px;">
                                           <p style="margin:0 0 8px;color:#425667;font-size:12px;line-height:1.4;letter-spacing:0.05em;text-transform:uppercase;font-weight:700;">Quote snapshot</p>
                                           <p style="margin:0 0 10px;color:#172532;font-size:14px;line-height:1.7;"><strong>Professional fee:</strong> {{Encode(FormatProfessionalFee(response))}}</p>
                                           <p style="margin:0 0 10px;color:#172532;font-size:14px;line-height:1.7;"><strong>Estimated disbursements:</strong> {{Encode(disbursements)}}</p>
                                           <p style="margin:0 0 10px;color:#172532;font-size:14px;line-height:1.7;"><strong>Turnaround:</strong> {{Encode(turnaround)}}</p>
                                           <p style="margin:0;color:#172532;font-size:14px;line-height:1.7;"><strong>Valid until:</strong> {{Encode(validUntil)}}</p>
                                         </td>
                                       </tr>
                                     </table>
                                   </td>
                                 </tr>
                                 <tr>
                                   <td align="left" style="padding:0 0 18px;">
                                     <table role="presentation" cellspacing="0" cellpadding="0">
                                       <tr>
                                         <td>
                                           <a href="{{Encode(workflowUrl)}}" style="display:inline-block;background:#0b3c5d;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;line-height:1.2;padding:15px 24px;border-radius:999px;">Open quote workflow</a>
                                         </td>
                                       </tr>
                                     </table>
                                   </td>
                                 </tr>
                                 <tr>
                                   <td style="padding:0;">
                                     <p style="margin:0;color:#425667;font-size:13px;line-height:1.6;">
                                       If the button does not work, copy and paste this link into your browser:<br>
                                       <a href="{{Encode(workflowUrl)}}" style="color:#0b3c5d;word-break:break-all;">{{Encode(workflowUrl)}}</a>
                                     </p>
                                   </td>
                                 </tr>
                               </table>
                             </td>
                           </tr>
                         </table>
                       </td>
                     </tr>
                   </table>
                 </body>
                 </html>
                 """;
    }

    private static string BuildDocumentAccessOtpHtmlBody(
        string propertyAddress,
        string otpCode,
        DateTimeOffset expiresAtUtc,
        string? logoUrl)
    {
        static string Encode(string? value) => WebUtility.HtmlEncode(value ?? string.Empty);

        var logoMarkup = string.IsNullOrWhiteSpace(logoUrl)
            ? "<span style=\"display:inline-block;font-size:24px;font-weight:700;color:#0b3c5d;letter-spacing:-0.03em;\">ConveyMate</span>"
            : $"""<img src="{Encode(logoUrl)}" alt="ConveyMate" width="210" height="48" style="display:block;width:210px;max-width:100%;height:auto;border:0;">""";

        return $$"""
                 <!doctype html>
                 <html lang="en">
                 <body style="margin:0;padding:0;background:#eef3f7;font-family:'Segoe UI',Arial,sans-serif;color:#172532;">
                   <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#eef3f7;padding:24px 10px;">
                     <tr>
                       <td align="center">
                         <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #d3dde6;border-radius:20px;">
                           <tr>
                             <td style="padding:24px 28px 18px;background:#eef5fb;border-bottom:1px solid #dbe7f0;">
                               <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                                 <tr>
                                   <td style="padding:0 16px 12px 0;vertical-align:top;">
                                     <p style="margin:0 0 8px;color:#425667;font-size:12px;line-height:1.4;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">Secure document access</p>
                                     <p style="margin:0;color:#0b3c5d;font-size:16px;line-height:1.5;font-weight:700;">One-time code expires {{Encode(expiresAtUtc.ToString("dddd, d MMM yyyy h:mm tt 'UTC'"))}}</p>
                                   </td>
                                   <td align="right" style="vertical-align:top;">
                                     {{logoMarkup}}
                                   </td>
                                 </tr>
                               </table>
                             </td>
                           </tr>
                           <tr>
                             <td style="padding:24px 28px 28px;">
                               <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;">
                                 <tr>
                                   <td style="padding:24px;border:1px solid #d3dde6;border-radius:18px;background:#f8fbfd;">
                                     <p style="margin:0 0 12px;color:#172532;font-size:15px;line-height:1.7;">
                                       Use the code below to unlock the buyer-approved report and supporting contract documents for <strong>{{Encode(propertyAddress)}}</strong>.
                                     </p>
                                     <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border:1px solid #c8d8e5;border-radius:16px;background:#eef5fb;">
                                       <tr>
                                         <td align="center" style="padding:22px 18px;">
                                           <p style="margin:0 0 8px;color:#425667;font-size:12px;line-height:1.4;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">One-time code</p>
                                           <p style="margin:0;color:#0b3c5d;font-size:36px;line-height:1;font-weight:800;letter-spacing:0.16em;">{{Encode(otpCode)}}</p>
                                         </td>
                                       </tr>
                                     </table>
                                     <p style="margin:16px 0 0;color:#425667;font-size:13px;line-height:1.6;">
                                       This code expires on <strong>{{Encode(expiresAtUtc.ToString("dddd, d MMM yyyy h:mm tt 'UTC'"))}}</strong>.
                                     </p>
                                   </td>
                                 </tr>
                               </table>
                             </td>
                           </tr>
                         </table>
                       </td>
                     </tr>
                   </table>
                 </body>
                 </html>
                 """;
    }

    private static string BuildHtmlList(IReadOnlyList<string> values, string emptyMessage)
    {
        static string Encode(string? value) => WebUtility.HtmlEncode(value ?? string.Empty);

        if (values.Count == 0)
        {
            return $"<p style=\"margin:0;color:#425667;font-size:14px;line-height:1.6;\">{Encode(emptyMessage)}</p>";
        }

        var items = values.Select((value, index) =>
            $"""<li style="margin:{(index == 0 ? "0" : "8px")} 0 0;">{Encode(value)}</li>""");

        return $"<ul style=\"margin:0;padding-left:18px;color:#172532;font-size:14px;line-height:1.6;\">{string.Join(string.Empty, items)}</ul>";
    }

    private static string EncodeMultiline(string? value)
    {
        return WebUtility.HtmlEncode(value ?? string.Empty)
            .Replace("\r\n", "<br>", StringComparison.Ordinal)
            .Replace("\n", "<br>", StringComparison.Ordinal);
    }

    private static string? ResolveLogoUrl(string? appBaseUrl)
    {
        if (string.IsNullOrWhiteSpace(appBaseUrl))
        {
            return null;
        }

        return $"{appBaseUrl.Trim().TrimEnd('/')}{EmailLogoPath}";
    }

    private static string ResolveBuyerDisplayName(string buyerName)
    {
        return NormalizeNullableMessage(buyerName) ?? "the buyer";
    }

    private static string ResolvePersonGreeting(string name)
    {
        return NormalizeNullableMessage(name) ?? "there";
    }

    private static string ResolveRecipientGreeting(ConveyancerDirectoryRecord record)
    {
        var contactName = NormalizeNullableMessage(record.ContactName);
        if (!string.IsNullOrWhiteSpace(contactName))
        {
            return contactName;
        }

        var organizationName = NormalizeNullableMessage(record.OrganizationName)
            ?? NormalizeNullableMessage(record.Name);
        if (string.IsNullOrWhiteSpace(organizationName))
        {
            return "there";
        }

        return $"{organizationName} team";
    }

    private static string ResolveConveyancerDisplayName(QuoteRequestTargetDetailRecord target)
    {
        return NormalizeNullableMessage(target.OrganizationName)
            ?? NormalizeNullableMessage(target.Name)
            ?? "A conveyancer";
    }

    private static string FormatUtcDeadline(DateTimeOffset value)
    {
        return value.ToString("dddd, d MMM yyyy h:mm tt 'UTC'");
    }

    private static string FormatProfessionalFee(QuoteRequestResponseRecord response)
    {
        return response.IncludesGst
            ? $"{FormatAudMoney(response.ProfessionalFeeAud)} incl. GST"
            : $"{FormatAudMoney(response.ProfessionalFeeAud)} plus GST";
    }

    private static string FormatAudMoney(decimal value)
    {
        return $"${value.ToString("N2", CultureInfo.InvariantCulture)}";
    }

    private static string FormatTurnaround(int businessDays)
    {
        return businessDays == 1
            ? "1 business day"
            : $"{businessDays} business days";
    }

    private static string? NormalizeNullableMessage(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrWhiteSpace(trimmed) ? null : trimmed;
    }
}
