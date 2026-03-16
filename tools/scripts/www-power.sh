#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  www-power.sh <off|on|status> [--region <aws-region>] [--core-stack <name>] [--services-stack <name>] [--worker-stack <name>]

Behavior:
  off    Set worker concurrency to 0, scale the ECS API service to 0,
         stop the RDS instance, and stop the NAT EC2 instance.
  on     Restore the saved ECS desired count and Lambda concurrency, then start the
         NAT instance and RDS instance.
  status Show the current live state plus the saved restore state from SSM.

Notes:
  - Restore state is stored in SSM at /conveymate/www/ops/power-state by default.
  - RDS instances auto-start after 7 days, so www:off is not permanent for the database.
  - ALB, CloudFront, S3/ECR storage, Route53, Cognito, logs, and public IPv4/EIP charges still remain.
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

die() {
  echo "$*" >&2
  exit 1
}

log() {
  echo "$*"
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_NAME="${APP_NAME:-conveymate}"
ENV_NAME="${ENV_NAME:-www}"
REGION="${AWS_REGION:-ap-southeast-2}"
CORE_STACK_NAME="${CORE_STACK_NAME:-${APP_NAME}-${ENV_NAME}-core}"
SERVICES_STACK_NAME="${SERVICES_STACK_NAME:-${APP_NAME}-${ENV_NAME}-services}"
WORKER_STACK_NAME="${WORKER_STACK_NAME:-${APP_NAME}-${ENV_NAME}-worker}"
STATE_PARAMETER_NAME="${STATE_PARAMETER_NAME:-/${APP_NAME}/${ENV_NAME}/ops/power-state}"
SERVICES_PARAMS_PATH="${ROOT_DIR}/infra/cloudformation/environments/www/services-parameters.json"
WORKER_PARAMS_PATH="${ROOT_DIR}/infra/cloudformation/environments/www/worker-parameters.json"

ACTION=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    off|on|status)
      if [[ -n "${ACTION}" ]]; then
        die "Action already provided: ${ACTION}"
      fi
      ACTION="$1"
      shift
      ;;
    --region)
      REGION="${2:-}"
      shift 2
      ;;
    --core-stack)
      CORE_STACK_NAME="${2:-}"
      shift 2
      ;;
    --services-stack)
      SERVICES_STACK_NAME="${2:-}"
      shift 2
      ;;
    --worker-stack)
      WORKER_STACK_NAME="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

if [[ -z "${ACTION}" ]]; then
  usage
  exit 1
fi

require_command aws
require_command jq

json_param_value() {
  local file_path="$1"
  local key="$2"
  local fallback="$3"
  local value=""

  if [[ -f "${file_path}" ]]; then
    value="$(jq -r --arg key "${key}" '.[] | select(.ParameterKey == $key) | .ParameterValue' "${file_path}" | tail -n 1)"
  fi

  if [[ -z "${value}" || "${value}" == "null" ]]; then
    echo "${fallback}"
    return
  fi

  echo "${value}"
}

DEFAULT_ECS_DESIRED_COUNT="$(json_param_value "${SERVICES_PARAMS_PATH}" "DesiredCount" "1")"
DEFAULT_LAMBDA_RESERVED_CONCURRENCY="$(json_param_value "${WORKER_PARAMS_PATH}" "ReservedConcurrentExecutions" "2")"

is_integer() {
  [[ "${1:-}" =~ ^[0-9]+$ ]]
}

stack_output() {
  local stack_name="$1"
  local output_key="$2"
  local value

  value="$(aws cloudformation describe-stacks \
    --region "${REGION}" \
    --stack-name "${stack_name}" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue" \
    --output text)"

  if [[ -z "${value}" || "${value}" == "None" ]]; then
    die "Could not resolve output ${output_key} from stack ${stack_name} in ${REGION}."
  fi

  echo "${value}"
}

stack_resource_id() {
  local stack_name="$1"
  local logical_id="$2"
  local value

  value="$(aws cloudformation describe-stack-resource \
    --region "${REGION}" \
    --stack-name "${stack_name}" \
    --logical-resource-id "${logical_id}" \
    --query 'StackResourceDetail.PhysicalResourceId' \
    --output text)"

  if [[ -z "${value}" || "${value}" == "None" ]]; then
    die "Could not resolve resource ${logical_id} from stack ${stack_name} in ${REGION}."
  fi

  echo "${value}"
}

read_state_json() {
  aws ssm get-parameter \
    --region "${REGION}" \
    --name "${STATE_PARAMETER_NAME}" \
    --query 'Parameter.Value' \
    --output text 2>/dev/null || echo '{}'
}

