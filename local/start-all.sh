#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_ENV_FILE="${ROOT_DIR}/local/.env"
LOCAL_ENV_EXAMPLE_FILE="${ROOT_DIR}/local/.env.example"
LOCAL_COMPOSE_FILE="${ROOT_DIR}/local/docker-compose.yml"

NODE_MIN_VERSION="24.13.1"
NPM_MIN_VERSION="11.8.0"
DOTNET_MIN_VERSION="10.0.100"
AWSCLI_MIN_MAJOR="2"

API_PID=""
API_LOG_PID=""
API_LOG_FILE=""
CLEANUP_RAN=0

NODE_VERSION=""
NPM_VERSION=""
DOTNET_VERSION=""
AWSCLI_VERSION=""
DOCKER_VERSION=""
COMPOSE_VERSION=""
CURL_VERSION=""
ZIP_VERSION=""
SKIP_BOOTSTRAP=false
CLEAN_START=false

usage() {
  cat <<'USAGE'
Usage: npm run local:start [-- --skip-bootstrap] [-- --clean]

Starts the full local stack in order:
1) bootstrap dependencies (optional)
2) local docker services
3) SSM bootstrap
4) worker deploy
5) API
6) web app
USAGE
}

print_step() {
  printf '\n==> %s\n' "$1"
}

print_info() {
  printf '    %s\n' "$1"
}

stop_and_install() {
  local label="$1"
  local requirement="$2"
  local detected="${3:-not found}"
  local download_url="$4"

  printf '\nSTOP: %s is required.\n' "${label}"
  printf 'Required: %s\n' "${requirement}"
  printf 'Detected: %s\n' "${detected}"
  printf 'Download: %s\n' "${download_url}"
  printf 'After installing, rerun: npm run local:start\n'
  exit 1
}

stop_with_message() {
  local message="$1"
  local help_url="${2:-}"

  printf '\nSTOP: %s\n' "${message}"
  if [[ -n "${help_url}" ]]; then
    printf 'More info: %s\n' "${help_url}"
  fi
  printf 'After fixing this, rerun: npm run local:start\n'
  exit 1
}

require_command() {
  local command_name="$1"
  local label="$2"
  local requirement="$3"
  local download_url="$4"

  if ! command -v "${command_name}" >/dev/null 2>&1; then
    stop_and_install "${label}" "${requirement}" "not found" "${download_url}"
  fi
}

extract_numeric_version() {
  local raw="$1"
  echo "${raw}" | sed -nE 's/^[^0-9]*([0-9]+(\.[0-9]+){0,2}).*/\1/p'
}

