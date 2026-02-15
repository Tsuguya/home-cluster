# Manual Bootstrap Steps

ArgoCD (GitOps) 管理外で、手動実行が必要な手順をまとめる。
クラスタ再構築時はこの順序で実行すること。

## 1. Cilium (CNI)

Talos はデフォルト CNI を持たないため、ArgoCD より先に Cilium を手動インストールする。
ArgoCD デプロイ後は app-of-apps が Cilium の管理を引き継ぐ。

```bash
helm repo add cilium https://helm.cilium.io
helm install cilium cilium/cilium \
  --namespace kube-system \
  --version 1.19.0 \
  -f apps/cilium/values.yaml
```

## 2. ArgoCD

CNI が動いた後、ArgoCD 本体を手動インストールし、app-of-apps を適用する。
以降は ArgoCD が自身を含む全 Application を管理する。

```bash
helm repo add argo https://argoproj.github.io/argo-helm
helm install argocd argo/argo-cd \
  --namespace argocd --create-namespace \
  --version 9.4.2 \
  -f apps/argocd/values.yaml

kubectl apply -f argocd/app-of-apps.yaml
```

## 3. 1Password Operator

Service Account Token を手動で作成する。
トークンは git 管理外とし、1Password 側で発行・管理する。

```bash
kubectl create namespace 1password
kubectl create secret generic onepassword-token \
  --namespace 1password \
  --from-literal=token="<SERVICE_ACCOUNT_TOKEN>"
```

app-of-apps が `apps/onepassword.yaml` を検出し、Operator を自動デプロイする。

## 4. Gateway API CRDs

Cilium は Gateway API CRDs を同梱しないため、手動でインストールする。
Cilium の `gatewayAPI.enabled: true` はこの CRDs が存在する前提で動作する。

```bash
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.2.1/standard-install.yaml
```

## 5. Google OAuth クライアント (ArgoCD Dex)

ArgoCD の Google ログインに使用する OAuth クライアントを作成する。

### GCP Console

1. [APIs & Services](https://console.cloud.google.com/apis/credentials) > OAuth consent screen > Internal
2. Credentials > Create OAuth Client ID > Web application
   - Authorized redirect URIs: `https://argocd.tgy.io/api/dex/callback`
3. Client ID と Client Secret を控える

### 1Password

1. `home-cluster` vault に新規アイテム作成（名前: `argocd-google-oauth`）
2. フィールド追加:
   - `clientID` — GCP の Client ID
   - `clientSecret` — GCP の Client Secret
3. アイテム ID を確認し、`manifests/infra/argocd-google-oauth.yaml` の `<ITEM_ID>` を置換

## 6. QNAP CSI Backend 認証

QNAP NAS の認証情報を 1Password で管理する。

### 1Password

1. `home-cluster` vault に新規アイテム作成（名前: `qnap-backend-secret`）
2. フィールド追加:
   - `username` — QNAP ユーザー名
   - `password` — QNAP パスワード
   - `storageAddress` — `192.168.0.240`
   - `https` — `true`
   - `port` — `443`
3. アイテム ID を確認し、`manifests/storage/backend.yaml` の `<ITEM_ID>` を置換

app-of-apps が `apps/qnap-csi.yaml` と `apps/qnap-csi-config.yaml` を検出し、CSI Operator・Backend・StorageClass を自動デプロイする。

## 7. DNS レコード

Gateway の LoadBalancer IP を確認し、Cloudflare で A レコードを作成する。

```bash
kubectl get gateway -n gateway main-gateway
```

Cloudflare DNS に以下を追加（Proxy OFF）:
- `argocd.tgy.io` → `<GATEWAY_LB_IP>`
