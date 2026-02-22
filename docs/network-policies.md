# Network Policies

All policies are CiliumNetworkPolicy (CNP) and CiliumClusterwideNetworkPolicy (CCNP). Pods with `hostNetwork: true` are not subject to network policies and are excluded.

**Caveats:**
- Do NOT add L7 HTTP rules (`rules.http`) to ingress of services using TLS passthrough (TLSRoute). Cilium attempts to parse encrypted traffic as HTTP, breaking the connection.
- The `cluster` entity in `ingressDeny` includes `host` and `remote-node`. Since deny rules take precedence over allow rules, this also blocks access from hostNetwork pods. Prefer ingress allow-only policies (implicit default deny) over explicit `ingressDeny`.

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
| Prometheus (monitoring) | Ceph exporter (rook-ceph) | 9926 | Metrics scrape |
| Prometheus (monitoring) | Ceph MGR (rook-ceph) | 9283 | Metrics scrape |
| Loki (monitoring) | Ceph RGW (rook-ceph) | 8080 | S3 storage |
| Tempo (monitoring) | Ceph RGW (rook-ceph) | 8080 | S3 storage |
| Argo Workflows controller (argo) | shared-pg (database) | 5432 | Workflow archive |
| Argo Workflows server (argo) | shared-pg (database) | 5432 | Workflow archive |
| CloudNative-PG (cnpg-system) | shared-pg (database) | 8000 | Health probes |
| Cloudflared (argocd) | EventSource (argo) | 12000 | GitHub webhook relay |
| Workflow pods (argo) | Ceph RGW (rook-ceph) | 8080 | Artifact/log storage |
| Argo Workflows server (argo) | Ceph RGW (rook-ceph) | 8080 | Archived log retrieval |
| Grafana (monitoring) | Kanidm (kanidm) | 8443 | OIDC token exchange (direct, via CoreDNS rewrite) |
| ArgoCD server (argocd) | Kanidm (kanidm) | 8443 | OIDC token exchange (direct, via CoreDNS rewrite) |
| Argo Workflows server (argo) | Kanidm (kanidm) | 8443 | OIDC token exchange (direct, via CoreDNS rewrite) |
| oauth2-proxy-hubble (oauth2-proxy) | Hubble UI (kube-system) | 8081 | Reverse proxy upstream |
| oauth2-proxy-hubble (oauth2-proxy) | Kanidm (kanidm) | 8443 | OIDC token exchange |
| oauth2-proxy-ceph (oauth2-proxy) | Ceph MGR (rook-ceph) | 7000 | Reverse proxy upstream |
| oauth2-proxy-ceph (oauth2-proxy) | Kanidm (kanidm) | 8443 | OIDC token exchange |
| shared-pg (database) | Cloudflare R2 (external) | 443 | CNPG barman backup/WAL archiving |

## Excluded Pods (hostNetwork: true)

| Namespace | Pod | Reason |
|---|---|---|
| monitoring | node-exporter | Host metrics collection |
| kube-system | Cilium agent, kube-proxy | CNI / networking |
| kube-system | Tetragon agent | eBPF runtime security (hostNetwork DaemonSet) |
| kube-system | kube-apiserver, etcd, scheduler, controller-manager | Control plane static pods |
| rook-ceph | CSI nodeplugin (RBD, CephFS) | Block device / mount on host |
| trident | trident-node-linux | CSI node plugin |

---

## argocd (8 policies)

| Component | Ingress | Egress |
|---|---|---|
| **server** | ingress, cloudflared → 8080 | kube-apiserver, repo-server:8081, kanidm (kanidm):8443, redis:6379 |
| **application-controller** | (none) | kube-apiserver, repo-server:8081, redis:6379 |
| **repo-server** | server, app-controller → 8081 | HTTPS 443, redis:6379 |
| **redis** | server, repo-server, app-controller → 6379 | (none) |
| **applicationset-controller** | (none) | kube-apiserver |
| **notifications-controller** | (none) | kube-apiserver, HTTPS 443 |
| **redis-secret-init** (Job) | (none) | kube-apiserver |
| **cloudflared** | (none) | HTTPS 443, QUIC 7844, server:8080, eventsource (argo):12000 |

