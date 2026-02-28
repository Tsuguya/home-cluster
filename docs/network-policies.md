# Network Policies

All policies are CiliumNetworkPolicy (CNP) and CiliumClusterwideNetworkPolicy (CCNP). Pods with `hostNetwork: true` are not subject to network policies and are excluded.

**Caveats:**
- Do NOT add L7 HTTP rules (`rules.http`) to ingress of services using TLS passthrough (TLSRoute). Cilium attempts to parse encrypted traffic as HTTP, breaking the connection.
- The `cluster` entity in `ingressDeny` includes `host` and `remote-node`. Since deny rules take precedence over allow rules, this blocks kubelet probes. Never use `cluster` in `ingressDeny` — use `world` only. For pods with probes, prefer ingress allow-only policies (implicit default deny) over `ingressDeny`.

## Cluster-Wide Policies (CCNP)

| Policy | Selector | Egress |
|---|---|---|
| **allow-dns** | all pods (`io.cilium.k8s.policy.cluster: default`) | kube-dns:53 (UDP/TCP) with L7 DNS proxy (`matchPattern: "*"`) |

All regular pods can reach kube-dns for DNS resolution. Individual CNPs below do not repeat this rule. The selector excludes Cilium internal endpoints (e.g. Gateway) to avoid breaking `enforce_policy_on_l7lb`. L7 DNS rules enable Cilium DNS proxy for Hubble DNS metrics visibility.

## Cross-Namespace Communication

| From (namespace) | To (namespace) | Port | Purpose |
|---|---|---|---|
| Grafana (monitoring) | shared-pg (database) | 5432 | Dashboard state |
| Prometheus (monitoring) | CoreDNS (kube-system) | 9153 | Metrics scrape |
| Prometheus (monitoring) | Tetragon operator (kube-system) | 2113 | Metrics scrape |
| Prometheus (monitoring) | SeaweedFS (seaweedfs) | 9327 | Metrics scrape |
| Loki (monitoring) | SeaweedFS filer (seaweedfs) | 8333 | S3 storage |
| Tempo (monitoring) | SeaweedFS filer (seaweedfs) | 8333 | S3 storage |
| Argo Workflows controller (argo) | shared-pg (database) | 5432 | Workflow archive |
| Argo Workflows server (argo) | shared-pg (database) | 5432 | Workflow archive |
| CloudNative-PG (cnpg-system) | shared-pg (database) | 8000 | Health probes |
| Cloudflared (argocd) | EventSource (argo) | 12000 | GitHub webhook relay |
| Workflow pods (argo) | SeaweedFS filer (seaweedfs) | 8333 | Artifact/log storage |
| PXE sync pods (argo) | SeaweedFS filer (seaweedfs) | 8333 | Artifact/log storage |
| Argo Workflows server (argo) | SeaweedFS filer (seaweedfs) | 8333 | Archived log retrieval |
| Prometheus (monitoring) | Trivy Operator (trivy-system) | 8080 | Metrics scrape |
| Grafana (monitoring) | Kanidm (kanidm) | 8443 | OIDC token exchange (direct, via CoreDNS rewrite) |
| ArgoCD server (argocd) | Kanidm (kanidm) | 8443 | OIDC token exchange (direct, via CoreDNS rewrite) |
| Argo Workflows server (argo) | Kanidm (kanidm) | 8443 | OIDC token exchange (direct, via CoreDNS rewrite) |
| oauth2-proxy-hubble (oauth2-proxy) | Hubble UI (kube-system) | 8081 | Reverse proxy upstream |
| oauth2-proxy-hubble (oauth2-proxy) | Kanidm (kanidm) | 8443 | OIDC token exchange |
| oauth2-proxy-seaweedfs (oauth2-proxy) | SeaweedFS filer (seaweedfs) | 8888 | Reverse proxy upstream |
| oauth2-proxy-seaweedfs (oauth2-proxy) | Kanidm (kanidm) | 8443 | OIDC token exchange |
| shared-pg (database) | Cloudflare R2 (external) | 443 | CNPG barman backup/WAL archiving |

## Excluded Pods (hostNetwork: true)

| Namespace | Pod | Reason |
|---|---|---|
| monitoring | node-exporter | Host metrics collection |
| kube-system | Cilium agent, kube-proxy | CNI / networking |
| kube-system | Tetragon agent | eBPF runtime security (hostNetwork DaemonSet) |
| kube-system | kube-apiserver, etcd, scheduler, controller-manager | Control plane static pods |
| trident | trident-node-linux | CSI node plugin |

---

## argocd (8 policies)

