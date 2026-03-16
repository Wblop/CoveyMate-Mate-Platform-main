using System.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using Serilog.Formatting.Compact;

namespace ConveyMate.Api.Logging;

internal static class ApiSerilogConfiguration
{
    internal static Logger CreateBootstrapLogger()
    {
        return new LoggerConfiguration()
            .MinimumLevel.Information()
            .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
            .Enrich.FromLogContext()
            .Enrich.WithProperty("service", "api")
            .Enrich.With<ApiExceptionSummaryEnricher>()
            .WriteTo.Console(new RenderedCompactJsonFormatter())
            .CreateLogger();
    }

    internal static void Configure(LoggerConfiguration loggerConfiguration, IConfiguration configuration, string environmentName)
    {
        var defaultLevel = ParseLevel(configuration["Logging:LogLevel:Default"], LogEventLevel.Information);

        loggerConfiguration
            .MinimumLevel.Is(defaultLevel)
            .Enrich.FromLogContext()
            .Enrich.WithProperty("service", "api")
            .Enrich.WithProperty("environment", environmentName)
            .Enrich.With<ApiExceptionSummaryEnricher>()
            .WriteTo.Console(new RenderedCompactJsonFormatter());

        foreach (var overrideSetting in configuration.GetSection("Logging:LogLevel").GetChildren())
        {
            if (string.Equals(overrideSetting.Key, "Default", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            loggerConfiguration.MinimumLevel.Override(
                overrideSetting.Key,
                ParseLevel(overrideSetting.Value, defaultLevel));
        }
    }

    internal static void EnrichRequest(IDiagnosticContext diagnosticContext, HttpContext httpContext)
    {
        diagnosticContext.Set("event", "http_request_completed");
        diagnosticContext.Set("requestId", httpContext.TraceIdentifier);
        diagnosticContext.Set("requestHost", httpContext.Request.Host.Value ?? string.Empty);
        diagnosticContext.Set("requestScheme", httpContext.Request.Scheme);

        if (Activity.Current is { } activity)
        {
            diagnosticContext.Set("traceId", activity.TraceId.ToString());
            diagnosticContext.Set("spanId", activity.SpanId.ToString());
        }
    }

    private static LogEventLevel ParseLevel(string? value, LogEventLevel fallback)
    {
        return value?.Trim().ToLowerInvariant() switch
        {
            "trace" => LogEventLevel.Verbose,
            "debug" => LogEventLevel.Debug,
            "information" => LogEventLevel.Information,
            "warning" => LogEventLevel.Warning,
            "error" => LogEventLevel.Error,
            "critical" => LogEventLevel.Fatal,
            "none" => LogEventLevel.Fatal,
            _ => fallback
        };
    }
}

internal sealed class ApiExceptionSummaryEnricher : ILogEventEnricher
{
    public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
    {
        if (logEvent.Exception is null)
        {
            return;
        }

        logEvent.AddPropertyIfAbsent(propertyFactory.CreateProperty("errorType", logEvent.Exception.GetType().FullName));
        logEvent.AddPropertyIfAbsent(propertyFactory.CreateProperty("errorMessage", logEvent.Exception.Message));
        logEvent.AddPropertyIfAbsent(propertyFactory.CreateProperty("errorSummary", Summarize(logEvent.Exception)));
    }

    private static string Summarize(Exception exception)
    {
        return string.Join(
            " | ",
            exception.ToString()
                .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries)
                .Select(line => line.Trim())
                .Where(line => line.Length > 0)
                .Take(8));
    }
}