write_state_json() {
  local state_json="$1"

  aws ssm put-parameter \
    --region "${REGION}" \
    --name "${STATE_PARAMETER_NAME}" \
    --type String \
    --value "${state_json}" \
    --overwrite \
    --description "Saved www power restore state" >/dev/null
}

publish_maintenance_site() {
  log "Publishing maintenance website ..."
  AWS_REGION="${REGION}" \
  SERVICES_STACK_NAME="${SERVICES_STACK_NAME}" \
  bash "${ROOT_DIR}/ci-cd/deploy-www-maintenance.sh"
}

publish_live_site() {
  log "Rebuilding and publishing live website ..."
  AWS_REGION="${REGION}" \
  SERVICES_STACK_NAME="${SERVICES_STACK_NAME}" \
  bash "${ROOT_DIR}/ci-cd/deploy-www-website.sh"
}

get_nat_state() {
  aws ec2 describe-instances \
    --region "${REGION}" \
    --instance-ids "${NAT_INSTANCE_ID}" \
    --query 'Reservations[0].Instances[0].State.Name' \
    --output text
}

get_db_status() {
  aws rds describe-db-instances \
    --region "${REGION}" \
    --db-instance-identifier "${DB_INSTANCE_ID}" \
    --query 'DBInstances[0].DBInstanceStatus' \
    --output text
}

get_ecs_desired_count() {
  aws ecs describe-services \
    --region "${REGION}" \
    --cluster "${CLUSTER_ARN}" \
    --services "${ECS_SERVICE_ID}" \
    --query 'services[0].desiredCount' \
    --output text
}

get_lambda_reserved_concurrency() {
  aws lambda get-function-concurrency \
    --region "${REGION}" \
    --function-name "${WORKER_FUNCTION_NAME}" \
    --query 'ReservedConcurrentExecutions' \
    --output text 2>/dev/null || echo "None"
}

set_lambda_reserved_concurrency() {
  local target="$1"
  local current
  current="$(get_lambda_reserved_concurrency)"

  if [[ "${target}" == "null" ]]; then
    if [[ "${current}" == "None" ]]; then
      log "Reports worker reserved concurrency is already unset."
      return
    fi

    log "Removing reports worker reserved concurrency ..."
    aws lambda delete-function-concurrency \
      --region "${REGION}" \
      --function-name "${WORKER_FUNCTION_NAME}" >/dev/null
    return
  fi

  if [[ "${current}" == "${target}" ]]; then
    log "Reports worker reserved concurrency is already ${target}."
    return
  fi

  log "Setting reports worker reserved concurrency to ${target} ..."
  aws lambda put-function-concurrency \
    --region "${REGION}" \
    --function-name "${WORKER_FUNCTION_NAME}" \
    --reserved-concurrent-executions "${target}" >/dev/null
}

scale_service() {
  local target="$1"
  local current
  current="$(get_ecs_desired_count)"

  if [[ "${current}" == "${target}" ]]; then
    log "ECS desired count is already ${target}."
    return
  fi

  log "Setting ECS desired count to ${target} ..."
  aws ecs update-service \
    --region "${REGION}" \
    --cluster "${CLUSTER_ARN}" \
    --service "${ECS_SERVICE_ID}" \
    --desired-count "${target}" >/dev/null

  log "Waiting for ECS service to stabilise ..."
  aws ecs wait services-stable \
    --region "${REGION}" \
    --cluster "${CLUSTER_ARN}" \
    --services "${ECS_SERVICE_ID}"
}

wait_for_db_status() {
  local target_status="$1"
  local current_status=""

  for _ in $(seq 1 80); do
    current_status="$(get_db_status)"
    if [[ "${current_status}" == "${target_status}" ]]; then
      return 0
    fi

    sleep 30
  done

  die "Timed out waiting for RDS instance ${DB_INSTANCE_ID} to reach status ${target_status}; last status was ${current_status}."
}

ensure_db_stopped() {
  local status
  status="$(get_db_status)"

  case "${status}" in
    stopped)
      log "RDS instance is already stopped."
      ;;
    stopping)
      log "Waiting for RDS instance to stop ..."
      wait_for_db_status "stopped"
      ;;
    available)
      log "Stopping RDS instance ..."
      aws rds stop-db-instance \
        --region "${REGION}" \
        --db-instance-identifier "${DB_INSTANCE_ID}" >/dev/null
      wait_for_db_status "stopped"
      ;;
    starting)
      log "RDS instance is starting; waiting for availability before stopping ..."
      aws rds wait db-instance-available \
        --region "${REGION}" \
        --db-instance-identifier "${DB_INSTANCE_ID}"
      ensure_db_stopped
      ;;
    *)
      log "RDS instance is ${status}; waiting for availability before stopping ..."
      aws rds wait db-instance-available \
        --region "${REGION}" \
        --db-instance-identifier "${DB_INSTANCE_ID}"
      ensure_db_stopped
      ;;
  esac
}

