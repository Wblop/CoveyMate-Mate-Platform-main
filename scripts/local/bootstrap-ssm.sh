#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: ./scripts/local/bootstrap-ssm.sh [--env <name>] [--region <aws-region>] [--dry-run]

Bootstraps ConveyMate SSM parameters for local development.
Reads defaults from local/.env and existing SSM values when available.

Required values (env var or existing SSM value):
  CONVEYMATE_COGNITO_USER_POOL_ID
  CONVEYMATE_COGNITO_APP_CLIENT_ID
  CONVEYMATE_STRIPE_SECRET_KEY
  CONVEYMATE_STRIPE_PUBLISHABLE_KEY
  CONVEYMATE_GROK_API_KEY

Optional values can also be provided via env vars; see script body for supported names.
  CONVEYMATE_STRIPE_WEBHOOK_SECRET (needed only for signed Stripe webhook endpoint testing)
  CONVEYMATE_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID (for frontend GA4 runtime injection)
  CONVEYMATE_PUBLIC_ENABLE_RECAPTCHA (for non-dev environments only)
  CONVEYMATE_PUBLIC_RECAPTCHA_SITE_KEY (for non-dev environments only)
  CONVEYMATE_RECAPTCHA_LEGACY_SECRET_KEY (server-side verification secret)
  CONVEYMATE_EMAIL_SMTP_HOST / PORT / ENABLE_SSL / USERNAME / PASSWORD / ENABLE_SES / TEST_ADDRESS
USAGE
}

if ! command -v aws >/dev/null 2>&1; then
  echo "aws cli is required"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ROOT_DIR}/local/.env"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "${ENV_FILE}"
  set +a
fi

APP_NAME="${CONVEYMATE_APP_NAME:-conveymate}"
CONFIG_ENV="${CONVEYMATE_CONFIG_ENV:-dev}"
REGION="${CONVEYMATE_AWS_REGION:-${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-southeast-2}}}"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      CONFIG_ENV="$2"
      shift 2
      ;;
    --region)
      REGION="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

PREFIX="/${APP_NAME}/${CONFIG_ENV}"
LOCALSTACK_PORT="${CONVEYMATE_LOCALSTACK_PORT:-4566}"
LOCALSTACK_ENDPOINT="http://localhost:${LOCALSTACK_PORT}"
BUCKET_NAME="${CONVEYMATE_LOCALSTACK_REPORTS_BUCKET:-conveymate-dev-reports-bucket}"
SEO_QUEUE_NAME="${CONVEYMATE_LOCALSTACK_SEO_QUEUE:-conveymate-dev-seo-commands}"
SEO_BUCKET_NAME="${CONVEYMATE_LOCALSTACK_SEO_BUCKET:-conveymate-dev-seo-artifacts}"

aws_ssm() {
  AWS_PAGER="" aws --region "${REGION}" "$@"
}

get_existing_value() {
  local name="$1"
  aws_ssm ssm get-parameter --name "${name}" --with-decryption --query 'Parameter.Value' --output text 2>/dev/null || true
}

coalesce() {
  local first="$1"
  local second="$2"
  local third="${3:-}"

  if [[ -n "${first}" && "${first}" != "None" ]]; then
    printf '%s' "${first}"
    return 0
  fi

  if [[ -n "${second}" && "${second}" != "None" ]]; then
    printf '%s' "${second}"
    return 0
  fi

  printf '%s' "${third}"
}

missing=0
assert_non_empty() {
  local value="$1"
  local label="$2"
  local env_name="$3"
  local path_name="$4"

  if [[ -n "${value}" && "${value}" != "None" ]]; then
    return 0
  fi

  echo "Missing required value: ${label}. Set ${env_name} or create ${path_name}."
  missing=1
}

safe_get_env() {
  local name="$1"
  printf '%s' "${!name:-}"
}

cognito_user_pool_id="$(coalesce "$(safe_get_env CONVEYMATE_COGNITO_USER_POOL_ID)" "$(get_existing_value "${PREFIX}/cognito/userpoolid")")"
cognito_app_client_id="$(coalesce "$(safe_get_env CONVEYMATE_COGNITO_APP_CLIENT_ID)" "$(coalesce "$(get_existing_value "${PREFIX}/cognito/appclientid")" "$(get_existing_value "${PREFIX}/cognito/clientid")")")"

