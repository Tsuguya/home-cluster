# home-cluster

ArgoCD GitOps で管理するホーム Kubernetes クラスタの構成リポジトリ。

## Stack

| Category | Tool |
|----------|------|
| OS | Talos Linux |
| CNI | Cilium (kube-proxy replacement) |
| GitOps | ArgoCD |
| Storage | SeaweedFS, QNAP CSI |
| Monitoring | Prometheus, Grafana, Loki, Tempo, Alloy |
| Certificates | cert-manager (Let's Encrypt) |
| DNS | external-dns (Cloudflare) |
| IdP | Kanidm |
| Secrets | 1Password Operator |
| Database | CloudNativePG |
| CI/CD | Argo Workflows, Argo Events |
| Gateway | Cilium Gateway API |

## Nodes

| Node | Hardware | RAM |
|------|----------|-----|
| cp-01〜03 | Minisforum S100 (Intel N100) | - |
| wn-01 | TRIGKEY G4 (Intel N100) | 32GB |
| wn-02 | NiPoGi AK2Plus (Intel N100) | 32GB |
| wn-03 | MINISFORUM UM790Pro (AMD 7940HS) | 64GB |

## Structure

```
apps/          # ArgoCD Application definitions
helm-values/   # Helm chart values
manifests/     # Raw K8s manifests
docs/          # Operational docs
manual/        # Manual bootstrap steps
```

## Documentation

- [Bootstrap手順](manual/README.md) — クラスタ再構築時の手動ステップ
- [サービス一覧](docs/services.md) — 外部/内部エンドポイント
- [SSO設定](docs/sso.md) — Kanidm OIDC 設定・新サービス追加手順
- [ネットワークポリシー](docs/network-policies.md) — CNP/CCNP 全ポリシー一覧
- [リソース設定](docs/resource-limits.md) — requests/limits 一覧と実測値
- [既知の問題](docs/known-issues.md) — 初回構築時の注意点など
