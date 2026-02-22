# SSO (Single Sign-On)

Kanidm (self-hosted IdP) と Google OIDC の併用構成。Kanidm 移行済みサービスは Kanidm に直接認証する。

## 構成

| Service | Auth Method | IdP | Secret | Config |
|---|---|---|---|---|
| ArgoCD | Built-in OIDC (PKCE) | Kanidm (public client) | なし | `helm-values/argocd/values.yaml` |
| Grafana | generic_oauth | Kanidm | kanidm-grafana-oauth (monitoring) | `helm-values/kube-prometheus-stack/values.yaml` |
| Argo Workflows | OIDC (Google) | Google | google-oauth (argo) | `helm-values/argo-workflows/values.yaml` |

ArgoCD は Kanidm public client (PKCE S256) を使用するため、clientSecret 不要。

## Kanidm クライアント設定

### ArgoCD (public client)

```bash
kanidm system oauth2 create-public argocd "ArgoCD" https://argocd.infra.tgy.io --url https://idm.infra.tgy.io

kanidm system oauth2 add-redirect-url argocd https://argocd.infra.tgy.io/auth/callback --url https://idm.infra.tgy.io

kanidm group create argocd_users --url https://idm.infra.tgy.io
kanidm group add-members argocd_users tsuguya --url https://idm.infra.tgy.io

kanidm system oauth2 update-scope-map argocd argocd_users openid profile email --url https://idm.infra.tgy.io

kanidm system oauth2 prefer-short-username argocd --url https://idm.infra.tgy.io
```

### Grafana (confidential client)

```bash
kanidm system oauth2 create grafana "Grafana" https://grafana.infra.tgy.io --url https://idm.infra.tgy.io

kanidm system oauth2 add-redirect-url grafana https://grafana.infra.tgy.io/login/generic_oauth --url https://idm.infra.tgy.io

kanidm group create grafana_users --url https://idm.infra.tgy.io
kanidm group add-members grafana_users tsuguya --url https://idm.infra.tgy.io

kanidm system oauth2 update-scope-map grafana grafana_users openid profile email --url https://idm.infra.tgy.io

kanidm system oauth2 prefer-short-username grafana --url https://idm.infra.tgy.io

kanidm system oauth2 show-basic-secret grafana --url https://idm.infra.tgy.io
```

clientSecret は 1Password (kanidm-grafana-oauth) に保存し、OnePasswordItem 経由でデプロイ。

## 1Password Items

| Item | Secret Name | Namespaces | Keys |
|---|---|---|---|
| google-oauth | google-oauth | monitoring, argo | clientID, clientSecret |
| kanidm-grafana-oauth | kanidm-grafana-oauth | monitoring | clientID, clientSecret |

ArgoCD は public client のため 1Password item 不要。

## 新サービスに Kanidm SSO を追加する手順

### 1. Kanidm でクライアント作成

```bash
# Confidential client (clientSecret あり)
kanidm system oauth2 create <client_name> "<Display Name>" https://<service>.infra.tgy.io --url https://idm.infra.tgy.io

# または Public client (PKCE のみ、clientSecret なし)
kanidm system oauth2 create-public <client_name> "<Display Name>" https://<service>.infra.tgy.io --url https://idm.infra.tgy.io
```

### 2. リダイレクト URL とスコープマップ

```bash
kanidm system oauth2 add-redirect-url <client_name> https://<service>.infra.tgy.io/<callback_path> --url https://idm.infra.tgy.io

kanidm system oauth2 update-scope-map <client_name> <group> openid profile email --url https://idm.infra.tgy.io

kanidm system oauth2 prefer-short-username <client_name> --url https://idm.infra.tgy.io
```

### 3. Confidential client の場合: Secret をデプロイ

```bash
kanidm system oauth2 show-basic-secret <client_name> --url https://idm.infra.tgy.io
```

1Password に API Credential として保存し、`manifests/secrets/` に OnePasswordItem を作成。

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

| Endpoint | URL |
|---|---|
| Issuer | `https://idm.infra.tgy.io/oauth2/openid/<client_name>` |
| Authorization | `https://idm.infra.tgy.io/ui/oauth2` |
| Token | `https://idm.infra.tgy.io/oauth2/token` |
| Userinfo | `https://idm.infra.tgy.io/oauth2/openid/<client_name>/userinfo` |

## 注意事項

- Kanidm は PKCE S256 を要求する。ArgoCD は PKCE + clientSecret の同時使用に問題がある ([#23773](https://github.com/argoproj/argo-cd/issues/23773)) ため public client を使用
- Kanidm の `prefer-short-username` でユーザー名を短縮形にする（RBAC マッチに影響）
- Cilium Gateway bug ([#41970](https://github.com/cilium/cilium/issues/41970)) により、クロスネームスペース HTTP が L7 proxy で 403 になる場合がある。Kanidm は CoreDNS rewrite で Service に直接接続する構成が安定する
- OAuth プロバイダを切り替える場合、Grafana は一時的に `oauth_allow_insecure_email_lookup: true` が必要（既存ユーザーの auth_id 再紐付け）