assert_non_empty "${cognito_user_pool_id}" "Cognito user pool id" "CONVEYMATE_COGNITO_USER_POOL_ID" "${PREFIX}/cognito/userpoolid"
assert_non_empty "${cognito_app_client_id}" "Cognito app client id" "CONVEYMATE_COGNITO_APP_CLIENT_ID" "${PREFIX}/cognito/appclientid"

cognito_region="$(coalesce "$(safe_get_env CONVEYMATE_COGNITO_REGION)" "$(get_existing_value "${PREFIX}/cognito/region")" "${REGION}")"
cognito_issuer_default=""
if [[ -n "${cognito_region}" && -n "${cognito_user_pool_id}" ]]; then
  cognito_issuer_default="https://cognito-idp.${cognito_region}.amazonaws.com/${cognito_user_pool_id}"
fi
cognito_issuer="$(coalesce "$(safe_get_env CONVEYMATE_COGNITO_ISSUER)" "$(get_existing_value "${PREFIX}/cognito/issuer")" "${cognito_issuer_default}")"
cognito_scopes="$(coalesce "$(safe_get_env CONVEYMATE_COGNITO_SCOPES)" "$(get_existing_value "${PREFIX}/cognito/scopes")" "openid,email,profile")"

postgres_default="Host=localhost;Port=${CONVEYMATE_POSTGRES_PORT:-54329};Database=${CONVEYMATE_POSTGRES_DB:-conveymate};Username=${CONVEYMATE_POSTGRES_USER:-conveymate_app};Password=${CONVEYMATE_POSTGRES_PASSWORD:-conveymate_local_dev_password};SSL Mode=Disable;Include Error Detail=true"
postgres_connection_string="$(coalesce "$(safe_get_env CONVEYMATE_POSTGRES_CONNECTION_STRING)" "$(get_existing_value "${PREFIX}/database/connectionstring")" "${postgres_default}")"

stripe_secret_key="$(coalesce "$(safe_get_env CONVEYMATE_STRIPE_SECRET_KEY)" "$(coalesce "$(get_existing_value "${PREFIX}/stripe/secretkey")" "$(get_existing_value "${PREFIX}/stripe/secretKey")")")"
stripe_publishable_key="$(coalesce "$(safe_get_env CONVEYMATE_STRIPE_PUBLISHABLE_KEY)" "$(coalesce "$(get_existing_value "${PREFIX}/stripe/publishablekey")" "$(get_existing_value "${PREFIX}/stripe/publishableKey")")")"
stripe_webhook_secret="$(coalesce "$(safe_get_env CONVEYMATE_STRIPE_WEBHOOK_SECRET)" "$(coalesce "$(get_existing_value "${PREFIX}/stripe/webhooksecret")" "$(get_existing_value "${PREFIX}/stripe/webhookSecret")")")"
stripe_price_aud_cents="$(coalesce "$(safe_get_env CONVEYMATE_STRIPE_PRICE_AUD_CENTS)" "$(get_existing_value "${PREFIX}/stripe/priceaudcents")" "1999")"

assert_non_empty "${stripe_secret_key}" "Stripe secret key" "CONVEYMATE_STRIPE_SECRET_KEY" "${PREFIX}/stripe/secretkey"
assert_non_empty "${stripe_publishable_key}" "Stripe publishable key" "CONVEYMATE_STRIPE_PUBLISHABLE_KEY" "${PREFIX}/stripe/publishablekey"

grok_api_key="$(coalesce "$(safe_get_env CONVEYMATE_GROK_API_KEY)" "$(coalesce "$(get_existing_value "${PREFIX}/grok/apikey")" "$(get_existing_value "${PREFIX}/grok/api-key")")")"
assert_non_empty "${grok_api_key}" "Grok API key" "CONVEYMATE_GROK_API_KEY" "${PREFIX}/grok/apikey"

