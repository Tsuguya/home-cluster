# SSO (Single Sign-On)

Google OIDC で統一。各サービスが直接 Google に認証する。

## 構成

| Service | Auth Method | Secret | Config |
|---|---|---|---|
| ArgoCD | Dex (Google connector) | argocd-google-oauth (argocd) | `helm-values/argocd/values.yaml` |
| Grafana | generic_oauth (Google) | google-oauth (monitoring) | `helm-values/kube-prometheus-stack/values.yaml` |
| Argo Workflows | OIDC (Google) | google-oauth (argo) | `helm-values/argo-workflows/values.yaml` |

ArgoCD のみ Dex 経由（ArgoCD 組み込み）。Grafana と Argo Workflows は Google OIDC に直接接続。

## 1Password Items

| Item | Secret Name | Namespaces | Keys |
|---|---|---|---|
| google-oauth | argocd-google-oauth | argocd | clientID, clientSecret |
| google-oauth | google-oauth | monitoring, argo | clientID, clientSecret |

全サービスで同じ 1Password item（google-oauth）を共用。Secret 名のみ ArgoCD は `argocd-google-oauth`。

## 新サービスに SSO を追加する手順

### 1. Google Cloud Console で設定

- [Credentials](https://console.cloud.google.com/apis/credentials) で既存の OAuth クライアントにリダイレクト URI を追加
- 既存の `google-oauth` クライアントを共用できる（ArgoCD 以外）
- 新しいクライアントが必要な場合は 1Password に保存

### 2. 1Password Item を必要な namespace にデプロイ

既存の `google-oauth` を使う場合:

```yaml
# manifests/infra/google-oauth-<namespace>.yaml
apiVersion: onepassword.com/v1
kind: OnePasswordItem
metadata:
  name: google-oauth
  namespace: <namespace>
spec:
  itemPath: "vaults/home-cluster/items/xc4g6jfzyxeuwxrrlp2phuekka"
```

### 3. サービスの SSO 設定

Google OIDC エンドポイント:

| Endpoint | URL |
|---|---|
| Authorization | `https://accounts.google.com/o/oauth2/v2/auth` |
| Token | `https://oauth2.googleapis.com/token` |
| Userinfo | `https://openidconnect.googleapis.com/v1/userinfo` |
| Issuer | `https://accounts.google.com` |

Scopes: `openid profile email`

### 4. CNP に HTTPS egress を追加

Google エンドポイントへのアクセスに HTTPS 443 の egress が必要:

```yaml
- toCIDR:
    - 0.0.0.0/0
  toPorts:
    - ports:
        - port: "443"
          protocol: TCP
```

## 注意事項

- Google の access token は opaque (JWT ではない)。Grafana では `email_attribute_path: email` を明示的に設定すること
- OAuth プロバイダを切り替える場合、Grafana は一時的に `oauth_allow_insecure_email_lookup: true` が必要（既存ユーザーの auth_id 再紐付け）
- `allowed_domains: tgy.io` で組織外ユーザーのログインを制限
- Cilium Gateway bug ([#41970](https://github.com/cilium/cilium/issues/41970)) により、クロスネームスペースの HTTP 通信が L7 proxy で 403 になる場合がある。SSO は外部 IdP に直接接続する構成が安定する
