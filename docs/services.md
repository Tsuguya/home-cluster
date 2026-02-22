# Services

## External (*.infra.tgy.io)

TLS-terminated at the Gateway (cert-manager + Let's Encrypt). HTTP requests are redirected to HTTPS (301).
ArgoCD のみ TLS Passthrough（専用 argocd-gateway、ArgoCD 自身が TLS 終端）。

| Service | URL | Backend | TLS |
|---|---|---|---|
| ArgoCD | https://argocd.infra.tgy.io | argocd-server (argocd) | Passthrough (argocd-gateway) |
| Grafana | https://grafana.infra.tgy.io | kube-prometheus-stack-grafana:80 (monitoring) | Terminate (main-gateway) |
| Hubble UI | https://hubble.infra.tgy.io | hubble-ui:80 (kube-system) | Terminate (main-gateway) |
| Ceph Dashboard | https://ceph.infra.tgy.io | rook-ceph-mgr-dashboard:7000 (rook-ceph) | Terminate (main-gateway) |
| Argo Workflows | https://argo.infra.tgy.io | argo-workflows-server:2746 (argo) | Terminate (main-gateway) |

## Internal

| Service | Endpoint | Notes |
|---|---|---|
| PostgreSQL (RW) | shared-pg-rw.database.svc:5432 | CNPG managed, 2 instances |
| PostgreSQL (RO) | shared-pg-ro.database.svc:5432 | Read replicas |
| Loki | loki-gateway.monitoring.svc:80 | Log aggregation |
| Tempo (HTTP API) | tempo.monitoring.svc:3200 | Distributed tracing (query) |
| Tempo (OTLP gRPC) | tempo.monitoring.svc:4317 | Trace ingestion |
| Tempo (OTLP HTTP) | tempo.monitoring.svc:4318 | Trace ingestion |
| Prometheus | kube-prometheus-stack-prometheus.monitoring.svc:9090 | Metrics |

## Databases (shared-pg)

| Database | Owner | Used by |
|---|---|---|
| grafana | grafana | Grafana (kube-prometheus-stack) |
| argo | argo | Argo Workflows |

Credentials: 1Password per service → OnePasswordItem per namespace.

| 1Password Item | User | Secret Name | Namespaces |
|---|---|---|---|
| Shared PostgreSQL | app | shared-pg-credentials | database |
| Grafana PostgreSQL | grafana | grafana-pg-credentials | database, monitoring |
| Argo PostgreSQL | argo | argo-pg-credentials | database, argo |