grok_api_url="$(coalesce "$(safe_get_env CONVEYMATE_GROK_API_URL)" "$(get_existing_value "${PREFIX}/grok/apiurl")" "https://api.x.ai/v1/chat/completions")"
grok_model="$(coalesce "$(safe_get_env CONVEYMATE_GROK_MODEL)" "$(get_existing_value "${PREFIX}/grok/model")" "grok-4-1-fast-reasoning")"
grok_temperature="$(coalesce "$(safe_get_env CONVEYMATE_GROK_TEMPERATURE)" "$(get_existing_value "${PREFIX}/grok/temperature")" "0.1")"
grok_web_search_enabled="$(coalesce "$(safe_get_env CONVEYMATE_GROK_WEB_SEARCH_ENABLED)" "$(get_existing_value "${PREFIX}/grok/websearchenabled")" "true")"
grok_web_search_allowed_domains="$(coalesce "$(safe_get_env CONVEYMATE_GROK_WEB_SEARCH_ALLOWED_DOMAINS)" "$(get_existing_value "${PREFIX}/grok/websearch/alloweddomains")" "abc.net.au,accesscanberra.act.gov.au,accc.gov.au,act.gov.au,adelaidenow.com.au,afr.com,anz.com.au,apra.gov.au,asic.gov.au,ato.gov.au,abs.gov.au,brisbanetimes.com.au,canberratimes.com.au,canstar.com.au,cbs.sa.gov.au,cityservices.act.gov.au,commerce.wa.gov.au,commbank.com.au,consumer.tas.gov.au,consumer.vic.gov.au,consumeraffairs.nt.gov.au,corelogic.com.au,couriermail.com.au,data.gov.au,dplh.wa.gov.au,domain.com.au,environment.act.gov.au,esa.act.gov.au,fairtrading.nsw.gov.au,heraldsun.com.au,housingaustralia.gov.au,ing.com.au,insurancecouncil.com.au,landgate.wa.gov.au,macquarie.com.au,mercury.com.au,mozo.com.au,nab.com.au,news.com.au,nsw.gov.au,nt.gov.au,ntnews.com.au,plan.sa.gov.au,planning.tas.gov.au,planning.act.gov.au,planning.vic.gov.au,planningportal.nsw.gov.au,propertycouncil.com.au,qld.gov.au,realestate.com.au,revenue.nsw.gov.au,rba.gov.au,sa.gov.au,smh.com.au,sqmresearch.com.au,sro.vic.gov.au,suncorp.com.au,tas.gov.au,theage.com.au,theaustralian.com.au,theguardian.com,titlesqld.com.au,treasury.gov.au,treasury.qld.gov.au,vic.gov.au,wa.gov.au")"
grok_management_key="$(coalesce "$(safe_get_env CONVEYMATE_GROK_MANAGEMENT_KEY)" "$(get_existing_value "${PREFIX}/grok/managementkey")")"

embeddings_provider="$(coalesce "$(safe_get_env CONVEYMATE_EMBEDDINGS_PROVIDER)" "$(get_existing_value "${PREFIX}/embeddings/provider")" "deterministic")"
embeddings_model="$(coalesce "$(safe_get_env CONVEYMATE_EMBEDDINGS_MODEL)" "$(get_existing_value "${PREFIX}/embeddings/model")" "deterministic-1536-v1")"
embeddings_api_key="$(coalesce "$(safe_get_env CONVEYMATE_EMBEDDINGS_API_KEY)" "$(coalesce "$(get_existing_value "${PREFIX}/embeddings/api-key")" "$(get_existing_value "${PREFIX}/embeddings/apikey")")" "${grok_api_key}")"
embeddings_api_url_default="${grok_api_url/chat\/completions/embeddings}"
embeddings_api_url="$(coalesce "$(safe_get_env CONVEYMATE_EMBEDDINGS_API_URL)" "$(get_existing_value "${PREFIX}/embeddings/apiurl")" "${embeddings_api_url_default}")"

default_state="$(coalesce "$(safe_get_env CONVEYMATE_DEFAULT_STATE)" "$(coalesce "$(get_existing_value "${PREFIX}/jurisdiction/defaultstate")" "$(get_existing_value "${PREFIX}/reviewpipeline/defaultstate")")" "ACT")"
collections_enabled="$(coalesce "$(safe_get_env CONVEYMATE_COLLECTIONS_ENABLED)" "$(get_existing_value "${PREFIX}/collections/enabled")" "false")"

