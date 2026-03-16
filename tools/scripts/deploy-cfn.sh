#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${1:-dev}"
STACK_NAME="${2:-conveymate-core-${ENVIRONMENT}}"
TEMPLATE_PATH="${3:-infra/cloudformation/templates/conveymate-core.yml}"
PARAMS_PATH="${4:-infra/cloudformation/environments/${ENVIRONMENT}/parameters.json}"
REGION="${AWS_REGION:-ap-southeast-2}"

if ! command -v aws >/dev/null 2>&1; then
  echo "aws cli is required"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required"
  exit 1
fi

if [[ ! -f "$PARAMS_PATH" ]]; then
  echo "Missing parameter file: $PARAMS_PATH"
  exit 1
fi

if [[ ! -f "$TEMPLATE_PATH" ]]; then
  echo "Template not found: $TEMPLATE_PATH"
  exit 1
fi

# Build parameter overrides as a proper argv array so each key/value is passed separately.
PARAM_OVERRIDES=()
while IFS= read -r line; do
  PARAM_OVERRIDES+=("$line")
done < <(jq -r '.[] | "\(.ParameterKey)=\(.ParameterValue)"' "$PARAMS_PATH")

aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --template-file "$TEMPLATE_PATH" \
  --parameter-overrides "${PARAM_OVERRIDES[@]}" \
  --capabilities CAPABILITY_NAMED_IAM

echo "Deployed stack $STACK_NAME to $REGION using template $TEMPLATE_PATH"
