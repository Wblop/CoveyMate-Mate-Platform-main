#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  reset-environment-data.sh [--env <name>] [--region <aws-region>] [--apply]

Examples:
  reset-environment-data.sh --env www
  reset-environment-data.sh --env www --apply

Behavior:
  - Dry-run by default.
  - Preserves app.users, app.admin_users, app.conveyancers, and app.conveyancer_refresh_log.
  - Deletes review jobs, uploaded documents, extracted pipeline data, quote workflows, feedback,
    stripe webhook events, site notifications, and S3 report artifacts under raw/, extracted/, and reports/.
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

APP_NAME="conveymate"
ENV_NAME="www"
REGION="${AWS_REGION:-ap-southeast-2}"
APPLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENV_NAME="${2:-}"
      shift 2
      ;;
    --region)
      REGION="${2:-}"
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

require_command aws
require_command python3
require_command base64

if [[ -z "${ENV_NAME}" ]]; then
  echo "--env is required." >&2
  exit 1
fi

SSM_PREFIX="/${APP_NAME}/${ENV_NAME}"
CONNECTION_STRING="$(
  aws ssm get-parameter \
    --name "${SSM_PREFIX}/database/connectionstring" \
    --with-decryption \
    --region "${REGION}" \
    --query 'Parameter.Value' \
    --output text
)"
REPORTS_BUCKET="$(
  aws ssm get-parameter \
    --name "${SSM_PREFIX}/s3/reportsbucketname" \
    --region "${REGION}" \
    --query 'Parameter.Value' \
    --output text
)"

connection_value() {
  local key="$1"
  printf '%s' "${CONNECTION_STRING}" | tr ';' '\n' | sed -n "s/^${key}=//p"
}

PGHOST="$(connection_value Host)"
PGPORT="$(connection_value Port)"
PGDATABASE="$(connection_value Database)"
PGUSER="$(connection_value Username)"
PGPASSWORD="$(connection_value Password)"
PGSSLMODE="$(connection_value 'SSL Mode' | tr '[:upper:]' '[:lower:]')"

CLUSTER_NAME="${APP_NAME}-${ENV_NAME}-cluster"
SERVICE_ARN="$(
  aws ecs list-services \
    --cluster "${CLUSTER_NAME}" \
    --region "${REGION}" \
    --query 'serviceArns[0]' \
    --output text
)"

if [[ -z "${SERVICE_ARN}" || "${SERVICE_ARN}" == "None" ]]; then
  echo "Could not resolve an ECS service for cluster ${CLUSTER_NAME}." >&2
  exit 1
fi

TASK_DEFINITION_ARN="$(
  aws ecs describe-services \
    --cluster "${CLUSTER_NAME}" \
    --services "${SERVICE_ARN}" \
    --region "${REGION}" \
    --query 'services[0].taskDefinition' \
    --output text
)"
SUBNETS_RAW="$(
  aws ecs describe-services \
    --cluster "${CLUSTER_NAME}" \
    --services "${SERVICE_ARN}" \
    --region "${REGION}" \
    --query 'services[0].networkConfiguration.awsvpcConfiguration.subnets' \
    --output text
)"
SECURITY_GROUPS_RAW="$(
  aws ecs describe-services \
    --cluster "${CLUSTER_NAME}" \
    --services "${SERVICE_ARN}" \
    --region "${REGION}" \
    --query 'services[0].networkConfiguration.awsvpcConfiguration.securityGroups' \
    --output text
)"
EXECUTION_ROLE_ARN="$(
  aws ecs describe-task-definition \
    --task-definition "${TASK_DEFINITION_ARN}" \
    --region "${REGION}" \
    --query 'taskDefinition.executionRoleArn' \
    --output text
)"
TASK_ROLE_ARN="$(
  aws ecs describe-task-definition \
    --task-definition "${TASK_DEFINITION_ARN}" \
    --region "${REGION}" \
    --query 'taskDefinition.taskRoleArn' \
    --output text
)"
LOG_GROUP_NAME="$(
  aws ecs describe-task-definition \
    --task-definition "${TASK_DEFINITION_ARN}" \
    --region "${REGION}" \
    --output json | python3 -c 'import json,sys; print(json.load(sys.stdin)["taskDefinition"]["containerDefinitions"][0]["logConfiguration"]["options"]["awslogs-group"])'
)"

