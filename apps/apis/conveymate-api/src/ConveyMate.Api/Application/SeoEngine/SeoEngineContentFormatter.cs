using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.RegularExpressions;
using ConveyMate.Api.Application.SeoEngine.Abstractions;

namespace ConveyMate.Api.Application.SeoEngine;

internal static partial class SeoEngineContentFormatter
{
    private static readonly Regex QuotedPhrasePattern = new(
        "(?<!\\*)(\"[^\"]{8,220}\"|“[^”]{8,220}”)(?!\\*)",
        RegexOptions.Compiled);

    public static string NormalizeSlug(string title, string? explicitSlug = null)
    {
        var candidate = string.IsNullOrWhiteSpace(explicitSlug) ? title : explicitSlug;
        candidate = candidate.Trim().ToLowerInvariant();
        candidate = SlugCleanupRegex().Replace(candidate, "-");
        candidate = candidate.Trim('-');
        return string.IsNullOrWhiteSpace(candidate) ? "insight" : candidate;
    }

    public static string[] NormalizeKeywords(IEnumerable<string> values, int maxCount)
    {
        return values
            .Select(value => (value ?? string.Empty).Trim())
            .Where(value => value.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(maxCount)
            .ToArray();
    }

    public static IReadOnlyList<SeoEngineArticleSectionRecord> ParseSections(string markdown)
    {
        var sections = new List<SeoEngineArticleSectionRecord>();
        var lines = markdown.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n').Split('\n');
        var currentHeading = "Overview";
        var currentSectionId = "overview";
        var paragraphs = new List<string>();
        var paragraphLines = new List<string>();
        var bullets = new List<string>();
        var position = 0;

        void FlushParagraph()
        {
            if (paragraphLines.Count == 0)
            {
                return;
            }

            var paragraph = string.Join(' ', paragraphLines).Trim();
            if (paragraph.Length > 0)
            {
                paragraphs.Add(paragraph);
            }

            paragraphLines.Clear();
        }

        void FlushSection()
        {
            FlushParagraph();
            if (paragraphs.Count == 0 && bullets.Count == 0 && sections.Count > 0)
            {
                return;
            }

            sections.Add(new SeoEngineArticleSectionRecord(
                currentSectionId,
                currentHeading,
                paragraphs.ToArray(),
                bullets.ToArray(),
                position++));

            paragraphs = [];
            bullets = [];
        }

        foreach (var rawLine in lines)
        {
            var line = rawLine.Trim();
            if (line.StartsWith("## ", StringComparison.Ordinal))
            {
                FlushSection();
                currentHeading = line[3..].Trim();
                currentSectionId = NormalizeSlug(currentHeading);
                continue;
            }

            if (line.StartsWith("- ", StringComparison.Ordinal) || line.StartsWith("* ", StringComparison.Ordinal))
            {
                FlushParagraph();
                var bullet = line[2..].Trim();
                if (bullet.Length > 0)
                {
                    bullets.Add(bullet);
                }

                continue;
            }

            if (line.Length == 0)
            {
                FlushParagraph();
                continue;
            }

            paragraphLines.Add(line);
        }

        FlushSection();

        if (sections.Count == 0)
        {
            sections.Add(new SeoEngineArticleSectionRecord("overview", "Overview", [markdown.Trim()], [], 0));
        }

        return sections;
    }

    public static string BuildHtml(
        IReadOnlyList<SeoEngineArticleSectionRecord> sections,
        IReadOnlyList<SeoEngineArticleSourceRecord>? sources = null)
    {
        var builder = new StringBuilder();
        foreach (var section in sections.OrderBy(item => item.Position))
        {
            builder.Append("<section id=\"")
                .Append(HtmlEncoder.Default.Encode(section.SectionId))
                .Append("\">")
                .Append("<h2>")
                .Append(HtmlEncoder.Default.Encode(section.Heading))
                .Append("</h2>");

            foreach (var paragraph in section.Paragraphs)
            {
                builder.Append("<p>")
                    .Append(RenderInlineHtml(paragraph, sources))
                    .Append("</p>");
            }

            if (section.Bullets.Length > 0)
            {
                builder.Append("<ul>");
                foreach (var bullet in section.Bullets)
                {
                    builder.Append("<li>")
                        .Append(RenderInlineHtml(bullet, sources))
                        .Append("</li>");
                }

                builder.Append("</ul>");
            }

            builder.Append("</section>");
        }

        return builder.ToString();
    }

    public static string RenderInlineHtml(
        string value,
        IReadOnlyList<SeoEngineArticleSourceRecord>? sources = null)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        var normalized = AutoFormatInlineText(value.Trim(), sources);
        return RenderInlineHtmlInternal(normalized, 0);
    }

