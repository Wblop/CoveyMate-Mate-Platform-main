#!/usr/bin/env bash
# Reset all local review pipeline test data while preserving users.
# - Clears review jobs and all dependent pipeline records.
# - Clears stripe webhook tracking rows.
# - Does NOT delete app.users or Cognito users.
# - Default mode is dry-run; pass --apply to execute.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/local-dev-env.sh"

usage() {
  cat <<'EOF'
Usage:
  reset-review-pipeline-test-data.sh [--apply]

Examples:
  reset-review-pipeline-test-data.sh
  reset-review-pipeline-test-data.sh --apply
EOF
}

APPLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      APPLY=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

COUNTS=()
while IFS= read -r row; do
  [[ -n "${row}" ]] && COUNTS+=("${row}")
done < <(psql_local -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT 'review_jobs|' || COUNT(*) FROM app.review_jobs;
SELECT 'job_documents|' || COUNT(*) FROM app.job_documents;
SELECT 'extracted_chunks|' || COUNT(*) FROM app.extracted_chunks;
SELECT 'citations|' || COUNT(*) FROM app.citations;
SELECT 'embeddings|' || COUNT(*) FROM app.embeddings;
SELECT 'review_job_progress_events|' || COUNT(*) FROM app.review_job_progress_events;
SELECT 'stripe_webhook_events|' || COUNT(*) FROM app.stripe_webhook_events;
SQL
)

echo "Current row counts:"
for row in "${COUNTS[@]}"; do
  table="${row%%|*}"
  count="${row#*|}"
  printf '  - %-28s %s\n' "${table}" "${count}"
done

if [[ "${APPLY}" != "true" ]]; then
  echo "Dry-run mode. Re-run with --apply to delete these rows."
  exit 0
fi

echo "Resetting review pipeline data..."
psql_local -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
TRUNCATE TABLE app.review_jobs CASCADE;
TRUNCATE TABLE app.stripe_webhook_events;
COMMIT;
SQL

echo "Review pipeline test data reset complete."