SUBNETS_CSV="$(printf '%s' "${SUBNETS_RAW}" | tr '\t' ',')"
SECURITY_GROUPS_CSV="$(printf '%s' "${SECURITY_GROUPS_RAW}" | tr '\t' ',')"
DBTOOLS_FAMILY="${APP_NAME}-${ENV_NAME}-dbtools"

DBTOOLS_TASK_DEFINITION_ARN="$(
  aws ecs register-task-definition \
    --region "${REGION}" \
    --family "${DBTOOLS_FAMILY}" \
    --network-mode awsvpc \
    --requires-compatibilities FARGATE \
    --cpu 256 \
    --memory 512 \
    --execution-role-arn "${EXECUTION_ROLE_ARN}" \
    --task-role-arn "${TASK_ROLE_ARN}" \
    --runtime-platform cpuArchitecture=ARM64,operatingSystemFamily=LINUX \
    --container-definitions "[{\"name\":\"db\",\"image\":\"public.ecr.aws/docker/library/postgres:17-alpine\",\"essential\":true,\"entryPoint\":[\"sh\",\"-lc\"],\"command\":[\"echo dbtools-ready\"],\"logConfiguration\":{\"logDriver\":\"awslogs\",\"options\":{\"awslogs-group\":\"${LOG_GROUP_NAME}\",\"awslogs-region\":\"${REGION}\",\"awslogs-stream-prefix\":\"dbtools\"}}}]" \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text
)"

run_db_sql() {
  local sql="$1"
  local sql_b64
  local overrides_json
  local task_arn
  local task_id

  sql_b64="$(printf '%s' "${sql}" | base64 | tr -d '\n')"
  overrides_json="$(
    PGHOST="${PGHOST}" \
    PGPORT="${PGPORT}" \
    PGDATABASE="${PGDATABASE}" \
    PGUSER="${PGUSER}" \
    PGPASSWORD="${PGPASSWORD}" \
    PGSSLMODE="${PGSSLMODE}" \
    SQL_B64="${sql_b64}" \
    python3 - <<'PY'
import json
import os

command = "printf '%s' \"$SQL_B64\" | base64 -d | psql -v ON_ERROR_STOP=1 -Atf -"
environment = [
    {"name": "PGHOST", "value": os.environ["PGHOST"]},
    {"name": "PGPORT", "value": os.environ["PGPORT"]},
    {"name": "PGDATABASE", "value": os.environ["PGDATABASE"]},
    {"name": "PGUSER", "value": os.environ["PGUSER"]},
    {"name": "PGPASSWORD", "value": os.environ["PGPASSWORD"]},
    {"name": "PGSSLMODE", "value": os.environ["PGSSLMODE"]},
    {"name": "SQL_B64", "value": os.environ["SQL_B64"]},
]
print(json.dumps({"containerOverrides": [{"name": "db", "command": [command], "environment": environment}]}))
PY
  )"

  task_arn="$(
    aws ecs run-task \
      --region "${REGION}" \
      --cluster "${CLUSTER_NAME}" \
      --launch-type FARGATE \
      --task-definition "${DBTOOLS_TASK_DEFINITION_ARN}" \
      --network-configuration "awsvpcConfiguration={subnets=[${SUBNETS_CSV}],securityGroups=[${SECURITY_GROUPS_CSV}],assignPublicIp=DISABLED}" \
      --overrides "${overrides_json}" \
      --query 'tasks[0].taskArn' \
      --output text
  )"

  if [[ -z "${task_arn}" || "${task_arn}" == "None" ]]; then
    echo "Could not start dbtools ECS task." >&2
    exit 1
  fi

  aws ecs wait tasks-stopped --region "${REGION}" --cluster "${CLUSTER_NAME}" --tasks "${task_arn}" >/dev/null
  task_id="${task_arn##*/}"

  for _ in $(seq 1 10); do
    if aws logs get-log-events \
      --region "${REGION}" \
      --log-group-name "${LOG_GROUP_NAME}" \
      --log-stream-name "dbtools/db/${task_id}" \
      --query 'events[].message' \
      --output text 2>/dev/null; then
      return 0
    fi

    sleep 2
  done

  echo "Could not read dbtools task logs for ${task_id}." >&2
  exit 1
}