app_base_url="$(coalesce "$(safe_get_env CONVEYMATE_APP_BASE_URL)" "$(get_existing_value "${PREFIX}/app/baseurl")" "http://localhost:4200")"
public_api_base_url="$(coalesce "$(safe_get_env CONVEYMATE_PUBLIC_API_BASE_URL)" "$(get_existing_value "${PREFIX}/publicmetadata/apibaseurl")" "http://localhost:5141")"
public_cache_ttl_seconds="$(coalesce "$(safe_get_env CONVEYMATE_PUBLIC_CACHE_TTL_SECONDS)" "$(get_existing_value "${PREFIX}/publicmetadata/cachettlseconds")" "120")"
public_google_analytics_measurement_id="$(coalesce "$(safe_get_env CONVEYMATE_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID)" "$(coalesce "$(get_existing_value "${PREFIX}/publicmetadata/googleanalyticsmeasurementid")" "$(coalesce "$(get_existing_value "${PREFIX}/publicmetadata/googleanalyticsid")" "$(get_existing_value "${PREFIX}/publicmetadata/ga4measurementid")")")")"
public_enable_recaptcha="$(coalesce "$(safe_get_env CONVEYMATE_PUBLIC_ENABLE_RECAPTCHA)" "$(get_existing_value "${PREFIX}/publicmetadata/enablerecaptcha")" "false")"
public_recaptcha_site_key="$(coalesce "$(safe_get_env CONVEYMATE_PUBLIC_RECAPTCHA_SITE_KEY)" "$(get_existing_value "${PREFIX}/publicmetadata/recaptchasitekey")")"
recaptcha_legacy_secret_key="$(coalesce "$(safe_get_env CONVEYMATE_RECAPTCHA_LEGACY_SECRET_KEY)" "$(get_existing_value "${PREFIX}/recaptcha/legacysecretkey")")"
recaptcha_minimum_score="$(coalesce "$(safe_get_env CONVEYMATE_RECAPTCHA_MINIMUM_SCORE)" "$(get_existing_value "${PREFIX}/recaptcha/minimumscore")" "0.5")"
cors_allowed_origins="$(coalesce "$(safe_get_env CONVEYMATE_CORS_ALLOWED_ORIGINS)" "$(get_existing_value "${PREFIX}/cors/allowedorigins")" "http://localhost:4200")"
seo_engine_enabled="$(coalesce "$(safe_get_env CONVEYMATE_SEO_ENGINE_ENABLED)" "$(get_existing_value "${PREFIX}/seo-engine/enabled")" "true")"
seo_engine_name="$(coalesce "$(safe_get_env CONVEYMATE_SEO_ENGINE_NAME)" "$(get_existing_value "${PREFIX}/seo-engine/enginename")" "SEO Engine")"
seo_engine_command_queue_url_default="${LOCALSTACK_ENDPOINT}/000000000000/${SEO_QUEUE_NAME}"
seo_engine_command_queue_url="$(coalesce "$(safe_get_env CONVEYMATE_SEO_ENGINE_COMMAND_QUEUE_URL)" "$(get_existing_value "${PREFIX}/seo-engine/commandqueueurl")" "${seo_engine_command_queue_url_default}")"
seo_engine_command_queue_region="$(coalesce "$(safe_get_env CONVEYMATE_SEO_ENGINE_COMMAND_QUEUE_REGION)" "$(get_existing_value "${PREFIX}/seo-engine/commandqueueregion")" "${REGION}")"
seo_engine_marketing_host="$(coalesce "$(safe_get_env CONVEYMATE_SEO_ENGINE_MARKETING_HOST)" "$(get_existing_value "${PREFIX}/seo-engine/marketinghost")" "conveymate.com.au")"
seo_engine_app_host="$(coalesce "$(safe_get_env CONVEYMATE_SEO_ENGINE_APP_HOST)" "$(get_existing_value "${PREFIX}/seo-engine/apphost")" "app.conveymate.com.au")"

