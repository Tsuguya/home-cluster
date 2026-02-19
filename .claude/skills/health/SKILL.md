---
name: health
description: クラスタの健全性チェック。ノード状態、Pod 状態、hubble drop を一括確認
---

# クラスタヘルスチェック

以下の 3 項目を並列で確認し、結果をまとめて報告する。

## 1. ノード状態

```bash
kubectl get nodes -o wide
```

全ノードが Ready であること。NotReady があれば警告。

## 2. Pod 状態

```bash
kubectl get pods -A --no-headers | grep -v Running | grep -v Completed
```

異常な Pod（Error, CrashLoopBackOff, Pending 等）を一覧表示。
rook-ceph の Error/Completed Pod はリブート後の残骸の可能性がある。

## 3. Hubble drop 確認

```bash
hubble observe --verdict DROPPED --since 5m 2>&1 | grep -v "ICMPv6\|Unsupported L3 protocol\|Stale or unroutable\|level=WARN\|ICMP"
```

出力がある場合はドロップの要約を作成（送信元、宛先、ポート、理由）。
`Policy denied DROPPED` は CNP の設定漏れの可能性がある。

## 報告フォーマット

結果を以下の形式で簡潔に報告:

- **ノード**: N/N Ready（異常があればノード名を列挙）
- **Pod**: 異常 Pod 数と一覧（なければ「全 Pod 正常」）
- **Drop**: Policy denied の有無と概要（なければ「ドロップなし」）
