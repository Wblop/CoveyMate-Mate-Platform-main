using Npgsql;
using ConveyMate.Api.Application.Users.Abstractions;
using ConveyMate.Api.Domain.Users;

namespace ConveyMate.Api.Infrastructure.Persistence.Users;

/// <summary>
/// PostgreSQL-backed implementation of the user repository port.
/// </summary>
public sealed class UserRepository(NpgsqlDataSource dataSource) : IUserRepository
{
    public async Task<AppUser?> GetByIdAsync(Guid userId, CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT id,
                                  cognito_sub,
                                  email,
                                  full_name,
                                  is_admin,
                                  is_suspended,
                                  last_login_at,
                                  created_at,
                                  updated_at
                           FROM app.users
                           WHERE id = @id
                           LIMIT 1;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("id", userId);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return Map(reader);
    }

    public async Task<AppUser?> GetByCognitoSubAsync(string cognitoSub, CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT id,
                                  cognito_sub,
                                  email,
                                  full_name,
                                  is_admin,
                                  is_suspended,
                                  last_login_at,
                                  created_at,
                                  updated_at
                           FROM app.users
                           WHERE cognito_sub = @sub
                           LIMIT 1;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("sub", cognitoSub);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return Map(reader);
    }

    public async Task<AppUser?> TouchLastLoginAsync(Guid userId, CancellationToken cancellationToken)
    {
        const string sql = """
                           UPDATE app.users
                           SET last_login_at = NOW(),
                               updated_at = NOW()
                           WHERE id = @id
                           RETURNING id,
                                     cognito_sub,
                                     email,
                                     full_name,
                                     is_admin,
                                     is_suspended,
                                     last_login_at,
                                     created_at,
                                     updated_at;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("id", userId);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return Map(reader);
    }

    public async Task<AppUser> UpsertFromClaimsAsync(
        string cognitoSub,
        string email,
        string fullName,
        CancellationToken cancellationToken)
    {
        const string sql = """
                           INSERT INTO app.users AS users (id, cognito_sub, email, full_name, is_admin, last_login_at)
                           VALUES (
                               @id,
                               @cognito_sub,
                               @email,
                               @full_name,
                               EXISTS (
                                   SELECT 1
                                   FROM app.admin_users admin_users
                                   WHERE LOWER(admin_users.email) = LOWER(@email)
                               ),
                               NOW()
                           )
                           ON CONFLICT (cognito_sub)
                           DO UPDATE
                               SET email = EXCLUDED.email,
                                   full_name = EXCLUDED.full_name,
                                   is_admin = users.is_admin OR EXISTS (
                                       SELECT 1
                                       FROM app.admin_users admin_users
                                       WHERE LOWER(admin_users.email) = LOWER(EXCLUDED.email)
                                   ),
                                   last_login_at = NOW(),
                                   updated_at = NOW()
                           RETURNING id,
                                     cognito_sub,
                                     email,
                                     full_name,
                                     is_admin,
                                     is_suspended,
                                     last_login_at,
                                     created_at,
                                     updated_at;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("id", Guid.NewGuid());
        command.Parameters.AddWithValue("cognito_sub", cognitoSub);
        command.Parameters.AddWithValue("email", email);
        command.Parameters.AddWithValue("full_name", fullName);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            throw new InvalidOperationException("User upsert did not return a row.");
        }

        return Map(reader);
    }

    private static AppUser Map(NpgsqlDataReader reader)
    {
        return new AppUser(
            reader.GetGuid(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.GetBoolean(5),
            reader.GetBoolean(4),
            reader.IsDBNull(6) ? null : reader.GetFieldValue<DateTimeOffset>(6),
            reader.GetFieldValue<DateTimeOffset>(7),
            reader.GetFieldValue<DateTimeOffset>(8));
    }
}