## argo (8 policies)

| Component | Ingress | Egress |
|---|---|---|
| **workflows-server** | ingress → 2746 (L7 HTTP); sensors (tofu-cloudflare, upgrade-k8s), workflows-controller → 2746 | kube-apiserver, shared-pg (database):5432, kanidm (kanidm):8443, ceph-rgw (rook-ceph):8080 |
| **workflows-controller** | (none) | kube-apiserver, shared-pg (database):5432, workflows-server:2746 |
| **eventsource** | cloudflared (argocd) → 12000 | kube-apiserver, eventbus:4222 |
| **sensor** (tofu-cloudflare, upgrade-k8s) | (none) | kube-apiserver, eventbus:4222, workflows-server:2746 |
| **events-controller** | (none) | kube-apiserver, eventbus:8222 |
| **eventbus** | eventsource, sensors (tofu-cloudflare, upgrade-k8s) → 4222; self → 6222/7777; events-controller → 8222 | self:6222/7777 |
| **workflow-pods** (backup-workflow除外) | (none) | kube-apiserver, HTTPS 443, all nodes:50000 (Talos apid), ceph-rgw (rook-ceph):8080 |
| **etcd-backup** (backup-workflow=true) | (none) | kube-apiserver, *.r2.cloudflarestorage.com + github.com + *.githubusercontent.com + dl.min.io :443, CP nodes:50000 (Talos apid), ceph-rgw (rook-ceph):8080 |

## monitoring (11 policies)

| Component | Ingress | Egress |
|---|---|---|
| **prometheus** | grafana, tempo → 9090 | kube-apiserver, alertmanager:9093/8080, kube-state-metrics:8080, operator:10250, grafana:3000, tempo:3200 (scrape), coredns (kube-system):9153, tetragon-operator (kube-system):2113, ceph exporter (rook-ceph):9926, ceph mgr (rook-ceph):9283, host/remote-node:10250/9100/2379/2381/10257/10259/9965 |
| **alertmanager** | prometheus → 9093/8080 | HTTPS 443 |
| **grafana** | ingress → 3000 (L7 HTTP); prometheus → 3000 | kube-apiserver, prometheus:9090, loki-gateway:8080, tempo:3200, shared-pg (database):5432, kanidm (kanidm):8443, HTTPS 443 |
| **kube-state-metrics** | prometheus → 8080 | kube-apiserver |
| **prometheus-operator** | kube-apiserver/remote-node, prometheus → 10250 | kube-apiserver |
| **loki** | loki-gateway, loki-canary → 3100 | kube-apiserver, ceph-rgw (rook-ceph):8080, self:7946 (memberlist) |
| **loki-gateway** | grafana, alloy, loki-canary → 8080 | loki:3100 |
| **loki-canary** | (none) | loki-gateway:8080, loki:3100 |
| **alloy** | (none) | kube-apiserver, loki-gateway:8080 |
| **tempo** | grafana, prometheus → 3200 | ceph-rgw (rook-ceph):8080, prometheus:9090 (metrics remote_write) |
| **prometheus-admission** (Job) | (none) | kube-apiserver |

## rook-ceph (14 policies)

| Component | Ingress | Egress |
|---|---|---|
| **mon** | all ceph daemons, exporter, crashcollector, CSI ctrlplugins → 3300/6789; remote-node → 3300/6789 | mon (self):3300/6789, mgr:6800 |
| **mgr** | all ceph daemons, csi-rbd-ctrlplugin, remote-node → 6800; oauth2-proxy-ceph (oauth2-proxy) → 7000 (dashboard); prometheus (monitoring) → 9283 | kube-apiserver, mon:3300/6789, mgr (self):6800, osd/mds/rgw:6800-6806 |
| **osd** | osd (self), mgr, operator, mds, rgw, tools, csi-rbd-ctrlplugin → 6800-6806; host/remote-node → 6800-6806 | mon:3300/6789, mgr:6800, osd (self):6800-6806 |
| **mds** | (none) | mon:3300/6789, mgr:6800, osd:6800-6806 |
| **rgw** | operator, loki (monitoring), tempo (monitoring), workflow-pods (argo), workflows-server (argo) → 8080 | mon:3300/6789, mgr:6800, osd:6800-6806 |
| **operator** | (none) | kube-apiserver, mon:3300/6789, mgr:6800, osd:6800, rgw:8080 |
| **detect-version** (Job) | (none) | kube-apiserver |
| **exporter** | prometheus (monitoring) → 9926 | mgr:6800, mon:3300/6789 |
| **crashcollector** | (none) | mon:3300/6789, mgr:6800 |
| **tools** | (none) | mon:3300/6789, mgr:6800, osd:6800-6806 |
| **osd-prepare** | (none) | kube-apiserver, mon:3300/6789 |
| **csi-rbd-ctrlplugin** | (none) | kube-apiserver, mon:3300/6789, mgr:6800, osd:6800 |
| **csi-cephfs-ctrlplugin** | (none) | kube-apiserver, mon:3300/6789 |
| **csi-controller-manager** | host → 8081 | kube-apiserver |

