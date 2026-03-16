#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGION="${AWS_REGION:-ap-southeast-2}"
EDGE_REGION="${EDGE_REGION:-us-east-1}"
CORE_STACK_NAME="${CORE_STACK_NAME:-conveymate-www-core}"
EDGE_STACK_NAME="${EDGE_STACK_NAME:-conveymate-www-edge}"
STACK_NAME="${STACK_NAME:-conveymate-www-services}"
APP_FRONTEND_STACK_NAME="${APP_FRONTEND_STACK_NAME:-conveymate-www-app-frontend}"
TEMPLATE_PATH="${ROOT_DIR}/infra/cloudformation/templates/conveymate-www-services.yml"
APP_FRONTEND_TEMPLATE_PATH="${ROOT_DIR}/infra/cloudformation/templates/conveymate-www-app-frontend.yml"
EDGE_TEMPLATE_PATH="${ROOT_DIR}/infra/cloudformation/templates/conveymate-www-edge.yml"
PARAMS_PATH="${ROOT_DIR}/infra/cloudformation/environments/www/services-parameters.json"
CORE_PARAMS_PATH="${ROOT_DIR}/infra/cloudformation/environments/www/core-parameters.json"
IMAGE_TAG="${IMAGE_TAG:-$(git -C "${ROOT_DIR}" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)}"
DOCKER_PLATFORM="${DOCKER_PLATFORM:-linux/arm64}"
WEB_PROJECT_DIR="${ROOT_DIR}/apps/web"
MARKETING_WEB_BUILD_ROOT="${WEB_PROJECT_DIR}/dist/marketing-site"
APP_WEB_BUILD_ROOT="${WEB_PROJECT_DIR}/dist/app-site"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

require_command aws
require_command jq
require_command docker
require_command npm

if [[ ! -f "${TEMPLATE_PATH}" ]]; then
  echo "Template not found: ${TEMPLATE_PATH}"
  exit 1
fi

if [[ ! -f "${PARAMS_PATH}" ]]; then
  echo "Parameter file not found: ${PARAMS_PATH}"
  exit 1
fi

if [[ ! -f "${EDGE_TEMPLATE_PATH}" ]]; then
  echo "Template not found: ${EDGE_TEMPLATE_PATH}"
  exit 1
fi

if [[ ! -f "${APP_FRONTEND_TEMPLATE_PATH}" ]]; then
  echo "Template not found: ${APP_FRONTEND_TEMPLATE_PATH}"
  exit 1
fi

if [[ ! -f "${CORE_PARAMS_PATH}" ]]; then
  echo "Parameter file not found: ${CORE_PARAMS_PATH}"
  exit 1
fi

stack_output() {
  local region="$1"
  local stack_name="$2"
  local output_key="$3"
  aws cloudformation describe-stacks \
    --region "${region}" \
    --stack-name "${stack_name}" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue" \
    --output text
}

param_value() {
  local key="$1"
  jq -r --arg key "${key}" '.[] | select(.ParameterKey == $key) | .ParameterValue' "${PARAMS_PATH}" | tail -n 1
}

core_param_value() {
  local key="$1"
  jq -r --arg key "${key}" '.[] | select(.ParameterKey == $key) | .ParameterValue' "${CORE_PARAMS_PATH}" | tail -n 1
}

resolve_hosted_zone_id() {
  local domain_name="$1"
  local hosted_zone_name="${HOSTED_ZONE_NAME:-}"

  if [[ -z "${hosted_zone_name}" ]]; then
    hosted_zone_name="${domain_name#www.}"
  fi

  hosted_zone_name="${hosted_zone_name%.}."

  aws route53 list-hosted-zones-by-name \
    --dns-name "${hosted_zone_name}" \
    --query "HostedZones[?Name=='${hosted_zone_name}'] | [0].Id" \
    --output text | sed 's#/hostedzone/##'
}

docker_login_ecr() {
  local registry_host="$1"
  aws ecr get-login-password --region "${REGION}" | docker login --username AWS --password-stdin "${registry_host}" >/dev/null
}

build_and_push_api() {
  local dockerfile_path="$1"
  local image_uri="$2"

  if docker buildx version >/dev/null 2>&1; then
    docker buildx build \
      --platform "${DOCKER_PLATFORM}" \
      --provenance=false \
      --file "${dockerfile_path}" \
      --tag "${image_uri}" \
      --push \
      "${ROOT_DIR}"
    return
  fi

  docker build --file "${dockerfile_path}" --tag "${image_uri}" "${ROOT_DIR}"
  docker push "${image_uri}"
}

