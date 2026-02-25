# Talos SecureBoot

## 概要

全ノードで UEFI SecureBoot を有効化。カスタム署名鍵で UKI (Unified Kernel Image) を署名し、ブートチェーンの整合性を保証する。

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
| cp-01/02/03 | Minisforum S100 | **有効** | UEFI Shell + Reset To Setup Mode + auto-enrollment で登録 |
| wn-01 | TRIGKEY G4 | **有効** | UEFI Key Management から USB で .auth 登録 |
| wn-02 | NiPoGi AK2Plus | **有効** | 同上 |
| wn-03 | Minisforum UM790Pro | **有効** | UEFI Shell + Reset To Setup Mode + auto-enrollment で登録 |

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

### 方法 B: UEFI Shell + Reset To Setup Mode + auto-enrollment（Minisforum S100）

S100 の UEFI は Key Management メニューがなく、USB からの直接キーインポートができない。
UEFI Shell で .auth ファイルを ESP に配置し、systemd-boot の自動登録機能を利用する。

`secureboot-installer` は auto-enrollment 用の .auth ファイルを ESP に配置しない（設計上、キー登録済みが前提）。
そのため UEFI Shell で手動配置が必要。

0. **USB 準備**: FAT32 フォーマットした USB に PK.auth, KEK.auth, db.auth をコピー

1. **SecureBoot installer にアップグレード**
   ```bash
   talosctl upgrade --image ghcr.io/tsuguya/installer:vX.Y.Z -n <NODE_IP>
   ```

2. **UEFI 設定変更**（物理アクセス必要）
   - Secure Boot → **Disabled**
   - Secure Boot Mode → **Custom**

3. **UEFI Shell で .auth ファイルを ESP にコピー**
   - Save & Exit → UEFI Shell を起動
   - USB を挿入した状態で以下を実行:
   ```
   map -r
   ls fs0:\          # EFI, loader があるドライブを探す
   mkdir fs0:\loader\keys
   mkdir fs0:\loader\keys\auto
   cp fs1:\db.auth fs0:\loader\keys\auto\db.auth
   cp fs1:\KEK.auth fs0:\loader\keys\auto\KEK.auth
   cp fs1:\PK.auth fs0:\loader\keys\auto\PK.auth
   ```
   - `fs0:` が ESP、`fs1:` が USB（環境により異なるので `ls` で確認）
   - 完了後、再起動

4. **Reset To Setup Mode**: UEFI 設定 → Secure Boot → Custom → Reset To Setup Mode
   - ポップアップ: Reset To Setup Mode → **Yes**
   - ポップアップ: Reset Without Saving → **Cancel**

5. **Boot Override で起動**: Save & Exit → Boot Override からディスクを選択して起動
   - UEFI Shell は選ばないこと（Setup Mode では Shell から戻れなくなる場合がある）

6. **auto-enrollment 選択**: systemd-boot のブートメニューが表示される。**一番下の 「Enroll Secure Boot keys: auto」を選択**。`loader/keys/auto/` の PK/KEK/db が UEFI 変数に自動登録される。

7. **SecureBoot 有効化**: 再起動後、UEFI 設定 → Secure Boot → **Enabled** → 保存して再起動

**注意**:
- SecureBoot ON では UEFI Shell に入れない
- `secureboot-iso` を USB に焼いてブートする方法でも可（ISO には auto-enrollment 用 .auth が含まれている）
- 失敗しても CMOS クリア（バッテリー外し）で復旧可能

### 確認

```bash
talosctl -n <NODE_IP> get securitystate
# SecureBoot: true を確認
```

### 注意: 未署名 installer で SecureBoot ON にしない

SecureBoot 有効の UEFI に未署名 installer を書くと **Secure Boot Violation** で起動不能になる。復旧には物理アクセスで UEFI SecureBoot 無効化が必要。

## 次のステップ

- [x] 全ノード SecureBoot 有効化完了
- [ ] TPM ディスク暗号化（全ノード SecureBoot 有効済み）
- [ ] siderolabs/extensions に issue: ホストレベル iscsiadm 復活要求
