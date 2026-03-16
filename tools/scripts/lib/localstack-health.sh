#!/usr/bin/env bash

# Shared LocalStack health-check helpers for local scripts.

localstack_health_json() {
  local endpoint="$1"
  curl -fsS "${endpoint}/_localstack/health" || true
}

localstack_services_ready() {
  local health_json="$1"
  local lambda_ready=false

  if [[ "${health_json}" == *"\"lambda\": \"available\""* ]] || [[ "${health_json}" == *"\"lambda\": \"running\""* ]]; then
    lambda_ready=true
  fi

  [[ "${health_json}" == *"\"s3\": \"running\""* ]] &&
    [[ "${health_json}" == *"\"sqs\": \"running\""* ]] &&
    [[ "${lambda_ready}" == "true" ]]
}

wait_for_localstack_services() {
  local endpoint="$1"
  local attempts="${2:-80}"
  local sleep_seconds="${3:-2}"
  local health_json

  for _ in $(seq 1 "${attempts}"); do
    health_json="$(localstack_health_json "${endpoint}")"
    if localstack_services_ready "${health_json}"; then
      return 0
    fi
    sleep "${sleep_seconds}"
  done

  health_json="$(localstack_health_json "${endpoint}")"
  localstack_services_ready "${health_json}"
}