SEO_PREFIX="/conveymate-seo/${CONFIG_ENV}"
seo_marketing_base_url="$(coalesce "$(safe_get_env CONVEYMATE_SEO_MARKETING_BASE_URL)" "$(get_existing_value "${SEO_PREFIX}/seoengine/marketingbaseurl")" "http://localhost:4200")"
seo_app_base_url="$(coalesce "$(safe_get_env CONVEYMATE_SEO_APP_BASE_URL)" "$(get_existing_value "${SEO_PREFIX}/seoengine/appbaseurl")" "http://localhost:4201")"
seo_artifacts_bucket_name="$(coalesce "$(safe_get_env CONVEYMATE_SEO_ARTIFACTS_BUCKET_NAME)" "$(get_existing_value "${SEO_PREFIX}/publishing/artifactsbucketname")" "${SEO_BUCKET_NAME}")"
seo_artifacts_prefix="$(coalesce "$(safe_get_env CONVEYMATE_SEO_ARTIFACTS_PREFIX)" "$(get_existing_value "${SEO_PREFIX}/publishing/artifactsprefix")" "insights")"
seo_commands_queue_url="$(coalesce "$(safe_get_env CONVEYMATE_SEO_COMMANDS_QUEUE_URL)" "$(get_existing_value "${SEO_PREFIX}/sqs/commandsqueueurl")" "${seo_engine_command_queue_url_default}")"
seo_database_connection_string="$(coalesce "$(safe_get_env CONVEYMATE_SEO_DATABASE_CONNECTION_STRING)" "$(get_existing_value "${SEO_PREFIX}/database/connectionstring")" "${postgres_connection_string}")"
seo_insights_max_sources_per_article="$(coalesce "$(safe_get_env CONVEYMATE_SEO_INSIGHTS_MAX_SOURCES_PER_ARTICLE)" "$(get_existing_value "${SEO_PREFIX}/insights/maxsourcesperarticle")" "5")"
seo_insights_max_tags="$(coalesce "$(safe_get_env CONVEYMATE_SEO_INSIGHTS_MAX_TAGS)" "$(get_existing_value "${SEO_PREFIX}/insights/maxtags")" "6")"
seo_insights_max_keywords="$(coalesce "$(safe_get_env CONVEYMATE_SEO_INSIGHTS_MAX_KEYWORDS)" "$(get_existing_value "${SEO_PREFIX}/insights/maxkeywords")" "12")"
seo_insights_publisher_name="$(coalesce "$(safe_get_env CONVEYMATE_SEO_INSIGHTS_PUBLISHER_NAME)" "$(get_existing_value "${SEO_PREFIX}/insights/publishername")" "ConveyMate")"

quote_request_email_mode_default="log"
quote_request_email_from_email_default="quotes@conveymate.local"
email_smtp_host_default="localhost"
email_smtp_port_default="${CONVEYMATE_SMTP4DEV_SMTP_PORT:-2525}"
email_smtp_enable_ssl_default="false"
email_smtp_enable_ses_default="false"
if [[ "${CONFIG_ENV}" == "dev" ]]; then
  quote_request_email_mode_default="smtp"
fi

quote_request_email_mode="$(coalesce "$(safe_get_env CONVEYMATE_QUOTE_REQUEST_EMAIL_MODE)" "$(get_existing_value "${PREFIX}/quoterequestemail/mode")" "${quote_request_email_mode_default}")"
quote_request_email_from_name="$(coalesce "$(safe_get_env CONVEYMATE_QUOTE_REQUEST_EMAIL_FROM_NAME)" "$(get_existing_value "${PREFIX}/quoterequestemail/fromname")" "ConveyMate Quotes")"
quote_request_email_from_email="$(coalesce "$(safe_get_env CONVEYMATE_QUOTE_REQUEST_EMAIL_FROM_EMAIL)" "$(get_existing_value "${PREFIX}/quoterequestemail/fromemail")" "${quote_request_email_from_email_default}")"
quote_request_email_request_expiry_hours="$(coalesce "$(safe_get_env CONVEYMATE_QUOTE_REQUEST_EMAIL_REQUEST_EXPIRY_HOURS)" "$(get_existing_value "${PREFIX}/quoterequestemail/requestexpiryhours")" "72")"

