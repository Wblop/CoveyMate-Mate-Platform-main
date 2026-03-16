#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ROOT_DIR}/local/.env"
COMPOSE_FILE="${ROOT_DIR}/local/docker-compose.yml"
WORKER_PROJECT="${ROOT_DIR}/../ConveyMate-AI/src/ConveyMate.ReportsWorker/ConveyMate.ReportsWorker.csproj"
# shellcheck disable=SC1091
source "${ROOT_DIR}/tools/scripts/lib/localstack-health.sh"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "${ENV_FILE}"
  set +a
fi

CONFIG_ENV="${CONVEYMATE_CONFIG_ENV:-dev}"
AWS_REGION="${CONVEYMATE_AWS_REGION:-ap-southeast-2}"
LOCALSTACK_PORT="${CONVEYMATE_LOCALSTACK_PORT:-4566}"
LOCALSTACK_ENDPOINT="${CONVEYMATE_AWS_LOCALSTACK_ENDPOINT:-http://localhost:${LOCALSTACK_PORT}}"
LOCALSTACK_LAMBDA_ENDPOINT="${CONVEYMATE_AWS_LOCALSTACK_LAMBDA_ENDPOINT:-http://host.docker.internal:${LOCALSTACK_PORT}}"
LOCALSTACK_LAMBDA_POSTGRES_HOST="${CONVEYMATE_AWS_LOCALSTACK_LAMBDA_POSTGRES_HOST:-host.docker.internal}"

LAMBDA_FUNCTION_NAME="${CONVEYMATE_LOCALSTACK_WORKER_FUNCTION:-conveymate-dev-reports-worker-lambda}"
BUCKET_NAME="${CONVEYMATE_LOCALSTACK_REPORTS_BUCKET:-conveymate-dev-reports-bucket}"
LAMBDA_ROLE_ARN="${CONVEYMATE_LOCALSTACK_LAMBDA_ROLE_ARN:-arn:aws:iam::000000000000:role/conveymate-local-lambda-role}"

TMP_DIR="$(mktemp -d)"
PUBLISH_DIR="${TMP_DIR}/publish"
ZIP_PATH="${TMP_DIR}/worker.zip"
ENV_JSON="${TMP_DIR}/lambda-env.json"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "Ensuring local services are running..."
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d >/dev/null

echo "Waiting for LocalStack..."
if ! wait_for_localstack_services "${LOCALSTACK_ENDPOINT}" 80 2; then
  echo "LocalStack is not healthy at ${LOCALSTACK_ENDPOINT}"
  exit 1
fi

echo "Publishing worker..."
dotnet publish "${WORKER_PROJECT}" -c Release -f net10.0 -o "${PUBLISH_DIR}" >/dev/null

(
  cd "${PUBLISH_DIR}"
  zip -q -r "${ZIP_PATH}" .
)

aws_local() {
  AWS_ACCESS_KEY_ID="${CONVEYMATE_LOCALSTACK_ACCESS_KEY_ID:-test}" \
  AWS_SECRET_ACCESS_KEY="${CONVEYMATE_LOCALSTACK_SECRET_ACCESS_KEY:-test}" \
  AWS_DEFAULT_REGION="${AWS_REGION}" \
    aws --endpoint-url "${LOCALSTACK_ENDPOINT}" "$@"
}

aws_ssm() {
  AWS_DEFAULT_REGION="${AWS_REGION}" aws "$@"
}

normalize_config_env() {
  local environment="${1:-}"
  environment="$(printf '%s' "${environment}" | tr '[:upper:]' '[:lower:]' | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"

  case "${environment}" in
    ""|local|development)
      echo "dev"
      ;;
    *)
      echo "${environment}"
      ;;
  esac
}

resolve_ssm_runtime_credentials() {
  if [[ -n "${CONVEYMATE_SSM_AWS_ACCESS_KEY_ID:-}" && -n "${CONVEYMATE_SSM_AWS_SECRET_ACCESS_KEY:-}" ]]; then
    SSM_AWS_ACCESS_KEY_ID="${CONVEYMATE_SSM_AWS_ACCESS_KEY_ID}"
    SSM_AWS_SECRET_ACCESS_KEY="${CONVEYMATE_SSM_AWS_SECRET_ACCESS_KEY}"
    SSM_AWS_SESSION_TOKEN="${CONVEYMATE_SSM_AWS_SESSION_TOKEN:-}"
    return 0
  fi

  local exported_credentials=""
  if exported_credentials="$(
    env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN -u AWS_SECURITY_TOKEN \
      AWS_DEFAULT_REGION="${AWS_REGION}" aws configure export-credentials --format env 2>/dev/null
  )"; then
    eval "${exported_credentials}"
  fi

  SSM_AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-}"
  SSM_AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-}"
  SSM_AWS_SESSION_TOKEN="${AWS_SESSION_TOKEN:-${AWS_SECURITY_TOKEN:-}}"

  if [[ -z "${SSM_AWS_ACCESS_KEY_ID}" || -z "${SSM_AWS_SECRET_ACCESS_KEY}" ]]; then
    echo "Could not resolve AWS credentials for worker runtime SSM access."
    echo "Set CONVEYMATE_SSM_AWS_ACCESS_KEY_ID / CONVEYMATE_SSM_AWS_SECRET_ACCESS_KEY or export standard AWS credentials before deploying."
    exit 1
  fi
}

ssm_get_optional() {
  local path="$1"
  aws_ssm ssm get-parameter --name "${path}" --with-decryption --query 'Parameter.Value' --output text 2>/dev/null || true
}

