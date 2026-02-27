# 既知の問題

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

## Grafana ダッシュボードで "No data" になるパネル

kube-prometheus-stack と Cilium のダッシュボードには、シングルクラスタ環境では "No data" になるパネルがある。これらはバグではない。

### エラー・イベント発生時のみ表示されるパネル

| ダッシュボード | パネル | 理由 |
|---|---|---|
| Kubernetes / Kubelet | Storage Operation Error Rate | `storage_operation_errors_total` はエラー発生時のみ存在 |
| Hubble / Network Overview | Missing ICMP Echo Reply | クラスタ内に ICMP トラフィックがない |
| Hubble / DNS Overview | Missing DNS responses | 未応答の DNS クエリがない |

### 特定条件が必要なパネル

| ダッシュボード | パネル | 理由 |
|---|---|---|
| Hubble L7 HTTP Metrics by Workload | CPU Usage by Source | L7 HTTP トラフィックは Gateway（外部）からのみ来るため `source_workload` が空 |
| Kubernetes / Compute Resources / Multi-Cluster | 全パネル | シングルクラスタ環境。kube-prometheus-stack では個別に無効化できない |

## Prometheus の cluster ラベル（シングルクラスタ環境）

`prometheusSpec.externalLabels.cluster` は remote write、federation、alertmanager にのみ適用される。ローカルの PromQL クエリや TSDB ストレージには影響しない。

**`defaultRules.additionalRuleLabels.cluster` を使ってはいけない。** recording rule に cluster ラベルを追加すると、recording rule は `cluster=home-cluster` を持つが生メトリクスには `cluster` ラベルがないため不整合が起きる。recording rule と生メトリクスを join するダッシュボードパネル（CPU Quota, Memory Quota, Network Usage 等）が No data になる。

シングルクラスタ環境では全メトリクスから `cluster` ラベルを除外する。Grafana 変数は空に解決され、`cluster=""` で全メトリクスに一貫してマッチする。

将来マルチクラスタや Thanos/Mimir が必要になった場合は、recording rule だけでなく全スクレイプターゲットの ServiceMonitor `metricRelabelings` で `cluster` を付与すること。

## iscsi-tools extension のホストバイナリ消失

siderolabs/extensions の `fb4eb042` ("consolidate extension services") で iscsi-tools のアーキテクチャが変更され、バイナリがホスト rootfs からコンテナ rootfs 内のみの配置に移行された。

**影響**: ホストの `/usr/local/sbin/iscsiadm` が消失し、Trident CSI が iSCSI ボリュームをマウントできなくなる。SeaweedFS の volume/filer が `ContainerCreating` でスタックする。

**根本原因**:

| バージョン | バイナリ配置 | Trident |
|-----------|-------------|---------|
| 旧 (consolidation 前) | `/usr/local/sbin/iscsiadm` (ホスト) | OK |
| 新 (consolidation 後) | `/usr/local/lib/containers/iscsid/usr/local/sbin/iscsiadm` (コンテナ内のみ) | NG |

`c2bff8e8` ("fix: iscsi and rpcbind extensions", 2026-02-23) はコンテナ内パスの修正のみで、ホストレベル配置は未修復。

**対策**: 旧版 extension image を自前 GHCR にミラーして pin。

```
ghcr.io/tsuguya/iscsi-tools:v0.2.0-pre-consolidation
```

- 元 digest: `sha256:b30127b2f3ea6a49aa73dcf18c30da1fa1d2604da00c60519f8f00b4c6d25294`
- WorkflowTemplate `talos-secureboot-build` の `--system-extension-image` で指定

**診断方法**:

```bash
# ホストに iscsiadm があるか
talosctl -n <NODE_IP> ls /usr/local/sbin/

# iscsid サービスの状態
talosctl -n <NODE_IP> services ext-iscsid

# Trident ログで iSCSI 検出確認
kubectl -n trident logs <trident-node-pod> -c trident-main | grep -i iscsi
```

**注意**:
- Talos ホストにシェル (`/bin/sh`) がないため wrapper script による回避は不可
- upstream が修正されたらミラー版から公式版に戻すこと
- TODO: siderolabs/extensions に issue 提出

## QNAP Trident iSCSI: ノード移動時の LUN リフォーマット

Pod がノード間を移動した際に、Trident CSI が iSCSI LUN を再フォーマットしてデータを全消失させるバグ。2026-02-27 の K8s v1.35.2 アップグレード時に SeaweedFS volume で発生。

**根本原因チェーン**:

1. K8s アップグレード等で API server が再起動
2. Trident コントローラーが API 接続断で再起動、ブートストラップ中にバックエンドが一時不可
3. Pod が別ノードに再スケジュール（liveness probe 失敗等）
4. 移動先ノードに前回の stale iSCSI セッションが残存（portal 情報が空 `:3260`）
5. FSType チェック失敗 → Trident がデバイスを ext4 で再フォーマット → **データ全消失**

**対策: nodeSelector / nodeAffinity でノード固定**

Pod がノード間を移動しなければ stale iSCSI セッション問題は発生しない。iSCSI PVC を持つ全ワークロードを現在稼働中のノードに固定する。

| ワークロード | 固定先 | 方式 |
|---|---|---|
| kanidm | wn-02, wn-03 | nodeAffinity (StatefulSet 2 replicas) |
| seaweedfs volume/filer | wn-02 | nodeSelector |
| prometheus | wn-02 | nodeSelector |
| loki | wn-03 | nodeSelector |
| tempo | wn-01 | nodeSelector |

**レプリケーション HA を持つワークロードの方針**:

Kanidm のようにレプリケーションでデータ冗長性を持つワークロードは、可能であれば iSCSI を使わずローカルディスク（Local PV）を使う。これにより QNAP CSI 依存を完全排除できる。ノード障害時はもう片方の Pod がサービス継続し、復旧後にレプリケーションで再同期。

**レプリケーションなしのワークロード**:

nodeSelector で固定し PDB で voluntary eviction を防止。ノード障害時は復旧を待つ。

**注意事項**:

- 新たに iSCSI PVC を使うワークロードを追加する際は必ず nodeSelector を設定すること
- K8s アップグレード前に iSCSI ワークロードの配置を確認（`kubectl get pods -o wide`）
- emptyDir は Pod 削除でデータ消失するため、DB 系ワークロードにはレプリケーション併用でも不適（レプリケーション証明書も消失するため手動復旧が必要になる）

## QNAP CSI (trident-operator) CPU limit ハードコード

QNAP CSI Helm chart (v1.6.0) は `bundle.yaml` テンプレート内で `resources.limits.cpu: 20m` をハードコードしており、values で上書きできない。この制限により CPUThrottlingHigh アラートが発生する。

**対策**: Helm source をやめ、`helm template` でレンダリングした manifests を `kustomize/qnap-csi/` に配置。Kustomize JSON patch で CPU limit を除去。

```
kustomize/qnap-csi/
├── kustomization.yaml              # JSON patch: limits.cpu を除去
├── upstream.yaml                   # helm template 出力 (v1.6.0)
└── crds/tridentorchestrator_crd.yaml
```

**アップグレード手順**:

1. 新バージョンの chart を clone
2. `helm template qnap-trident <chart-path> -n trident -f <values> --kube-version 1.32.0` で再レンダリング
3. `upstream.yaml` を差し替え、CRD に変更があれば `crds/` も更新
4. push → ArgoCD sync（Kustomize patch が自動適用される）
