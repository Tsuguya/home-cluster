# Manual Bootstrap Steps

ArgoCD (GitOps) 管理外で、手動実行が必要な手順をまとめる。
クラスタ再構築時はこの順序で実行すること。

## 前提条件

- Talos Linux ノードが起動済み（VIP: 192.168.0.229）
- `talosctl` / `kubectl` が VIP に接続可能
- 1Password vault `home-cluster` に構築前アイテムが作成済み（[1Password Items](#1password-items) 参照）

## 1. Gateway API CRDs

Cilium は Gateway API CRDs を同梱しないため、先にインストールする。
TLSRoute（ArgoCD TLS Passthrough に使用）は experimental channel に含まれる。

```bash
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.2.1/experimental-install.yaml
```

> **重要**: TLSRoute CRD は Cilium operator 起動前にインストールすること。
> 後からインストールした場合は Cilium operator の再起動が必要。

## 2. Cilium (CNI)

Talos はデフォルト CNI を持たないため、ArgoCD より先に Cilium を手動インストールする。
ArgoCD デプロイ後は app-of-apps が Cilium の管理を引き継ぐ。

```bash
helm repo add cilium https://helm.cilium.io
helm install cilium cilium/cilium \
  --namespace kube-system \
  --version 1.19.0 \
  -f helm-values/cilium/values.yaml
```

## 3. ArgoCD

CNI が動いた後、ArgoCD 本体を手動インストールし、app-of-apps を適用する。
以降は ArgoCD が自身を含む全 Application を管理する。

```bash
helm repo add argo https://argoproj.github.io/argo-helm
helm install argocd argo/argo-cd \
  --namespace argocd --create-namespace \
  --version 9.4.2 \
  -f helm-values/argocd/values.yaml

kubectl apply -f argocd/app-of-apps.yaml
```

## 4. 1Password Operator Token

Service Account Token を手動で作成する。
トークンは git 管理外とし、1Password 側で発行・管理する。

```bash
kubectl create namespace 1password
kubectl create secret generic onepassword-token \
  --namespace 1password \
  --from-literal=token="<SERVICE_ACCOUNT_TOKEN>"
```

app-of-apps が `apps/onepassword.yaml` を検出し、Operator を自動デプロイする。
Operator が起動すると、各 namespace の OnePasswordItem から Secret を自動生成する。

## 以降は自動

上記 4 ステップ完了後、ArgoCD が app-of-apps 経由で全サービスを自動デプロイする:
cert-manager, external-dns, rook-ceph, CNPG, Grafana, Loki, Argo Workflows 等。

DNS レコードも external-dns が Gateway の HTTPRoute / TLSRoute から自動作成する（Cloudflare）。

## 5. Loki S3 クレデンシャル（rook-ceph 稼働後）

rook-ceph が稼働し CephObjectStoreUser `loki` が作成されると、
rook-ceph が S3 アクセスキーを含む Secret `rook-ceph-object-user-ceph-objectstore-loki` を `rook-ceph` namespace に生成する。

```bash
kubectl get secret -n rook-ceph rook-ceph-object-user-ceph-objectstore-loki \
  -o jsonpath='{.data.AccessKey}' | base64 -d
kubectl get secret -n rook-ceph rook-ceph-object-user-ceph-objectstore-loki \
  -o jsonpath='{.data.SecretKey}' | base64 -d
```

取得した値を 1Password vault `home-cluster` の `loki-s3-credentials` アイテムに保存:
- `AWS_ACCESS_KEY_ID` — AccessKey
- `AWS_SECRET_ACCESS_KEY` — SecretKey

1Password Operator が Secret を monitoring namespace に同期し、Loki が S3 に接続できるようになる。

---

## 1Password Items

クラスタが参照する 1Password vault アイテム一覧。
構築前に作成できるものと、クラスタ稼働後に作成が必要なものがある。

### 構築前に作成（外部サービスの認証情報）

#### コアインフラ

| Item | Deployed Namespaces | Keys | 用途 |
|---|---|---|---|
| cloudflare-api-token | cert-manager, external-dns | api-token | DNS-01 challenge, DNS レコード管理 |
| cloudflared-tunnel-token | argocd | credential | Cloudflare Tunnel (GitHub webhook relay) |

#### 認証

| Item | Deployed Namespaces | Keys | 用途 |
|---|---|---|---|
| google-oauth | argocd¹, monitoring, argo | clientID, clientSecret | Google OIDC SSO |
| github-repo-creds | argocd | url, type, password | ArgoCD private repo 認証 |

¹ ArgoCD namespace では Secret 名が `argocd-google-oauth` になる

#### データベース

| Item | Deployed Namespaces | Keys | 用途 |
|---|---|---|---|
| shared-pg-credentials | database | username, password | CNPG shared-pg superuser |
| grafana-pg-credentials | database, monitoring | username, password | Grafana DB ユーザー |
| argo-pg-credentials | database, argo | username, password | Argo Workflows DB ユーザー |

#### ストレージ

| Item | Deployed Namespaces | Keys | 用途 |
|---|---|---|---|
| qnap-backend-secret | trident | username, password, storageAddress, https, port | QNAP NAS CSI |

#### Argo Workflows 自動化

| Item | Deployed Namespaces | Keys | 用途 |
|---|---|---|---|
| talosconfig | argo | talosconfig | Talos ノード操作 |
| cloudflare-tofu-credentials | argo | CLOUDFLARE_API_TOKEN | OpenTofu Cloudflare provider |
| github-pat-tofu | argo | GITHUB_TOKEN | OpenTofu GitHub provider |
| home-cloudflare-github-webhook | argo | secret | GitHub webhook 検証 |

### 構築後に作成（クラスタ内サービスに依存）

| Item | Deployed Namespaces | Keys | 依存先 | 用途 |
|---|---|---|---|---|
| loki-s3-credentials | monitoring | AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY | rook-ceph (CephObjectStoreUser) | Loki → Ceph RGW (S3) |
