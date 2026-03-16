using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using ErrorOr;
using Microsoft.Extensions.Options;
using ConveyMate.Api.Application.Auth.Abstractions;
using ConveyMate.Api.Configuration;

namespace ConveyMate.Api.Infrastructure.Auth;

public sealed class CognitoSignUpService(
    HttpClient httpClient,
    IOptions<CognitoOptions> cognitoOptions)
    : ICognitoSignUpService
{
    private static readonly JsonSerializerOptions ResponseSerializerOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };
    private const string TargetHeader = "AWSCognitoIdentityProviderService.SignUp";

    public async Task<ErrorOr<CognitoSignUpResult>> SignUpAsync(string fullName, string email, string password, CancellationToken cancellationToken)
    {
        var cognito = cognitoOptions.Value;
        var endpoint = $"https://cognito-idp.{cognito.Region}.amazonaws.com/";
        var payload = new
        {
            ClientId = cognito.AppClientId,
            Username = email,
            Password = password,
            UserAttributes = new[]
            {
                new { Name = "email", Value = email },
                new { Name = "name", Value = fullName }
            }
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
        {
            Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/x-amz-json-1.1")
        };
        request.Headers.TryAddWithoutValidation("X-Amz-Target", TargetHeader);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/x-amz-json-1.1"));

        using var response = await httpClient.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);

        if (response.IsSuccessStatusCode)
        {
            var signUpResponse = JsonSerializer.Deserialize<CognitoSignUpResponse>(body, ResponseSerializerOptions);
            return new CognitoSignUpResult(signUpResponse?.UserConfirmed ?? false);
        }

        return MapError(body);
    }

    private static ErrorOr<CognitoSignUpResult> MapError(string body)
    {
        var (errorType, fallbackMessage) = ParseError(body);
        var message = ResolveMessage(errorType, fallbackMessage);

        return errorType switch
        {
            "UsernameExistsException" => Error.Conflict(description: message),
            "InvalidPasswordException" => Error.Validation(description: message),
            "InvalidParameterException" => Error.Validation(description: message),
            "TooManyRequestsException" => Error.Validation(description: "Too many registration attempts. Please try again shortly."),
            _ => Error.Validation(description: message)
        };
    }

    private static (string Type, string? Message) ParseError(string body)
    {
        if (string.IsNullOrWhiteSpace(body))
        {
            return (string.Empty, null);
        }

        try
        {
            using var document = JsonDocument.Parse(body);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                return (string.Empty, null);
            }

            var errorType = NormalizeErrorType(
                GetPropertyValue(document.RootElement, "__type")
                ?? GetPropertyValue(document.RootElement, "code"));
            var message = GetPropertyValue(document.RootElement, "message");

            return (errorType, message);
        }
        catch (JsonException)
        {
            return (string.Empty, null);
        }
    }

    private static string NormalizeErrorType(string? rawType)
    {
        if (string.IsNullOrWhiteSpace(rawType))
        {
            return string.Empty;
        }

        var normalized = rawType.Trim();
        var hashIndex = normalized.LastIndexOf('#');
        return hashIndex >= 0 ? normalized[(hashIndex + 1)..] : normalized;
    }

    private static string ResolveMessage(string errorType, string? fallbackMessage)
    {
        return errorType switch
        {
            "UsernameExistsException" => "That email address is already registered.",
            "InvalidPasswordException" => "Use a stronger password.",
            _ => string.IsNullOrWhiteSpace(fallbackMessage) ? "Registration failed." : fallbackMessage.Trim()
        };
    }

    private static string? GetPropertyValue(JsonElement root, string propertyName)
    {
        foreach (var property in root.EnumerateObject())
        {
            if (!string.Equals(property.Name, propertyName, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            return property.Value.ValueKind == JsonValueKind.String
                ? property.Value.GetString()
                : property.Value.ToString();
        }

        return null;
    }

    private sealed record CognitoSignUpResponse(bool UserConfirmed);
}