ensure_db_available() {
  local status
  status="$(get_db_status)"

  case "${status}" in
    available)
      log "RDS instance is already available."
      ;;
    starting)
      log "Waiting for RDS instance to become available ..."
      aws rds wait db-instance-available \
        --region "${REGION}" \
        --db-instance-identifier "${DB_INSTANCE_ID}"
      ;;
    stopped)
      log "Starting RDS instance ..."
      aws rds start-db-instance \
        --region "${REGION}" \
        --db-instance-identifier "${DB_INSTANCE_ID}" >/dev/null
      wait_for_db_status "available"
      ;;
    stopping)
      log "RDS instance is stopping; waiting for it to stop before starting ..."
      wait_for_db_status "stopped"
      ensure_db_available
      ;;
    *)
      log "RDS instance is ${status}; waiting for availability ..."
      aws rds wait db-instance-available \
        --region "${REGION}" \
        --db-instance-identifier "${DB_INSTANCE_ID}"
      ;;
  esac
}

ensure_nat_stopped() {
  local state
  state="$(get_nat_state)"

  case "${state}" in
    stopped)
      log "NAT instance is already stopped."
      ;;
    stopping)
      log "Waiting for NAT instance to stop ..."
      aws ec2 wait instance-stopped \
        --region "${REGION}" \
        --instance-ids "${NAT_INSTANCE_ID}"
      ;;
    running)
      log "Stopping NAT instance ..."
      aws ec2 stop-instances \
        --region "${REGION}" \
        --instance-ids "${NAT_INSTANCE_ID}" >/dev/null
      aws ec2 wait instance-stopped \
        --region "${REGION}" \
        --instance-ids "${NAT_INSTANCE_ID}"
      ;;
    pending)
      log "NAT instance is pending; waiting for it to run before stopping ..."
      aws ec2 wait instance-running \
        --region "${REGION}" \
        --instance-ids "${NAT_INSTANCE_ID}"
      ensure_nat_stopped
      ;;
    *)
      die "NAT instance ${NAT_INSTANCE_ID} is in unexpected state ${state}."
      ;;
  esac
}

ensure_nat_running() {
  local state
  state="$(get_nat_state)"

  case "${state}" in
    running)
      log "Waiting for NAT instance status checks to pass ..."
      aws ec2 wait instance-status-ok \
        --region "${REGION}" \
        --instance-ids "${NAT_INSTANCE_ID}"
      ;;
    pending)
      log "Waiting for NAT instance to start ..."
      aws ec2 wait instance-running \
        --region "${REGION}" \
        --instance-ids "${NAT_INSTANCE_ID}"
      aws ec2 wait instance-status-ok \
        --region "${REGION}" \
        --instance-ids "${NAT_INSTANCE_ID}"
      ;;
    stopped)
      log "Starting NAT instance ..."
      aws ec2 start-instances \
        --region "${REGION}" \
        --instance-ids "${NAT_INSTANCE_ID}" >/dev/null
      aws ec2 wait instance-running \
        --region "${REGION}" \
        --instance-ids "${NAT_INSTANCE_ID}"
      aws ec2 wait instance-status-ok \
        --region "${REGION}" \
        --instance-ids "${NAT_INSTANCE_ID}"
      ;;
    stopping)
      log "NAT instance is stopping; waiting for it to stop before starting ..."
      aws ec2 wait instance-stopped \
        --region "${REGION}" \
        --instance-ids "${NAT_INSTANCE_ID}"
      ensure_nat_running
      ;;
    *)
      die "NAT instance ${NAT_INSTANCE_ID} is in unexpected state ${state}."
      ;;
  esac
}

resolve_resources() {
  CLUSTER_ARN="$(stack_output "${CORE_STACK_NAME}" "EcsClusterArn")"
  NAT_INSTANCE_ID="$(stack_resource_id "${CORE_STACK_NAME}" "NatInstance")"
  DB_INSTANCE_ID="$(stack_resource_id "${CORE_STACK_NAME}" "DatabaseInstance")"
  ECS_SERVICE_ID="$(stack_resource_id "${SERVICES_STACK_NAME}" "Service")"
  WORKER_FUNCTION_NAME="$(stack_resource_id "${WORKER_STACK_NAME}" "ReportsWorkerLambda")"
}

