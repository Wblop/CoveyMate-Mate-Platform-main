#!/usr/bin/env bash

CI_CD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${CI_CD_DIR}/.." && pwd)"
REGION="${AWS_REGION:-ap-southeast-2}"
EDGE_REGION="${EDGE_REGION:-us-east-1}"
CORE_STACK_NAME="${CORE_STACK_NAME:-conveymate-www-core}"
EDGE_STACK_NAME="${EDGE_STACK_NAME:-conveymate-www-edge}"
SERVICES_STACK_NAME="${SERVICES_STACK_NAME:-conveymate-www-services}"
APP_FRONTEND_STACK_NAME="${APP_FRONTEND_STACK_NAME:-conveymate-www-app-frontend}"
SERVICES_TEMPLATE_PATH="${ROOT_DIR}/infra/cloudformation/templates/conveymate-www-services.yml"
SERVICES_PARAMS_PATH="${ROOT_DIR}/infra/cloudformation/environments/www/services-parameters.json"
WEB_PROJECT_DIR="${ROOT_DIR}/apps/web"
MARKETING_WEB_BUILD_ROOT="${WEB_PROJECT_DIR}/dist/marketing-site"
APP_WEB_BUILD_ROOT="${WEB_PROJECT_DIR}/dist/app-site"
DOCKER_PLATFORM="${DOCKER_PLATFORM:-linux/arm64}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "Required file not found: $1"
    exit 1
  fi
}

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

  jq -r --arg key "${key}" '.[] | select(.ParameterKey == $key) | .ParameterValue' "${SERVICES_PARAMS_PATH}" | tail -n 1
}

default_image_tag() {
  local git_head

  git_head="$(git -C "${ROOT_DIR}" rev-parse --short HEAD 2>/dev/null || true)"
  if [[ -z "${git_head}" ]]; then
    date +%Y%m%d%H%M%S
    return
  fi

  if git -C "${ROOT_DIR}" diff --quiet --ignore-submodules HEAD --; then
    printf '%s\n' "${git_head}"
    return
  fi

  printf '%s-dirty-%s\n' "${git_head}" "$(date +%Y%m%d%H%M%S)"
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

resolve_www_hosted_zone_id() {
  local domain_name
  local hosted_zone_id

  domain_name="$(param_value "DomainName")"
  hosted_zone_id="${HOSTED_ZONE_ID:-}"

  if [[ -z "${hosted_zone_id}" || "${hosted_zone_id}" == "REPLACE_WITH_ROUTE53_HOSTED_ZONE_ID" ]]; then
    hosted_zone_id="$(param_value "HostedZoneId")"
  fi

  if [[ -z "${hosted_zone_id}" || "${hosted_zone_id}" == "REPLACE_WITH_ROUTE53_HOSTED_ZONE_ID" ]]; then
    hosted_zone_id="$(resolve_hosted_zone_id "${domain_name}")"
  fi

  if [[ -z "${hosted_zone_id}" || "${hosted_zone_id}" == "None" ]]; then
    echo "Could not resolve a Route53 hosted zone ID for ${domain_name}"
    exit 1
  fi

  printf '%s\n' "${hosted_zone_id}"
}

resolve_www_cloudfront_certificate_arn() {
  local certificate_arn

  certificate_arn="$(stack_output "${EDGE_REGION}" "${EDGE_STACK_NAME}" "CloudFrontCertificateArn")"
  if [[ -z "${certificate_arn}" || "${certificate_arn}" == "None" ]]; then
    echo "Could not resolve CloudFrontCertificateArn from stack ${EDGE_STACK_NAME} in ${EDGE_REGION}"
    exit 1
  fi

  printf '%s\n' "${certificate_arn}"
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
    printf '%s\n' "${MARKETING_WEB_BUILD_ROOT}/browser"
    return
  fi

  printf '%s\n' "${MARKETING_WEB_BUILD_ROOT}"
}

resolve_app_web_build_dir() {
  if [[ -d "${APP_WEB_BUILD_ROOT}/browser" ]]; then
    printf '%s\n' "${APP_WEB_BUILD_ROOT}/browser"
    return
  fi

  printf '%s\n' "${APP_WEB_BUILD_ROOT}"
}

resolve_web_entry_file() {
  local build_dir="$1"

  if [[ -f "${build_dir}/index.html" ]]; then
    printf '%s\n' "${build_dir}/index.html"
    return
  fi

  if [[ -f "${build_dir}/index.csr.html" ]]; then
    printf '%s\n' "${build_dir}/index.csr.html"
    return
  fi

  return 1
}

upload_web_assets() {
  local bucket_name="$1"
  local distribution_id="$2"
  local build_dir="$3"
  local entry_file="$4"
  local insights_manifest_file="${build_dir}/insights/latest.json"
  local sitemap_file="${build_dir}/sitemap.xml"

  aws s3 sync \
    "${build_dir}/" \
    "s3://${bucket_name}/" \
    --delete \
    --cache-control "public,max-age=31536000,immutable" \
    --exclude "insights/latest.json" \
    --exclude "sitemap.xml" \
    --exclude "insights/*/index.html" \
    --exclude "*.html"

  aws s3 sync \
    "${build_dir}/" \
    "s3://${bucket_name}/" \
    --delete \
    --cache-control "no-store,no-cache,must-revalidate" \
    --exclude "*" \
    --include "*.html" \
    --exclude "insights/*/index.html" \
    --exclude "sitemap.xml"

  seed_runtime_artifact_if_missing \
    "${bucket_name}" \
    "insights/latest.json" \
    "${insights_manifest_file}" \
    "application/json; charset=utf-8"

  seed_runtime_artifact_if_missing \
    "${bucket_name}" \
    "sitemap.xml" \
    "${sitemap_file}" \
    "application/xml; charset=utf-8"

  aws s3 cp \
    "${entry_file}" \
    "s3://${bucket_name}/index.html" \
    --cache-control "no-store,no-cache,must-revalidate" \
    --content-type "text/html; charset=utf-8"

  aws cloudfront create-invalidation \
    --distribution-id "${distribution_id}" \
    --paths "/*" >/dev/null
}

seed_runtime_artifact_if_missing() {
  local bucket_name="$1"
  local object_key="$2"
  local source_file="$3"
  local content_type="$4"

  if [[ ! -f "${source_file}" ]]; then
    return
  fi

  if aws s3api head-object --bucket "${bucket_name}" --key "${object_key}" >/dev/null 2>&1; then
    return
  fi

  aws s3 cp \
    "${source_file}" \
    "s3://${bucket_name}/${object_key}" \
    --cache-control "no-store,no-cache,must-revalidate" \
    --content-type "${content_type}"
}