ensure_web_dependencies() {
  if [[ -d "${WEB_PROJECT_DIR}/node_modules" ]]; then
    return
  fi

  echo "Installing web dependencies ..."
  bash "${ROOT_DIR}/tools/scripts/with-node24.sh" npm --prefix "${WEB_PROJECT_DIR}" ci
}

build_marketing_web() {
  echo "Building marketing site assets ..."
  bash "${ROOT_DIR}/tools/scripts/with-node24.sh" npm --prefix "${WEB_PROJECT_DIR}" run build:marketing
}

build_app_web() {
  echo "Building authenticated app assets ..."
  bash "${ROOT_DIR}/tools/scripts/with-node24.sh" npm --prefix "${WEB_PROJECT_DIR}" run build:app
}

build_all_web() {
  build_marketing_web
  build_app_web
}

resolve_marketing_web_build_dir() {
  if [[ -d "${MARKETING_WEB_BUILD_ROOT}/browser" ]]; then
    echo "${MARKETING_WEB_BUILD_ROOT}/browser"
    return
  fi

  echo "${MARKETING_WEB_BUILD_ROOT}"
}

resolve_app_web_build_dir() {
  if [[ -d "${APP_WEB_BUILD_ROOT}/browser" ]]; then
    echo "${APP_WEB_BUILD_ROOT}/browser"
    return
  fi

  echo "${APP_WEB_BUILD_ROOT}"
}

resolve_web_entry_file() {
  local build_dir="$1"

  if [[ -f "${build_dir}/index.html" ]]; then
    echo "${build_dir}/index.html"
    return
  fi

  if [[ -f "${build_dir}/index.csr.html" ]]; then
    echo "${build_dir}/index.csr.html"
    return
  fi

  return 1
}

deploy_edge_stack() {
  local app_name="$1"
  local environment_name="$2"
  local domain_name="$3"
  local hosted_zone_id="$4"
  local app_domain_name="$5"
  local auth_domain_name="$6"

  local parameter_overrides=(
    "AppName=${app_name}"
    "EnvironmentName=${environment_name}"
    "DomainName=${domain_name}"
    "HostedZoneId=${hosted_zone_id}"
  )

  if [[ -n "${app_domain_name}" ]]; then
    parameter_overrides+=("AppDomainName=${app_domain_name}")
  fi

  if [[ -n "${auth_domain_name}" ]]; then
    parameter_overrides+=("AuthDomainName=${auth_domain_name}")
  fi

  aws cloudformation deploy \
    --region "${EDGE_REGION}" \
    --stack-name "${EDGE_STACK_NAME}" \
    --template-file "${EDGE_TEMPLATE_PATH}" \
    --parameter-overrides "${parameter_overrides[@]}"
}

upload_web_assets() {
  local bucket_name="$1"
  local distribution_id="$2"
  local build_dir="$3"
  local entry_file="$4"

  aws s3 sync \
    "${build_dir}/" \
    "s3://${bucket_name}/" \
    --delete \
    --cache-control "public,max-age=31536000,immutable" \
    --exclude "*.html"

  aws s3 sync \
    "${build_dir}/" \
    "s3://${bucket_name}/" \
    --delete \
    --cache-control "no-store,no-cache,must-revalidate" \
    --exclude "*" \
    --include "*.html"

  aws s3 cp \
    "${entry_file}" \
    "s3://${bucket_name}/index.html" \
    --cache-control "no-store,no-cache,must-revalidate" \
    --content-type "text/html; charset=utf-8"

  aws cloudfront create-invalidation \
    --distribution-id "${distribution_id}" \
    --paths "/*" >/dev/null
}

API_REPOSITORY_URI="$(stack_output "${REGION}" "${CORE_STACK_NAME}" "ApiRepositoryUri")"

if [[ -z "${API_REPOSITORY_URI}" || "${API_REPOSITORY_URI}" == "None" ]]; then
  echo "Could not resolve ApiRepositoryUri from stack ${CORE_STACK_NAME}"
  exit 1
fi

REGISTRY_HOST="${API_REPOSITORY_URI%%/*}"
docker_login_ecr "${REGISTRY_HOST}"

API_IMAGE_URI="${API_REPOSITORY_URI}:${IMAGE_TAG}"

