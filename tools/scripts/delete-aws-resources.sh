#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# AWS FULL RESET Script (keeps IAM)
#
# - DRY RUN by default (prints commands)
# - Set EXECUTE=1 to actually delete
# - Set DELETE_GLOBAL=1 to delete global resources (Route53, CloudFront, etc.)
# - Set DELETE_DEFAULT_VPCS=1 to also delete default VPCs in each region
#
# Requirements:
#   - aws cli v2
#   - jq
#
# Usage:
#   ./tools/scripts/delete-aws-resources.sh
#   EXECUTE=1 ./tools/scripts/delete-aws-resources.sh
#   EXECUTE=1 ./tools/scripts/delete-aws-resources.sh --all-regions
#   EXECUTE=1 ./tools/scripts/delete-aws-resources.sh --regions ap-southeast-2 ap-southeast-4
#
# Notes:
#   - IAM is not touched.
#   - Some services are best-effort due to AWS delete semantics (disable-first / async).
#   - KMS keys are scheduled for deletion (cannot be immediate).
# ============================================================

EXECUTE="${EXECUTE:-0}"                 # 0=dry-run, 1=execute
DELETE_GLOBAL="${DELETE_GLOBAL:-0}"     # 0=skip global deletes, 1=delete global resources
DELETE_DEFAULT_VPCS="${DELETE_DEFAULT_VPCS:-0}" # 0=skip default VPCs, 1=delete them too

DEFAULT_REGIONS=("ap-southeast-2")
REGIONS=()
ALL_REGIONS=0

RED=$'\033[0;31m'
GRN=$'\033[0;32m'
YEL=$'\033[0;33m'
BLU=$'\033[0;34m'
RST=$'\033[0m'

log()  { printf "%s%s%s\n" "${BLU}" "$*" "${RST}"; }
warn() { printf "%s%s%s\n" "${YEL}" "$*" "${RST}"; }
err()  { printf "%s%s%s\n" "${RED}" "$*" "${RST}"; }
ok()   { printf "%s%s%s\n" "${GRN}" "$*" "${RST}"; }

need() { command -v "$1" >/dev/null 2>&1 || { err "Missing dependency: $1"; exit 1; }; }

run() {
  if [[ "$EXECUTE" == "1" ]]; then
    "$@" || true
  else
    printf "DRY-RUN: %q " "$@"; echo
  fi
}

is_empty_text() {
  local v="${1:-}"
  [[ -z "${v// }" || "$v" == "None" || "$v" == "null" ]]
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --all-regions) ALL_REGIONS=1; shift ;;
      --regions) shift; while [[ $# -gt 0 && "$1" != --* ]]; do REGIONS+=("$1"); shift; done ;;
      *) err "Unknown arg: $1"; exit 1 ;;
    esac
  done
}

resolve_regions() {
  if [[ "$ALL_REGIONS" == "1" ]]; then
    mapfile -t REGIONS < <(aws ec2 describe-regions --query "Regions[].RegionName" --output text | tr '\t' '\n' | sort)
  elif [[ "${#REGIONS[@]}" -eq 0 ]]; then
    REGIONS=("${DEFAULT_REGIONS[@]}")
  fi
}

header() {
  echo "============================================================"
  echo "AWS FULL RESET (keeps IAM)"
  echo "EXECUTE=$EXECUTE (0=dry-run, 1=delete)"
  echo "DELETE_GLOBAL=$DELETE_GLOBAL (0=skip, 1=delete global resources)"
  echo "DELETE_DEFAULT_VPCS=$DELETE_DEFAULT_VPCS (0=skip, 1=delete default VPCs)"
  echo "Regions: ${REGIONS[*]}"
  echo "Caller:  $(aws sts get-caller-identity --query Arn --output text)"
  echo "============================================================"
}

# -----------------------------
# GLOBAL (non-regional) deletes
# -----------------------------

