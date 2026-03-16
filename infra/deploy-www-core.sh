#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGION="${AWS_REGION:-ap-southeast-2}"
EDGE_REGION="${EDGE_REGION:-us-east-1}"
STACK_NAME="${STACK_NAME:-conveymate-www-core}"
EDGE_STACK_NAME="${EDGE_STACK_NAME:-conveymate-www-edge}"
TEMPLATE_PATH="${ROOT_DIR}/infra/cloudformation/templates/conveymate-www-core.yml"
EDGE_TEMPLATE_PATH="${ROOT_DIR}/infra/cloudformation/templates/conveymate-www-edge.yml"
PARAMS_PATH="${ROOT_DIR}/infra/cloudformation/environments/www/core-parameters.json"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

require_command aws
require_command jq

if [[ ! -f "${TEMPLATE_PATH}" ]]; then
  echo "Template not found: ${TEMPLATE_PATH}"
  exit 1
fi

if [[ ! -f "${EDGE_TEMPLATE_PATH}" ]]; then
  echo "Template not found: ${EDGE_TEMPLATE_PATH}"
  exit 1
fi

if [[ ! -f "${PARAMS_PATH}" ]]; then
  echo "Parameter file not found: ${PARAMS_PATH}"
  exit 1
fi

param_value() {
  local key="$1"
  jq -r --arg key "${key}" '.[] | select(.ParameterKey == $key) | .ParameterValue' "${PARAMS_PATH}" | tail -n 1
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

resolve_hosted_zone_id() {
  local domain_name="$1"
  local hosted_zone_name="${HOSTED_ZONE_NAME:-}"

  if [[ -z "${hosted_zone_name}" ]]; then
    hosted_zone_name="${domain_name%.}."
  else
    hosted_zone_name="${hosted_zone_name%.}."
  fi

  aws route53 list-hosted-zones-by-name \
    --dns-name "${hosted_zone_name}" \
    --query "HostedZones[?Name=='${hosted_zone_name}'] | [0].Id" \
    --output text | sed 's#/hostedzone/##'
}

deploy_edge_stack() {
  local app_name="$1"
  local environment_name="$2"
  local domain_name="$3"
  local hosted_zone_id="$4"
  local auth_domain_name="$5"

  local param_overrides=(
    "AppName=${app_name}"
    "EnvironmentName=${environment_name}"
    "DomainName=${domain_name}"
    "HostedZoneId=${hosted_zone_id}"
  )

  if [[ -n "${auth_domain_name}" ]]; then
    param_overrides+=("AuthDomainName=${auth_domain_name}")
  fi

  aws cloudformation deploy \
    --region "${EDGE_REGION}" \
    --stack-name "${EDGE_STACK_NAME}" \
    --template-file "${EDGE_TEMPLATE_PATH}" \
    --parameter-overrides "${param_overrides[@]}"
}

APP_NAME="$(param_value "AppName")"
ENVIRONMENT_NAME="$(param_value "EnvironmentName")"
DOMAIN_NAME="$(param_value "DomainName")"
HOSTED_UI_CUSTOM_DOMAIN_NAME="$(param_value "HostedUiCustomDomainName")"
HOSTED_UI_CUSTOM_DOMAIN_HOSTED_ZONE_ID_FROM_FILE="$(param_value "HostedUiCustomDomainHostedZoneId")"
HOSTED_UI_CUSTOM_DOMAIN_HOSTED_ZONE_ID="${HOSTED_UI_CUSTOM_DOMAIN_HOSTED_ZONE_ID:-}"

PARAM_OVERRIDES=()
while IFS= read -r line; do
  case "${line}" in
    HostedUiCustomDomainCertificateArn=*|HostedUiCustomDomainHostedZoneId=*)
      ;;
    *)
      PARAM_OVERRIDES+=("${line}")
      ;;
  esac
done < <(jq -r '.[] | "\(.ParameterKey)=\(.ParameterValue)"' "${PARAMS_PATH}")

