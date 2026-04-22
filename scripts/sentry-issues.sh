#!/usr/bin/env bash
# Pull open Sentry issues for the himaxym.com org.
#
# Auth: set SENTRY_AUTH_TOKEN (personal API token with event:read +
# project:read + org:read). Create at:
#   https://sentry.io/settings/account/api/auth-tokens/
#
# Usage:
#   scripts/sentry-issues.sh                    # top 10 unresolved, last 24h
#   scripts/sentry-issues.sh 20 7d              # top 20, last 7 days
#   scripts/sentry-issues.sh 10 24h javascript-react   # filter by project
#   scripts/sentry-issues.sh projects           # list project slugs
#
# Requires: curl, jq.
set -euo pipefail

if [[ -z "${SENTRY_AUTH_TOKEN:-}" ]]; then
  echo "ERROR: SENTRY_AUTH_TOKEN not set." >&2
  echo "  1. Create a token at https://sentry.io/settings/account/api/auth-tokens/" >&2
  echo "  2. Grant scopes: event:read, project:read, org:read" >&2
  echo "  3. export SENTRY_AUTH_TOKEN=sntrys_..." >&2
  exit 1
fi

ORG="${SENTRY_ORG:-himaxym}"
BASE="${SENTRY_API_BASE:-https://sentry.io/api/0}"
AUTH="Authorization: Bearer $SENTRY_AUTH_TOKEN"

if [[ "${1:-}" == "projects" ]]; then
  echo "=== Projects in org '$ORG' ==="
  curl -s -H "$AUTH" "$BASE/organizations/$ORG/projects/" \
    | jq -r 'if type == "array" then
               .[] | "  slug=\(.slug)  name=\(.name)  platform=\(.platform // "?")  id=\(.id)"
             else
               "  ERROR: \(.detail // .)"
             end'
  exit 0
fi

limit="${1:-10}"
since="${2:-24h}"
project_filter="${3:-}"

query="is:unresolved"
if [[ -n "$project_filter" ]]; then
  # Project filter uses project:slug syntax in Sentry search.
  query="$query project:$project_filter"
fi
# URL-encode spaces.
q_encoded="${query// /%20}"
q_encoded="${q_encoded//:/%3A}"

echo "=== Sentry unresolved — org=$ORG, last $since, limit $limit${project_filter:+, project=$project_filter} ==="

curl -s -H "$AUTH" \
  "$BASE/organizations/$ORG/issues/?query=$q_encoded&statsPeriod=$since&limit=$limit&sort=freq" \
| jq -r 'if type == "array" then
           if length == 0 then "  (no open issues)" else
             .[] | "[\(.project.slug // "?")] \(.level | ascii_upcase): \(.title)
  events=\(.count)  users=\(.userCount)  lastSeen=\(.lastSeen)
  id=\(.shortId)  url=\(.permalink)
"
           end
         else
           "  ERROR: \(.detail // .)"
         end'
