# SSO (シングルサインオン)

全サービスが Kanidm (self-hosted IdP) で認証する。

## 構成

| サービス | 認証方式 | IdP | Secret | 設定ファイル |
|---|---|---|---|---|
| ArgoCD | Built-in OIDC (PKCE) | Kanidm (パブリック) | なし | `helm-values/argocd/values.yaml` |
| Grafana | generic_oauth | Kanidm (コンフィデンシャル) | kanidm-grafana-oauth (monitoring) | `helm-values/kube-prometheus-stack/values.yaml` |
| Argo Workflows | OIDC | Kanidm (コンフィデンシャル) | kanidm-argo-workflows-oauth (argo) | `helm-values/argo-workflows/values.yaml` |
| Hubble UI | oauth2-proxy (OIDC) | Kanidm (コンフィデンシャル) | oauth2-proxy-hubble-oauth (oauth2-proxy) | `helm-values/oauth2-proxy-hubble/values.yaml` |

ArgoCD は Kanidm パブリッククライアント (PKCE S256) を使用するため、clientSecret 不要。

## Kanidm クライアント設定

### ArgoCD (パブリッククライアント)

```bash
kanidm system oauth2 create-public argocd "ArgoCD" https://argocd.infra.tgy.io --url https://idm.infra.tgy.io

kanidm system oauth2 add-redirect-url argocd https://argocd.infra.tgy.io/auth/callback --url https://idm.infra.tgy.io

kanidm group create argocd_users --url https://idm.infra.tgy.io
kanidm group add-members argocd_users tsuguya --url https://idm.infra.tgy.io

kanidm system oauth2 update-scope-map argocd argocd_users openid profile email --url https://idm.infra.tgy.io

kanidm system oauth2 prefer-short-username argocd --url https://idm.infra.tgy.io

kanidm system oauth2 enable-localhost-redirects argocd --url https://idm.infra.tgy.io
```

### Grafana (コンフィデンシャルクライアント)

```bash
kanidm system oauth2 create grafana "Grafana" https://grafana.infra.tgy.io --url https://idm.infra.tgy.io

kanidm system oauth2 add-redirect-url grafana https://grafana.infra.tgy.io/login/generic_oauth --url https://idm.infra.tgy.io

kanidm group create grafana_users --url https://idm.infra.tgy.io
kanidm group add-members grafana_users tsuguya --url https://idm.infra.tgy.io

kanidm system oauth2 update-scope-map grafana grafana_users openid profile email --url https://idm.infra.tgy.io

kanidm system oauth2 prefer-short-username grafana --url https://idm.infra.tgy.io

kanidm system oauth2 show-basic-secret grafana --url https://idm.infra.tgy.io
```

カスタムクレームでグループ → Grafana ロールのマッピングを設定:

```bash
kanidm system oauth2 update-claim-map grafana grafana_role grafana_users Admin --url https://idm.infra.tgy.io
kanidm system oauth2 update-claim-map-join grafana grafana_role csv --url https://idm.infra.tgy.io
```

ID トークンに `"grafana_role": "Admin"` が含まれるようになる（`grafana_users` グループのメンバーのみ）。
Grafana 側は `role_attribute_path: grafana_role` でこの値を参照する。

clientSecret は 1Password (kanidm-grafana-oauth) に保存し、OnePasswordItem 経由でデプロイ。

### Argo Workflows (コンフィデンシャルクライアント)

```bash
kanidm system oauth2 create argo-workflows "Argo Workflows" https://argo.infra.tgy.io --url https://idm.infra.tgy.io

kanidm system oauth2 add-redirect-url argo-workflows https://argo.infra.tgy.io/oauth2/callback --url https://idm.infra.tgy.io

kanidm group create argo_workflows_users --url https://idm.infra.tgy.io
kanidm group add-members argo_workflows_users tsuguya --url https://idm.infra.tgy.io

kanidm system oauth2 update-scope-map argo-workflows argo_workflows_users openid profile email --url https://idm.infra.tgy.io

kanidm system oauth2 prefer-short-username argo-workflows --url https://idm.infra.tgy.io

kanidm system oauth2 warning-insecure-client-disable-pkce argo-workflows --url https://idm.infra.tgy.io

kanidm system oauth2 show-basic-secret argo-workflows --url https://idm.infra.tgy.io
```

Argo Workflows は PKCE 未サポートのため `warning-insecure-client-disable-pkce` が必要。
clientSecret は 1Password (kanidm-argo-workflows-oauth) に保存し、OnePasswordItem 経由でデプロイ。

### Hubble UI (oauth2-proxy, コンフィデンシャルクライアント)

