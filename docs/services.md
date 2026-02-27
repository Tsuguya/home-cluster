# サービス一覧

## 外部公開 (*.infra.tgy.io)

Gateway で TLS 終端（cert-manager + Let's Encrypt）。HTTP は HTTPS にリダイレクト（301）。
ArgoCD のみ TLS Passthrough（専用 argocd-gateway、ArgoCD 自身が TLS 終端）。

| サービス | URL | バックエンド | TLS |
|---|---|---|---|
| Kanidm | https://idm.tgy.io | kanidm:443 (kanidm) | Passthrough (kanidm-gateway) |
| ArgoCD | https://argocd.infra.tgy.io | argocd-server (argocd) | Passthrough (argocd-gateway) |
| Grafana | https://grafana.infra.tgy.io | kube-prometheus-stack-grafana:80 (monitoring) | Terminate (main-gateway) |
| Hubble UI | https://hubble.infra.tgy.io | hubble-ui:80 (kube-system) | Terminate (main-gateway) |
| Argo Workflows | https://argo.infra.tgy.io | argo-workflows-server:2746 (argo) | Terminate (main-gateway) |
| SeaweedFS UI | https://seaweedfs.infra.tgy.io | oauth2-proxy-seaweedfs:4180 (oauth2-proxy) → seaweedfs-filer:8888 | Terminate (main-gateway) |

## 内部サービス

| サービス | エンドポイント | 備考 |
|---|---|---|
| PostgreSQL (RW) | shared-pg-rw.database.svc:5432 | CNPG 管理、2 インスタンス |
| PostgreSQL (RO) | shared-pg-ro.database.svc:5432 | リードレプリカ |
| Loki | loki-gateway.monitoring.svc:80 | ログ集約 |
| Tempo (HTTP API) | tempo.monitoring.svc:3200 | 分散トレーシング（クエリ） |
| Tempo (OTLP gRPC) | tempo.monitoring.svc:4317 | トレース取り込み |
| Tempo (OTLP HTTP) | tempo.monitoring.svc:4318 | トレース取り込み |
| Prometheus | kube-prometheus-stack-prometheus.monitoring.svc:9090 | メトリクス |

## データベース (shared-pg)

| データベース | オーナー | 利用サービス |
|---|---|---|
| grafana | grafana | Grafana (kube-prometheus-stack) |
| argo | argo | Argo Workflows |

クレデンシャルはサービスごとに 1Password → OnePasswordItem で各 namespace にデプロイ。

| 1Password アイテム | ユーザー | Secret 名 | Namespace |
|---|---|---|---|
| Shared PostgreSQL | app | shared-pg-credentials | database |
| Grafana PostgreSQL | grafana | grafana-pg-credentials | database, monitoring |
| Argo PostgreSQL | argo | argo-pg-credentials | database, argo |
