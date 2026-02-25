# Talos SecureBoot

## 概要

Worker ノードで UEFI SecureBoot を有効化。カスタム署名鍵で UKI (Unified Kernel Image) を署名し、ブートチェーンの整合性を保証する。

CP ノード（Minisforum S100）は UEFI が SecureBoot カスタムキー登録に非対応のため対象外。

## アーキテクチャ

```
GHA (talos-custom-build)              Argo Workflows (argo namespace)
┌────────────────────────┐            ┌──────────────────────────────────────┐
│ kernel (UFS config)    │            │ imager (SecureBoot signing)          │
│ installer-base         │            │  ├─ secureboot-installer → GHCR     │
│ imager                 │──webhook──→│  ├─ secureboot-iso      → GH Release│
│ Pre-release 作成       │            │  └─ iso (PXE assets)   → GH Release│
└────────────────────────┘            │ finalize-release (pre→release)      │
                                      └──────────────────────────────────────┘
```

- **GHA**: カスタムカーネル + imager ビルド（秘密不要）
- **Argo WF**: SecureBoot 署名（署名鍵はクラスタ内 1Password 管理）
- 署名鍵が GitHub に渡らない（リポジトリはパブリック）

## ノード状態

| ノード | HW | SecureBoot | 備考 |
|--------|-----|-----------|------|
| cp-03 | Minisforum S100 | **有効** | UEFI リセット + boot override で登録（下記参照） |
| cp-01/02 | Minisforum S100 | 未適用 | cp-03 と同じ手順で可能 |
| wn-01 | TRIGKEY G4 | **有効** | UEFI Key Management から USB で .auth 登録 |
| wn-02 | NiPoGi AK2Plus | **有効** | 同上 |
| wn-03 | Minisforum UM790Pro | **非対応** | UEFI が対応していない |

## 署名鍵

`talosctl gen secureboot` で生成、1Password vault `home-cluster` の `secureboot-signing-keys` に保存。

| ファイル | 用途 |
|----------|------|
| `uki-signing-key.pem` | UKI 署名秘密鍵 |
| `uki-signing-cert.pem` | UKI 署名証明書 |
| `pcr-signing-key.pem` | PCR 署名秘密鍵 |
| `PK.auth` | Platform Key (UEFI 登録用) |
| `KEK.auth` | Key Exchange Key |
| `db.auth` | Signature Database |

OnePasswordItem: `manifests/secrets/argo-secureboot-signing-keys.yaml`

## ビルドパイプライン

### 関連ファイル

| ファイル | 内容 |
|----------|------|
| `manifests/argo/talos-secureboot-build.yaml` | WorkflowTemplate + SA + RBAC |
| `manifests/argo/talos-build-scripts.yaml` | push-installer.sh, push-iso.sh, finalize-release.sh |
| `manifests/argo/talos-build-sensor.yaml` | Sensor (release webhook → WF trigger) |

### トリガーフロー

1. GHA が `talos-custom-build` で imager + installer-base をビルド → GHCR push
2. GHA が pre-release 作成 → GitHub webhook
3. Argo Events Sensor が `prerelease: true` のリリースをフィルタ
4. Argo WF が imager コンテナで SecureBoot installer/ISO をビルド
5. GHCR に installer push、GitHub Release に ISO + PXE assets upload
6. Release を pre-release → release に更新

### カーネル引数

```yaml
--extra-kernel-arg "-lockdown"
--extra-kernel-arg "lockdown=integrity"
```

SecureBoot プロファイルはデフォルトで `lockdown=confidentiality` を設定するが、これは BPF の `bpf_probe_read` をブロックし **Tetragon と Cilium eBPF を壊す**。`lockdown=integrity` に上書きすることで、カーネル整合性保護を維持しつつ BPF を許可する。

## iscsi-tools 互換性問題

### 問題