COUNTS_SQL="WITH counts AS (SELECT 1 ord,'users' label,COUNT(*)::text value FROM app.users UNION ALL SELECT 2,'admin_users',COUNT(*)::text FROM app.admin_users UNION ALL SELECT 3,'conveyancers',COUNT(*)::text FROM app.conveyancers UNION ALL SELECT 4,'conveyancer_refresh_log',COUNT(*)::text FROM app.conveyancer_refresh_log UNION ALL SELECT 5,'review_jobs',COUNT(*)::text FROM app.review_jobs UNION ALL SELECT 6,'job_documents',COUNT(*)::text FROM app.job_documents UNION ALL SELECT 7,'review_job_progress_events',COUNT(*)::text FROM app.review_job_progress_events UNION ALL SELECT 8,'extracted_chunks',COUNT(*)::text FROM app.extracted_chunks UNION ALL SELECT 9,'citations',COUNT(*)::text FROM app.citations UNION ALL SELECT 10,'embeddings',COUNT(*)::text FROM app.embeddings UNION ALL SELECT 11,'stripe_webhook_events',COUNT(*)::text FROM app.stripe_webhook_events UNION ALL SELECT 12,'feedback',COUNT(*)::text FROM app.feedback UNION ALL SELECT 13,'site_notifications',COUNT(*)::text FROM app.site_notifications UNION ALL SELECT 14,'quote_requests',COUNT(*)::text FROM app.quote_requests UNION ALL SELECT 15,'quote_request_targets',COUNT(*)::text FROM app.quote_request_targets UNION ALL SELECT 16,'quote_request_responses',COUNT(*)::text FROM app.quote_request_responses) SELECT label || '|' || value FROM counts ORDER BY ord;"

print_counts() {
  local counts_output="$1"
  echo "Database counts for ${ENV_NAME}:"
  printf '%s\n' "${counts_output}" | tr '\t' '\n' | while IFS='|' read -r label count; do
    printf '  %-28s %s\n' "${label}" "${count}"
  done
}

COUNTS_OUTPUT="$(run_db_sql "${COUNTS_SQL}")"

echo "Environment: ${ENV_NAME}"
echo "Region: ${REGION}"
echo "Cluster: ${CLUSTER_NAME}"
echo "Reports bucket: ${REPORTS_BUCKET}"
print_counts "${COUNTS_OUTPUT}"
echo
echo "S3 usage under s3://${REPORTS_BUCKET}:"
aws s3 ls "s3://${REPORTS_BUCKET}" --recursive --summarize | tail -n 2
echo

if [[ "${APPLY}" != "true" ]]; then
  echo "Dry-run only. Re-run with --apply to wipe report data while keeping users and conveyancers."
  exit 0
fi

echo "Deleting S3 artifacts..."
aws s3 rm "s3://${REPORTS_BUCKET}/raw/" --recursive >/dev/null
aws s3 rm "s3://${REPORTS_BUCKET}/extracted/" --recursive >/dev/null
aws s3 rm "s3://${REPORTS_BUCKET}/reports/" --recursive >/dev/null

echo "Deleting application data..."
RESET_SQL="BEGIN; DELETE FROM app.site_notifications; DELETE FROM app.feedback; DELETE FROM app.stripe_webhook_events; DELETE FROM app.quote_requests; DELETE FROM app.review_jobs; COMMIT;"
run_db_sql "${RESET_SQL}" >/dev/null

echo
echo "Remaining counts after reset:"
print_counts "$(run_db_sql "${COUNTS_SQL}")"
