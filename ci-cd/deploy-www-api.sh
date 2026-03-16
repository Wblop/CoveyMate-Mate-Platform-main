#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Shared helpers keep these local deploy entrypoints thin.
source "${SCRIPT_DIR}/lib-www-deploy.sh"

IMAGE_TAG="${IMAGE_TAG:-$(default_image_tag)}"
API_DOCKERFILE_PATH="${ROOT_DIR}/infra/docker/api.Dockerfile"

require_command aws
require_command jq
require_command docker
require_file "${SERVICES_TEMPLATE_PATH}"
require_file "${SERVICES_PARAMS_PATH}"
require_file "${API_DOCKERFILE_PATH}"

API_REPOSITORY_URI="$(stack_output "${REGION}" "${CORE_STACK_NAME}" "ApiRepositoryUri")"
if [[ -z "${API_REPOSITORY_URI}" || "${API_REPOSITORY_URI}" == "None" ]]; then
  echo "Could not resolve ApiRepositoryUri from stack ${CORE_STACK_NAME}"
  exit 1
fi

REGISTRY_HOST="${API_REPOSITORY_URI%%/*}"
API_IMAGE_URI="${API_REPOSITORY_URI}:${IMAGE_TAG}"
HOSTED_ZONE_ID="$(resolve_www_hosted_zone_id)"
CLOUDFRONT_CERTIFICATE_ARN="$(resolve_www_cloudfront_certificate_arn)"

echo "Logging into ECR ${REGISTRY_HOST} ..."
docker_login_ecr "${REGISTRY_HOST}"

echo "Building API image ${API_IMAGE_URI} ..."
build_and_push_api "${API_DOCKERFILE_PATH}" "${API_IMAGE_URI}"

PARAM_OVERRIDES=()
while IFS= read -r line; do
  case "${line}" in
    ApiImageUri=*|CloudFrontCertificateArn=*|HostedZoneId=*)
      ;;
    *)
      PARAM_OVERRIDES+=("${line}")
      ;;
  esac
done < <(jq -r '.[] | "\(.ParameterKey)=\(.ParameterValue)"' "${SERVICES_PARAMS_PATH}")

PARAM_OVERRIDES+=("HostedZoneId=${HOSTED_ZONE_ID}")
PARAM_OVERRIDES+=("ApiImageUri=${API_IMAGE_URI}")
PARAM_OVERRIDES+=("CloudFrontCertificateArn=${CLOUDFRONT_CERTIFICATE_ARN}")

aws cloudformation deploy \
  --region "${REGION}" \
  --stack-name "${SERVICES_STACK_NAME}" \
  --template-file "${SERVICES_TEMPLATE_PATH}" \
  --parameter-overrides "${PARAM_OVERRIDES[@]}" \
  --capabilities CAPABILITY_NAMED_IAM

echo "Deployed ${SERVICES_STACK_NAME} with API image ${API_IMAGE_URI}"