siderolabs/extensions の `fb4eb042` ("consolidate extension services") で iscsi-tools のアーキテクチャが変更された:

- **旧**: バイナリをホスト rootfs overlay (`/usr/local/sbin/`) に配置 + bind mount でコンテナに共有
- **新**: 自己完結型コンテナ rootfs (`/usr/local/lib/containers/iscsid/`) にのみ配置

Trident CSI はホストの `/usr/local/sbin/iscsiadm` を参照するため、新アーキテクチャでは iSCSI マウントが失敗する。

### 対策

旧アーキテクチャ版の extension image をミラーして pin:

```
ghcr.io/tsuguya/iscsi-tools:v0.2.0-pre-consolidation
```

元イメージ: `ghcr.io/siderolabs/iscsi-tools@sha256:b30127b2f3ea6a49aa73dcf18c30da1fa1d2604da00c60519f8f00b4c6d25294`

**暫定措置**: siderolabs/extensions がホストレベルバイナリ配置を復活したら、公式版に戻す。

## 新ノードへの SecureBoot 適用手順

### 前提

- `ghcr.io/tsuguya/installer:vX.Y.Z` に SecureBoot 署名済み installer が存在
- USB に .auth ファイル（PK.auth, KEK.auth, db.auth）をコピー済み

### 方法 A: UEFI Key Management（TRIGKEY G4 / NiPoGi AK2Plus）

1. **installer アップグレード**
   ```bash
   talosctl upgrade --image ghcr.io/tsuguya/installer:vX.Y.Z -n <NODE_IP>
   ```

2. **UEFI キー登録**（物理アクセス必要）
   - UEFI 設定 → Key Management
   - USB から PK.auth, KEK.auth, db.auth をインポート

3. **SecureBoot 有効化**
   - UEFI 設定 → Secure Boot → Enabled
   - 保存して再起動

### 方法 B: UEFI リセット + boot override（Minisforum S100）

S100 の UEFI は Key Management メニューがなく、Setup Mode にも直接入れない。
以下の方法で SecureBoot キーを登録できる。

1. **installer アップグレード**
   ```bash
   talosctl upgrade --image ghcr.io/tsuguya/installer:vX.Y.Z -n <NODE_IP>
   ```

2. **USB 準備**: .auth ファイル（PK.auth, KEK.auth, db.auth）を FAT32 USB にコピー

3. **UEFI リセット実行**: UEFI 設定からリセット（工場出荷状態に戻す）

4. **boot override で割り込み**: リセット後、通常2回リブートが走る（この間にデフォルトキーが復元される）。**1回目のリブートで boot override を使い UEFI Shell に入る**。この時点で Setup Mode になっている。

5. **UEFI Shell からキー登録**: Shell 内で USB の .auth ファイルを使いキー登録（db → KEK → PK の順、PK 登録で Setup Mode 終了）

6. **SecureBoot 有効化**: UEFI 設定 → Secure Boot → Enabled → 保存して再起動

**注意**:
- SecureBoot ON では UEFI Shell に入れない（署名チェックで弾かれる）
- SecureBoot OFF では UEFI 変数の書き込みが拒否される
- UEFI リセット後の Setup Mode 経由タイミングで割り込むのがポイント
- 失敗しても CMOS クリア（バッテリー外し）で復旧可能

### 確認

```bash
talosctl -n <NODE_IP> get securitystate
# SecureBoot: true を確認
```

### 注意: 未署名 installer で SecureBoot ON にしない

SecureBoot 有効の UEFI に未署名 installer を書くと **Secure Boot Violation** で起動不能になる。復旧には物理アクセスで UEFI SecureBoot 無効化が必要。

## 次のステップ

- [ ] cp-01/02 に SecureBoot 適用（方法 B）
- [ ] TPM ディスク暗号化（SecureBoot 有効ノードのみ）
- [ ] siderolabs/extensions に issue: ホストレベル iscsiadm 復活要求