email_smtp_host="$(coalesce "$(safe_get_env CONVEYMATE_EMAIL_SMTP_HOST)" "$(get_existing_value "${PREFIX}/email/smtp/host")" "${email_smtp_host_default}")"
email_smtp_port="$(coalesce "$(safe_get_env CONVEYMATE_EMAIL_SMTP_PORT)" "$(get_existing_value "${PREFIX}/email/smtp/port")" "${email_smtp_port_default}")"
email_smtp_enable_ssl="$(coalesce "$(safe_get_env CONVEYMATE_EMAIL_SMTP_ENABLE_SSL)" "$(get_existing_value "${PREFIX}/email/smtp/enablessl")" "${email_smtp_enable_ssl_default}")"
email_smtp_username="$(coalesce "$(safe_get_env CONVEYMATE_EMAIL_SMTP_USERNAME)" "$(get_existing_value "${PREFIX}/email/smtp/username")")"
email_smtp_password="$(coalesce "$(safe_get_env CONVEYMATE_EMAIL_SMTP_PASSWORD)" "$(get_existing_value "${PREFIX}/email/smtp/password")")"
email_smtp_enable_ses="$(coalesce "$(safe_get_env CONVEYMATE_EMAIL_SMTP_ENABLE_SES)" "$(get_existing_value "${PREFIX}/email/smtp/enableses")" "${email_smtp_enable_ses_default}")"
email_smtp_test_address="$(coalesce "$(safe_get_env CONVEYMATE_EMAIL_SMTP_TEST_ADDRESS)" "$(get_existing_value "${PREFIX}/email/smtp/testaddress")" "daimenrees@hotmail.com")"

if [[ "${CONFIG_ENV}" == "dev" ]]; then
  public_enable_recaptcha="false"
  public_recaptcha_site_key=""
  recaptcha_legacy_secret_key=""
fi

reports_bucket_name="$(coalesce "$(safe_get_env CONVEYMATE_REPORTS_BUCKET_NAME)" "$(get_existing_value "${PREFIX}/s3/reportsbucketname")" "${BUCKET_NAME}")"
textract_enabled="$(coalesce "$(safe_get_env CONVEYMATE_TEXTRACT_ENABLED)" "$(get_existing_value "${PREFIX}/textract/enabled")" "false")"

if [[ "${missing}" -ne 0 ]]; then
  echo ""
  echo "Resolve missing values and run again."
  exit 1
fi

PARAM_NAMES=()
PARAM_TYPES=()
PARAM_VALUES=()

add_param() {
  PARAM_NAMES+=("$1")
  PARAM_TYPES+=("$2")
  PARAM_VALUES+=("$3")
}

add_param "${PREFIX}/cognito/userpoolid" "String" "${cognito_user_pool_id}"
add_param "${PREFIX}/cognito/appclientid" "String" "${cognito_app_client_id}"
add_param "${PREFIX}/cognito/clientid" "String" "${cognito_app_client_id}"
add_param "${PREFIX}/cognito/region" "String" "${cognito_region}"
add_param "${PREFIX}/cognito/issuer" "String" "${cognito_issuer}"
add_param "${PREFIX}/cognito/scopes" "String" "${cognito_scopes}"

add_param "${PREFIX}/database/connectionstring" "SecureString" "${postgres_connection_string}"

add_param "${PREFIX}/publicmetadata/apibaseurl" "String" "${public_api_base_url}"
add_param "${PREFIX}/publicmetadata/cachettlseconds" "String" "${public_cache_ttl_seconds}"
if [[ -n "${public_google_analytics_measurement_id}" && "${public_google_analytics_measurement_id}" != "None" ]]; then
  add_param "${PREFIX}/publicmetadata/googleanalyticsmeasurementid" "String" "${public_google_analytics_measurement_id}"