APP_NAME="$(param_value "AppName")"
ENVIRONMENT_NAME="$(param_value "EnvironmentName")"
DOMAIN_NAME="$(param_value "DomainName")"
HOSTED_ZONE_ID_FROM_FILE="$(param_value "HostedZoneId")"
HOSTED_ZONE_ID="${HOSTED_ZONE_ID:-}"
AUTH_DOMAIN_NAME="$(core_param_value "HostedUiCustomDomainName")"
APP_DOMAIN_NAME="$(param_value "AppDomainName")"

if [[ -z "${HOSTED_ZONE_ID}" || "${HOSTED_ZONE_ID}" == "REPLACE_WITH_ROUTE53_HOSTED_ZONE_ID" ]]; then
  if [[ -n "${HOSTED_ZONE_ID_FROM_FILE}" && "${HOSTED_ZONE_ID_FROM_FILE}" != "REPLACE_WITH_ROUTE53_HOSTED_ZONE_ID" ]]; then
    HOSTED_ZONE_ID="${HOSTED_ZONE_ID_FROM_FILE}"
  else
    HOSTED_ZONE_ID="$(resolve_hosted_zone_id "${DOMAIN_NAME}")"
  fi
fi

if [[ -z "${HOSTED_ZONE_ID}" || "${HOSTED_ZONE_ID}" == "None" ]]; then
  echo "Could not resolve a Route53 hosted zone ID for ${DOMAIN_NAME}"
  exit 1
fi

echo "Deploying edge certificate stack ${EDGE_STACK_NAME} in ${EDGE_REGION} ..."
deploy_edge_stack "${APP_NAME}" "${ENVIRONMENT_NAME}" "${DOMAIN_NAME}" "${HOSTED_ZONE_ID}" "${APP_DOMAIN_NAME}" "${AUTH_DOMAIN_NAME}"

CLOUDFRONT_CERTIFICATE_ARN="$(stack_output "${EDGE_REGION}" "${EDGE_STACK_NAME}" "CloudFrontCertificateArn")"
if [[ -z "${CLOUDFRONT_CERTIFICATE_ARN}" || "${CLOUDFRONT_CERTIFICATE_ARN}" == "None" ]]; then
  echo "Could not resolve CloudFrontCertificateArn from stack ${EDGE_STACK_NAME}"
  exit 1
fi

APP_CLOUDFRONT_CERTIFICATE_ARN="$(stack_output "${EDGE_REGION}" "${EDGE_STACK_NAME}" "AppDomainCertificateArn")"
if [[ -z "${APP_CLOUDFRONT_CERTIFICATE_ARN}" || "${APP_CLOUDFRONT_CERTIFICATE_ARN}" == "None" ]]; then
  APP_CLOUDFRONT_CERTIFICATE_ARN="${CLOUDFRONT_CERTIFICATE_ARN}"
fi

echo "Building API image ${API_IMAGE_URI} ..."
build_and_push_api "${ROOT_DIR}/infra/docker/api.Dockerfile" "${API_IMAGE_URI}"

ensure_web_dependencies
build_all_web

PARAM_OVERRIDES=()
while IFS= read -r line; do
  case "${line}" in
    ApiImageUri=*|CloudFrontCertificateArn=*|HostedZoneId=*)
      ;;
    *)
      PARAM_OVERRIDES+=("${line}")
      ;;
  esac
done < <(jq -r '.[] | "\(.ParameterKey)=\(.ParameterValue)"' "${PARAMS_PATH}")

PARAM_OVERRIDES+=("HostedZoneId=${HOSTED_ZONE_ID}")
PARAM_OVERRIDES+=("ApiImageUri=${API_IMAGE_URI}")
PARAM_OVERRIDES+=("CloudFrontCertificateArn=${CLOUDFRONT_CERTIFICATE_ARN}")

aws cloudformation deploy \
  --region "${REGION}" \
  --stack-name "${STACK_NAME}" \
  --template-file "${TEMPLATE_PATH}" \
  --parameter-overrides "${PARAM_OVERRIDES[@]}" \
  --capabilities CAPABILITY_NAMED_IAM

WEBSITE_BUCKET_NAME="$(stack_output "${REGION}" "${STACK_NAME}" "WebsiteBucketName")"
CLOUDFRONT_DISTRIBUTION_ID="$(stack_output "${REGION}" "${STACK_NAME}" "CloudFrontDistributionId")"
ALB_DNS_NAME="$(stack_output "${REGION}" "${STACK_NAME}" "AlbDnsName")"
MARKETING_WEB_BUILD_DIR="$(resolve_marketing_web_build_dir)"
APP_WEB_BUILD_DIR="$(resolve_app_web_build_dir)"
MARKETING_WEB_ENTRY_FILE="$(resolve_web_entry_file "${MARKETING_WEB_BUILD_DIR}" || true)"

