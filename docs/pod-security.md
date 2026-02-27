# Pod Security Admission (PSA)

Cluster-wide default is **restricted enforce** (configured in Talos `admissionControl`). Namespace labels override the default when needed.

## Namespace PSA Levels

| Namespace | enforce | Reason |
|---|---|---|
| 1password | restricted | |
| argo | restricted | init container + static binary DL で apk add 脱却 |
| argocd | restricted | |
| cert-manager | restricted | |
| cilium-secrets | (default) | Cilium helm 管理。明示ラベルなし、クラスタデフォルトで restricted |
| cnpg-system | restricted | |
| database | restricted | |
| default | restricted | Pod なし |
| external-dns | restricted | |
| gateway | restricted | Pod なし（Cilium agent 内 Envoy で処理） |
| kanidm | restricted | |
| kube-node-lease | restricted | Pod なし |
| kube-public | restricted | Pod なし |
| oauth2-proxy | restricted | |
| seaweedfs | restricted | |
| kube-system | privileged | Cilium, Tetragon, コントロールプレーン static pods |
| monitoring | privileged | node-exporter が hostPID/hostPath 必須 |
| trident | privileged | CSI ドライバが hostNetwork/hostPath/SYS_ADMIN 必須 |
| trivy-system | privileged | node-collector が hostPID/hostPath 必須 |

All namespaces also have `warn: restricted` and `audit: restricted` (except kube-system and trident which only have enforce).

## Default Configuration

Talos `admissionControl` patch in `home-infra/talconfig.yaml`:

```yaml
cluster:
  apiServer:
    admissionControl:
      - name: PodSecurity
        configuration:
          apiVersion: pod-security.admission.config.k8s.io/v1
          kind: PodSecurityConfiguration
          defaults:
            enforce: restricted
            enforce-version: latest
            warn: restricted
            warn-version: latest
            audit: restricted
            audit-version: latest
          exemptions:
            namespaces: []  # kube-system is added by Talos defaults
```

## Adding a New Namespace

1. Create `manifests/<dir>/namespace.yaml` or `manifests/infra/<name>-namespace.yaml`
2. New namespaces automatically get **restricted enforce** from the cluster default
3. Add explicit labels only if you need privileged or want warn/audit visibility
4. If the workload needs privileged access, set `pod-security.kubernetes.io/enforce: privileged` and document the reason in this file

## Gotchas

- **K8s 1.35+**: `exemptions.namespaces` rejects duplicate entries — apiserver refuses to start
- **argo-events images** run as root by default — `runAsUser: 1000` required in pod securityContext
- **NATS (EventBus)** also runs as root — same fix, plus all 3 containers (main, reloader, metrics) need container-level securityContext
- **Talos merges** its own kube-system exemption into the admissionControl config — do NOT add kube-system in the patch (causes duplicate)
- **他の controller が管理する namespace** (e.g. cilium-secrets) に PSA ラベルを付けると tracking-id が競合して OutOfSync が出たり消えたりする。クラスタデフォルトが restricted なので明示ラベル不要
