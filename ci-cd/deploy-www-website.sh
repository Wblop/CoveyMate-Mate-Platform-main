#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib-www-deploy.sh"

require_command aws
require_command npm

WEBSITE_BUCKET_NAME="$(stack_output "${REGION}" "${SERVICES_STACK_NAME}" "WebsiteBucketName")"
CLOUDFRONT_DISTRIBUTION_ID="$(stack_output "${REGION}" "${SERVICES_STACK_NAME}" "CloudFrontDistributionId")"
APP_WEBSITE_BUCKET_NAME="$(stack_output "${REGION}" "${APP_FRONTEND_STACK_NAME}" "AppWebsiteBucketName" 2>/dev/null || true)"
APP_CLOUDFRONT_DISTRIBUTION_ID="$(stack_output "${REGION}" "${APP_FRONTEND_STACK_NAME}" "AppCloudFrontDistributionId" 2>/dev/null || true)"

if [[ -z "${WEBSITE_BUCKET_NAME}" || "${WEBSITE_BUCKET_NAME}" == "None" ]]; then
  echo "Could not resolve WebsiteBucketName from stack ${SERVICES_STACK_NAME}"
  exit 1
fi

if [[ -z "${CLOUDFRONT_DISTRIBUTION_ID}" || "${CLOUDFRONT_DISTRIBUTION_ID}" == "None" ]]; then
  echo "Could not resolve CloudFrontDistributionId from stack ${SERVICES_STACK_NAME}"
  exit 1
fi

ensure_web_dependencies
build_all_web

MARKETING_WEB_BUILD_DIR="$(resolve_marketing_web_build_dir)"
APP_WEB_BUILD_DIR="$(resolve_app_web_build_dir)"
MARKETING_WEB_ENTRY_FILE="$(resolve_web_entry_file "${MARKETING_WEB_BUILD_DIR}" || true)"

if [[ -z "${MARKETING_WEB_ENTRY_FILE}" ]]; then
  echo "Marketing web entry file not found in ${MARKETING_WEB_BUILD_DIR}"
  exit 1
fi

echo "Deploying frontend websites"
echo "  Marketing site build: ${MARKETING_WEB_BUILD_DIR}"
echo "  Marketing site target: conveymate.com.au -> s3://${WEBSITE_BUCKET_NAME}"
upload_web_assets "${WEBSITE_BUCKET_NAME}" "${CLOUDFRONT_DISTRIBUTION_ID}" "${MARKETING_WEB_BUILD_DIR}" "${MARKETING_WEB_ENTRY_FILE}"

if [[ -n "${APP_WEBSITE_BUCKET_NAME}" && "${APP_WEBSITE_BUCKET_NAME}" != "None" && -n "${APP_CLOUDFRONT_DISTRIBUTION_ID}" && "${APP_CLOUDFRONT_DISTRIBUTION_ID}" != "None" ]]; then
  APP_WEB_ENTRY_FILE="$(resolve_web_entry_file "${APP_WEB_BUILD_DIR}" || true)"

  if [[ -z "${APP_WEB_ENTRY_FILE}" ]]; then
    echo "App web entry file not found in ${APP_WEB_BUILD_DIR}"
    exit 1
  fi

  echo "  Authenticated app build: ${APP_WEB_BUILD_DIR}"
  echo "  Authenticated app target: app.conveymate.com.au -> s3://${APP_WEBSITE_BUCKET_NAME}"
  upload_web_assets "${APP_WEBSITE_BUCKET_NAME}" "${APP_CLOUDFRONT_DISTRIBUTION_ID}" "${APP_WEB_BUILD_DIR}" "${APP_WEB_ENTRY_FILE}"
else
  echo "  Authenticated app: skipped (app frontend stack output not found)"
fi

echo "Completed deployment for both frontend websites"