| Component | Ingress | Egress |
|---|---|---|
| **server** | ingress, cloudflared → 8080 | kube-apiserver, repo-server:8081, kanidm (kanidm):8443, redis:6379 |
| **application-controller** | (none) | kube-apiserver, repo-server:8081, redis:6379 |
| **repo-server** | server, app-controller → 8081 | github.com + {argoproj,1password,grafana,oauth2-proxy,aquasecurity,cloudnative-pg,kubernetes-sigs,prometheus-community,seaweedfs,stakater}.github.io + *.githubusercontent.com + charts.jetstack.io + helm.cilium.io:443, redis:6379 |
| **redis** | server, repo-server, app-controller → 6379 | (none) |
| **applicationset-controller** | (none) | kube-apiserver |
| **notifications-controller** | (none) | kube-apiserver, discord.com:443 |
| **redis-secret-init** (Job) | (none) | kube-apiserver |
| **cloudflared** | (none) | *.v2.argotunnel.com + cftunnel.com:443/7844, server:8080, eventsource (argo):12000 |

## argo (11 policies)

| Component | Ingress | Egress |
|---|---|---|
| **workflows-server** | ingress → 2746 (L7 HTTP); sensors (tofu-cloudflare, upgrade-k8s, pxe-sync), workflows-controller → 2746 | kube-apiserver, shared-pg (database):5432, kanidm (kanidm):8443, seaweedfs-filer (seaweedfs):8333 |
| **workflows-controller** | (none) | kube-apiserver, shared-pg (database):5432, workflows-server:2746 |
| **eventsource** | cloudflared (argocd) → 12000 | kube-apiserver, eventbus:4222 |
| **sensor** (tofu-cloudflare, upgrade-k8s, pxe-sync, talos-build) | (none) | kube-apiserver, eventbus:4222, workflows-server:2746 |
| **events-controller** | (none) | kube-apiserver, eventbus:8222 |
| **eventbus** | eventsource, sensors (tofu-cloudflare, upgrade-k8s, pxe-sync, talos-build) → 4222; self → 6222/7777; events-controller → 8222 | self:6222/7777 |
| **workflow-pods** (backup-workflow, pxe-sync, talos-build, kanidm-repl-exchange, kanidm-backup除外) | (none) | kube-apiserver, HTTPS 443, all nodes:50000 (Talos apid), seaweedfs-filer (seaweedfs):8333 |
| **etcd-backup** (backup-workflow=true) | (none) | kube-apiserver, *.r2.cloudflarestorage.com + github.com + *.githubusercontent.com + dl.min.io :443, CP nodes:50000 (Talos apid), seaweedfs-filer (seaweedfs):8333 |
| **pxe-sync** (pxe-sync=true) | (none) | kube-apiserver, github.com + api.github.com + *.githubusercontent.com + dl-cdn.alpinelinux.org :443, seaweedfs-filer (seaweedfs):8333, QNAP NAS (192.168.0.241):2049 (NFS) |
| **talos-build** (talos-build=true) | (none) | kube-apiserver, ghcr.io + github.com + api.github.com + *.githubusercontent.com + dl-cdn.alpinelinux.org :443, seaweedfs-filer (seaweedfs):8333 |
| **kanidm-backup** (kanidm-backup=true) | (deny world) | kube-apiserver, *.r2.cloudflarestorage.com + dl.k8s.io + dl-cdn.alpinelinux.org :443, seaweedfs-filer (seaweedfs):8333 |
| **kanidm-repl-exchange** (kanidm-repl-exchange=true) | (deny world) | kube-apiserver, seaweedfs-filer (seaweedfs):8333 |

## monitoring (11 policies)

| Component | Ingress | Egress |
|---|---|---|
| **prometheus** | grafana, tempo → 9090 | kube-apiserver, alertmanager:9093/8080, kube-state-metrics:8080, operator:10250, grafana:3000, tempo:3200 (scrape), coredns (kube-system):9153, tetragon-operator (kube-system):2113, seaweedfs (seaweedfs):9327, trivy-operator (trivy-system):8080, host/remote-node:10250/9100/2379/2381/10257/10259/9965/2112 |
| **alertmanager** | prometheus → 9093/8080 | discord.com:443 |
| **grafana** | ingress → 3000 (L7 HTTP); prometheus → 3000 | kube-apiserver, prometheus:9090, loki-gateway:8080, tempo:3200, shared-pg (database):5432, kanidm (kanidm):8443 |
| **kube-state-metrics** | prometheus → 8080 | kube-apiserver |
| **prometheus-operator** | kube-apiserver/remote-node, prometheus → 10250 | kube-apiserver |
| **loki** | loki-gateway, loki-canary → 3100 | kube-apiserver, seaweedfs-filer (seaweedfs):8333, self:7946 (memberlist) |
| **loki-gateway** | grafana, alloy, loki-canary → 8080 | loki:3100 |
| **loki-canary** | (none) | loki-gateway:8080, loki:3100 |
| **alloy** | (none) | kube-apiserver, loki-gateway:8080 |
| **tempo** | grafana, prometheus → 3200 | seaweedfs-filer (seaweedfs):8333, prometheus:9090 (metrics remote_write) |
| **prometheus-admission** (Job) | (none) | kube-apiserver |

## seaweedfs (4 policies)

