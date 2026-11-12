#!/bin/zsh
# Build and deploy the two hosted front ends to their Vercel projects (production).
#   scripts/deploy-web.sh [web|app|both]   (default both)
# web -> kumi-avax-web.vercel.app (Vite build in web/dist, with /download from web/public/download)
# app -> kumi-avax-app.vercel.app (Expo web export of the phone app in mobile/dist)
# Vite and Expo wipe their output folders, so the Vercel project link is written back after each build.
# The ids below are project ids, not secrets.
set -euo pipefail
ROOT=${0:A:h:h}
WHICH=${1:-both}
ORG=team_gwapD8j8P5T3NxIU746NjNxe
link() { mkdir -p "$1/.vercel"; printf '{"projectId":"%s","orgId":"%s","projectName":"%s"}' "$2" "$ORG" "$3" > "$1/.vercel/project.json"; }

if [[ $WHICH == web || $WHICH == both ]]; then
  [[ -f "$ROOT/web/public/download/Kumi-iOS-Simulator.zip" ]] || { echo "Missing web/public/download/Kumi-iOS-Simulator.zip: run mobile/scripts/build-ios-sim.sh first"; exit 1; }
  (cd "$ROOT/web" && pnpm build)
  link "$ROOT/web/dist" prj_Mx0KTaWcO0W57CXhZLg6sJnj5Q6u kumi-avax-web
  (cd "$ROOT/web/dist" && vercel deploy --prod --yes)
fi
if [[ $WHICH == app || $WHICH == both ]]; then
  (cd "$ROOT/mobile" && npm run export:vercel)
  link "$ROOT/mobile/dist" prj_aQgpAA7MrmRe3ChTouyuCZHLGgmv kumi-avax-app
  (cd "$ROOT/mobile/dist" && vercel deploy --prod --yes)
fi
