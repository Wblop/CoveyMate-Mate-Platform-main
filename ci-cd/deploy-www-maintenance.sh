#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib-www-deploy.sh"

require_command aws

WEBSITE_BUCKET_NAME="$(stack_output "${REGION}" "${SERVICES_STACK_NAME}" "WebsiteBucketName")"
CLOUDFRONT_DISTRIBUTION_ID="$(stack_output "${REGION}" "${SERVICES_STACK_NAME}" "CloudFrontDistributionId")"
APP_WEBSITE_BUCKET_NAME="$(stack_output "${REGION}" "${APP_FRONTEND_STACK_NAME}" "AppWebsiteBucketName" 2>/dev/null || true)"
APP_CLOUDFRONT_DISTRIBUTION_ID="$(stack_output "${REGION}" "${APP_FRONTEND_STACK_NAME}" "AppCloudFrontDistributionId" 2>/dev/null || true)"
APP_DOMAIN_NAME="$(param_value "AppDomainName")"
APP_URL="https://${APP_DOMAIN_NAME}"
DOMAIN_NAME="$(param_value "DomainName")"
SUPPORT_EMAIL="${SUPPORT_EMAIL:-support@${DOMAIN_NAME}}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

if [[ -z "${WEBSITE_BUCKET_NAME}" || "${WEBSITE_BUCKET_NAME}" == "None" ]]; then
  echo "Could not resolve WebsiteBucketName from stack ${SERVICES_STACK_NAME}"
  exit 1
fi

if [[ -z "${CLOUDFRONT_DISTRIBUTION_ID}" || "${CLOUDFRONT_DISTRIBUTION_ID}" == "None" ]]; then
  echo "Could not resolve CloudFrontDistributionId from stack ${SERVICES_STACK_NAME}"
  exit 1
fi

cat > "${TMP_DIR}/index.html" <<EOF
<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <title>ConveyMate | Maintenance</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow, noarchive">
  <meta name="theme-color" content="#12324a">
  <style>
    :root {
      color-scheme: light;
      --bg: #f3efe7;
      --surface: rgba(255, 252, 247, 0.84);
      --surface-strong: #fffaf2;
      --text: #12324a;
      --muted: #556b7c;
      --accent: #d57a3d;
      --accent-deep: #a34f22;
      --line: rgba(18, 50, 74, 0.12);
      --shadow: 0 30px 70px rgba(18, 50, 74, 0.12);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Avenir Next", "Segoe UI", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(213, 122, 61, 0.22), transparent 32%),
        radial-gradient(circle at bottom right, rgba(18, 50, 74, 0.18), transparent 28%),
        linear-gradient(180deg, #f8f3eb 0%, var(--bg) 100%);
      display: grid;
      place-items: center;
      padding: 24px;
    }

    main {
      width: min(100%, 960px);
      display: grid;
      gap: 24px;
      grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
      align-items: stretch;
    }

    .panel,
    .sidebar {
      border: 1px solid var(--line);
      border-radius: 28px;
      background: var(--surface);
      backdrop-filter: blur(16px);
      box-shadow: var(--shadow);
    }

    .panel {
      padding: 40px;
    }

    .sidebar {
      padding: 28px;
      background:
        linear-gradient(180deg, rgba(18, 50, 74, 0.96), rgba(18, 50, 74, 0.88)),
        var(--surface-strong);
      color: #eef4f8;
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 18px;
      padding: 8px 14px;
      border-radius: 999px;
      background: rgba(213, 122, 61, 0.14);
      color: var(--accent-deep);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      font-size: clamp(2.4rem, 6vw, 4.4rem);
      line-height: 0.95;
      letter-spacing: -0.03em;
    }

    p {
      margin: 0;
      color: var(--muted);
      font-size: 1.05rem;
      line-height: 1.7;
      max-width: 34rem;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 28px;
    }

    a,
    button {
      appearance: none;
      border: 0;
      cursor: pointer;
      border-radius: 999px;
      padding: 14px 20px;
      font: inherit;
      font-weight: 700;
      text-decoration: none;
      transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease;
    }

    a:hover,
    button:hover {
      transform: translateY(-1px);
    }

    .primary {
      background: var(--text);
      color: #fffaf2;
      box-shadow: 0 10px 24px rgba(18, 50, 74, 0.18);
    }

    .secondary {
      background: rgba(18, 50, 74, 0.08);
      color: var(--text);
    }

    .sidebar h2 {
      margin: 0 0 16px;
      font-size: 1rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .sidebar ul {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 14px;
    }

    .sidebar li {
      padding-top: 14px;
      border-top: 1px solid rgba(255, 255, 255, 0.12);
      line-height: 1.6;
    }

    .sidebar li:first-child {
      padding-top: 0;
      border-top: 0;
    }

    .meta {
      color: rgba(238, 244, 248, 0.74);
      font-size: 0.95rem;
    }

    @media (max-width: 860px) {
      main {
        grid-template-columns: 1fr;
      }

      .panel,
      .sidebar {
        padding: 28px;
        border-radius: 22px;
      }
    }
  </style>
</head>
<body>
  <main>
    <section class="panel">
      <div class="eyebrow">Scheduled Maintenance</div>
      <h1>ConveyMate is temporarily offline.</h1>
      <p>
        The application is in maintenance mode while the environment is powered down. Reports, uploads, and account
        data are preserved. The full site will return after the platform is brought back online.
      </p>
      <div class="actions">
        <button class="primary" type="button" onclick="window.location.reload()">Try again</button>
        <a class="secondary" href="mailto:${SUPPORT_EMAIL}">Contact support</a>
      </div>
    </section>
    <aside class="sidebar">
      <h2>What to expect</h2>
      <ul>
        <li>The public site is intentionally serving a maintenance page instead of the main application.</li>
        <li>Existing customer data remains in place and will be available again when the environment is restored.</li>
        <li class="meta">Primary URL: <a href="${APP_URL}" style="color:#fffaf2;">${APP_URL}</a></li>
        <li class="meta">Support: <a href="mailto:${SUPPORT_EMAIL}" style="color:#fffaf2;">${SUPPORT_EMAIL}</a></li>
      </ul>
    </aside>
  </main>
</body>
</html>
EOF

echo "Uploading maintenance page for marketing site to s3://${WEBSITE_BUCKET_NAME} ..."
upload_web_assets "${WEBSITE_BUCKET_NAME}" "${CLOUDFRONT_DISTRIBUTION_ID}" "${TMP_DIR}"

if [[ -n "${APP_WEBSITE_BUCKET_NAME}" && "${APP_WEBSITE_BUCKET_NAME}" != "None" && -n "${APP_CLOUDFRONT_DISTRIBUTION_ID}" && "${APP_CLOUDFRONT_DISTRIBUTION_ID}" != "None" ]]; then
  echo "Uploading maintenance page for authenticated app to s3://${APP_WEBSITE_BUCKET_NAME} ..."
  upload_web_assets "${APP_WEBSITE_BUCKET_NAME}" "${APP_CLOUDFRONT_DISTRIBUTION_ID}" "${TMP_DIR}"
fi

echo "Deployed maintenance pages for both frontend sites"