if [[ -z "${WEBSITE_BUCKET_NAME}" || "${WEBSITE_BUCKET_NAME}" == "None" ]]; then
  echo "Could not resolve WebsiteBucketName from stack ${STACK_NAME}"
  exit 1
fi

if [[ -z "${CLOUDFRONT_DISTRIBUTION_ID}" || "${CLOUDFRONT_DISTRIBUTION_ID}" == "None" ]]; then
  echo "Could not resolve CloudFrontDistributionId from stack ${STACK_NAME}"
  exit 1
fi

if [[ -z "${ALB_DNS_NAME}" || "${ALB_DNS_NAME}" == "None" ]]; then
  echo "Could not resolve AlbDnsName from stack ${STACK_NAME}"
  exit 1
fi

if [[ -z "${MARKETING_WEB_ENTRY_FILE}" ]]; then
  echo "Marketing web entry file not found in ${MARKETING_WEB_BUILD_DIR}"
  exit 1
fi

echo "Deploying frontend websites"
echo "  Marketing site build: ${MARKETING_WEB_BUILD_DIR}"
echo "  Marketing site target: conveymate.com.au -> s3://${WEBSITE_BUCKET_NAME}"
upload_web_assets "${WEBSITE_BUCKET_NAME}" "${CLOUDFRONT_DISTRIBUTION_ID}" "${MARKETING_WEB_BUILD_DIR}" "${MARKETING_WEB_ENTRY_FILE}"

if [[ -n "${APP_DOMAIN_NAME}" ]]; then
  echo "Deploying authenticated app frontend stack ${APP_FRONTEND_STACK_NAME} ..."

  aws cloudformation deploy \
    --region "${REGION}" \
    --stack-name "${APP_FRONTEND_STACK_NAME}" \
    --template-file "${APP_FRONTEND_TEMPLATE_PATH}" \
    --parameter-overrides \
      "EnvironmentName=${ENVIRONMENT_NAME}" \
      "AppName=${APP_NAME}" \
      "AppDomainName=${APP_DOMAIN_NAME}" \
      "HostedZoneId=${HOSTED_ZONE_ID}" \
      "CloudFrontCertificateArn=${APP_CLOUDFRONT_CERTIFICATE_ARN}" \
      "ApiOriginDomainName=${ALB_DNS_NAME}"

  APP_WEBSITE_BUCKET_NAME="$(stack_output "${REGION}" "${APP_FRONTEND_STACK_NAME}" "AppWebsiteBucketName")"
  APP_CLOUDFRONT_DISTRIBUTION_ID="$(stack_output "${REGION}" "${APP_FRONTEND_STACK_NAME}" "AppCloudFrontDistributionId")"

  if [[ -z "${APP_WEBSITE_BUCKET_NAME}" || "${APP_WEBSITE_BUCKET_NAME}" == "None" ]]; then
    echo "Could not resolve AppWebsiteBucketName from stack ${APP_FRONTEND_STACK_NAME}"
    exit 1
  fi

  if [[ -z "${APP_CLOUDFRONT_DISTRIBUTION_ID}" || "${APP_CLOUDFRONT_DISTRIBUTION_ID}" == "None" ]]; then
    echo "Could not resolve AppCloudFrontDistributionId from stack ${APP_FRONTEND_STACK_NAME}"
    exit 1
  fi

  APP_WEB_ENTRY_FILE="$(resolve_web_entry_file "${APP_WEB_BUILD_DIR}" || true)"

  if [[ -z "${APP_WEB_ENTRY_FILE}" ]]; then
    echo "App web entry file not found in ${APP_WEB_BUILD_DIR}"
    exit 1
  fi

  echo "  Authenticated app build: ${APP_WEB_BUILD_DIR}"
  echo "  Authenticated app target: ${APP_DOMAIN_NAME} -> s3://${APP_WEBSITE_BUCKET_NAME}"
  upload_web_assets "${APP_WEBSITE_BUCKET_NAME}" "${APP_CLOUDFRONT_DISTRIBUTION_ID}" "${APP_WEB_BUILD_DIR}" "${APP_WEB_ENTRY_FILE}"
fi

echo "Deployed ${STACK_NAME} using API image ${API_IMAGE_URI} and both frontend websites"
