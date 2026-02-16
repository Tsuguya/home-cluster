# Services

## External (*.infra.tgy.io)

All services are TLS-terminated at the Gateway (cert-manager + Let's Encrypt).
HTTP requests are redirected to HTTPS (301).

| Service | URL | Backend |
|---|---|---|
| ArgoCD | https://argocd.infra.tgy.io | argocd-server (argocd) |
| Grafana | https://grafana.infra.tgy.io | kube-prometheus-stack-grafana:80 (monitoring) |
| Hubble UI | https://hubble.infra.tgy.io | hubble-ui:80 (kube-system) |
| Ceph Dashboard | https://ceph.infra.tgy.io | rook-ceph-mgr-dashboard:7000 (rook-ceph) |
| Argo Workflows | https://argo.infra.tgy.io | argo-workflows-server:2746 (argo) |

## Internal

| Service | Endpoint | Notes |
|---|---|---|
| PostgreSQL (RW) | shared-pg-rw.database.svc:5432 | CNPG managed, 2 instances |
| PostgreSQL (RO) | shared-pg-ro.database.svc:5432 | Read replicas |
| Loki | loki-gateway.monitoring.svc:80 | Log aggregation |
| Prometheus | kube-prometheus-stack-prometheus.monitoring.svc:9090 | Metrics |

## Databases (shared-pg)

| Database | Owner | Used by |
|---|---|---|
| grafana | app | Grafana (kube-prometheus-stack) |
| argo | app | Argo Workflows |

Credentials: 1Password "Shared PostgreSQL" → OnePasswordItem per namespace.