| Component | Ingress | Egress |
|---|---|---|
| **master** | master/volume/filer/bucket-hook → 9333/19333; prometheus (monitoring) → 9327 | master (self):9333/19333, volume:8080/18080, filer:8888/18888 |
| **volume** | master/filer → 8080/18080; prometheus (monitoring) → 9327 | master:9333/19333, volume (self):8080/18080 |
| **filer** | loki (monitoring), tempo (monitoring), workflow-pods (argo), workflows-server (argo), etcd-backup (argo), pxe-sync (argo), talos-build (argo), kanidm-backup (argo) → 8333; filer/master/bucket-hook/oauth2-proxy-seaweedfs (oauth2-proxy) → 8888/18888; prometheus (monitoring) → 9327 | master:9333/19333, volume:8080/18080, filer (self):8888/18888 |
| **bucket-hook** (Job) | (none) | master:9333, filer:8888 |

## kube-system (6 policies)

| Component | Ingress | Egress |
|---|---|---|
| **coredns** | cluster/host/remote-node → 53; prometheus (monitoring) → 9153 | host:53 (upstream), kube-apiserver |
| **hubble-relay** | host → 4222; hubble-ui → 4245 | host/remote-node:4244, kube-apiserver:6443 |
| **hubble-ui** | oauth2-proxy-hubble (oauth2-proxy)/host → 8081 | kube-apiserver, hubble-relay:4245 |
| **metrics-server** | host/remote-node/kube-apiserver → 10250 | kube-apiserver, host/remote-node:10250 |
| **reloader** | host → 9090 (probes) | kube-apiserver |
| **tetragon-operator** | prometheus (monitoring) → 2113 | kube-apiserver |

## database (1 policy)

| Component | Ingress | Egress |
|---|---|---|
| **shared-pg** | grafana (monitoring), argo-workflows-controller (argo), argo-workflows-server (argo) → 5432; self → 5432/8000 (replication); cloudnative-pg (cnpg-system), host → 8000 (probes) | kube-apiserver, self:5432/8000, *.r2.cloudflarestorage.com:443 (backup) |

## cert-manager (4 policies)

| Component | Ingress | Egress |
|---|---|---|
| **controller** | host → 9403 | kube-apiserver, acme-v02.api.letsencrypt.org:443, api.cloudflare.com:443, external DNS 53 (propagation check) |
| **cainjector** | (none) | kube-apiserver |
| **webhook** | kube-apiserver/remote-node → 10250; host → 6080 | kube-apiserver |
| **startupapicheck** (Job) | (none) | kube-apiserver |

## external-dns (1 policy)

| Component | Ingress | Egress |
|---|---|---|
| **external-dns** | host → 7979 | kube-apiserver, api.cloudflare.com:443 |

## cnpg-system (1 policy)

| Component | Ingress | Egress |
|---|---|---|
| **cloudnative-pg** | kube-apiserver/host/remote-node → 9443 | kube-apiserver, shared-pg (database):8000 |

## 1password (1 policy)

| Component | Ingress | Egress |
|---|---|---|
| **connect-operator** | (none) | kube-apiserver, *.1password.com:443 |

## kanidm (1 policy)

| Component | Ingress | Egress |
|---|---|---|
| **kanidm** | ingress → 8443 (TLS Passthrough); grafana (monitoring) → 8443; argocd-server (argocd) → 8443; argo-workflows-server (argo) → 8443; oauth2-proxy-hubble (oauth2-proxy) → 8443; oauth2-proxy-seaweedfs (oauth2-proxy) → 8443; self → 8444 (replication) | self:8444 (replication), kube-apiserver |

## oauth2-proxy (2 policies)

| Component | Ingress | Egress |
|---|---|---|
| **oauth2-proxy-hubble** | ingress → 4180 (L7 HTTP) | hubble-ui (kube-system):8081, kanidm (kanidm):8443 |
| **oauth2-proxy-seaweedfs** | ingress → 4180 (L7 HTTP) | seaweedfs-filer (seaweedfs):8888, kanidm (kanidm):8443 |

## trivy-system (3 policies)

| Component | Ingress | Egress |
|---|---|---|
| **trivy-operator** | prometheus (monitoring) → 8080; host → 9090 (probes) | kube-apiserver, mirror.gcr.io + registry-1.docker.io + auth.docker.io + production.cloudflare.docker.com + ghcr.io + registry.k8s.io + *.pkg.dev + quay.io + *.quay.io + public.ecr.aws :443 |
| **scan-jobs** (managed-by: trivy-operator) | deny world | 0.0.0.0/0:443 — registry CDN backends (S3, R2, CloudFront, etc.) are too numerous and dynamic for toFQDNs. Ephemeral pods, HTTPS only |
| **node-collector** (app: node-collector) | deny world | kube-apiserver |

## trident (2 policies)

| Component | Ingress | Egress |
|---|---|---|
| **controller** | host/remote-node → 8443 (CSI node registration) | kube-apiserver, 192.168.0.240:8080 (QNAP NAS) |
| **operator** | (none) | kube-apiserver |