semver_gte() {
  local current="$1"
  local required="$2"

  local current_parts required_parts
  local length=0
  local i current_num required_num

  IFS='.' read -r -a current_parts <<< "${current}"
  IFS='.' read -r -a required_parts <<< "${required}"

  if (( ${#current_parts[@]} > length )); then
    length=${#current_parts[@]}
  fi
  if (( ${#required_parts[@]} > length )); then
    length=${#required_parts[@]}
  fi

  for (( i=0; i<length; i++ )); do
    current_num="${current_parts[$i]:-0}"
    required_num="${required_parts[$i]:-0}"

    if (( 10#${current_num} > 10#${required_num} )); then
      return 0
    fi
    if (( 10#${current_num} < 10#${required_num} )); then
      return 1
    fi
  done

  return 0
}

prefix_stream() {
  local prefix="$1"
  while IFS= read -r line; do
    printf '[%s] %s\n' "${prefix}" "${line}"
  done
}

get_port_from_url() {
  local url="$1"
  local host_port=""

  host_port="${url#*://}"
  host_port="${host_port%%/*}"

  if [[ "${host_port}" == *:* ]]; then
    printf '%s\n' "${host_port##*:}"
  fi
}

ensure_local_env_file() {
  if [[ -f "${LOCAL_ENV_FILE}" ]]; then
    return 0
  fi

  if [[ ! -f "${LOCAL_ENV_EXAMPLE_FILE}" ]]; then
    stop_with_message "Missing ${LOCAL_ENV_FILE} and ${LOCAL_ENV_EXAMPLE_FILE}. Cannot run docker compose."
  fi

  cp "${LOCAL_ENV_EXAMPLE_FILE}" "${LOCAL_ENV_FILE}"
  print_info "Created local/.env from local/.env.example"
}

docker_compose_local() {
  docker compose --env-file "${LOCAL_ENV_FILE}" -f "${LOCAL_COMPOSE_FILE}" "$@"
}

get_listening_pids() {
  local port="$1"

  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true
    return 0
  fi

  if command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "${port}" 2>/dev/null | tr ' ' '\n' | sed '/^$/d' || true
    return 0
  fi

  return 0
}

kill_listeners_on_port() {
  local port="$1"
  local service_name="$2"
  local pids=""
  local remaining=""
  local pids_arr=()
  local remaining_arr=()

  pids="$(get_listening_pids "${port}" | xargs 2>/dev/null || true)"
  if [[ -z "${pids}" ]]; then
    print_info "${service_name}: no listener found on port ${port}"
    return 0
  fi

  # shellcheck disable=SC2206
  pids_arr=(${pids})
  print_info "${service_name}: stopping pid(s) on port ${port}: ${pids}"
  kill "${pids_arr[@]}" >/dev/null 2>&1 || true
  sleep 1

  remaining="$(get_listening_pids "${port}" | xargs 2>/dev/null || true)"
  if [[ -n "${remaining}" ]]; then
    # shellcheck disable=SC2206
    remaining_arr=(${remaining})
    print_info "${service_name}: force-stopping pid(s) on port ${port}: ${remaining}"
    kill -9 "${remaining_arr[@]}" >/dev/null 2>&1 || true
    sleep 1
  fi

  remaining="$(get_listening_pids "${port}" | xargs 2>/dev/null || true)"
  if [[ -n "${remaining}" ]]; then
    stop_with_message "Could not free port ${port} for ${service_name}. Remaining pid(s): ${remaining}"
  fi
}

reset_local_containers() {
  print_step "Resetting local containers"

  ensure_local_env_file

  if docker_compose_local down --remove-orphans >/dev/null 2>&1; then
    print_info "Docker compose services stopped."
  else
    print_info "Docker compose down returned a non-zero exit code; continuing startup."
  fi
}

reset_app_processes() {
  local api_base_url="${CONVEYMATE_LOCAL_API_URL:-http://localhost:5141}"
  local api_port=""
  local web_port="${CONVEYMATE_WEB_PORT:-4200}"

  print_step "Stopping existing API/web listeners"

  api_port="$(get_port_from_url "${api_base_url}")"
  if [[ -z "${api_port}" ]]; then
    api_port="5141"
  fi

  kill_listeners_on_port "${api_port}" "API"
  kill_listeners_on_port "${web_port}" "Angular web app"
}

npm_run() {
  (
    cd "${ROOT_DIR}"
    npm run "$@"
  )
}

check_prerequisites() {
  print_step "Checking required tools and versions"

  require_command "node" "Node.js" ">= ${NODE_MIN_VERSION}" "https://nodejs.org/en/download"
  NODE_VERSION="$(extract_numeric_version "$(node -v)")"
  if [[ -z "${NODE_VERSION}" ]] || ! semver_gte "${NODE_VERSION}" "${NODE_MIN_VERSION}"; then
    stop_and_install "Node.js" ">= ${NODE_MIN_VERSION}" "${NODE_VERSION:-unknown}" "https://nodejs.org/en/download"
  fi

  require_command "npm" "npm" ">= ${NPM_MIN_VERSION}" "https://docs.npmjs.com/downloading-and-installing-node-js-and-npm"
  NPM_VERSION="$(extract_numeric_version "$(npm -v)")"
  if [[ -z "${NPM_VERSION}" ]] || ! semver_gte "${NPM_VERSION}" "${NPM_MIN_VERSION}"; then
    stop_and_install "npm" ">= ${NPM_MIN_VERSION}" "${NPM_VERSION:-unknown}" "https://docs.npmjs.com/downloading-and-installing-node-js-and-npm"
  fi

  require_command "dotnet" ".NET SDK" ">= ${DOTNET_MIN_VERSION}" "https://dotnet.microsoft.com/en-us/download/dotnet/10.0"
  DOTNET_VERSION="$(extract_numeric_version "$(dotnet --version)")"
  if [[ -z "${DOTNET_VERSION}" ]] || ! semver_gte "${DOTNET_VERSION}" "${DOTNET_MIN_VERSION}"; then
    stop_and_install ".NET SDK" ">= ${DOTNET_MIN_VERSION}" "${DOTNET_VERSION:-unknown}" "https://dotnet.microsoft.com/en-us/download/dotnet/10.0"
  fi

  require_command "docker" "Docker Desktop" "Docker with Compose support" "https://docs.docker.com/get-docker/"
  if ! docker info >/dev/null 2>&1; then
    stop_with_message "Docker is installed but the Docker daemon is not running." "https://docs.docker.com/desktop/"
  fi

  if ! docker compose version >/dev/null 2>&1; then
    stop_and_install "Docker Compose" "Docker Compose plugin" "not available" "https://docs.docker.com/compose/install/"
  fi

  require_command "aws" "AWS CLI" "AWS CLI v2" "https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
  AWSCLI_VERSION="$(extract_numeric_version "$(aws --version 2>&1)")"
  if [[ -z "${AWSCLI_VERSION}" ]]; then
    stop_and_install "AWS CLI" "AWS CLI v2" "unknown" "https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
  fi
  if (( 10#${AWSCLI_VERSION%%.*} < AWSCLI_MIN_MAJOR )); then
    stop_and_install "AWS CLI" "AWS CLI v2" "${AWSCLI_VERSION}" "https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
  fi

  if ! aws sts get-caller-identity >/dev/null 2>&1; then
    stop_with_message "AWS CLI is not authenticated for this environment." "https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-configure.html"
  fi

  require_command "curl" "curl" "curl (required by local scripts)" "https://curl.se/download.html"
  require_command "zip" "zip" "zip (required for worker deployment package)" "https://infozip.sourceforge.net/Zip.html"

  DOCKER_VERSION="$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "unknown")"
  COMPOSE_VERSION="$(extract_numeric_version "$(docker compose version 2>/dev/null || true)")"
  CURL_VERSION="$(extract_numeric_version "$(curl --version | head -n1)")"
  ZIP_VERSION="$(extract_numeric_version "$(zip --version | head -n1)")"

  print_info "Node.js ${NODE_VERSION} (required >= ${NODE_MIN_VERSION})"
  print_info "npm ${NPM_VERSION} (required >= ${NPM_MIN_VERSION})"
  print_info ".NET SDK ${DOTNET_VERSION} (required >= ${DOTNET_MIN_VERSION})"
  print_info "Docker ${DOCKER_VERSION}"
  print_info "Docker Compose ${COMPOSE_VERSION:-detected}"
  print_info "AWS CLI ${AWSCLI_VERSION} (required v2)"
  print_info "curl ${CURL_VERSION:-detected}"
  print_info "zip ${ZIP_VERSION:-detected}"
}

start_api() {
  API_LOG_FILE="$(mktemp -t conveymate-api.XXXXXX.log)"

  (
    cd "${ROOT_DIR}"
    npm run api:run > "${API_LOG_FILE}" 2>&1
  ) &
  API_PID=$!

  tail -n +1 -f "${API_LOG_FILE}" 2>/dev/null | prefix_stream "api" &
  API_LOG_PID=$!

  print_info "API process started (pid: ${API_PID})"
}

wait_for_api_health() {
  local api_base_url="${CONVEYMATE_LOCAL_API_URL:-http://localhost:5141}"
  local health_url="${api_base_url%/}/health"

  print_info "Waiting for ${health_url}"
  for _ in $(seq 1 60); do
    if curl -fsS "${health_url}" >/dev/null 2>&1; then
      print_info "API is healthy."
      return 0
    fi

    if [[ -n "${API_PID}" ]] && ! kill -0 "${API_PID}" >/dev/null 2>&1; then
      printf '    API exited before becoming healthy.\n'
      return 1
    fi

    sleep 2
  done

  printf '    API did not become healthy within 120 seconds.\n'
  return 1
}

cleanup() {
  local exit_code=$?

  if (( CLEANUP_RAN == 1 )); then
    exit "${exit_code}"
  fi
  CLEANUP_RAN=1

  trap - EXIT INT TERM

  if [[ -n "${API_LOG_PID}" ]] && kill -0 "${API_LOG_PID}" >/dev/null 2>&1; then
    kill "${API_LOG_PID}" >/dev/null 2>&1 || true
    wait "${API_LOG_PID}" 2>/dev/null || true
  fi

  if [[ -n "${API_PID}" ]] && kill -0 "${API_PID}" >/dev/null 2>&1; then
    print_info "Stopping API process..."
    kill "${API_PID}" >/dev/null 2>&1 || true
    wait "${API_PID}" 2>/dev/null || true
  fi

  if [[ -n "${API_LOG_FILE}" && -f "${API_LOG_FILE}" ]]; then
    rm -f "${API_LOG_FILE}" || true
  fi

  exit "${exit_code}"
}

trap cleanup EXIT INT TERM

for arg in "$@"; do
  case "${arg}" in
    --skip-bootstrap)
      SKIP_BOOTSTRAP=true
      ;;
    --clean)
      CLEAN_START=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "${arg}"
      usage
      exit 1
      ;;
  esac
done

main() {
  check_prerequisites
  if [[ "${CLEAN_START}" == "true" ]]; then
    reset_local_containers
  fi
  reset_app_processes

  if [[ "${SKIP_BOOTSTRAP}" == "false" ]]; then
    print_step "Bootstrapping dependencies"
    npm_run bootstrap
  else
    print_step "Skipping dependency bootstrap (--skip-bootstrap)"
  fi

  print_step "Starting local containers (Postgres + LocalStack)"
  if ! npm_run local:up; then
    print_info "local:up failed; resetting containers and retrying once..."
    reset_local_containers
    npm_run local:up
  fi

  print_step "Bootstrapping SSM parameters"
  npm_run local:ssm:bootstrap

  print_step "Deploying worker to LocalStack"
  npm_run local:worker:deploy

  print_step "Starting API"
  start_api

  print_step "Waiting for API readiness"
  wait_for_api_health

  print_step "Starting Angular web app"
  print_info "Web URL: http://localhost:4200"
  print_info "API URL: http://localhost:5141"
  print_info "Press Ctrl+C to stop the web app and API."
  (
    cd "${ROOT_DIR}"
    npm run dev:web 2>&1
  ) | prefix_stream "web"
}

main "$@"
