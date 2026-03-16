namespace ConveyMate.Api.Security;

/// <summary>
/// Applies a secure baseline of HTTP response headers for API endpoints.
/// </summary>
public static class SecurityHeadersExtensions
{
    public static IApplicationBuilder UseConveyMateSecurityHeaders(this IApplicationBuilder app, IWebHostEnvironment environment)
    {
        return app.Use(async (context, next) =>
        {
            var headers = context.Response.Headers;
            headers["X-Content-Type-Options"] = "nosniff";
            headers["X-Frame-Options"] = "DENY";
            headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
            headers["X-Permitted-Cross-Domain-Policies"] = "none";
            headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()";
            headers["Cross-Origin-Opener-Policy"] = "same-origin";
            headers["Cross-Origin-Resource-Policy"] = "same-site";
            // Restrict resource loading for API responses; XSS protection for any incidental HTML.
            headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none';";

            if (!environment.IsDevelopment())
            {
                headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload";
            }

            await next();
        });
    }
}