ssm_get_first() {
  for path in "$@"; do
    local value
    value="$(ssm_get_optional "${path}")"
    if [[ -n "${value}" && "${value}" != "None" ]]; then
      echo "${value}"
      return 0
    fi
  done
  return 1
}

SSM_CONFIG_ENV="$(normalize_config_env "${CONFIG_ENV}")"
if [[ "${SSM_CONFIG_ENV}" != "${CONFIG_ENV}" ]]; then
  echo "Normalizing worker config environment ${CONFIG_ENV} -> ${SSM_CONFIG_ENV} for SSM."
fi

echo "Validating runtime SSM parameters under /conveymate/${SSM_CONFIG_ENV}/* ..."
if ! ssm_get_first "/conveymate/${SSM_CONFIG_ENV}/database/connectionstring" >/dev/null; then
  echo "Missing required SSM parameter: /conveymate/${SSM_CONFIG_ENV}/database/connectionstring"
  exit 1
fi

if ! ssm_get_first \
  "/conveymate/${SSM_CONFIG_ENV}/grok/apiKey" \
  "/conveymate/${SSM_CONFIG_ENV}/grok/apikey" \
  "/conveymate/${SSM_CONFIG_ENV}/grok/key" >/dev/null; then
  echo "Missing required Grok API key under /conveymate/${SSM_CONFIG_ENV}/grok/*"
  exit 1
fi

resolve_ssm_runtime_credentials

cat > "${ENV_JSON}" <<EOF
{
  "Variables": {
    "AWS_REGION": "${AWS_REGION}",
    "AWS_DEFAULT_REGION": "${AWS_REGION}",
    "AWS_ACCESS_KEY_ID": "${SSM_AWS_ACCESS_KEY_ID}",
    "AWS_SECRET_ACCESS_KEY": "${SSM_AWS_SECRET_ACCESS_KEY}",
    "AWS_SESSION_TOKEN": "${SSM_AWS_SESSION_TOKEN}",
    "AWS_EC2_METADATA_DISABLED": "true",
    "CONVEYMATE_CONFIG_ENV": "${SSM_CONFIG_ENV}",
    "CONVEYMATE_AWS_USE_LOCALSTACK": "true",
    "CONVEYMATE_AWS_LOCALSTACK_URL": "${LOCALSTACK_LAMBDA_ENDPOINT}",
    "CONVEYMATE_AWS_LOCALSTACK_LAMBDA_POSTGRES_HOST": "${LOCALSTACK_LAMBDA_POSTGRES_HOST}",
    "CONVEYMATE_AWS_ACCESS_KEY_ID": "${CONVEYMATE_LOCALSTACK_ACCESS_KEY_ID:-test}",
    "CONVEYMATE_AWS_SECRET_ACCESS_KEY": "${CONVEYMATE_LOCALSTACK_SECRET_ACCESS_KEY:-test}"
  }
}
EOF

if aws_local lambda get-function --function-name "${LAMBDA_FUNCTION_NAME}" >/dev/null 2>&1; then
  echo "Updating existing LocalStack Lambda ${LAMBDA_FUNCTION_NAME}..."
  aws_local lambda update-function-code \
    --function-name "${LAMBDA_FUNCTION_NAME}" \
    --zip-file "fileb://${ZIP_PATH}" >/dev/null
  aws_local lambda wait function-updated-v2 --function-name "${LAMBDA_FUNCTION_NAME}" >/dev/null 2>&1 || true
  aws_local lambda update-function-configuration \
    --function-name "${LAMBDA_FUNCTION_NAME}" \
    --runtime dotnet8 \
    --handler "ConveyMate.ReportsWorker::ConveyMate.ReportsWorker.Function::FunctionHandler" \
    --memory-size 2048 \
    --timeout 900 \
    --role "${LAMBDA_ROLE_ARN}" \
    --environment "file://${ENV_JSON}" >/dev/null
else
  echo "Creating LocalStack Lambda ${LAMBDA_FUNCTION_NAME}..."
  aws_local lambda create-function \
    --function-name "${LAMBDA_FUNCTION_NAME}" \
    --runtime dotnet8 \
    --handler "ConveyMate.ReportsWorker::ConveyMate.ReportsWorker.Function::FunctionHandler" \
    --memory-size 2048 \
    --timeout 900 \
    --role "${LAMBDA_ROLE_ARN}" \
    --zip-file "fileb://${ZIP_PATH}" \
    --environment "file://${ENV_JSON}" >/dev/null
fi

echo "Waiting for Lambda ${LAMBDA_FUNCTION_NAME} to become Active..."
if ! aws_local lambda wait function-active-v2 --function-name "${LAMBDA_FUNCTION_NAME}" >/dev/null 2>&1; then
  # Fallback for LocalStack waiter edge-cases.
  for _ in $(seq 1 30); do
    LAMBDA_STATE="$(aws_local lambda get-function --function-name "${LAMBDA_FUNCTION_NAME}" --query 'Configuration.State' --output text 2>/dev/null || true)"
    if [[ "${LAMBDA_STATE}" == "Active" ]]; then
      break
    fi
    sleep 2
  done

  LAMBDA_STATE="$(aws_local lambda get-function --function-name "${LAMBDA_FUNCTION_NAME}" --query 'Configuration.State' --output text 2>/dev/null || true)"
  if [[ "${LAMBDA_STATE}" != "Active" ]]; then
    echo "Lambda ${LAMBDA_FUNCTION_NAME} did not become Active. Current state: ${LAMBDA_STATE:-unknown}"
    exit 1
  fi
fi

echo "LocalStack worker deployment complete."
echo "Function: ${LAMBDA_FUNCTION_NAME}"