fi
add_param "${PREFIX}/publicmetadata/enablerecaptcha" "String" "${public_enable_recaptcha}"
add_param "${PREFIX}/publicmetadata/recaptchasitekey" "String" "${public_recaptcha_site_key}"
add_param "${PREFIX}/cors/allowedorigins" "String" "${cors_allowed_origins}"
add_param "${PREFIX}/recaptcha/minimumscore" "String" "${recaptcha_minimum_score}"
if [[ -n "${recaptcha_legacy_secret_key}" && "${recaptcha_legacy_secret_key}" != "None" ]]; then
  add_param "${PREFIX}/recaptcha/legacysecretkey" "SecureString" "${recaptcha_legacy_secret_key}"
fi

add_param "${PREFIX}/stripe/secretkey" "SecureString" "${stripe_secret_key}"
add_param "${PREFIX}/stripe/publishablekey" "String" "${stripe_publishable_key}"
if [[ -n "${stripe_webhook_secret}" && "${stripe_webhook_secret}" != "None" ]]; then
  add_param "${PREFIX}/stripe/webhooksecret" "SecureString" "${stripe_webhook_secret}"
else
  echo "Note: Stripe webhook secret not set; /api/webhooks/stripe signature validation will fail until configured."
fi
add_param "${PREFIX}/stripe/priceaudcents" "String" "${stripe_price_aud_cents}"

add_param "${PREFIX}/grok/apikey" "SecureString" "${grok_api_key}"
add_param "${PREFIX}/grok/apiurl" "String" "${grok_api_url}"
add_param "${PREFIX}/grok/model" "String" "${grok_model}"
add_param "${PREFIX}/grok/temperature" "String" "${grok_temperature}"
add_param "${PREFIX}/grok/websearchenabled" "String" "${grok_web_search_enabled}"
add_param "${PREFIX}/grok/websearch/alloweddomains" "String" "${grok_web_search_allowed_domains}"
if [[ -n "${grok_management_key}" && "${grok_management_key}" != "None" ]]; then
  add_param "${PREFIX}/grok/managementkey" "SecureString" "${grok_management_key}"
fi

if [[ -n "${CONVEYMATE_GROK_COLLECTION_AU_COMMON:-}" ]]; then
  add_param "${PREFIX}/grok/collections/au-common" "String" "${CONVEYMATE_GROK_COLLECTION_AU_COMMON}"
fi

if [[ -n "${CONVEYMATE_GROK_COLLECTION_AU_ACT:-}" ]]; then
  add_param "${PREFIX}/grok/collections/au-act" "String" "${CONVEYMATE_GROK_COLLECTION_AU_ACT}"
fi

add_param "${PREFIX}/embeddings/provider" "String" "${embeddings_provider}"
add_param "${PREFIX}/embeddings/model" "String" "${embeddings_model}"
add_param "${PREFIX}/embeddings/api-key" "SecureString" "${embeddings_api_key}"
add_param "${PREFIX}/embeddings/apiurl" "String" "${embeddings_api_url}"

add_param "${PREFIX}/collections/enabled" "String" "${collections_enabled}"
add_param "${PREFIX}/jurisdiction/defaultstate" "String" "${default_state}"

add_param "${PREFIX}/app/baseurl" "String" "${app_base_url}"
add_param "${PREFIX}/seo-engine/enabled" "String" "${seo_engine_enabled}"
add_param "${PREFIX}/seo-engine/enginename" "String" "${seo_engine_name}"
add_param "${PREFIX}/seo-engine/commandqueueurl" "String" "${seo_engine_command_queue_url}"
add_param "${PREFIX}/seo-engine/commandqueueregion" "String" "${seo_engine_command_queue_region}"
add_param "${PREFIX}/seo-engine/marketinghost" "String" "${seo_engine_marketing_host}"
add_param "${PREFIX}/seo-engine/apphost" "String" "${seo_engine_app_host}"
add_param "${PREFIX}/s3/reportsbucketname" "String" "${reports_bucket_name}"
add_param "${PREFIX}/textract/enabled" "String" "${textract_enabled}"
add_param "${PREFIX}/quoterequestemail/mode" "String" "${quote_request_email_mode}"
add_param "${PREFIX}/quoterequestemail/fromname" "String" "${quote_request_email_from_name}"
add_param "${PREFIX}/quoterequestemail/fromemail" "String" "${quote_request_email_from_email}"
add_param "${PREFIX}/quoterequestemail/requestexpiryhours" "String" "${quote_request_email_request_expiry_hours}"
add_param "${PREFIX}/email/smtp/host" "String" "${email_smtp_host}"
add_param "${PREFIX}/email/smtp/port" "String" "${email_smtp_port}"
add_param "${PREFIX}/email/smtp/enablessl" "String" "${email_smtp_enable_ssl}"
add_param "${PREFIX}/email/smtp/enableses" "String" "${email_smtp_enable_ses}"
add_param "${PREFIX}/email/smtp/testaddress" "String" "${email_smtp_test_address}"
if [[ -n "${email_smtp_username}" && "${email_smtp_username}" != "None" ]]; then
  add_param "${PREFIX}/email/smtp/username" "String" "${email_smtp_username}"
