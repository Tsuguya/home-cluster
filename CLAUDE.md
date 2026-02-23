# home-cluster

ArgoCD GitOps で管理される Kubernetes マニフェスト・Helm values。push → ArgoCD が即座に sync（selfHeal: true, prune: true）。

## ディレクトリ構成

```
apps/              # ArgoCD Application 定義（各サービス1ファイル）
argocd/            # app-of-apps.yaml（ArgoCD ブートストラップ）
helm-values/       # Helm chart の values.yaml（サービスごとにディレクトリ）
manifests/         # 生の K8s マニフェスト（namespace ごとにディレクトリ）
  infra/           # Gateway, CertManager, IP Pool, CCNP
  secrets/         # 全 OnePasswordItem（専用 secrets app で管理）
  storage/         # CSI StorageClass, Backend
docs/              # 運用ドキュメント
```

## 変更パターン

- **新サービス**: `apps/` に Application YAML + `helm-values/` に values.yaml
- **Secrets**: `manifests/secrets/` に OnePasswordItem YAML → 1Password Operator が Secret 自動生成（専用 `secrets` app で他 app の reconcile から隔離）
- **CNP 変更**: `manifests/<namespace>/netpol-*.yaml` + `docs/network-policies.md` を同時に更新。作業前に `docs/network-policies.md` を読んで通信の全体像を把握すること
- **SSO 追加**: `docs/sso.md` の手順に従う

## CiliumNetworkPolicy (CNP) 規約

全 Pod に CNP を適用（デフォルト deny）。DNS egress は CCNP (`manifests/infra/ccnp-dns.yaml`) で全 Pod に共通適用済み。新しい CNP を作るときは以下を守る:

### egress の必須ルール
```yaml
egress:
  # 1. DNS は CCNP で共通適用済み — 個別 CNP には不要
  # 2. kube-apiserver が必要なら toEntities で
  - toEntities:
      - kube-apiserver
  # 3. 外部 HTTPS は toCIDR 0.0.0.0/0:443
  - toCIDR:
      - 0.0.0.0/0
    toPorts:
      - ports:
          - port: "443"
            protocol: TCP
```

### クロスネームスペース通信
- `io.kubernetes.pod.namespace` ラベルで namespace を指定
- ingress 側と egress 側の両方で許可が必要

### 確認手順
- `hubble observe --verdict DROPPED` で Policy denied を確認
- `http-request DROPPED` = L7 proxy drop（`toPorts` 起因）
- `Policy denied DROPPED` = L3/L4 drop

## Helm values 規約

- コメントは最小限（設定の意図が自明でない場合のみ）
- Secret は envValueFrom + secretKeyRef で注入（ハードコード禁止）
- 不要になった設定は削除（コメントアウトで残さない）

## 検証

変更後は以下を確認:
1. `kubectl get pods -A` — 全 Pod が Running
2. `hubble observe --verdict DROPPED` — 意図しない drop がないこと
3. ノードリブート後も正常復帰すること

## 注意事項

- push は即座に本番反映される。変更内容をよく確認してから push
- Cilium Gateway bug (#41970): HTTPRoute が付いた Service は `world` identity になり L7 proxy で 403 になる。クロスネームスペース HTTP は避ける
