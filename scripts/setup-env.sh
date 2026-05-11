#!/usr/bin/env bash
# Bootstraps placeholder .env files for the four (env × side) combinations:
#
#   client/.env.local        — local dev frontend (Next.js auto-loads)
#   client/.env.production   — paste-into-Vercel reference (also auto-loaded
#                              if you ever run `next build` locally with
#                              NODE_ENV=production)
#   server/.env              — local dev backend (loaded by `npm start` /
#                              `npm run dev`)
#   server/.env.production   — paste-into-Render reference (loaded by
#                              `npm run start:prod`)
#
# Every value is a placeholder. Edit the files after running. Real secrets
# never live in the repo — these files are gitignored.
#
# Usage:
#   ./scripts/setup-env.sh                 # create whichever files are missing
#   ./scripts/setup-env.sh --force         # overwrite even if they exist
#   ./scripts/setup-env.sh --only=server   # only generate server files
#   ./scripts/setup-env.sh --only=client   # only generate client files

set -euo pipefail

FORCE=0
ONLY="both"
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --only=client) ONLY="client" ;;
    --only=server) ONLY="server" ;;
    --only=both) ONLY="both" ;;
    -h|--help)
      # Print the leading comment header (everything from line 2 up to the
      # first non-comment, non-blank line). Stays correct if the header grows.
      awk 'NR==1{next} /^[^#[:space:]]/{exit} {print}' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

# Resolve repo root from this script's location so it works no matter where
# you invoke it from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

write_if_missing() {
  local path="$1"
  local body="$2"
  if [[ -f "$path" && "$FORCE" -ne 1 ]]; then
    echo "  skip  $path (already exists; pass --force to overwrite)"
    return
  fi
  mkdir -p "$(dirname "$path")"
  printf '%s\n' "$body" > "$path"
  chmod 600 "$path"
  echo "  wrote $path"
}

client_local() {
  cat <<'EOF'
# Local development — frontend.
# Next.js auto-loads this file when running `npm run dev`.
# Every NEXT_PUBLIC_* var is shipped to the browser bundle.

NEXT_PUBLIC_WS_URL=ws://localhost:3001
NEXT_PUBLIC_API_URL=http://localhost:3001

# Google OAuth — Web Application client. Authorized JavaScript origin for
# local dev must include http://localhost:3000.
NEXT_PUBLIC_GOOGLE_CLIENT_ID=replace-with-google-client-id

# CloudFront CDN that fronts the private S3 bucket for user uploads.
# Public URL — fine in the browser bundle. Fill in once the AWS bucket /
# distribution is provisioned (see README).
NEXT_PUBLIC_CDN_URL=https://replace-with-cloudfront.cloudfront.net
EOF
}

client_prod() {
  cat <<'EOF'
# Production — frontend. Paste these into your deploy platform's project
# settings (e.g. Vercel → Project → Settings → Environment Variables).
# Next.js will also load this file automatically if NODE_ENV=production at
# build time.

NEXT_PUBLIC_WS_URL=wss://replace-with-server-host
NEXT_PUBLIC_API_URL=https://replace-with-server-host

NEXT_PUBLIC_GOOGLE_CLIENT_ID=replace-with-google-client-id

NEXT_PUBLIC_CDN_URL=https://replace-with-cloudfront.cloudfront.net
EOF
}

server_local() {
  cat <<'EOF'
# Local development — backend.
# Loaded by `npm start` and `npm run dev` via Node's --env-file-if-exists.

PORT=3001

# Google OAuth — same Web Application client id as the frontend.
GOOGLE_CLIENT_ID=replace-with-google-client-id
GOOGLE_CLIENT_SECRET=replace-with-google-client-secret

# Postgres connection. Railway gives you a connection URL; SSL is required
# for any hosted Postgres but you can flip DATABASE_SSL=false for a local
# Postgres without TLS.
DATABASE_URL=postgresql://user:password@host:port/dbname
DATABASE_SSL=true

# Long random string. Generate with: openssl rand -hex 48
JWT_SECRET=replace-with-long-random-string
JWT_TTL_SECONDS=2592000

# Comma-separated origins allowed to call the HTTP API.
CORS_ORIGINS=http://localhost:3000

# --- AWS S3 + CloudFront (user uploads) ---
# The bucket is fully private. Browser uploads go through server-issued
# presigned PUT URLs; reads are served via CloudFront. The access keys
# here belong to a dedicated IAM user scoped to s3:PutObject/GetObject on
# this one bucket — never use account-root keys.
AWS_REGION=us-west-1
S3_BUCKET_NAME=replace-with-bucket-name
S3_PUBLIC_BASE_URL=https://replace-with-cloudfront.cloudfront.net
CLOUDFRONT_DISTRIBUTION_ID=replace-with-distribution-id
AWS_ACCESS_KEY_ID=replace-with-access-key-id
AWS_SECRET_ACCESS_KEY=replace-with-access-key-secret

# Hard cap on a single browser upload (bytes). The presigned URL enforces
# the same via Content-Length-Range, so manipulating client code cannot
# bypass it. Default 5 MiB.
UPLOAD_MAX_BYTES=5242880
EOF
}

server_prod() {
  cat <<'EOF'
# Production — backend. Paste these into your deploy platform's project
# settings (e.g. Render → Service → Environment).
# Loaded by `npm run start:prod` via Node's --env-file-if-exists when
# running locally with NODE_ENV=production.

PORT=3001

GOOGLE_CLIENT_ID=replace-with-google-client-id
GOOGLE_CLIENT_SECRET=replace-with-google-client-secret

DATABASE_URL=postgresql://user:password@host:port/dbname
DATABASE_SSL=true

JWT_SECRET=replace-with-long-random-string
JWT_TTL_SECONDS=2592000

# In prod this MUST include the deployed frontend origin. Mixed with the
# WebSocket server's own origin check, this is what stops random sites from
# making cross-origin calls into the API.
CORS_ORIGINS=https://replace-with-frontend-host

AWS_REGION=us-west-1
S3_BUCKET_NAME=replace-with-bucket-name
S3_PUBLIC_BASE_URL=https://replace-with-cloudfront.cloudfront.net
CLOUDFRONT_DISTRIBUTION_ID=replace-with-distribution-id
AWS_ACCESS_KEY_ID=replace-with-access-key-id
AWS_SECRET_ACCESS_KEY=replace-with-access-key-secret

UPLOAD_MAX_BYTES=5242880
EOF
}

echo "Generating placeholder .env files in $ROOT"
echo

if [[ "$ONLY" == "client" || "$ONLY" == "both" ]]; then
  write_if_missing "$ROOT/client/.env.local"       "$(client_local)"
  write_if_missing "$ROOT/client/.env.production"  "$(client_prod)"
fi

if [[ "$ONLY" == "server" || "$ONLY" == "both" ]]; then
  write_if_missing "$ROOT/server/.env"             "$(server_local)"
  write_if_missing "$ROOT/server/.env.production"  "$(server_prod)"
fi

echo
echo "Done. Edit each file with real values before starting the apps."
echo "These files are gitignored — do not commit them."