fi
if [[ -n "${email_smtp_password}" && "${email_smtp_password}" != "None" ]]; then
  add_param "${PREFIX}/email/smtp/password" "SecureString" "${email_smtp_password}"
fi

add_param "${SEO_PREFIX}/publishing/artifactsbucketname" "String" "${seo_artifacts_bucket_name}"
add_param "${SEO_PREFIX}/publishing/artifactsprefix" "String" "${seo_artifacts_prefix}"
add_param "${SEO_PREFIX}/database/connectionstring" "SecureString" "${seo_database_connection_string}"
add_param "${SEO_PREFIX}/sqs/commandsqueueurl" "String" "${seo_commands_queue_url}"
add_param "${SEO_PREFIX}/seoengine/marketingbaseurl" "String" "${seo_marketing_base_url}"
add_param "${SEO_PREFIX}/seoengine/appbaseurl" "String" "${seo_app_base_url}"
add_param "${SEO_PREFIX}/insights/maxsourcesperarticle" "String" "${seo_insights_max_sources_per_article}"
add_param "${SEO_PREFIX}/insights/maxtags" "String" "${seo_insights_max_tags}"
add_param "${SEO_PREFIX}/insights/maxkeywords" "String" "${seo_insights_max_keywords}"
add_param "${SEO_PREFIX}/insights/publishername" "String" "${seo_insights_publisher_name}"
add_param "${SEO_PREFIX}/grok/apikey" "SecureString" "${grok_api_key}"
add_param "${SEO_PREFIX}/grok/apiurl" "String" "${grok_api_url}"
add_param "${SEO_PREFIX}/grok/model" "String" "${grok_model}"
add_param "${SEO_PREFIX}/grok/temperature" "String" "${grok_temperature}"
add_param "${SEO_PREFIX}/grok/websearchenabled" "String" "${grok_web_search_enabled}"
add_param "${SEO_PREFIX}/grok/websearch/alloweddomains" "String" "${grok_web_search_allowed_domains}"
if [[ -n "${grok_management_key}" && "${grok_management_key}" != "None" ]]; then
  add_param "${SEO_PREFIX}/grok/managementkey" "SecureString" "${grok_management_key}"
fi

echo "Bootstrapping SSM parameters under ${PREFIX} in region ${REGION}"

for idx in "${!PARAM_NAMES[@]}"; do
  name="${PARAM_NAMES[$idx]}"
  type="${PARAM_TYPES[$idx]}"
  value="${PARAM_VALUES[$idx]}"

  if [[ "${DRY_RUN}" -eq 1 ]]; then
    echo "DRY-RUN put ${name} (${type})"
    continue
  fi

  aws_ssm ssm put-parameter \
    --name "${name}" \
    --type "${type}" \
    --value "${value}" \
    --overwrite >/dev/null

done

echo ""
if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo "Dry run complete. No changes were written."
else
  echo "SSM bootstrap complete."
fi

echo ""
echo "Parameters in scope:"
echo "  aws --region ${REGION} ssm get-parameters-by-path --path ${PREFIX} --recursive --query 'Parameters[].Name' --output text"

if [[ "${DRY_RUN}" -eq 0 ]]; then
  aws_ssm ssm get-parameters-by-path \
    --path "${PREFIX}" \
    --recursive \
    --query 'Parameters[].Name' \
    --output text
fi