save_restore_state() {
  local current_ecs_desired_count="$1"
  local current_lambda_reserved_concurrency="$2"
  local existing_state_json="$3"
  local existing_ecs_desired_count=""
  local existing_lambda_reserved_concurrency=""
  local saved_ecs_desired_count=""
  local saved_lambda_reserved_concurrency=""
  local state_json=""

  existing_ecs_desired_count="$(printf '%s' "${existing_state_json}" | jq -r '.ecsDesiredCount // empty')"
  existing_lambda_reserved_concurrency="$(printf '%s' "${existing_state_json}" | jq -r 'if has("lambdaReservedConcurrency") then (.lambdaReservedConcurrency | tostring) else empty end')"

  if is_integer "${current_ecs_desired_count}" && (( current_ecs_desired_count > 0 )); then
    saved_ecs_desired_count="${current_ecs_desired_count}"
  elif is_integer "${existing_ecs_desired_count}"; then
    saved_ecs_desired_count="${existing_ecs_desired_count}"
  else
    saved_ecs_desired_count="${DEFAULT_ECS_DESIRED_COUNT}"
  fi

  if is_integer "${current_lambda_reserved_concurrency}" && (( current_lambda_reserved_concurrency > 0 )); then
    saved_lambda_reserved_concurrency="${current_lambda_reserved_concurrency}"
  elif [[ "${existing_lambda_reserved_concurrency}" == "null" ]]; then
    saved_lambda_reserved_concurrency="null"
  elif is_integer "${existing_lambda_reserved_concurrency}"; then
    saved_lambda_reserved_concurrency="${existing_lambda_reserved_concurrency}"
  else
    saved_lambda_reserved_concurrency="${DEFAULT_LAMBDA_RESERVED_CONCURRENCY}"
  fi

  state_json="$(jq -cn \
    --argjson ecsDesiredCount "${saved_ecs_desired_count}" \
    --argjson lambdaReservedConcurrency "${saved_lambda_reserved_concurrency}" \
    --arg savedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{
      ecsDesiredCount: $ecsDesiredCount,
      lambdaReservedConcurrency: $lambdaReservedConcurrency,
      savedAt: $savedAt
    }')"

  write_state_json "${state_json}"
  log "Saved restore state to ${STATE_PARAMETER_NAME}: ${state_json}"
}

show_status() {
  local state_json
  state_json="$(read_state_json)"

  log "Environment: ${ENV_NAME}"
  log "Region: ${REGION}"
  log "Core stack: ${CORE_STACK_NAME}"
  log "Services stack: ${SERVICES_STACK_NAME}"
  log "Worker stack: ${WORKER_STACK_NAME}"
  log "NAT instance: ${NAT_INSTANCE_ID} ($(get_nat_state))"
  log "RDS instance: ${DB_INSTANCE_ID} ($(get_db_status))"
  log "ECS cluster: ${CLUSTER_ARN}"
  log "ECS service: ${ECS_SERVICE_ID} (desiredCount=$(get_ecs_desired_count))"
  log "Worker function: ${WORKER_FUNCTION_NAME} (reservedConcurrency=$(get_lambda_reserved_concurrency))"
  log "Saved restore state parameter: ${STATE_PARAMETER_NAME}"
  printf '%s\n' "${state_json}" | jq .
}

power_off() {
  local current_ecs_desired_count
  local current_lambda_reserved_concurrency
  local existing_state_json

  current_ecs_desired_count="$(get_ecs_desired_count)"
  current_lambda_reserved_concurrency="$(get_lambda_reserved_concurrency)"
  existing_state_json="$(read_state_json)"

  save_restore_state \
    "${current_ecs_desired_count}" \
    "${current_lambda_reserved_concurrency}" \
    "${existing_state_json}"

  publish_maintenance_site
  set_lambda_reserved_concurrency "0"
  scale_service "0"
  ensure_db_stopped
  ensure_nat_stopped

  log "www is powered down as far as the current CloudFormation layout allows."
  log "Reminder: the RDS instance will auto-start after 7 days if you leave it stopped."
}

power_on() {
  local state_json
  local target_ecs_desired_count
  local target_lambda_reserved_concurrency

  state_json="$(read_state_json)"
  target_ecs_desired_count="$(printf '%s' "${state_json}" | jq -r ".ecsDesiredCount // ${DEFAULT_ECS_DESIRED_COUNT}")"
  target_lambda_reserved_concurrency="$(printf '%s' "${state_json}" | jq -r "if has(\"lambdaReservedConcurrency\") then (.lambdaReservedConcurrency | tostring) else \"${DEFAULT_LAMBDA_RESERVED_CONCURRENCY}\" end")"

  ensure_nat_running
  ensure_db_available
  scale_service "${target_ecs_desired_count}"
  set_lambda_reserved_concurrency "${target_lambda_reserved_concurrency}"

  publish_live_site
  log "www is powered back on."
}

resolve_resources

case "${ACTION}" in
  off)
    power_off
    ;;
  on)
    power_on
    ;;
  status)
    show_status
    ;;
esac
