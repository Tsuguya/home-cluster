# home-cluster

ArgoCD GitOps で管理するホーム Kubernetes クラスタの構成リポジトリ。

## Stack

| Category | Tool |
|----------|------|
| OS | Talos Linux |
| CNI | Cilium (kube-proxy replacement) |
| GitOps | ArgoCD |
| Storage | Rook Ceph, QNAP CSI |
| Monitoring | Prometheus, Grafana, Loki, Alloy |
| Certificates | cert-manager (Let's Encrypt) |
| DNS | external-dns (Cloudflare) |
| Secrets | 1Password Operator |
| Database | CloudNativePG |
| CI/CD | Argo Workflows, Argo Events |
| Gateway | Cilium Gateway API |

## Nodes

| Node | Hardware | RAM |
|------|----------|-----|
| cp-01〜03 | Minisforum S100 (Intel N150) | - |
| wn-01 | TRIGKEY G4 | 32GB |
| wn-02 | NiPoGi AK2Plus | 32GB |
| wn-03 | MINISFORUM UM790Pro | 64GB |

## Structure

```
apps/          # ArgoCD Application definitions
helm-values/   # Helm chart values
manifests/     # Raw K8s manifests
docs/          # Operational docs
```
