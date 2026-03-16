#!/usr/bin/env bash
set -euo pipefail

REGION="${CONVEYMATE_AWS_REGION:-ap-southeast-2}"
BUCKET_NAME="${CONVEYMATE_LOCALSTACK_REPORTS_BUCKET:-conveymate-dev-reports-bucket}"

echo "[conveymate-localstack] Bootstrapping resources in region ${REGION}"

if ! awslocal s3api head-bucket --bucket "${BUCKET_NAME}" >/dev/null 2>&1; then
  if [[ "${REGION}" == "us-east-1" ]]; then
    awslocal s3api create-bucket --bucket "${BUCKET_NAME}" >/dev/null
  else
    awslocal s3api create-bucket \
      --bucket "${BUCKET_NAME}" \
      --create-bucket-configuration "LocationConstraint=${REGION}" >/dev/null
  fi
fi

awslocal s3api put-bucket-versioning \
  --bucket "${BUCKET_NAME}" \
  --versioning-configuration Status=Enabled >/dev/null

awslocal s3api put-bucket-encryption \
  --bucket "${BUCKET_NAME}" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' >/dev/null

awslocal s3api put-bucket-cors \
  --bucket "${BUCKET_NAME}" \
  --cors-configuration '{
    "CORSRules": [
      {
        "AllowedOrigins": ["http://localhost:*", "http://127.0.0.1:*"],
        "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
        "AllowedHeaders": ["*"],
        "ExposeHeaders": ["ETag", "x-amz-request-id", "x-amz-id-2"],
        "MaxAgeSeconds": 3000
      }
    ]
  }' >/dev/null

echo "[conveymate-localstack] Bucket=${BUCKET_NAME}"