delete_route53_global() {
  warn "[global] Route53 hosted zones + records + health checks"

  local zones
  zones=$(aws route53 list-hosted-zones --query "HostedZones[].Id" --output text 2>/dev/null || true)
  if is_empty_text "$zones"; then
    ok "  hosted zones: none"
  else
    for zid in $zones; do
      local zone_id="${zid##*/}"
      warn "  hosted zone: $zone_id"

      # Determine apex name from SOA
      local rrjson apex
      rrjson=$(aws route53 list-resource-record-sets --hosted-zone-id "$zone_id" --output json 2>/dev/null || echo "{}")
      apex=$(echo "$rrjson" | jq -r '.ResourceRecordSets[]? | select(.Type=="SOA") | .Name' | head -n 1)

      # Build deletions: everything except apex NS/SOA
      local changes count
      if [[ -n "$apex" && "$apex" != "null" ]]; then
        changes=$(echo "$rrjson" | jq -c --arg apex "$apex" '
          .ResourceRecordSets
          | map(select( ( .Name==$apex and (.Type=="NS" or .Type=="SOA") ) | not ))
        ')
      else
        changes=$(echo "$rrjson" | jq -c '.ResourceRecordSets | map(select(.Type!="NS" and .Type!="SOA"))')
      fi

      count=$(echo "$changes" | jq 'length' 2>/dev/null || echo 0)

      if [[ "$count" -gt 0 ]]; then
        local i=0
        while [[ $i -lt $count ]]; do
          local chunk batch
          chunk=$(echo "$changes" | jq -c ".[$i:$((i+500))]")
          batch=$(jq -c -n --argjson rr "$chunk" '{Changes: ($rr | map({Action:"DELETE", ResourceRecordSet:.}))}')
          warn "    delete record batch: $i..$((i+$(echo "$chunk" | jq 'length')-1))"
          run aws route53 change-resource-record-sets --hosted-zone-id "$zone_id" --change-batch "$batch"
          i=$((i+500))
        done
      else
        ok "    records: none (besides apex NS/SOA)"
      fi

      warn "  delete hosted zone: $zone_id"
      run aws route53 delete-hosted-zone --id "$zone_id"
    done
  fi

  local hcs
  hcs=$(aws route53 list-health-checks --query "HealthChecks[].Id" --output text 2>/dev/null || true)
  if is_empty_text "$hcs"; then
    ok "  health checks: none"
  else
    for hc in $hcs; do
      warn "  delete health check: $hc"
      run aws route53 delete-health-check --health-check-id "$hc"
    done
  fi
}

delete_cloudfront_global() {
  warn "[global] CloudFront distributions"
  # CloudFront requires DISABLE then DELETE and can take time. This implements best-effort:
  # 1) list distributions
  # 2) for each: get config+etag, set Enabled=false, update, then attempt delete once disabled

  local ids
  ids=$(aws cloudfront list-distributions --query "DistributionList.Items[].Id" --output text 2>/dev/null || true)
  if is_empty_text "$ids"; then
    ok "  distributions: none"
    return
  fi

  for id in $ids; do
    warn "  distribution: $id"
    local etag cfg enabled
    etag=$(aws cloudfront get-distribution-config --id "$id" --query "ETag" --output text 2>/dev/null || true)
    cfg=$(aws cloudfront get-distribution-config --id "$id" --query "DistributionConfig" --output json 2>/dev/null || echo "{}")
    enabled=$(echo "$cfg" | jq -r '.Enabled // false')

    if [[ "$enabled" == "true" ]]; then
      warn "    disabling distribution"
      local newcfg
      newcfg=$(echo "$cfg" | jq '.Enabled=false')
      if [[ "$EXECUTE" == "1" ]]; then
        aws cloudfront update-distribution --id "$id" --if-match "$etag" --distribution-config "$newcfg" >/dev/null || true
      else
        echo "DRY-RUN: aws cloudfront update-distribution --id $id --if-match $etag --distribution-config <enabled=false>"
      fi
      warn "    CloudFront disable is async; rerun script later to delete after Disabled."
      continue
    fi

    warn "    attempting delete distribution"
    run aws cloudfront delete-distribution --id "$id" --if-match "$etag"
  done
}

delete_wafv2_cloudfront_global() {
  warn "[global] WAFv2 (CLOUDFRONT scope)"
  local acls
  acls=$(aws wafv2 list-web-acls --region us-east-1 --scope CLOUDFRONT --output json 2>/dev/null || echo "{}")
  local count
  count=$(echo "$acls" | jq '.WebACLs | length' 2>/dev/null || echo 0)
  if [[ "$count" -eq 0 ]]; then
    ok "  none"
    return
  fi

  echo "$acls" | jq -r '.WebACLs[] | "\(.Name) \(.Id)"' | while read -r name id; do
    [[ -z "$name" || -z "$id" ]] && continue
    local token
    token=$(aws wafv2 get-web-acl --region us-east-1 --scope CLOUDFRONT --name "$name" --id "$id" --query "LockToken" --output text 2>/dev/null || true)
    warn "  delete web acl: $name ($id)"
    run aws wafv2 delete-web-acl --region us-east-1 --scope CLOUDFRONT --name "$name" --id "$id" --lock-token "$token"
  done
}

# ACM for CloudFront certs typically in us-east-1
delete_acm_us_east_1_global() {
  warn "[global] ACM certificates in us-east-1 (CloudFront certs)"
  local arns
  arns=$(aws acm list-certificates --region us-east-1 --query "CertificateSummaryList[].CertificateArn" --output text 2>/dev/null || true)
  if is_empty_text "$arns"; then
    ok "  none"
    return
  fi
  for a in $arns; do
    warn "  delete cert: $a"
    run aws acm delete-certificate --region us-east-1 --certificate-arn "$a"
  done
}

# -----------------------------
# REGIONAL deletes (helpers)
# -----------------------------

delete_cloudformation() {
  local region="$1"
  log "[${region}] CloudFormation stacks"
  local stacks
  stacks=$(aws cloudformation list-stacks --region "$region" \
    --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE ROLLBACK_COMPLETE DELETE_FAILED \
    --query "StackSummaries[].StackName" --output text 2>/dev/null || true)

  if is_empty_text "$stacks"; then
    ok "  none"
    return
  fi

  for s in $stacks; do
    warn "  delete stack: $s"
    run aws cloudformation delete-stack --region "$region" --stack-name "$s"
  done

  if [[ "$EXECUTE" == "1" ]]; then
    for s in $stacks; do
      warn "  wait stack delete: $s"
      aws cloudformation wait stack-delete-complete --region "$region" --stack-name "$s" || true
    done
  else
    warn "  DRY-RUN: not waiting for stacks"
  fi
}

delete_ecr() {
  local region="$1"
  log "[${region}] ECR repositories"
  local repos
  repos=$(aws ecr describe-repositories --region "$region" --query "repositories[].repositoryName" --output text 2>/dev/null || true)
  if is_empty_text "$repos"; then
    ok "  none"
    return
  fi
  for r in $repos; do
    warn "  delete repo (force): $r"
    run aws ecr delete-repository --region "$region" --repository-name "$r" --force
  done
}

delete_lambda() {
  local region="$1"
  log "[${region}] Lambda (functions + event source mappings)"
  local maps
  maps=$(aws lambda list-event-source-mappings --region "$region" --query "EventSourceMappings[].UUID" --output text 2>/dev/null || true)
  if ! is_empty_text "$maps"; then
    for u in $maps; do
      warn "  delete event source mapping: $u"
      run aws lambda delete-event-source-mapping --region "$region" --uuid "$u"
    done
  fi

  local funcs
  funcs=$(aws lambda list-functions --region "$region" --query "Functions[].FunctionName" --output text 2>/dev/null || true)
  if is_empty_text "$funcs"; then
    ok "  none"
    return
  fi
  for f in $funcs; do
    warn "  delete function: $f"
    run aws lambda delete-function --region "$region" --function-name "$f"
  done
}

delete_apigw() {
  local region="$1"
  log "[${region}] API Gateway (REST + HTTP/WebSocket)"
  local rest_ids
  rest_ids=$(aws apigateway get-rest-apis --region "$region" --query "items[].id" --output text 2>/dev/null || true)
  if ! is_empty_text "$rest_ids"; then
    for id in $rest_ids; do
      warn "  delete REST API: $id"
      run aws apigateway delete-rest-api --region "$region" --rest-api-id "$id"
    done
  else
    ok "  REST APIs: none"
  fi

  local v2_ids
  v2_ids=$(aws apigatewayv2 get-apis --region "$region" --query "Items[].ApiId" --output text 2>/dev/null || true)
  if ! is_empty_text "$v2_ids"; then
    for id in $v2_ids; do
      warn "  delete APIv2: $id"
      run aws apigatewayv2 delete-api --region "$region" --api-id "$id"
    done
  else
    ok "  APIv2: none"
  fi
}

delete_ecs() {
  local region="$1"
  log "[${region}] ECS (services + clusters + task definitions)"
  local clusters
  clusters=$(aws ecs list-clusters --region "$region" --query "clusterArns[]" --output text 2>/dev/null || true)
  if ! is_empty_text "$clusters"; then
    for c in $clusters; do
      local services
      services=$(aws ecs list-services --region "$region" --cluster "$c" --query "serviceArns[]" --output text 2>/dev/null || true)
      if ! is_empty_text "$services"; then
        for s in $services; do
          warn "  scale service to 0: $s"
          run aws ecs update-service --region "$region" --cluster "$c" --service "$s" --desired-count 0
          warn "  delete service (force): $s"
          run aws ecs delete-service --region "$region" --cluster "$c" --service "$s" --force
        done
      fi

      warn "  delete cluster: $c"
      run aws ecs delete-cluster --region "$region" --cluster "$c"
    done
  else
    ok "  clusters: none"
  fi

  # Task definitions clutter (not billable), but wipe them for “fresh”
  local tdefs
  tdefs=$(aws ecs list-task-definitions --region "$region" --status ACTIVE --query "taskDefinitionArns[]" --output text 2>/dev/null || true)
  if ! is_empty_text "$tdefs"; then
    for td in $tdefs; do
      warn "  deregister task definition: $td"
      run aws --no-cli-pager ecs deregister-task-definition --region "$region" --task-definition "$td" >/dev/null
    done
  else
    ok "  task definitions: none"
  fi
}

delete_eks() {
  local region="$1"
  log "[${region}] EKS (clusters)"
  local clusters
  clusters=$(aws eks list-clusters --region "$region" --query "clusters[]" --output text 2>/dev/null || true)
  if is_empty_text "$clusters"; then
    ok "  none"
    return
  fi
  for c in $clusters; do
    warn "  delete EKS cluster: $c"
    run aws eks delete-cluster --region "$region" --name "$c"
  done
}

delete_elb() {
  local region="$1"
  log "[${region}] Load balancers (ALB/NLB/CLB + target groups)"
  local lbs
  lbs=$(aws elbv2 describe-load-balancers --region "$region" --query "LoadBalancers[].LoadBalancerArn" --output text 2>/dev/null || true)
  if ! is_empty_text "$lbs"; then
    for arn in $lbs; do
      warn "  delete elbv2: $arn"
      run aws elbv2 delete-load-balancer --region "$region" --load-balancer-arn "$arn"
    done
  else
    ok "  elbv2: none"
  fi

  local tgs
  tgs=$(aws elbv2 describe-target-groups --region "$region" --query "TargetGroups[].TargetGroupArn" --output text 2>/dev/null || true)
  if ! is_empty_text "$tgs"; then
    for tg in $tgs; do
      warn "  delete target group: $tg"
      run aws elbv2 delete-target-group --region "$region" --target-group-arn "$tg"
    done
  else
    ok "  target groups: none"
  fi

  local clbs
  clbs=$(aws elb describe-load-balancers --region "$region" --query "LoadBalancerDescriptions[].LoadBalancerName" --output text 2>/dev/null || true)
  if ! is_empty_text "$clbs"; then
    for name in $clbs; do
      warn "  delete classic elb: $name"
      run aws elb delete-load-balancer --region "$region" --load-balancer-name "$name"
    done
  else
    ok "  classic elb: none"
  fi
}

delete_asg() {
  local region="$1"
  log "[${region}] Auto Scaling Groups + Launch Templates/Configs"
  local asgs
  asgs=$(aws autoscaling describe-auto-scaling-groups --region "$region" --query "AutoScalingGroups[].AutoScalingGroupName" --output text 2>/dev/null || true)
  if ! is_empty_text "$asgs"; then
    for a in $asgs; do
      warn "  scale ASG to 0: $a"
      run aws autoscaling update-auto-scaling-group --region "$region" --auto-scaling-group-name "$a" --min-size 0 --max-size 0 --desired-capacity 0
      warn "  delete ASG (force): $a"
      run aws autoscaling delete-auto-scaling-group --region "$region" --auto-scaling-group-name "$a" --force-delete
    done
  else
    ok "  ASGs: none"
  fi

  local lcs
  lcs=$(aws autoscaling describe-launch-configurations --region "$region" --query "LaunchConfigurations[].LaunchConfigurationName" --output text 2>/dev/null || true)
  if ! is_empty_text "$lcs"; then
    for lc in $lcs; do
      warn "  delete launch config: $lc"
      run aws autoscaling delete-launch-configuration --region "$region" --launch-configuration-name "$lc"
    done
  else
    ok "  launch configs: none"
  fi

  local lts
  lts=$(aws ec2 describe-launch-templates --region "$region" --query "LaunchTemplates[].LaunchTemplateId" --output text 2>/dev/null || true)
  if ! is_empty_text "$lts"; then
    for lt in $lts; do
      warn "  delete launch template: $lt"
      run aws ec2 delete-launch-template --region "$region" --launch-template-id "$lt"
    done
  else
    ok "  launch templates: none"
  fi
}

delete_ec2_compute() {
  local region="$1"
  log "[${region}] EC2 instances + volumes + snapshots + EIPs"
  local ids
  ids=$(aws ec2 describe-instances --region "$region" --query "Reservations[].Instances[?State.Name!='terminated'].InstanceId" --output text 2>/dev/null || true)
  if ! is_empty_text "$ids"; then
    warn "  terminate: $ids"
    run aws ec2 terminate-instances --region "$region" --instance-ids $ids
    if [[ "$EXECUTE" == "1" ]]; then
      aws ec2 wait instance-terminated --region "$region" --instance-ids $ids || true
    fi
  else
    ok "  instances: none"
  fi

  local vols
  vols=$(aws ec2 describe-volumes --region "$region" --query "Volumes[?State=='available'].VolumeId" --output text 2>/dev/null || true)
  if ! is_empty_text "$vols"; then
    for v in $vols; do
      warn "  delete volume: $v"
      run aws ec2 delete-volume --region "$region" --volume-id "$v"
    done
  else
    ok "  volumes: none"
  fi

  local snaps
  snaps=$(aws ec2 describe-snapshots --region "$region" --owner-ids self --query "Snapshots[].SnapshotId" --output text 2>/dev/null || true)
  if ! is_empty_text "$snaps"; then
    for s in $snaps; do
      warn "  delete snapshot: $s"
      run aws ec2 delete-snapshot --region "$region" --snapshot-id "$s"
    done
  else
    ok "  snapshots: none"
  fi

  local eips
  eips=$(aws ec2 describe-addresses --region "$region" --query "Addresses[].AllocationId" --output text 2>/dev/null || true)
  if ! is_empty_text "$eips"; then
    for a in $eips; do
      warn "  release eip: $a"
      run aws ec2 release-address --region "$region" --allocation-id "$a"
    done
  else
    ok "  eips: none"
  fi
}

delete_rds() {
  local region="$1"
  log "[${region}] RDS (instances + clusters)"
  local dbs
  dbs=$(aws rds describe-db-instances --region "$region" --query "DBInstances[].DBInstanceIdentifier" --output text 2>/dev/null || true)
  if ! is_empty_text "$dbs"; then
    for db in $dbs; do
      warn "  disable deletion protection: $db"
      run aws rds modify-db-instance --region "$region" --db-instance-identifier "$db" --no-deletion-protection --apply-immediately
      warn "  delete db (skip final snapshot): $db"
      run aws rds delete-db-instance --region "$region" --db-instance-identifier "$db" --skip-final-snapshot --delete-automated-backups
    done
  else
    ok "  instances: none"
  fi

  local clusters
  clusters=$(aws rds describe-db-clusters --region "$region" --query "DBClusters[].DBClusterIdentifier" --output text 2>/dev/null || true)
  if ! is_empty_text "$clusters"; then
    for c in $clusters; do
      warn "  disable deletion protection: $c"
      run aws rds modify-db-cluster --region "$region" --db-cluster-identifier "$c" --no-deletion-protection --apply-immediately
      warn "  delete cluster (skip final snapshot): $c"
      run aws rds delete-db-cluster --region "$region" --db-cluster-identifier "$c" --skip-final-snapshot
    done
  else
    ok "  clusters: none"
  fi
}

delete_dynamodb() {
  local region="$1"
  log "[${region}] DynamoDB tables"
  local tables
  tables=$(aws dynamodb list-tables --region "$region" --query "TableNames[]" --output text 2>/dev/null || true)
  if is_empty_text "$tables"; then
    ok "  none"
    return
  fi
  for t in $tables; do
    warn "  delete table: $t"
    run aws dynamodb delete-table --region "$region" --table-name "$t"
  done
}

delete_sqs_sns() {
  local region="$1"

  log "[${region}] SQS queues"
  local queues
  queues=$(aws sqs list-queues --region "$region" --query "QueueUrls[]" --output text 2>/dev/null || true)
  if is_empty_text "$queues"; then
    ok "  none"
  else
    printf "%s\n" "$queues" | tr '\t' '\n' | while read -r q; do
      [[ -z "$q" || "$q" == "None" ]] && continue
      warn "  delete queue: $q"
      run aws sqs delete-queue --region "$region" --queue-url "$q"
    done
  fi

  log "[${region}] SNS subscriptions (cleanup)"
  local subs
  subs=$(aws sns list-subscriptions --region "$region" --query "Subscriptions[].SubscriptionArn" --output text 2>/dev/null || true)
  if ! is_empty_text "$subs"; then
    for s in $subs; do
      [[ -z "$s" || "$s" == "None" || "$s" == "PendingConfirmation" ]] && continue
      warn "  unsubscribe: $s"
      run aws sns unsubscribe --region "$region" --subscription-arn "$s"
    done
  else
    ok "  none"
  fi

  log "[${region}] SNS topics"
  local topics
  topics=$(aws sns list-topics --region "$region" --query "Topics[].TopicArn" --output text 2>/dev/null || true)
  if is_empty_text "$topics"; then
    ok "  none"
    return
  fi
  for t in $topics; do
    warn "  delete topic: $t"
    run aws sns delete-topic --region "$region" --topic-arn "$t"
  done
}

delete_kinesis() {
  local region="$1"
  log "[${region}] Kinesis (streams + firehose)"

  local streams
  streams=$(aws kinesis list-streams --region "$region" --query "StreamNames[]" --output text 2>/dev/null || true)
  if ! is_empty_text "$streams"; then
    for s in $streams; do
      warn "  delete stream: $s"
      run aws kinesis delete-stream --region "$region" --stream-name "$s" --enforce-consumer-deletion
    done
  else
    ok "  streams: none"
  fi

  local fh
  fh=$(aws firehose list-delivery-streams --region "$region" --query "DeliveryStreamNames[]" --output text 2>/dev/null || true)
  if ! is_empty_text "$fh"; then
    for d in $fh; do
      warn "  delete firehose: $d"
      run aws firehose delete-delivery-stream --region "$region" --delivery-stream-name "$d" --allow-force-delete
    done
  else
    ok "  firehose: none"
  fi
}

delete_secrets_ssm() {
  local region="$1"
  log "[${region}] Secrets Manager + SSM Parameter Store"

  local secrets
  secrets=$(aws secretsmanager list-secrets --region "$region" --query "SecretList[].ARN" --output text 2>/dev/null || true)
  if ! is_empty_text "$secrets"; then
    for s in $secrets; do
      warn "  delete secret (force): $s"
      run aws secretsmanager delete-secret --region "$region" --secret-id "$s" --force-delete-without-recovery
    done
  else
    ok "  secrets: none"
  fi

  local names
  names=$(aws ssm describe-parameters --region "$region" --query "Parameters[].Name" --output text 2>/dev/null || true)
  if is_empty_text "$names"; then
    ok "  ssm params: none"
    return
  fi

  local batch=()
  for n in $names; do
    batch+=("$n")
    if [[ "${#batch[@]}" -ge 10 ]]; then
      warn "  delete params (batch of 10)"
      run aws ssm delete-parameters --region "$region" --names "${batch[@]}"
      batch=()
    fi
  done
  if [[ "${#batch[@]}" -gt 0 ]]; then
    warn "  delete params (final batch)"
    run aws ssm delete-parameters --region "$region" --names "${batch[@]}"
  fi
}

delete_cloudwatch() {
  local region="$1"
  log "[${region}] CloudWatch (log groups + alarms + dashboards)"

  local groups
  groups=$(aws logs describe-log-groups --region "$region" --query "logGroups[].logGroupName" --output text 2>/dev/null || true)
  if ! is_empty_text "$groups"; then
    for g in $groups; do
      warn "  delete log group: $g"
      run aws logs delete-log-group --region "$region" --log-group-name "$g"
    done
  else
    ok "  log groups: none"
  fi

  local alarms
  alarms=$(aws cloudwatch describe-alarms --region "$region" --query "MetricAlarms[].AlarmName" --output text 2>/dev/null || true)
  if ! is_empty_text "$alarms"; then
    warn "  delete alarms: $alarms"
    run aws cloudwatch delete-alarms --region "$region" --alarm-names $alarms
  else
    ok "  alarms: none"
  fi

  local dashes
  dashes=$(aws cloudwatch list-dashboards --region "$region" --query "DashboardEntries[].DashboardName" --output text 2>/dev/null || true)
  if ! is_empty_text "$dashes"; then
    warn "  delete dashboards: $dashes"
    run aws cloudwatch delete-dashboards --region "$region" --dashboard-names $dashes
  else
    ok "  dashboards: none"
  fi
}

delete_eventbridge_and_scheduler() {
  local region="$1"
  log "[${region}] EventBridge rules + Scheduler"

  local rules
  rules=$(aws events list-rules --region "$region" --query "Rules[].Name" --output text 2>/dev/null || true)
  if ! is_empty_text "$rules"; then
    for r in $rules; do
      local targets
      targets=$(aws events list-targets-by-rule --region "$region" --rule "$r" --query "Targets[].Id" --output text 2>/dev/null || true)
      if ! is_empty_text "$targets"; then
        warn "  remove targets for rule: $r"
        run aws events remove-targets --region "$region" --rule "$r" --ids $targets
      fi
      warn "  delete rule: $r"
      run aws events delete-rule --region "$region" --name "$r"
    done
  else
    ok "  rules: none"
  fi

  # EventBridge Scheduler (separate service)
  local scheds
  scheds=$(aws scheduler list-schedules --region "$region" --query "Schedules[].Name" --output text 2>/dev/null || true)
  if ! is_empty_text "$scheds"; then
    for s in $scheds; do
      warn "  delete schedule: $s"
      run aws scheduler delete-schedule --region "$region" --name "$s"
    done
  else
    ok "  schedules: none"
  fi
}

delete_s3() {
  local region="$1"
  log "[${region}] S3 buckets (region-filtered) + access points"
  # Access points (regional)
  local aps
  aps=$(aws s3control list-access-points --region "$region" --account-id "$(aws sts get-caller-identity --query Account --output text)" \
    --query "AccessPointList[].Name" --output text 2>/dev/null || true)
  if ! is_empty_text "$aps"; then
    for ap in $aps; do
      warn "  delete access point: $ap"
      run aws s3control delete-access-point --region "$region" --account-id "$(aws sts get-caller-identity --query Account --output text)" --name "$ap"
    done
  else
    ok "  access points: none"
  fi

  # Buckets (global list; delete only those in this region)
  local buckets
  buckets=$(aws s3api list-buckets --query "Buckets[].Name" --output text 2>/dev/null || true)
  if is_empty_text "$buckets"; then
    ok "  buckets: none"
    return
  fi

  for b in $buckets; do
    local loc
    loc=$(aws s3api get-bucket-location --bucket "$b" --query "LocationConstraint" --output text 2>/dev/null || true)
    [[ "$loc" == "None" ]] && loc="us-east-1"
    [[ "$loc" != "$region" ]] && continue

    warn "  empty bucket: $b (region=$loc)"

    if [[ "$EXECUTE" == "1" ]]; then
      aws s3 rm "s3://$b" --recursive || true

      # delete versions + delete markers
      while :; do
        local resp versions markers del
        resp=$(aws s3api list-object-versions --bucket "$b" --output json 2>/dev/null || echo '{}')
        versions=$(echo "$resp" | jq -c '[.Versions[]? | {Key, VersionId}]')
        markers=$(echo "$resp" | jq -c '[.DeleteMarkers[]? | {Key, VersionId}]')
        if [[ "$versions" == "[]" && "$markers" == "[]" ]]; then break; fi
        del=$(jq -c -n --argjson v "$versions" --argjson m "$markers" '{Objects: ($v + $m), Quiet:true}')
        aws s3api delete-objects --bucket "$b" --delete "$del" >/dev/null || true
      done
    else
      echo "DRY-RUN: would empty bucket (including versions): $b"
    fi

    warn "  delete bucket: $b"
    run aws s3api delete-bucket --bucket "$b" --region "$region"
  done
}

delete_cloudtrail() {
  local region="$1"
  log "[${region}] CloudTrail trails"
  local trails
  trails=$(aws cloudtrail describe-trails --region "$region" --query "trailList[].Name" --output text 2>/dev/null || true)
  if is_empty_text "$trails"; then
    ok "  none"
    return
  fi
  for t in $trails; do
    warn "  stop logging: $t"
    run aws cloudtrail stop-logging --region "$region" --name "$t"
    warn "  delete trail: $t"
    run aws cloudtrail delete-trail --region "$region" --name "$t"
  done
}

delete_cognito() {
  local region="$1"
  log "[${region}] Cognito (User Pools + Identity Pools)"
  local pools
  pools=$(aws cognito-idp list-user-pools --region "$region" --max-results 60 --query "UserPools[].Id" --output text 2>/dev/null || true)
  if ! is_empty_text "$pools"; then
    for pid in $pools; do
      warn "  delete user pool: $pid"
      run aws cognito-idp delete-user-pool --region "$region" --user-pool-id "$pid"
    done
  else
    ok "  user pools: none"
  fi

  local idpools
  idpools=$(aws cognito-identity list-identity-pools --region "$region" --max-results 60 --query "IdentityPools[].IdentityPoolId" --output text 2>/dev/null || true)
  if ! is_empty_text "$idpools"; then
    for ipid in $idpools; do
      warn "  delete identity pool: $ipid"
      run aws cognito-identity delete-identity-pool --region "$region" --identity-pool-id "$ipid"
    done
  else
    ok "  identity pools: none"
  fi
}

delete_stepfunctions() {
  local region="$1"
  log "[${region}] Step Functions"
  local sms
  sms=$(aws stepfunctions list-state-machines --region "$region" --query "stateMachines[].stateMachineArn" --output text 2>/dev/null || true)
  if ! is_empty_text "$sms"; then
    for arn in $sms; do
      warn "  delete state machine: $arn"
      run aws stepfunctions delete-state-machine --region "$region" --state-machine-arn "$arn"
    done
  else
    ok "  state machines: none"
  fi

  local acts
  acts=$(aws stepfunctions list-activities --region "$region" --query "activities[].activityArn" --output text 2>/dev/null || true)
  if ! is_empty_text "$acts"; then
    for arn in $acts; do
      warn "  delete activity: $arn"
      run aws stepfunctions delete-activity --region "$region" --activity-arn "$arn"
    done
  else
    ok "  activities: none"
  fi
}

delete_opensearch() {
  local region="$1"
  log "[${region}] OpenSearch domains"
  local domains
  domains=$(aws opensearch list-domain-names --region "$region" --query "DomainNames[].DomainName" --output text 2>/dev/null || true)
  if is_empty_text "$domains"; then
    ok "  none"
    return
  fi
  for d in $domains; do
    warn "  delete domain: $d"
    run aws opensearch delete-domain --region "$region" --domain-name "$d"
  done
}

delete_elasticache() {
  local region="$1"
  log "[${region}] ElastiCache"
  local rgs
  rgs=$(aws elasticache describe-replication-groups --region "$region" --query "ReplicationGroups[].ReplicationGroupId" --output text 2>/dev/null || true)
  if ! is_empty_text "$rgs"; then
    for rg in $rgs; do
      warn "  delete replication group: $rg"
      run aws elasticache delete-replication-group --region "$region" --replication-group-id "$rg" --retain-primary-cluster false
    done
  else
    ok "  replication groups: none"
  fi

  local clusters
  clusters=$(aws elasticache describe-cache-clusters --region "$region" --query "CacheClusters[].CacheClusterId" --output text 2>/dev/null || true)
  if ! is_empty_text "$clusters"; then
    for c in $clusters; do
      warn "  delete cache cluster: $c"
      run aws elasticache delete-cache-cluster --region "$region" --cache-cluster-id "$c"
    done
  else
    ok "  cache clusters: none"
  fi
}

delete_efs() {
  local region="$1"
  log "[${region}] EFS file systems"
  local fs
  fs=$(aws efs describe-file-systems --region "$region" --query "FileSystems[].FileSystemId" --output text 2>/dev/null || true)
  if is_empty_text "$fs"; then
    ok "  none"
    return
  fi

  for id in $fs; do
    local mts
    mts=$(aws efs describe-mount-targets --region "$region" --file-system-id "$id" --query "MountTargets[].MountTargetId" --output text 2>/dev/null || true)
    if ! is_empty_text "$mts"; then
      for mt in $mts; do
        warn "  delete mount target: $mt (fs=$id)"
        run aws efs delete-mount-target --region "$region" --mount-target-id "$mt"
      done
    fi
    warn "  delete file system: $id"
    run aws efs delete-file-system --region "$region" --file-system-id "$id"
  done
}

delete_backup() {
  local region="$1"
  log "[${region}] AWS Backup (vaults + recovery points)"
  local vaults
  vaults=$(aws backup list-backup-vaults --region "$region" --query "BackupVaultList[].BackupVaultName" --output text 2>/dev/null || true)
  if is_empty_text "$vaults"; then
    ok "  none"
    return
  fi

  for v in $vaults; do
    local rps
    rps=$(aws backup list-recovery-points-by-backup-vault --region "$region" --backup-vault-name "$v" --query "RecoveryPoints[].RecoveryPointArn" --output text 2>/dev/null || true)
    if ! is_empty_text "$rps"; then
      for rp in $rps; do
        warn "  delete recovery point: $rp"
        run aws backup delete-recovery-point --region "$region" --backup-vault-name "$v" --recovery-point-arn "$rp"
      done
    fi
    warn "  delete backup vault: $v"
    run aws backup delete-backup-vault --region "$region" --backup-vault-name "$v"
  done
}

delete_acm() {
  local region="$1"
  log "[${region}] ACM certificates"
  local arns
  arns=$(aws acm list-certificates --region "$region" --query "CertificateSummaryList[].CertificateArn" --output text 2>/dev/null || true)
  if is_empty_text "$arns"; then
    ok "  none"
    return
  fi
  for a in $arns; do
    warn "  delete cert: $a"
    run aws acm delete-certificate --region "$region" --certificate-arn "$a"
  done
}

delete_wafv2_regional() {
  local region="$1"
  log "[${region}] WAFv2 (REGIONAL scope)"
  local acls
  acls=$(aws wafv2 list-web-acls --region "$region" --scope REGIONAL --output json 2>/dev/null || echo "{}")
  local count
  count=$(echo "$acls" | jq '.WebACLs | length' 2>/dev/null || echo 0)
  if [[ "$count" -eq 0 ]]; then
    ok "  none"
    return
  fi

  echo "$acls" | jq -r '.WebACLs[] | "\(.Name) \(.Id)"' | while read -r name id; do
    local token
    token=$(aws wafv2 get-web-acl --region "$region" --scope REGIONAL --name "$name" --id "$id" --query "LockToken" --output text 2>/dev/null || true)
    warn "  delete web acl: $name ($id)"
    run aws wafv2 delete-web-acl --region "$region" --scope REGIONAL --name "$name" --id "$id" --lock-token "$token"
  done
}

delete_kms() {
  local region="$1"
  log "[${region}] KMS (schedule deletion for CUSTOMER keys)"
  local keys
  keys=$(aws kms list-keys --region "$region" --query "Keys[].KeyId" --output text 2>/dev/null || true)
  if is_empty_text "$keys"; then
    ok "  none"
    return
  fi

  for kid in $keys; do
    local mgr state
    mgr=$(aws kms describe-key --region "$region" --key-id "$kid" --query "KeyMetadata.KeyManager" --output text 2>/dev/null || true)
    state=$(aws kms describe-key --region "$region" --key-id "$kid" --query "KeyMetadata.KeyState" --output text 2>/dev/null || true)
    [[ "$mgr" != "CUSTOMER" ]] && continue
    [[ "$state" == "PendingDeletion" ]] && continue
    warn "  schedule deletion (7 days): $kid"
    run aws kms schedule-key-deletion --region "$region" --key-id "$kid" --pending-window-in-days 7
  done
}

delete_glue_athena() {
  local region="$1"
  log "[${region}] Glue (jobs/crawlers/catalog) + Athena workgroups"

  local jobs
  jobs=$(aws glue get-jobs --region "$region" --query "Jobs[].Name" --output text 2>/dev/null || true)
  if ! is_empty_text "$jobs"; then
    for j in $jobs; do
      warn "  delete glue job: $j"
      run aws glue delete-job --region "$region" --job-name "$j"
    done
  else
    ok "  glue jobs: none"
  fi

  local crawlers
  crawlers=$(aws glue get-crawlers --region "$region" --query "Crawlers[].Name" --output text 2>/dev/null || true)
  if ! is_empty_text "$crawlers"; then
    for c in $crawlers; do
      warn "  delete glue crawler: $c"
      run aws glue delete-crawler --region "$region" --name "$c"
    done
  else
    ok "  glue crawlers: none"
  fi

  local dbs
  dbs=$(aws glue get-databases --region "$region" --query "DatabaseList[].Name" --output text 2>/dev/null || true)
  if ! is_empty_text "$dbs"; then
    for d in $dbs; do
      [[ "$d" == "default" ]] && continue
      warn "  delete glue database: $d"
      run aws glue delete-database --region "$region" --name "$d"
    done
  else
    ok "  glue databases: none"
  fi

  local wgs
  wgs=$(aws athena list-work-groups --region "$region" --query "WorkGroups[].Name" --output text 2>/dev/null || true)
  if ! is_empty_text "$wgs"; then
    for w in $wgs; do
      [[ "$w" == "primary" ]] && continue
      warn "  delete athena workgroup: $w"
      run aws athena delete-work-group --region "$region" --work-group "$w" --recursive-delete-option
    done
  else
    ok "  athena workgroups: none"
  fi
}

delete_apprunner() {
  local region="$1"
  log "[${region}] App Runner services"
  local arns
  arns=$(aws apprunner list-services --region "$region" --query "ServiceSummaryList[].ServiceArn" --output text 2>/dev/null || true)
  if is_empty_text "$arns"; then
    ok "  none"
    return
  fi
  for a in $arns; do
    warn "  delete App Runner service: $a"
    run aws apprunner delete-service --region "$region" --service-arn "$a"
  done
}

delete_elastic_beanstalk() {
  local region="$1"
  log "[${region}] Elastic Beanstalk (environments + applications)"
  local envs
  envs=$(aws elasticbeanstalk describe-environments --region "$region" --query "Environments[].EnvironmentName" --output text 2>/dev/null || true)
  if ! is_empty_text "$envs"; then
    for e in $envs; do
      warn "  terminate environment: $e"
      run aws elasticbeanstalk terminate-environment --region "$region" --environment-name "$e" --terminate-resources
    done
  else
    ok "  environments: none"
  fi

  local apps
  apps=$(aws elasticbeanstalk describe-applications --region "$region" --query "Applications[].ApplicationName" --output text 2>/dev/null || true)
  if ! is_empty_text "$apps"; then
    for a in $apps; do
      warn "  delete application: $a"
      run aws elasticbeanstalk delete-application --region "$region" --application-name "$a" --terminate-env-by-force
    done
  else
    ok "  applications: none"
  fi
}

# -----------------------------
# Networking blockers
# -----------------------------

delete_vpc_endpoints_and_services() {
  local region="$1"
  log "[${region}] VPC endpoints + endpoint services"
  local services
  services=$(aws ec2 describe-vpc-endpoint-service-configurations --region "$region" --query "ServiceConfigurations[].ServiceId" --output text 2>/dev/null || true)
  if ! is_empty_text "$services"; then
    for sid in $services; do
      warn "  delete endpoint service config: $sid"
      run aws ec2 delete-vpc-endpoint-service-configurations --region "$region" --service-ids "$sid"
    done
  else
    ok "  endpoint services: none"
  fi

  local eps
  eps=$(aws ec2 describe-vpc-endpoints --region "$region" --query "VpcEndpoints[].VpcEndpointId" --output text 2>/dev/null || true)
  if ! is_empty_text "$eps"; then
    warn "  delete endpoints: $eps"
    run aws ec2 delete-vpc-endpoints --region "$region" --vpc-endpoint-ids $eps
  else
    ok "  endpoints: none"
  fi
}

delete_vpc_peering() {
  local region="$1"
  log "[${region}] VPC peering"
  local pcs
  pcs=$(aws ec2 describe-vpc-peering-connections --region "$region" --query "VpcPeeringConnections[?Status.Code!='deleted'].VpcPeeringConnectionId" --output text 2>/dev/null || true)
  if is_empty_text "$pcs"; then
    ok "  none"
    return
  fi
  for pc in $pcs; do
    warn "  delete peering: $pc"
    run aws ec2 delete-vpc-peering-connection --region "$region" --vpc-peering-connection-id "$pc"
  done
}

delete_vpn_and_gws() {
  local region="$1"
  log "[${region}] VPN connections + gateways + customer gateways"

  local vpns
  vpns=$(aws ec2 describe-vpn-connections --region "$region" --query "VpnConnections[].VpnConnectionId" --output text 2>/dev/null || true)
  if ! is_empty_text "$vpns"; then
    for v in $vpns; do
      warn "  delete vpn: $v"
      run aws ec2 delete-vpn-connection --region "$region" --vpn-connection-id "$v"
    done
  else
    ok "  vpn connections: none"
  fi

  local vgws
  vgws=$(aws ec2 describe-vpn-gateways --region "$region" --query "VpnGateways[].VpnGatewayId" --output text 2>/dev/null || true)
  if ! is_empty_text "$vgws"; then
    for g in $vgws; do
      local vpcids
      vpcids=$(aws ec2 describe-vpn-gateways --region "$region" --vpn-gateway-ids "$g" --query "VpnGateways[0].VpcAttachments[].VpcId" --output text 2>/dev/null || true)
      if ! is_empty_text "$vpcids"; then
        for vpc in $vpcids; do
          warn "  detach vgw $g from vpc $vpc"
          run aws ec2 detach-vpn-gateway --region "$region" --vpn-gateway-id "$g" --vpc-id "$vpc"
        done
      fi
      warn "  delete vgw: $g"
      run aws ec2 delete-vpn-gateway --region "$region" --vpn-gateway-id "$g"
    done
  else
    ok "  vpn gateways: none"
  fi

  local cgws
  cgws=$(aws ec2 describe-customer-gateways --region "$region" --query "CustomerGateways[].CustomerGatewayId" --output text 2>/dev/null || true)
  if ! is_empty_text "$cgws"; then
    for c in $cgws; do
      warn "  delete customer gateway: $c"
      run aws ec2 delete-customer-gateway --region "$region" --customer-gateway-id "$c"
    done
  else
    ok "  customer gateways: none"
  fi
}

delete_transit_gateways() {
  local region="$1"
  log "[${region}] Transit Gateway (attachments + tgw)"
  local atts
  atts=$(aws ec2 describe-transit-gateway-attachments --region "$region" --query "TransitGatewayAttachments[].TransitGatewayAttachmentId" --output text 2>/dev/null || true)
  if ! is_empty_text "$atts"; then
    for a in $atts; do
      warn "  delete tgw attachment: $a"
      run aws ec2 delete-transit-gateway-vpc-attachment --region "$region" --transit-gateway-attachment-id "$a"
    done
  else
    ok "  attachments: none"
  fi

  local tgws
  tgws=$(aws ec2 describe-transit-gateways --region "$region" --query "TransitGateways[].TransitGatewayId" --output text 2>/dev/null || true)
  if is_empty_text "$tgws"; then
    ok "  tgws: none"
    return
  fi
  for t in $tgws; do
    warn "  delete tgw: $t"
    run aws ec2 delete-transit-gateway --region "$region" --transit-gateway-id "$t"
  done
}

delete_vpcs() {
  local region="$1"
  log "[${region}] VPC teardown"

  local filter='Vpcs[?IsDefault==`false`].VpcId'
  if [[ "$DELETE_DEFAULT_VPCS" == "1" ]]; then
    filter='Vpcs[].VpcId'
  fi

  local vpcs
  vpcs=$(aws ec2 describe-vpcs --region "$region" --query "$filter" --output text 2>/dev/null || true)
  if is_empty_text "$vpcs"; then
    ok "  none"
    return
  fi

  for vpc in $vpcs; do
    warn "  VPC: $vpc"

    # NAT gateways
    local nats
    nats=$(aws ec2 describe-nat-gateways --region "$region" --filter "Name=vpc-id,Values=$vpc" --query "NatGateways[].NatGatewayId" --output text 2>/dev/null || true)
    if ! is_empty_text "$nats"; then
      for ngw in $nats; do
        warn "    delete NAT GW: $ngw"
        run aws ec2 delete-nat-gateway --region "$region" --nat-gateway-id "$ngw"
      done
    fi

    # IGWs
    local igws
    igws=$(aws ec2 describe-internet-gateways --region "$region" --filters "Name=attachment.vpc-id,Values=$vpc" --query "InternetGateways[].InternetGatewayId" --output text 2>/dev/null || true)
    if ! is_empty_text "$igws"; then
      for igw in $igws; do
        warn "    detach IGW: $igw"
        run aws ec2 detach-internet-gateway --region "$region" --internet-gateway-id "$igw" --vpc-id "$vpc"
        warn "    delete IGW: $igw"
        run aws ec2 delete-internet-gateway --region "$region" --internet-gateway-id "$igw"
      done
    fi

    # ENIs (best-effort)
    local enis
    enis=$(aws ec2 describe-network-interfaces --region "$region" --filters "Name=vpc-id,Values=$vpc" --query "NetworkInterfaces[].NetworkInterfaceId" --output text 2>/dev/null || true)
    if ! is_empty_text "$enis"; then
      for eni in $enis; do
        warn "    delete ENI: $eni"
        run aws ec2 delete-network-interface --region "$region" --network-interface-id "$eni"
      done
    fi

    # Subnets
    local subnets
    subnets=$(aws ec2 describe-subnets --region "$region" --filters "Name=vpc-id,Values=$vpc" --query "Subnets[].SubnetId" --output text 2>/dev/null || true)
    if ! is_empty_text "$subnets"; then
      for s in $subnets; do
        warn "    delete subnet: $s"
        run aws ec2 delete-subnet --region "$region" --subnet-id "$s"
      done
    fi

    # Route tables
    local rts
    rts=$(aws ec2 describe-route-tables --region "$region" --filters "Name=vpc-id,Values=$vpc" --query "RouteTables[].RouteTableId" --output text 2>/dev/null || true)
    if ! is_empty_text "$rts"; then
      for rt in $rts; do
        local assoc
        assoc=$(aws ec2 describe-route-tables --region "$region" --route-table-ids "$rt" --query "RouteTables[0].Associations[?Main==\`false\`].RouteTableAssociationId" --output text 2>/dev/null || true)
        if ! is_empty_text "$assoc"; then
          for a in $assoc; do
            warn "    disassociate route table: $a"
            run aws ec2 disassociate-route-table --region "$region" --association-id "$a"
          done
        fi
        warn "    delete route table: $rt"
        run aws ec2 delete-route-table --region "$region" --route-table-id "$rt"
      done
    fi

    # NACLs (non-default)
    local nacls
    nacls=$(aws ec2 describe-network-acls --region "$region" --filters "Name=vpc-id,Values=$vpc" --query "NetworkAcls[?IsDefault==\`false\`].NetworkAclId" --output text 2>/dev/null || true)
    if ! is_empty_text "$nacls"; then
      for n in $nacls; do
        warn "    delete NACL: $n"
        run aws ec2 delete-network-acl --region "$region" --network-acl-id "$n"
      done
    fi

    # Security groups (non-default)
    local sgs
    sgs=$(aws ec2 describe-security-groups --region "$region" --filters "Name=vpc-id,Values=$vpc" --query "SecurityGroups[?GroupName!='default'].GroupId" --output text 2>/dev/null || true)
    if ! is_empty_text "$sgs"; then
      for sg in $sgs; do
        warn "    delete SG: $sg"
        run aws ec2 delete-security-group --region "$region" --group-id "$sg"
      done
    fi

    # Finally delete VPC
    warn "  delete VPC: $vpc"
    run aws ec2 delete-vpc --region "$region" --vpc-id "$vpc"
  done
}

# -----------------------------
# MAIN
# -----------------------------

main() {
  need aws
  need jq

  parse_args "$@"
  resolve_regions
  header

  if [[ "$EXECUTE" != "1" ]]; then
    warn "DRY-RUN mode. Nothing will be deleted."
    warn "To execute: EXECUTE=1 $0 ..."
    echo
  else
    warn "EXECUTE=1 set. Deletions will be attempted."
    echo
  fi

  # Global nukes (explicit)
  if [[ "$DELETE_GLOBAL" == "1" ]]; then
    delete_wafv2_cloudfront_global
    delete_cloudfront_global
    delete_acm_us_east_1_global
    delete_route53_global
  else
    warn "[global] Skipping global deletes. Set DELETE_GLOBAL=1 to enable (Route53/CloudFront/etc.)."
  fi

  for region in "${REGIONS[@]}"; do
    echo
    echo "------------------------------"
    echo "Region: $region"
    echo "------------------------------"

    # Pre-empt common blockers
    delete_ecr "$region"

    # Orchestrators (often depend on underlying resources; can fail, rerun)
    delete_cloudformation "$region"

    # App / compute
    delete_apigw "$region"
    delete_lambda "$region"
    delete_ecs "$region"
    delete_eks "$region"
    delete_apprunner "$region"
    delete_elastic_beanstalk "$region"

    # Edge/traffic
    delete_elb "$region"
    delete_asg "$region"

    # Data + integration
    delete_rds "$region"
    delete_dynamodb "$region"
    delete_kinesis "$region"
    delete_sqs_sns "$region"
    delete_secrets_ssm "$region"

    # Observability + scheduling
    delete_cloudwatch "$region"
    delete_eventbridge_and_scheduler "$region"
    delete_cloudtrail "$region"

    # Identity (non-IAM)
    delete_cognito "$region"

    # Workflow + analytics
    delete_stepfunctions "$region"
    delete_glue_athena "$region"

    # Storage + search/cache
    delete_opensearch "$region"
    delete_elasticache "$region"
    delete_efs "$region"
    delete_backup "$region"
    delete_s3 "$region"

    # Security-ish
    delete_acm "$region"
    delete_wafv2_regional "$region"
    delete_kms "$region"

    # Compute leftovers
    delete_ec2_compute "$region"

    # Networking blockers BEFORE VPC deletes
    delete_vpc_endpoints_and_services "$region"
    delete_vpc_peering "$region"
    delete_vpn_and_gws "$region"
    delete_transit_gateways "$region"

    # VPC teardown last
    delete_vpcs "$region"

    ok "[${region}] pass complete"
  done

  echo
  ok "Done."
  warn "Re-run the script until it becomes mostly no-ops (AWS deletes are async)."
  warn "Biggest cost traps to confirm are gone: NAT gateways, EIPs, RDS, EBS, snapshots."
  warn "KMS keys are scheduled, not instantly deleted."
}

main "$@"
