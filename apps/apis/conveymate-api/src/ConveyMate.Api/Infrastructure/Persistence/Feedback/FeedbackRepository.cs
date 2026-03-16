using Npgsql;
using ConveyMate.Api.Application.Feedback;

namespace ConveyMate.Api.Infrastructure.Persistence.Feedback;

public sealed class FeedbackRepository(NpgsqlDataSource dataSource) : IFeedbackRepository
{
    public async Task InsertAsync(
        Guid userId,
        SubmitFeedbackRequest request,
        string? userAgent,
        CancellationToken cancellationToken)
    {
        const string sql = """
                           INSERT INTO app.feedback (id, user_id, type, message, page_url, user_agent)
                           VALUES (@id, @user_id, @type, @message, @page_url, @user_agent);
                           """;

        await using var cmd = dataSource.CreateCommand(sql);
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("user_id", userId);
        cmd.Parameters.AddWithValue("type", request.Type.ToLowerInvariant());
        cmd.Parameters.AddWithValue("message", request.Message.Trim());
        cmd.Parameters.AddWithValue("page_url", request.PageUrl);
        cmd.Parameters.AddWithValue("user_agent", (object?)userAgent ?? DBNull.Value);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }
}
