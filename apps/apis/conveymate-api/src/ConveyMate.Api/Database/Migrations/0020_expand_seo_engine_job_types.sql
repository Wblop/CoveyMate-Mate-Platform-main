ALTER TABLE app.seo_engine_jobs
    DROP CONSTRAINT IF EXISTS ck_seo_engine_jobs_type;

ALTER TABLE app.seo_engine_jobs
    ADD CONSTRAINT ck_seo_engine_jobs_type
        CHECK (job_type IN ('generate-article', 'publish-next-article', 'refresh-sitemap'));