    public static string BuildPlainText(IReadOnlyList<SeoEngineArticleSectionRecord> sections)
    {
        return string.Join(
            "\n",
            sections
                .OrderBy(item => item.Position)
                .SelectMany(section =>
                    new[] { section.Heading }
                        .Concat(section.Paragraphs.Select(StripInlineMarkdown))
                        .Concat(section.Bullets.Select(StripInlineMarkdown))))
            .Trim();
    }

    public static string ComputeFingerprint(string plainText)
    {
        var normalized = Regex.Replace(plainText.Trim().ToLowerInvariant(), @"\s+", " ");
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(normalized));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private static string AutoFormatInlineText(string value, IReadOnlyList<SeoEngineArticleSourceRecord>? sources)
    {
        var linked = LinkSourceMentions(value, sources);
        return QuotedPhrasePattern.Replace(linked, "*$1*");
    }

    private static string LinkSourceMentions(string value, IReadOnlyList<SeoEngineArticleSourceRecord>? sources)
    {
        if (sources is null || sources.Count == 0)
        {
            return value;
        }

        var updated = value;

        foreach (var source in sources
                     .Where(source => IsSafeHttpUrl(source.SourceUrl))
                     .OrderBy(source => source.Position))
        {
            if (updated.Contains(source.SourceUrl, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            foreach (var term in BuildSourceLinkTerms(source))
            {
                var linked = LinkFirstMatch(updated, term, source.SourceUrl);
                if (!string.Equals(linked, updated, StringComparison.Ordinal))
                {
                    updated = linked;
                    break;
                }
            }
        }

        return updated;
    }

    private static IEnumerable<string> BuildSourceLinkTerms(SeoEngineArticleSourceRecord source)
    {
        return new[] { source.Publisher, source.SourceName }
            .Select(value => value?.Trim() ?? string.Empty)
            .Where(value => value.Length >= 4)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderByDescending(value => value.Length);
    }

    private static string LinkFirstMatch(string value, string term, string url)
    {
        if (string.IsNullOrWhiteSpace(value)
            || string.IsNullOrWhiteSpace(term)
            || value.Contains("](", StringComparison.Ordinal))
        {
            return value;
        }

        var pattern = new Regex($@"(?<!\[){Regex.Escape(term)}(?!\]\()", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        var match = pattern.Match(value);
        if (!match.Success)
        {
            return value;
        }

        return string.Concat(
            value[..match.Index],
            "[",
            value.Substring(match.Index, match.Length),
            "](",
            url,
            ")",
            value[(match.Index + match.Length)..]);
    }

    private static string RenderInlineHtmlInternal(string value, int depth)
    {
        if (depth > 4 || string.IsNullOrEmpty(value))
        {
            return HtmlEncoder.Default.Encode(value);
        }

        var builder = new StringBuilder();

        for (var index = 0; index < value.Length;)
        {
            if (TryReadMarkdownLink(value, index, out var linkLength, out var linkText, out var linkUrl))
            {
                builder.Append("<a href=\"")
                    .Append(HtmlEncoder.Default.Encode(linkUrl))
                    .Append("\" target=\"_blank\" rel=\"noopener noreferrer\">")
                    .Append(RenderInlineHtmlInternal(linkText, depth + 1))
                    .Append("</a>");
                index += linkLength;
                continue;
            }

            if (TryReadEmphasis(value, index, out var emphasisLength, out var emphasisText))
            {
                builder.Append("<em>")
                    .Append(RenderInlineHtmlInternal(emphasisText, depth + 1))
                    .Append("</em>");
                index += emphasisLength;
                continue;
            }

            builder.Append(HtmlEncoder.Default.Encode(value[index].ToString()));
            index++;
        }

        return builder.ToString();
    }

    private static string StripInlineMarkdown(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        return StripInlineMarkdownInternal(value.Trim(), 0);
    }

    private static string StripInlineMarkdownInternal(string value, int depth)
    {
        if (depth > 4 || string.IsNullOrEmpty(value))
        {
            return value;
        }

        var builder = new StringBuilder();

        for (var index = 0; index < value.Length;)
        {
            if (TryReadMarkdownLink(value, index, out var linkLength, out var linkText, out _))
            {
                builder.Append(StripInlineMarkdownInternal(linkText, depth + 1));
                index += linkLength;
                continue;
            }

            if (TryReadEmphasis(value, index, out var emphasisLength, out var emphasisText))
            {
                builder.Append(StripInlineMarkdownInternal(emphasisText, depth + 1));
                index += emphasisLength;
                continue;
            }

            builder.Append(value[index]);
            index++;
        }

        return builder.ToString();
    }

    private static bool TryReadMarkdownLink(
        string value,
        int startIndex,
        out int consumedLength,
        out string text,
        out string url)
    {
        consumedLength = 0;
        text = string.Empty;
        url = string.Empty;

        if (startIndex >= value.Length || value[startIndex] != '[')
        {
            return false;
        }

        var closingBracketIndex = value.IndexOf(']', startIndex + 1);
        if (closingBracketIndex <= startIndex + 1
            || closingBracketIndex + 1 >= value.Length
            || value[closingBracketIndex + 1] != '(')
        {
            return false;
        }

        var closingParenthesisIndex = value.IndexOf(')', closingBracketIndex + 2);
        if (closingParenthesisIndex <= closingBracketIndex + 2)
        {
            return false;
        }

        var candidateText = value[(startIndex + 1)..closingBracketIndex].Trim();
        var candidateUrl = value[(closingBracketIndex + 2)..closingParenthesisIndex].Trim();
        if (string.IsNullOrWhiteSpace(candidateText) || !IsSafeHttpUrl(candidateUrl))
        {
            return false;
        }

        consumedLength = (closingParenthesisIndex - startIndex) + 1;
        text = candidateText;
        url = candidateUrl;
        return true;
    }

    private static bool TryReadEmphasis(string value, int startIndex, out int consumedLength, out string text)
    {
        consumedLength = 0;
        text = string.Empty;

        if (startIndex >= value.Length)
        {
            return false;
        }

        var marker = value[startIndex];
        if ((marker != '*' && marker != '_')
            || startIndex + 2 >= value.Length
            || value[startIndex + 1] == marker)
        {
            return false;
        }

        var closingIndex = value.IndexOf(marker, startIndex + 1);
        while (closingIndex > startIndex)
        {
            var candidate = value[(startIndex + 1)..closingIndex];
            if (!string.IsNullOrWhiteSpace(candidate)
                && !candidate.Contains('\n', StringComparison.Ordinal)
                && !candidate.StartsWith(' ')
                && !candidate.EndsWith(' '))
            {
                consumedLength = (closingIndex - startIndex) + 1;
                text = candidate;
                return true;
            }

            closingIndex = value.IndexOf(marker, closingIndex + 1);
        }

        return false;
    }

    private static bool IsSafeHttpUrl(string value)
    {
        return Uri.TryCreate(value, UriKind.Absolute, out var uri)
               && (uri.Scheme.Equals("http", StringComparison.OrdinalIgnoreCase)
                   || uri.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase));
    }

    [GeneratedRegex("[^a-z0-9]+", RegexOptions.Compiled)]
    private static partial Regex SlugCleanupRegex();
}
