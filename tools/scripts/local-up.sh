#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ROOT_DIR}/local/.env"
ENV_EXAMPLE_FILE="${ROOT_DIR}/local/.env.example"
COMPOSE_FILE="${ROOT_DIR}/local/docker-compose.yml"
# shellcheck disable=SC1091
source "${ROOT_DIR}/tools/scripts/lib/localstack-health.sh"

if [[ ! -f "${ENV_FILE}" ]]; then
  cp "${ENV_EXAMPLE_FILE}" "${ENV_FILE}"
  echo "Created ${ENV_FILE} from ${ENV_EXAMPLE_FILE}"
fi

# shellcheck disable=SC1090
set -a
source "${ENV_FILE}"
set +a

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d

LOCALSTACK_PORT="${CONVEYMATE_LOCALSTACK_PORT:-4566}"
LOCALSTACK_ENDPOINT="http://localhost:${LOCALSTACK_PORT}"

echo "Waiting for LocalStack at ${LOCALSTACK_ENDPOINT}..."
if ! wait_for_localstack_services "${LOCALSTACK_ENDPOINT}" 80 2; then
  echo "LocalStack did not become healthy in time."
  exit 1
fi

SERENA_PORT="${CONVEYMATE_SERENA_PORT:-3000}"
echo "Waiting for Serena MCP at http://localhost:${SERENA_PORT}/sse..."
SERENA_READY=false
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://localhost:${SERENA_PORT}/sse" -o /dev/null 2>/dev/null; then
    SERENA_READY=true
    break
  fi
  sleep 2
done

echo ""
echo "Local services are up."
echo ""
echo "  Postgres:  localhost:${CONVEYMATE_POSTGRES_PORT:-54329}"
echo "  LocalStack: ${LOCALSTACK_ENDPOINT}"
if [[ "${SERENA_READY}" == "true" ]]; then
  echo "  Serena MCP: http://localhost:${SERENA_PORT}/sse  ✓"
else
  echo "  Serena MCP: http://localhost:${SERENA_PORT}/sse  (still starting - retry in a few seconds)"
fi
echo "  SMTP4dev: http://localhost:${CONVEYMATE_SMTP4DEV_WEB_PORT:-8025}"
echo ""
echo "Next steps:"
echo "  1. ./scripts/local/bootstrap-ssm.sh"
echo "  2. ./tools/scripts/localstack-deploy-worker.sh"
echo "  3. ../ConveyMate-SEO/tools/scripts/localstack-deploy-seo-engine.sh"
echo "  4. npm --prefix ./apps/web run start:marketing"
echo "  5. npm --prefix ./apps/web run start:app"

echo ""
echo "MCP prerequisites:"
if command -v uvx &>/dev/null; then
  echo "  uvx:  $(uvx --version 2>/dev/null || echo 'ok')  ✓  (git + aws MCP)"
else
  echo "  uvx:  NOT FOUND  ✗  - install uv: https://docs.astral.sh/uv/getting-started/installation/"
fi
if command -v npx &>/dev/null; then
  echo "  npx:  ok  ✓  (postgres MCP)"
else
  echo "  npx:  NOT FOUND  ✗  - install Node.js 24+"
fi
echo ""
echo "Restart Claude Code to connect all MCP servers."
