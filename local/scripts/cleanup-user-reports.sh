#!/usr/bin/env bash
# Remove review pipeline test data for a single user email in local dev.
# - Deletes report artifacts from LocalStack S3.
# - Deletes review jobs and dependent pipeline rows from PostgreSQL.
# - Keeps Cognito and app.users records intact.
# - Default mode is dry-run; pass --apply to execute.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/local-dev-env.sh"

usage() {
  cat <<'EOF'
Usage:
  cleanup-user-reports.sh --email <user-email> [--apply]

Examples:
  cleanup-user-reports.sh --email daimenrees@hotmail.com
  cleanup-user-reports.sh --email daimenrees@hotmail.com --apply

Notes:
  - Dry-run by default.
  - Does not delete Cognito users or app.users rows.
EOF
}

EMAIL=""
APPLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --email)
      EMAIL="${2:-}"
      shift 2
      ;;
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

if [[ -z "${EMAIL}" ]]; then
  echo "--email is required." >&2
  usage
  exit 1
fi

EMAIL_SQL="${EMAIL//\'/\'\'}"

USER_ROWS=()
while IFS= read -r row; do
  [[ -n "${row}" ]] && USER_ROWS+=("${row}")
done < <(
  psql_local -v ON_ERROR_STOP=1 -At \
    -c "SELECT id || '|' || email FROM app.users WHERE lower(email)=lower('${EMAIL_SQL}');"
)

if [[ ${#USER_ROWS[@]} -eq 0 ]]; then
  echo "No app.users row found for email: ${EMAIL}"
  exit 0
fi

if [[ ${#USER_ROWS[@]} -gt 1 ]]; then
  echo "Multiple users matched '${EMAIL}'. Aborting for safety." >&2
  printf '%s\n' "${USER_ROWS[@]}" >&2
  exit 1
fi

USER_ID="${USER_ROWS[0]%%|*}"
USER_EMAIL="${USER_ROWS[0]#*|}"
USER_ID_SQL="${USER_ID//\'/\'\'}"

echo "User matched: ${USER_EMAIL} (${USER_ID})"

JOB_IDS=()
while IFS= read -r row; do
  [[ -n "${row}" ]] && JOB_IDS+=("${row}")
done < <(
  psql_local -v ON_ERROR_STOP=1 -At \
    -c "SELECT id::text FROM app.review_jobs WHERE user_id = '${USER_ID_SQL}'::uuid ORDER BY created_at;"
)

if [[ ${#JOB_IDS[@]} -eq 0 ]]; then
  echo "No review jobs found for this user. Nothing to clean."
  exit 0
fi

echo "Found ${#JOB_IDS[@]} review job(s)."

declare -a JOB_KEYS
for job_id in "${JOB_IDS[@]}"; do
  JOB_KEYS+=("reports/${job_id}/")
  JOB_KEYS+=("extracted/${job_id}/")
done

RAW_KEYS=()
while IFS= read -r row; do
  [[ -n "${row}" ]] && RAW_KEYS+=("${row}")
done < <(
  psql_local -v ON_ERROR_STOP=1 -At \
    -c "SELECT DISTINCT s3_key_raw FROM app.job_documents WHERE user_id = '${USER_ID_SQL}'::uuid AND s3_key_raw IS NOT NULL;"
)

REPORT_KEYS=()
while IFS= read -r row; do
  [[ -n "${row}" ]] && REPORT_KEYS+=("${row}")
done < <(
  psql_local -v ON_ERROR_STOP=1 -At \
    -c "SELECT DISTINCT report_s3_key FROM app.review_jobs WHERE user_id = '${USER_ID_SQL}'::uuid AND report_s3_key IS NOT NULL;"
)

if [[ "${APPLY}" != "true" ]]; then
  echo "Dry-run mode."
  echo "Would delete database rows for ${#JOB_IDS[@]} job(s) owned by user ${USER_EMAIL}."
  echo "Would delete S3 prefixes:"
  for key in "${JOB_KEYS[@]}"; do
    printf '  - s3://%s/%s\n' "${CONVEYMATE_REPORTS_BUCKET_NAME}" "${key}"
  done
  if [[ ${#RAW_KEYS[@]} -gt 0 ]]; then
    echo "Would delete uploaded raw keys:"
    for key in "${RAW_KEYS[@]}"; do
      printf '  - s3://%s/%s\n' "${CONVEYMATE_REPORTS_BUCKET_NAME}" "${key}"
    done
  fi
  if [[ ${#REPORT_KEYS[@]} -gt 0 ]]; then
    echo "Would delete report keys:"
    for key in "${REPORT_KEYS[@]}"; do
      printf '  - s3://%s/%s\n' "${CONVEYMATE_REPORTS_BUCKET_NAME}" "${key}"
    done
  fi
  echo "Re-run with --apply to execute."
  exit 0
fi

echo "Deleting LocalStack S3 artifacts from bucket ${CONVEYMATE_REPORTS_BUCKET_NAME}..."
for prefix in "${JOB_KEYS[@]}"; do
  aws_local s3 rm "s3://${CONVEYMATE_REPORTS_BUCKET_NAME}/${prefix}" --recursive >/dev/null || true
done
for key in "${RAW_KEYS[@]}"; do
  aws_local s3 rm "s3://${CONVEYMATE_REPORTS_BUCKET_NAME}/${key}" >/dev/null || true
done
for key in "${REPORT_KEYS[@]}"; do
  aws_local s3 rm "s3://${CONVEYMATE_REPORTS_BUCKET_NAME}/${key}" >/dev/null || true
done

echo "Deleting user review pipeline rows from PostgreSQL..."
psql_local -v ON_ERROR_STOP=1 <<SQL
BEGIN;

DELETE FROM app.stripe_webhook_events
WHERE payment_intent_id IN (
  SELECT stripe_payment_intent_id
  FROM app.review_jobs
  WHERE user_id = '${USER_ID_SQL}'::uuid
    AND stripe_payment_intent_id IS NOT NULL
);

DELETE FROM app.review_jobs
WHERE user_id = '${USER_ID_SQL}'::uuid;

COMMIT;
SQL

remaining_jobs="$(
  psql_local -v ON_ERROR_STOP=1 -At \
    -c "SELECT COUNT(*) FROM app.review_jobs WHERE user_id = '${USER_ID_SQL}'::uuid;"
)"

echo "Cleanup complete. Remaining review_jobs for ${USER_EMAIL}: ${remaining_jobs}"
