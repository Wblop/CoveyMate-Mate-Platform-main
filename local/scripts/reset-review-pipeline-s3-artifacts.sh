#!/usr/bin/env bash
# Remove all report pipeline artifacts from the local LocalStack S3 bucket.
# - Targets raw/, extracted/, and reports/ prefixes only.
# - Does NOT touch database rows.
# - Default mode is dry-run; pass --apply to execute.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/local-dev-env.sh"

usage() {
  cat <<'EOF'
Usage:
  reset-review-pipeline-s3-artifacts.sh [--apply]

Examples:
  reset-review-pipeline-s3-artifacts.sh
  reset-review-pipeline-s3-artifacts.sh --apply
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

prefixes=("raw/" "extracted/" "reports/")

if [[ "${APPLY}" != "true" ]]; then
  echo "Dry-run mode."
  echo "Would delete LocalStack S3 prefixes from bucket ${CONVEYMATE_REPORTS_BUCKET_NAME}:"
  printf '  - %s\n' "${prefixes[@]}"
  echo "Re-run with --apply to execute."
  exit 0
fi

echo "Deleting LocalStack S3 artifacts from bucket ${CONVEYMATE_REPORTS_BUCKET_NAME}..."
for prefix in "${prefixes[@]}"; do
  aws_local s3 rm "s3://${CONVEYMATE_REPORTS_BUCKET_NAME}/${prefix}" --recursive >/dev/null || true
done

echo "S3 artifact reset complete."
