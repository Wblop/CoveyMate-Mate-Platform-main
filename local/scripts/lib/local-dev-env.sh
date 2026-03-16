#!/usr/bin/env bash
# Shared local runtime helpers for cleanup scripts.
# - Loads local/.env defaults when available.
# - Exposes PostgreSQL connection details for psql.
# - Exposes LocalStack AWS defaults for S3 cleanup operations.

set -euo pipefail

SOURCE_PATH="${BASH_SOURCE[0]-$0}"
SCRIPT_DIR="$(cd "$(dirname "${SOURCE_PATH}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
LOCAL_ENV_FILE="${ROOT_DIR}/local/.env"

if [[ -f "${LOCAL_ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${LOCAL_ENV_FILE}"
fi

export CONVEYMATE_LOCAL_PG_HOST="${CONVEYMATE_LOCAL_PG_HOST:-localhost}"
export CONVEYMATE_POSTGRES_PORT="${CONVEYMATE_POSTGRES_PORT:-54329}"
export CONVEYMATE_POSTGRES_DB="${CONVEYMATE_POSTGRES_DB:-conveymate}"
export CONVEYMATE_POSTGRES_USER="${CONVEYMATE_POSTGRES_USER:-conveymate_app}"
export CONVEYMATE_POSTGRES_PASSWORD="${CONVEYMATE_POSTGRES_PASSWORD:-conveymate_local_dev_password}"

export CONVEYMATE_AWS_REGION="${CONVEYMATE_AWS_REGION:-ap-southeast-2}"
export CONVEYMATE_LOCALSTACK_ENDPOINT="${CONVEYMATE_LOCALSTACK_ENDPOINT:-http://localhost:4566}"
export CONVEYMATE_REPORTS_BUCKET_NAME="${CONVEYMATE_REPORTS_BUCKET_NAME:-conveymate-dev-reports-bucket}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"

export PGPASSWORD="${CONVEYMATE_POSTGRES_PASSWORD}"

# psql wrapper pinned to the local app database.
psql_local() {
  if command -v psql >/dev/null 2>&1; then
    psql \
      --host "${CONVEYMATE_LOCAL_PG_HOST}" \
      --port "${CONVEYMATE_POSTGRES_PORT}" \
      --username "${CONVEYMATE_POSTGRES_USER}" \
      --dbname "${CONVEYMATE_POSTGRES_DB}" \
      "$@"
    return
  fi

  # Fallback for environments where psql is not installed locally.
  docker exec -i "conveymate-postgres" \
    psql \
      --username "${CONVEYMATE_POSTGRES_USER}" \
      --dbname "${CONVEYMATE_POSTGRES_DB}" \
      "$@"
}

# aws wrapper pinned to LocalStack endpoint and configured region.
aws_local() {
  aws \
    --endpoint-url "${CONVEYMATE_LOCALSTACK_ENDPOINT}" \
    --region "${CONVEYMATE_AWS_REGION}" \
    "$@"
}