```bash
kanidm system oauth2 create oauth2-proxy-hubble "Hubble UI" https://hubble.infra.tgy.io --url https://idm.infra.tgy.io

kanidm system oauth2 add-redirect-url oauth2-proxy-hubble https://hubble.infra.tgy.io/oauth2/callback --url https://idm.infra.tgy.io

kanidm group create hubble_users --url https://idm.infra.tgy.io
kanidm group add-members hubble_users tsuguya --url https://idm.infra.tgy.io

kanidm system oauth2 update-scope-map oauth2-proxy-hubble hubble_users openid profile email --url https://idm.infra.tgy.io

kanidm system oauth2 prefer-short-username oauth2-proxy-hubble --url https://idm.infra.tgy.io

kanidm system oauth2 show-basic-secret oauth2-proxy-hubble --url https://idm.infra.tgy.io
```

oauth2-proxy 経由で認証。clientSecret + cookieSecret を 1Password (oauth2-proxy-hubble-oauth) に保存。

## 1Password アイテム

| アイテム | Secret 名 | Namespace | キー |
|---|---|---|---|
| kanidm-grafana-oauth | kanidm-grafana-oauth | monitoring | clientID, clientSecret |
| kanidm-argo-workflows-oauth | kanidm-argo-workflows-oauth | argo | clientID, clientSecret |
| oauth2-proxy-hubble-oauth | oauth2-proxy-hubble-oauth | oauth2-proxy | client-id, client-secret, cookie-secret |

ArgoCD はパブリッククライアントのため 1Password アイテム不要。
oauth2-proxy の Secret キーは chart の `existingSecret` が期待する `client-id`, `client-secret`, `cookie-secret`。

## 新サービスに Kanidm SSO を追加する手順

### 1. Kanidm でクライアント作成

```bash
# コンフィデンシャルクライアント (clientSecret あり)
kanidm system oauth2 create <client_name> "<Display Name>" https://<service>.infra.tgy.io --url https://idm.infra.tgy.io

# またはパブリッククライアント (PKCE のみ、clientSecret なし)
kanidm system oauth2 create-public <client_name> "<Display Name>" https://<service>.infra.tgy.io --url https://idm.infra.tgy.io
```

### 2. リダイレクト URL とスコープマップ

```bash
kanidm system oauth2 add-redirect-url <client_name> https://<service>.infra.tgy.io/<callback_path> --url https://idm.infra.tgy.io

kanidm system oauth2 update-scope-map <client_name> <group> openid profile email --url https://idm.infra.tgy.io

kanidm system oauth2 prefer-short-username <client_name> --url https://idm.infra.tgy.io
```

### 3. コンフィデンシャルクライアントの場合: Secret をデプロイ

```bash
kanidm system oauth2 show-basic-secret <client_name> --url https://idm.infra.tgy.io
```

1Password に API Credential として保存し、`manifests/secrets/` に OnePasswordItem を作成する。

### 4. CNP に Kanidm egress を追加

```yaml
- toEndpoints:
    - matchLabels:
        app.kubernetes.io/name: kanidm
        io.kubernetes.pod.namespace: kanidm
  toPorts:
    - ports:
        - port: "8443"
          protocol: TCP
```

`manifests/kanidm/netpol-kanidm.yaml` にも対応する ingress ルールを追加すること。

## Kanidm エンドポイント

| エンドポイント | URL |
|---|---|
| Issuer | `https://idm.infra.tgy.io/oauth2/openid/<client_name>` |
| Authorization | `https://idm.infra.tgy.io/ui/oauth2` |
| Token | `https://idm.infra.tgy.io/oauth2/token` |
| Userinfo | `https://idm.infra.tgy.io/oauth2/openid/<client_name>/userinfo` |

## 注意事項

- Kanidm は PKCE S256 を要求する。ArgoCD は PKCE + clientSecret の同時使用に問題がある ([#23773](https://github.com/argoproj/argo-cd/issues/23773)) ためパブリッククライアントを使用
- Argo Workflows は PKCE 未サポート（`golang.org/x/oauth2` の標準 `AuthCodeURL` を PKCE オプションなしで使用）のためコンフィデンシャルクライアント + `warning-insecure-client-disable-pkce` が必要
- Kanidm の `prefer-short-username` でユーザー名を短縮形にする（RBAC マッチに影響）
- Cilium Gateway bug ([#41970](https://github.com/cilium/cilium/issues/41970)) により、クロスネームスペース HTTP が L7 proxy で 403 になる場合がある。Kanidm は CoreDNS rewrite で Service に直接接続する構成が安定する
- OAuth プロバイダを切り替える場合、Grafana は一時的に `oauth_allow_insecure_email_lookup: true` が必要（既存ユーザーの auth_id 再紐付け）
