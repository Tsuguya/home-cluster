#!/usr/bin/env bash
set -euo pipefail

OP=$(command -v op || command -v op.exe) || { echo "op CLI not found"; exit 1; }

KANIDM_URL="https://idm.tgy.io"
KANIDM_USER="idm_admin"
OP_VAULT="am37jjl6mctaze6xsytbxdhu5y"

# kanidm_client → k8s_secret:namespace:secret_key:type:op_item_id
# type: oauth = client-secret only, proxy = client-secret + cookie-secret
declare -A CLIENTS=(
  [grafana]="kanidm-grafana-oauth:monitoring:clientSecret:oauth:h5bme4w2ekcdawkyslx6uyi6xa"
  [argo-workflows]="kanidm-argo-workflows-oauth:argo:clientSecret:oauth:oggzannoxdm57w2yoyxveubzhy"
  [oauth2-proxy-hubble]="oauth2-proxy-hubble-oauth:oauth2-proxy:client-secret:proxy:gantbbhcr4ojonk5zpwchiar2q"
  [oauth2-proxy-seaweedfs]="oauth2-proxy-seaweedfs-oauth:oauth2-proxy:client-secret:proxy:so2kq4jpyrwfnumdcquymigpca"
)

RESTART_DEPLOYMENTS=(
  "oauth2-proxy-hubble:oauth2-proxy"
  "oauth2-proxy-seaweedfs:oauth2-proxy"
  "kube-prometheus-stack-grafana:monitoring"
  "argo-workflows-server:argo"
)

echo "=== Step 1: Login to Kanidm as $KANIDM_USER ==="
KANIDM_PASSWORD=$(kubectl exec -n kanidm kanidm-0 -- \
  kanidmd scripting recover-account -c /config/server.toml "$KANIDM_USER" 2>/dev/null \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['output'])")
export KANIDM_PASSWORD

kanidm login --name "$KANIDM_USER" -H "$KANIDM_URL" 2>/dev/null
echo "Login successful."

echo ""
echo "=== Step 2: Rotate OAuth2 client secrets ==="
for client in "${!CLIENTS[@]}"; do
  IFS=: read -r secret_name namespace secret_key type op_item <<< "${CLIENTS[$client]}"

  echo "--- $client ---"
  OLD_SECRET=$(kanidm system oauth2 show-basic-secret "$client" -H "$KANIDM_URL" --name "$KANIDM_USER" 2>/dev/null)
  kanidm system oauth2 reset-basic-secret "$client" -H "$KANIDM_URL" --name "$KANIDM_USER"

  for i in $(seq 1 20); do
    NEW_SECRET=$(kanidm system oauth2 show-basic-secret "$client" -H "$KANIDM_URL" --name "$KANIDM_USER" 2>/dev/null)
    [ "$NEW_SECRET" != "$OLD_SECRET" ] && break
    echo "  Waiting for replication... ($i)"
    sleep 2
  done
  if [ "$NEW_SECRET" = "$OLD_SECRET" ]; then
    echo "  ERROR: Secret did not change after 40s, skipping $client"
    continue
  fi
  ENCODED=$(echo -n "$NEW_SECRET" | base64 -w0)

  kubectl patch secret "$secret_name" -n "$namespace" \
    -p "{\"data\":{\"$secret_key\":\"$ENCODED\"}}"
  echo "  Patched $namespace/$secret_name ($secret_key)"

  $OP item edit "$op_item" --vault "$OP_VAULT" "$secret_key=$NEW_SECRET"
  echo "  Updated 1Password ($secret_key)"

  if [ "$type" = "proxy" ]; then
    COOKIE=$(openssl rand -hex 16)
    kubectl patch secret "$secret_name" -n "$namespace" \
      -p "{\"data\":{\"cookie-secret\":\"$(echo -n "$COOKIE" | base64 -w0)\"}}"
    echo "  Patched cookie-secret"

    $OP item edit "$op_item" --vault "$OP_VAULT" "cookie-secret=$COOKIE"
    echo "  Updated 1Password (cookie-secret)"
  fi
done

echo ""
echo "=== Step 3: Restart deployments ==="
for entry in "${RESTART_DEPLOYMENTS[@]}"; do
  IFS=: read -r deploy namespace <<< "$entry"
  kubectl rollout restart deployment "$deploy" -n "$namespace"
  echo "  Restarted $namespace/$deploy"
done

echo ""
echo "=== Step 4: Wait for rollout ==="
for entry in "${RESTART_DEPLOYMENTS[@]}"; do
  IFS=: read -r deploy namespace <<< "$entry"
  kubectl rollout status deployment "$deploy" -n "$namespace" --timeout=60s || true
done

echo ""
echo "=== Done ==="
