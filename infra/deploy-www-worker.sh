#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGION="${AWS_REGION:-ap-southeast-2}"
CORE_STACK_NAME="${CORE_STACK_NAME:-conveymate-www-core}"
STACK_NAME="${STACK_NAME:-conveymate-www-worker}"
TEMPLATE_PATH="${ROOT_DIR}/infra/cloudformation/templates/conveymate-www-worker.yml"
PARAMS_PATH="${ROOT_DIR}/infra/cloudformation/environments/www/worker-parameters.json"
WORKER_PROJECT="${ROOT_DIR}/../ConveyMate-AI/src/ConveyMate.ReportsWorker/ConveyMate.ReportsWorker.csproj"
ARTIFACT_TAG="${ARTIFACT_TAG:-$(git -C "${ROOT_DIR}" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

require_command aws
require_command jq
require_command dotnet
require_command zip

if [[ ! -f "${TEMPLATE_PATH}" ]]; then
  echo "Template not found: ${TEMPLATE_PATH}"
  exit 1
fi

if [[ ! -f "${PARAMS_PATH}" ]]; then
  echo "Parameter file not found: ${PARAMS_PATH}"
  exit 1
fi

stack_output() {
  local stack_name="$1"
  local output_key="$2"
  aws cloudformation describe-stacks \
    --region "${REGION}" \
    --stack-name "${stack_name}" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue" \
    --output text
}

ARTIFACT_BUCKET="$(stack_output "${CORE_STACK_NAME}" "DeploymentArtifactsBucketName")"
if [[ -z "${ARTIFACT_BUCKET}" || "${ARTIFACT_BUCKET}" == "None" ]]; then
  echo "Could not resolve DeploymentArtifactsBucketName from stack ${CORE_STACK_NAME}"
  exit 1
fi

TMP_DIR="$(mktemp -d)"
PUBLISH_DIR="${TMP_DIR}/publish"
ZIP_PATH="${TMP_DIR}/worker.zip"
S3_KEY="releases/www/reports-worker/${ARTIFACT_TAG}.zip"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "Publishing worker artifact ..."
dotnet publish "${WORKER_PROJECT}" \
  -c Release \
  -f net10.0 \
  -r linux-arm64 \
  --self-contained false \
  -o "${PUBLISH_DIR}" >/dev/null

(
  cd "${PUBLISH_DIR}"
  zip -q -r "${ZIP_PATH}" .
)

echo "Uploading worker artifact to s3://${ARTIFACT_BUCKET}/${S3_KEY} ..."
OBJECT_VERSION="$(aws s3api put-object \
  --region "${REGION}" \
  --bucket "${ARTIFACT_BUCKET}" \
  --key "${S3_KEY}" \
  --body "${ZIP_PATH}" \
  --query VersionId \
  --output text)"

PARAM_OVERRIDES=()
while IFS= read -r line; do
  case "${line}" in
    WorkerCodeS3Bucket=*|WorkerCodeS3Key=*|WorkerCodeS3ObjectVersion=*)
      ;;
    *)
      PARAM_OVERRIDES+=("${line}")
      ;;
  esac
done < <(jq -r '.[] | "\(.ParameterKey)=\(.ParameterValue)"' "${PARAMS_PATH}")

PARAM_OVERRIDES+=("WorkerCodeS3Bucket=${ARTIFACT_BUCKET}")
PARAM_OVERRIDES+=("WorkerCodeS3Key=${S3_KEY}")
PARAM_OVERRIDES+=("WorkerCodeS3ObjectVersion=${OBJECT_VERSION}")

aws cloudformation deploy \
  --region "${REGION}" \
  --stack-name "${STACK_NAME}" \
  --template-file "${TEMPLATE_PATH}" \
  --parameter-overrides "${PARAM_OVERRIDES[@]}" \
  --capabilities CAPABILITY_NAMED_IAM

echo "Deployed ${STACK_NAME} with worker artifact ${S3_KEY} (${OBJECT_VERSION})"
