#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGION="${AWS_REGION:-ap-southeast-2}"
PARAMS_PATH="${ROOT_DIR}/infra/cloudformation/environments/www/services-parameters.json"
DOMAIN_NAME="${DOMAIN_NAME:-$(jq -r '.[] | select(.ParameterKey == "DomainName") | .ParameterValue' "${PARAMS_PATH}" | tail -n 1)}"
WEBSITE_URL="${WEBSITE_URL:-https://${DOMAIN_NAME}}"
CONTACT_LANGUAGE="${CONTACT_LANGUAGE:-EN}"
USE_CASE_DESCRIPTION="${USE_CASE_DESCRIPTION:-ConveyMate sends transactional quote request invitations and follow-up notifications to conveyancers selected by buyers using the web application. Emails are sent only in response to user-initiated requests and contain secure links back to the platform.}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

require_command aws
require_command jq

if [[ -z "${DOMAIN_NAME}" || "${DOMAIN_NAME}" == "null" ]]; then
  echo "Could not resolve DomainName from ${PARAMS_PATH}"
  exit 1
fi

ARGS=(
  sesv2
  put-account-details
  --region "${REGION}"
  --production-access-enabled
  --mail-type TRANSACTIONAL
  --website-url "${WEBSITE_URL}"
  --contact-language "${CONTACT_LANGUAGE}"
  --use-case-description "${USE_CASE_DESCRIPTION}"
)

if [[ -n "${SES_CONTACT_EMAILS:-}" ]]; then
  IFS=',' read -r -a contact_emails <<< "${SES_CONTACT_EMAILS}"
  if [[ ${#contact_emails[@]} -gt 0 ]]; then
    ARGS+=(--additional-contact-email-addresses "${contact_emails[@]}")
  fi
fi

aws "${ARGS[@]}"

