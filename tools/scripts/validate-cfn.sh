#!/usr/bin/env bash
set -euo pipefail

TEMPLATE_PATH="${1:-infra/cloudformation/templates/conveymate-core.yml}"

if ! command -v aws >/dev/null 2>&1; then
  echo "aws cli is required"
  exit 1
fi

if [[ ! -f "$TEMPLATE_PATH" ]]; then
  echo "Template not found: $TEMPLATE_PATH"
  exit 1
fi

aws cloudformation validate-template --template-body "file://${TEMPLATE_PATH}" >/dev/null
echo "CloudFormation template is valid: ${TEMPLATE_PATH}"
