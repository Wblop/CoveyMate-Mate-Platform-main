# Deployment

## What exists in this repo

CloudFormation templates and scripts are present for:

- Core stack: `infra/cloudformation/templates/conveymate-core.yml`
- Cognito stack: `infra/cloudformation/templates/conveymate-cognito.yml`
- Reports pipeline stack: `infra/cloudformation/templates/conveymate-reports-pipeline.yml`
- WWW core stack: `infra/cloudformation/templates/conveymate-www-core.yml`
- WWW edge stack: `infra/cloudformation/templates/conveymate-www-edge.yml`
- WWW services stack: `infra/cloudformation/templates/conveymate-www-services.yml`
- WWW worker stack: `infra/cloudformation/templates/conveymate-www-worker.yml`
- Admin IAM stack: `infra/cloudformation/templates/admin/iam-web-ops-group.yml`

## Prerequisites

- AWS CLI v2
- `jq`
- CloudFormation deploy permissions (`CAPABILITY_NAMED_IAM`)
- Packaged worker artifact in S3 for pipeline deployments

## Validate templates

```bash
npm run infra:cfn:validate
npm run infra:cfn:validate:cognito
npm run infra:cfn:validate:admin-stack
```

## Deploy core and Cognito stacks

```bash
npm run infra:cfn:deploy:dev
npm run infra:cfn:deploy:staging
npm run infra:cfn:deploy:prod

npm run infra:cfn:deploy:cognito:dev
npm run infra:cfn:deploy:cognito:staging
npm run infra:cfn:deploy:cognito:prod
```

## Deploy the www environment

Deploy order:

1. `bash infra/deploy-www-core.sh`
2. `bash infra/deploy-www-services.sh`
3. `bash infra/deploy-www-worker.sh`

Notes:

- `infra/deploy-www-core.sh` provisions shared network, NAT instance, ECS cluster, ECR repos, Cognito, RDS, and the shared deployment artifacts bucket.
- `infra/deploy-www-services.sh` deploys the CloudFront certificate stack in `us-east-1`, builds and pushes the API image, builds the Angular web app, uploads static assets to the website bucket, invalidates CloudFront, and deploys ALB + ECS + CloudFront + runtime SSM parameters.
- `infra/deploy-www-worker.sh` publishes the Lambda zip to the shared artifacts bucket and deploys the reports pipeline stack.
- Update `infra/cloudformation/environments/www/services-parameters.json` if the hosted zone cannot be auto-resolved.
- The public web URL is `https://conveymate.com.au`.
- The `www` stack intentionally uses a single NAT instance, single RDS instance, and a single ECS task to keep fixed cost down.

## Power the www environment off and on

```bash
npm run www:off
npm run www:on
```

What `www:off` does:

- Replaces the public S3/CloudFront website with a static maintenance page.
- Sets Lambda reserved concurrency to `0`.
- Scales the ECS API service down to `0`.
- Stops the PostgreSQL RDS instance.
- Stops the NAT EC2 instance.

What `www:on` does:

- Starts the NAT instance, RDS instance, ECS service, and reports worker back up.
- Rebuilds the Angular SPA and republishes the live website over the maintenance page.

What it does not stop:

- ALB, CloudFront, S3/ECR storage, Route53, Cognito, CloudWatch, and public IPv4/EIP charges remain.
- The stopped RDS instance will auto-start after 7 days, so rerun `npm run www:off` if needed.

## Deploy reports pipeline stack

```bash
bash tools/scripts/deploy-cfn.sh \
  dev \
  conveymate-reports-pipeline-dev \
  infra/cloudformation/templates/conveymate-reports-pipeline.yml \
  infra/cloudformation/environments/dev/reports-pipeline-parameters.json
```

## Deploy admin IAM stack

```bash
npm run infra:cfn:deploy:admin-stack
```

## Post-deploy checks

```bash
aws ssm get-parameters-by-path --path /conveymate/dev --recursive --with-decryption
aws cloudformation describe-stacks --stack-name conveymate-reports-pipeline-dev
```

Confirm:

- Website bucket, CloudFront distribution, and Lambda exist.
- SSM parameters are present for the target environment.
- API runtime principal has SSM, S3, and Textract access.

## Current gap

The repo now includes a first-pass `www` compute/network deployment stack. Non-`www` environments still use the lighter core/cognito/pipeline templates unless equivalent service stacks are added for them.
