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

| Role | Count | Hardware |
|------|-------|----------|
| Control Plane | 3 | Minisforum S100 (Intel N150) |
| Worker | 3 | TRIGKEY G4 |

## Structure

```
apps/          # ArgoCD Application definitions
helm-values/   # Helm chart values
manifests/     # Raw K8s manifests
docs/          # Operational docs
```