## kube-system (6 policies)

| Component | Ingress | Egress |
|---|---|---|
| **coredns** | cluster/host/remote-node → 53; prometheus (monitoring) → 9153 | host:53 (upstream), kube-apiserver |
| **hubble-relay** | host → 4222; hubble-ui → 4245 | host/remote-node/kube-apiserver:4244 |
| **hubble-ui** | oauth2-proxy-hubble (oauth2-proxy)/host → 8081 | kube-apiserver, hubble-relay:4245 |
| **metrics-server** | host/remote-node/kube-apiserver → 10250 | kube-apiserver, host/remote-node:10250 |
| **reloader** | (none) | kube-apiserver |
| **tetragon-operator** | prometheus (monitoring) → 2113 | kube-apiserver |

## database (1 policy)

| Component | Ingress | Egress |
|---|---|---|
| **shared-pg** | grafana (monitoring), argo-workflows-controller (argo), argo-workflows-server (argo) → 5432; self → 5432/8000 (replication); cloudnative-pg (cnpg-system), host → 8000 (probes) | kube-apiserver, self:5432/8000, *.r2.cloudflarestorage.com:443 (backup) |

## cert-manager (4 policies)

| Component | Ingress | Egress |
|---|---|---|
| **controller** | host → 9403 | kube-apiserver, external DNS 53 + HTTPS 443 (ACME/Cloudflare DNS-01) |
| **cainjector** | (none) | kube-apiserver |
| **webhook** | kube-apiserver/remote-node → 10250; host → 6080 | kube-apiserver |
| **startupapicheck** (Job) | (none) | kube-apiserver |

## external-dns (1 policy)

| Component | Ingress | Egress |
|---|---|---|
| **external-dns** | host → 7979 | kube-apiserver, HTTPS 443 (Cloudflare API) |

## cnpg-system (1 policy)

| Component | Ingress | Egress |
|---|---|---|
| **cloudnative-pg** | kube-apiserver/host/remote-node → 9443 | kube-apiserver, shared-pg (database):8000 |

## 1password (1 policy)

| Component | Ingress | Egress |
|---|---|---|
| **connect-operator** | (none) | kube-apiserver, HTTPS 443 (1Password API) |

## kanidm (1 policy)

| Component | Ingress | Egress |
|---|---|---|
| **kanidm** | ingress → 8443 (TLS Passthrough); grafana (monitoring) → 8443; argocd-server (argocd) → 8443; argo-workflows-server (argo) → 8443; oauth2-proxy-hubble/ceph (oauth2-proxy) → 8443 | kube-apiserver |

## oauth2-proxy (2 policies)

| Component | Ingress | Egress |
|---|---|---|
| **oauth2-proxy-hubble** | ingress → 4180 | hubble-ui (kube-system):8081, kanidm (kanidm):8443 |
| **oauth2-proxy-ceph** | ingress → 4180 | rook-ceph-mgr (rook-ceph):7000, kanidm (kanidm):8443 |

## trident (2 policies)

| Component | Ingress | Egress |
|---|---|---|
| **controller** | host/remote-node → 8443 (CSI node registration) | kube-apiserver, 192.168.0.240:8080 (QNAP NAS) |
| **operator** | (none) | kube-apiserver |