if [[ -n "${HOSTED_UI_CUSTOM_DOMAIN_NAME}" && "${HOSTED_UI_CUSTOM_DOMAIN_NAME}" != "null" ]]; then
  if [[ -z "${HOSTED_UI_CUSTOM_DOMAIN_HOSTED_ZONE_ID}" ]]; then
    if [[ -n "${HOSTED_UI_CUSTOM_DOMAIN_HOSTED_ZONE_ID_FROM_FILE}" && "${HOSTED_UI_CUSTOM_DOMAIN_HOSTED_ZONE_ID_FROM_FILE}" != "replace-with-hosted-ui-custom-domain-hosted-zone-id" ]]; then
      HOSTED_UI_CUSTOM_DOMAIN_HOSTED_ZONE_ID="${HOSTED_UI_CUSTOM_DOMAIN_HOSTED_ZONE_ID_FROM_FILE}"
    else
      HOSTED_UI_CUSTOM_DOMAIN_HOSTED_ZONE_ID="$(resolve_hosted_zone_id "${DOMAIN_NAME}")"
    fi
  fi

  if [[ -z "${HOSTED_UI_CUSTOM_DOMAIN_HOSTED_ZONE_ID}" || "${HOSTED_UI_CUSTOM_DOMAIN_HOSTED_ZONE_ID}" == "None" ]]; then
    echo "Could not resolve a Route53 hosted zone ID for ${HOSTED_UI_CUSTOM_DOMAIN_NAME}"
    exit 1
  fi

  echo "Deploying edge certificate stack ${EDGE_STACK_NAME} in ${EDGE_REGION} ..."
  deploy_edge_stack \
    "${APP_NAME}" \
    "${ENVIRONMENT_NAME}" \
    "${DOMAIN_NAME}" \
    "${HOSTED_UI_CUSTOM_DOMAIN_HOSTED_ZONE_ID}" \
    "${HOSTED_UI_CUSTOM_DOMAIN_NAME}"

  HOSTED_UI_CUSTOM_DOMAIN_CERTIFICATE_ARN="$(stack_output "${EDGE_REGION}" "${EDGE_STACK_NAME}" "AuthDomainCertificateArn")"
  if [[ -z "${HOSTED_UI_CUSTOM_DOMAIN_CERTIFICATE_ARN}" || "${HOSTED_UI_CUSTOM_DOMAIN_CERTIFICATE_ARN}" == "None" ]]; then
    echo "Could not resolve AuthDomainCertificateArn from stack ${EDGE_STACK_NAME}"
    exit 1
  fi

  PARAM_OVERRIDES+=("HostedUiCustomDomainHostedZoneId=${HOSTED_UI_CUSTOM_DOMAIN_HOSTED_ZONE_ID}")
  PARAM_OVERRIDES+=("HostedUiCustomDomainCertificateArn=${HOSTED_UI_CUSTOM_DOMAIN_CERTIFICATE_ARN}")
fi

aws cloudformation deploy \
  --region "${REGION}" \
  --stack-name "${STACK_NAME}" \
  --template-file "${TEMPLATE_PATH}" \
  --parameter-overrides "${PARAM_OVERRIDES[@]}" \
  --capabilities CAPABILITY_NAMED_IAM

DATABASE_NAME="$(param_value "DatabaseName")"
DATABASE_USERNAME="$(param_value "DatabaseUsername")"
DATABASE_ENDPOINT="$(stack_output "${REGION}" "${STACK_NAME}" "DatabaseEndpointAddress")"
DATABASE_SECRET_NAME="$(stack_output "${REGION}" "${STACK_NAME}" "DatabaseCredentialsSecretName")"
CONNECTION_PARAMETER_NAME="/${APP_NAME}/${ENVIRONMENT_NAME}/database/connectionstring"

if [[ -z "${DATABASE_ENDPOINT}" || "${DATABASE_ENDPOINT}" == "None" ]]; then
  echo "Could not resolve DatabaseEndpointAddress from stack ${STACK_NAME}"
  exit 1
fi

if [[ -z "${DATABASE_SECRET_NAME}" || "${DATABASE_SECRET_NAME}" == "None" ]]; then
  echo "Could not resolve DatabaseCredentialsSecretName from stack ${STACK_NAME}"
  exit 1
fi

DATABASE_PASSWORD="$(aws secretsmanager get-secret-value \
  --region "${REGION}" \
  --secret-id "${DATABASE_SECRET_NAME}" \
  --query 'SecretString' \
  --output text | jq -r '.password')"

if [[ -z "${DATABASE_PASSWORD}" || "${DATABASE_PASSWORD}" == "null" ]]; then
  echo "Could not resolve database password from secret ${DATABASE_SECRET_NAME}"
  exit 1
fi

CONNECTION_STRING="Host=${DATABASE_ENDPOINT};Port=5432;Database=${DATABASE_NAME};Username=${DATABASE_USERNAME};Password=${DATABASE_PASSWORD};SSL Mode=Require;Trust Server Certificate=true;Include Error Detail=false"

aws ssm put-parameter \
  --region "${REGION}" \
  --name "${CONNECTION_PARAMETER_NAME}" \
  --type SecureString \
  --value "${CONNECTION_STRING}" \
  --overwrite \
  --description "ConveyMate PostgreSQL connection string for the www environment" >/dev/null

echo "Updated secure SSM parameter ${CONNECTION_PARAMETER_NAME}"
