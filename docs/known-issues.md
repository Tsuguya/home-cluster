# Known Issues

## Grafana datasource の循環参照（初回構築時）

Loki と Tempo の datasource provisioning で相互参照（Logs↔Traces 相関）を設定している。
Grafana 12 は provisioning 時に `datasourceUid` の存在を検証するため、空 DB からの初回構築時に片方がまだ存在せず `data source not found` で起動に失敗する可能性がある。

**該当ファイル**: `helm-values/kube-prometheus-stack/values.yaml` の `additionalDataSources`

```
Loki  → derivedFields.datasourceUid: tempo   (Tempo がまだない可能性)
Tempo → tracesToLogsV2.datasourceUid: loki   (Loki は先に作成されるので OK)
```

**発生条件**: Grafana DB が空の状態での初回起動（新規クラスタ構築、DB リセット等）

**回復手順**:

1. `additionalDataSources` の Loki から `derivedFields` ブロックを一時削除
2. push して ArgoCD sync → Grafana が起動し、両 datasource が DB に作成される
3. `derivedFields` ブロックを戻して再度 push
4. Grafana pod を再起動（`kubectl delete pod -n monitoring -l app.kubernetes.io/name=grafana`）

**補足**: `derivedFields` はフロントエンド機能のため、実際には validate されず問題なく起動する可能性もある。Grafana の将来バージョンで provisioning 時の循環参照が解消される可能性あり。

## Grafana dashboards with expected "No data" panels

Some panels in kube-prometheus-stack and Cilium dashboards show "No data" by design in this single-cluster setup. These are not bugs.

### Panels that only appear when errors/events occur

| Dashboard | Panel | Reason |
|---|---|---|
| Kubernetes / Kubelet | Storage Operation Error Rate | `storage_operation_errors_total` only exists when errors occur |
| Hubble / Network Overview | Missing ICMP Echo Reply | No ICMP traffic in cluster |
| Hubble / DNS Overview | Missing DNS responses | No unanswered DNS queries |

### Panels that require specific conditions

| Dashboard | Panel | Reason |
|---|---|---|
| Hubble L7 HTTP Metrics by Workload | CPU Usage by Source | `source_workload` is empty because L7 HTTP traffic only comes from Gateway (external), not from pods |
| Kubernetes / Compute Resources / Multi-Cluster | All panels | Single-cluster setup; dashboard cannot be individually disabled in kube-prometheus-stack |

## Prometheus cluster label in single-cluster setup

`prometheusSpec.externalLabels.cluster` is set but only applies to remote write, federation, and alertmanager — NOT to local PromQL queries or TSDB storage.

**Do NOT use `defaultRules.additionalRuleLabels.cluster`** to add a cluster label to recording rules. This creates a mismatch: recording rules get `cluster=home-cluster` but raw scraped metrics have no `cluster` label. Dashboard panels that join recording rules with raw metrics (e.g. CPU Quota, Memory Quota, Network Usage) will return no data.

In a single-cluster setup, leave the `cluster` label absent from all metrics. Grafana variables resolve to empty, and `cluster=""` matches all metrics consistently.

If multi-cluster or Thanos/Mimir is needed in the future, add `cluster` to ALL metrics at scrape time via ServiceMonitor `metricRelabelings` on every scrape target — not just recording rules.
