using ErrorOr;

namespace ConveyMate.Api.Application;

internal static class ErrorOrExecution
{
    public static async Task<ErrorOr<Success>> TryAsync(Func<Task> action)
    {
        try
        {
            await action();
            return Result.Success;
        }
        catch (UnauthorizedAccessException error)
        {
            return Error.Unauthorized(description: error.Message);
        }
        catch (KeyNotFoundException error)
        {
            return Error.NotFound(description: error.Message);
        }
        catch (ArgumentException error)
        {
            return Error.Validation(description: error.Message);
        }
        catch (InvalidOperationException error)
        {
            return Error.Validation(description: error.Message);
        }
    }

    public static async Task<ErrorOr<T>> TryAsync<T>(Func<Task<T>> action)
    {
        try
        {
            return await action();
        }
        catch (UnauthorizedAccessException error)
        {
            return Error.Unauthorized(description: error.Message);
        }
        catch (KeyNotFoundException error)
        {
            return Error.NotFound(description: error.Message);
        }
        catch (ArgumentException error)
        {
            return Error.Validation(description: error.Message);
        }
        catch (InvalidOperationException error)
        {
            return Error.Validation(description: error.Message);
        }
    }
}
