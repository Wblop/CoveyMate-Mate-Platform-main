DO
$$
DECLARE
    embedding_type TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        RETURN;
    END IF;

    SELECT pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
    INTO embedding_type
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS class ON class.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'app'
      AND class.relname = 'embeddings'
      AND attribute.attname = 'embedding'
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'app'
          AND table_name = 'embeddings'
          AND column_name = 'embedding_v2'
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'app'
              AND table_name = 'embeddings'
              AND column_name = 'embedding'
        ) THEN
            IF embedding_type = 'vector(1536)' THEN
                EXECUTE 'UPDATE app.embeddings SET embedding = COALESCE(embedding, embedding_v2) WHERE embedding_v2 IS NOT NULL';
                EXECUTE 'ALTER TABLE app.embeddings DROP COLUMN embedding_v2';
            ELSE
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'app'
                      AND table_name = 'embeddings'
                      AND column_name = 'embedding_legacy_384'
                ) THEN
                    EXECUTE 'ALTER TABLE app.embeddings DROP COLUMN embedding';
                ELSE
                    EXECUTE 'ALTER TABLE app.embeddings RENAME COLUMN embedding TO embedding_legacy_384';
                END IF;

                EXECUTE 'ALTER TABLE app.embeddings RENAME COLUMN embedding_v2 TO embedding';
            END IF;
        ELSE
            EXECUTE 'ALTER TABLE app.embeddings RENAME COLUMN embedding_v2 TO embedding';
        END IF;
    ELSE
        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'app'
              AND table_name = 'embeddings'
              AND column_name = 'embedding'
        ) THEN
            EXECUTE 'ALTER TABLE app.embeddings ADD COLUMN embedding VECTOR(1536)';
        ELSIF embedding_type IS DISTINCT FROM 'vector(1536)' THEN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'app'
                  AND table_name = 'embeddings'
                  AND column_name = 'embedding_legacy_384'
            ) THEN
                EXECUTE 'ALTER TABLE app.embeddings DROP COLUMN embedding';
            ELSE
                EXECUTE 'ALTER TABLE app.embeddings RENAME COLUMN embedding TO embedding_legacy_384';
            END IF;

            EXECUTE 'ALTER TABLE app.embeddings ADD COLUMN embedding VECTOR(1536)';
        END IF;
    END IF;
END
$$;

DO
$$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
       AND EXISTS (
           SELECT 1
           FROM information_schema.columns
           WHERE table_schema = 'app'
             AND table_name = 'embeddings'
             AND column_name = 'embedding'
       ) THEN
        EXECUTE
            'UPDATE app.embeddings e
             SET embedding = (
                 (''['' || (
                     SELECT string_agg(value, '','')
                     FROM jsonb_array_elements_text(e.embedding_json) AS element(value)
                 ) || '']'')::vector
             )
             WHERE embedding IS NULL
               AND jsonb_typeof(e.embedding_json) = ''array''
               AND jsonb_array_length(e.embedding_json) = 1536';
    END IF;
END
$$;

DROP INDEX IF EXISTS app.ix_embeddings_vector_cosine_v2;
DROP INDEX IF EXISTS app.ix_embeddings_vector_cosine;

DO
$$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
       AND EXISTS (
           SELECT 1
           FROM information_schema.columns
           WHERE table_schema = 'app'
             AND table_name = 'embeddings'
             AND column_name = 'embedding'
       ) THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS ix_embeddings_vector_cosine ON app.embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)';
    END IF;
END
$$;
