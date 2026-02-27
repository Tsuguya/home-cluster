# 災害復旧

R2 オフサイトバックアップからの復旧手順。

## バックアップ構成

| 対象 | 方式 | スケジュール | 保持期間 |
|------|------|-------------|---------|
| PostgreSQL (shared-pg) | CNPG barman → R2 | WAL: リアルタイム / base backup: 毎日 3:00 JST | CNPG: 7日 / R2: 14日 |
| etcd | talosctl snapshot → R2 | 毎日 4:00 JST | R2: 14日 |

バケット: `s3://home-cluster-backup/` (Cloudflare R2, APAC)

PostgreSQL は二段階の保持: CNPG が 7日で古いバックアップカタログを整理し、R2 ライフサイクルが 14日でオブジェクトを最終削除する。

## PostgreSQL 復旧

### 前提

- `r2-backup-credentials` Secret が database namespace に存在すること
- R2 バケットにバックアップが存在すること

### 手順

1. `shared-pg.yaml` の `bootstrap` セクションを `recovery` に変更:

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: shared-pg
  namespace: database
spec:
  # ... (既存の instances, resources, storage はそのまま)
  bootstrap:
    recovery:
      source: shared-pg-backup
      # PITR する場合は targetTime を指定
      # recoveryTarget:
      #   targetTime: "2026-02-22T09:00:00Z"
  externalClusters:
    - name: shared-pg-backup
      barmanObjectStore:
        destinationPath: s3://home-cluster-backup/cnpg/
        endpointURL: https://b0832b1c20a7cada26af0ac45862ce80.r2.cloudflarestorage.com
        s3Credentials:
          accessKeyId:
            name: r2-backup-credentials
            key: credential
          secretAccessKey:
            name: r2-backup-credentials
            key: password
  # managed, backup セクションは既存のまま残す
```

2. 既存 Cluster を削除して再作成（ArgoCD が自動 sync）:

```bash
kubectl delete cluster shared-pg -n database
git add manifests/database/shared-pg.yaml && git push
```

3. リカバリ完了後、`bootstrap` を元の `initdb` に戻して push（次回の再作成時に initdb に戻らないように）。ただし CNPG は bootstrap 済みクラスタの bootstrap セクション変更を無視するため、急がなくてよい。

### 確認

```bash
kubectl get cluster shared-pg -n database
kubectl logs -n database -l cnpg.io/cluster=shared-pg --tail=20
# "recovery completed" のログを確認
```

## Kanidm 復旧

Kanidm は 2 Pod レプリケーション構成（mutual-pull）。片方のデータロスは他方から再同期で復旧可能。

### 片方のデータロス

Pod が空 DB で再起動した場合、レプリケーション証明書も再生成されるため ConfigMap の更新が必要。

1. 新しい証明書を取得:

```bash
kubectl exec -n kanidm kanidm-<N> -- kanidmd show-replication-certificate -c /config/server.toml
```

2. `manifests/kanidm/configmap-repl.yaml` のパートナー証明書を更新して push

3. Reloader が Pod をローリングリスタート後、consumer refresh で同期:

```bash
kubectl exec -n kanidm kanidm-<N> -- kanidmd refresh-replication-consumer -c /config/server.toml
```

### 両方のデータロス

レプリケーションでは復旧不可。手動で Kanidm を再セットアップ:

1. `kanidmd recover-account admin` で初期管理者パスワードをリセット
2. ユーザー・グループ・OAuth2 クライアントを再作成
3. 各サービスの SSO 設定を確認

## etcd 復旧

### 前提

- 全 CP ノードの Talos API にアクセスできること
- talosctl + mc がインストール済み（WSL2 で実行）
- R2 の credentials を手元に持っていること

### 手順

1. R2 からスナップショットをダウンロード:

```bash
mc alias set r2 https://b0832b1c20a7cada26af0ac45862ce80.r2.cloudflarestorage.com <ACCESS_KEY> <SECRET_KEY>

# 最新のスナップショットを確認
mc ls r2/home-cluster-backup/etcd/

# ダウンロード
mc cp r2/home-cluster-backup/etcd/<TIMESTAMP>.db /tmp/etcd-snapshot.db
```

2. **全 CP ノード**の etcd メンバーをリセット:

```bash
# 全 CP に対して etcd を停止・ワイプ
talosctl -n 192.168.0.230,192.168.0.231,192.168.0.232 reset \
  --graceful=false --reboot --system-labels-to-wipe=EPHEMERAL
```

3. 1台目の CP でスナップショットからブートストラップ:

```bash
talosctl bootstrap --recover-from=/tmp/etcd-snapshot.db -n 192.168.0.230
```

4. 残りの CP が自動的に etcd クラスタに join するのを待つ:

```bash
talosctl -n 192.168.0.230 health \
  --control-plane-nodes 192.168.0.230,192.168.0.231,192.168.0.232 \
  --worker-nodes 192.168.0.200,192.168.0.201,192.168.0.202
```

### 注意

- `talosctl bootstrap --recover-from` は**クラスタが完全に壊れた場合**のみ使う
- 既存 etcd が動いている状態では実行しない
- リカバリ後、ArgoCD が全リソースを再 sync するため一時的に Pod の再起動が発生する
