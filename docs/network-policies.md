# Network Policies

All policies are CiliumNetworkPolicy (CNP). Pods with `hostNetwork: true` are not subject to CNP and are excluded.

## Cross-Namespace Communication

| From (namespace) | To (namespace) | Port | Purpose |
|---|---|---|---|
| Grafana (monitoring) | shared-pg (database) | 5432 | Dashboard state |
| Grafana (monitoring) | Dex (argocd) | 5556, 5557 | SSO |
| Grafana (monitoring) | ArgoCD server (argocd) | 8080 | SSO OIDC discovery (via CoreDNS rewrite) |
| Prometheus (monitoring) | CoreDNS (kube-system) | 9153 | Metrics scrape |
| Prometheus (monitoring) | Ceph exporter (rook-ceph) | 9926 | Metrics scrape |
| Prometheus (monitoring) | Ceph MGR (rook-ceph) | 9283 | Metrics scrape |
| Loki (monitoring) | Ceph RGW (rook-ceph) | 8080 | S3 storage |
| Argo Workflows controller (argo) | shared-pg (database) | 5432 | Workflow archive |
| Argo Workflows server (argo) | shared-pg (database) | 5432 | Workflow archive |
| Argo Workflows server (argo) | Dex (argocd) | 5556, 5557 | SSO |
| Argo Workflows server (argo) | ArgoCD server (argocd) | 8080 | SSO OIDC discovery (via CoreDNS rewrite) |
| CloudNative-PG (cnpg-system) | shared-pg (database) | 8000 | Health probes |
| Cloudflared (argocd) | EventSource (argo) | 12000 | GitHub webhook relay |

## Excluded Pods (hostNetwork: true)

| Namespace | Pod | Reason |
|---|---|---|
| monitoring | node-exporter | Host metrics collection |
| kube-system | Cilium agent, kube-proxy | CNI / networking |
| kube-system | kube-apiserver, etcd, scheduler, controller-manager | Control plane static pods |
| rook-ceph | CSI nodeplugin (RBD, CephFS) | Block device / mount on host |
| trident | trident-node-linux | CSI node plugin |

---

## argocd (8 policies)

| Component | Ingress | Egress |
|---|---|---|
| **server** | ingress, cloudflared, argo-workflows-server (argo), grafana (monitoring) → 8080 | DNS, kube-apiserver, repo-server:8081, dex:5556/5557, redis:6379 |
| **application-controller** | (none) | DNS, kube-apiserver, repo-server:8081, redis:6379 |
| **repo-server** | server, app-controller → 8081 | DNS, HTTPS 443, redis:6379 |
| **dex-server** | server → 5556/5557; argo-workflows-server (argo) → 5556/5557; grafana (monitoring) → 5556/5557 | DNS, kube-apiserver, HTTPS 443 |
| **redis** | server, repo-server, app-controller → 6379 | DNS |
| **applicationset-controller** | (none) | DNS, kube-apiserver |
| **notifications-controller** | (none) | DNS, kube-apiserver |
| **cloudflared** | (none) | DNS, HTTPS 443, QUIC 7844, server:8080, eventsource (argo):12000 |

## argo (7 policies)

| Component | Ingress | Egress |
|---|---|---|
| **workflows-server** | ingress → 2746; sensor, workflows-controller → 2746 | DNS, kube-apiserver, shared-pg (database):5432, dex (argocd):5556/5557, argocd-server (argocd):8080 (SSO OIDC via CoreDNS rewrite) |
| **workflows-controller** | (none) | DNS, kube-apiserver, shared-pg (database):5432, workflows-server:2746 |
| **eventsource** | cloudflared (argocd) → 12000 | DNS, kube-apiserver, eventbus:4222 |
| **sensor** | (none) | DNS, kube-apiserver, eventbus:4222, workflows-server:2746 |
| **events-controller** | (none) | DNS, kube-apiserver, eventbus:8222 |
| **eventbus** | eventsource, sensor → 4222; self → 6222/7777; events-controller → 8222 | DNS, self:6222/7777 |
| **workflow-pods** | (none) | DNS, kube-apiserver, HTTPS 443, all nodes:50000 (Talos apid) |

## monitoring (9 policies)

| Component | Ingress | Egress |
|---|---|---|
| **prometheus** | grafana → 9090 | DNS, kube-apiserver, alertmanager:9093/8080, kube-state-metrics:8080, operator:10250, grafana:3000, coredns (kube-system):9153, host/remote-node:10250/9100/2379/10257/10259 |
| **alertmanager** | prometheus → 9093/8080 | DNS |
| **grafana** | ingress → 3000; prometheus → 3000 | DNS, kube-apiserver, prometheus:9090, loki-gateway:8080, shared-pg (database):5432, argocd-server (argocd):8080, HTTPS 443 |
| **kube-state-metrics** | prometheus → 8080 | DNS, kube-apiserver |
| **prometheus-operator** | kube-apiserver/remote-node, prometheus → 10250 | DNS, kube-apiserver |
| **loki** | loki-gateway, loki-canary → 3100 | DNS, kube-apiserver, ceph-rgw (rook-ceph):8080, self:7946 (memberlist) |
| **loki-gateway** | grafana, alloy, loki-canary → 8080 | DNS, loki:3100 |
| **loki-canary** | (none) | DNS, loki-gateway:8080, loki:3100 |
| **alloy** | (none) | DNS, kube-apiserver, loki-gateway:8080 |

## rook-ceph (13 policies)

| Component | Ingress | Egress |
|---|---|---|
| **mon** | all ceph daemons, exporter, CSI ctrlplugins → 3300/6789; remote-node → 3300/6789 | DNS, mon (self):3300/6789, mgr:6800 |
| **mgr** | all ceph daemons, csi-rbd-ctrlplugin, remote-node → 6800; ingress → 7000 (dashboard); prometheus (monitoring) → 9283 | DNS, mon:3300/6789, mgr (self):6800, osd:6800-6806 |
| **osd** | osd (self), mgr, mds, rgw, tools, csi-rbd-ctrlplugin → 6800-6806; host/remote-node → 6800-6806 | DNS, mon:3300/6789, mgr:6800, osd (self):6800-6806 |
| **mds** | (none) | DNS, mon:3300/6789, mgr:6800, osd:6800-6806 |
| **rgw** | loki (monitoring) → 8080 | DNS, mon:3300/6789, mgr:6800, osd:6800-6806 |
| **operator** | (none) | DNS, kube-apiserver, mon:3300/6789, mgr:6800 |
| **exporter** | prometheus (monitoring) → 9926 | DNS, mgr:6800, mon:3300/6789 |
| **crashcollector** | (none) | DNS, mon:3300/6789, mgr:6800 |
| **tools** | (none) | DNS, mon:3300/6789, mgr:6800, osd:6800-6806 |
| **osd-prepare** | (none) | DNS, kube-apiserver, mon:3300/6789 |
| **csi-rbd-ctrlplugin** | (none) | DNS, kube-apiserver, mon:3300/6789, mgr:6800, osd:6800 |
| **csi-cephfs-ctrlplugin** | (none) | DNS, kube-apiserver, mon:3300/6789 |
| **csi-controller-manager** | host → 8081 | DNS, kube-apiserver |

## kube-system (6 policies)

| Component | Ingress | Egress |
|---|---|---|
| **coredns** | cluster/host/remote-node → 53; prometheus (monitoring) → 9153 | host:53 (upstream), kube-apiserver |
| **hubble-relay** | host → 4222; hubble-ui → 4245 | DNS, host/remote-node/kube-apiserver:4244 |
| **hubble-ui** | ingress/host → 8081 | DNS, kube-apiserver, hubble-relay:4245 |
| **metrics-server** | host/remote-node/kube-apiserver → 10250 | DNS, kube-apiserver, host/remote-node:10250 |
| **snapshot-controller** | host → 8080 | DNS, kube-apiserver |
| **snapshot-validation-webhook** | kube-apiserver/host → 8443 | DNS, kube-apiserver |

## database (1 policy)

| Component | Ingress | Egress |
|---|---|---|
| **shared-pg** | grafana (monitoring), argo-workflows-controller (argo), argo-workflows-server (argo) → 5432; self → 5432/8000 (replication); cloudnative-pg (cnpg-system), host → 8000 (probes) | DNS, kube-apiserver, self:5432/8000 |

## cert-manager (3 policies)

| Component | Ingress | Egress |
|---|---|---|
| **controller** | host → 9403 | DNS, kube-apiserver, HTTPS 443 (ACME/Cloudflare) |
| **cainjector** | (none) | DNS, kube-apiserver |
| **webhook** | kube-apiserver → 10250; host → 6080 | DNS, kube-apiserver |

## external-dns (1 policy)

| Component | Ingress | Egress |
|---|---|---|
| **external-dns** | host → 7979 | DNS, kube-apiserver, HTTPS 443 (Cloudflare API) |

## cnpg-system (1 policy)

| Component | Ingress | Egress |
|---|---|---|
| **cloudnative-pg** | kube-apiserver/host/remote-node → 9443 | DNS, kube-apiserver, shared-pg (database):8000 |

## 1password (1 policy)

| Component | Ingress | Egress |
|---|---|---|
| **connect-operator** | (none) | DNS, kube-apiserver, HTTPS 443 (1Password API) |

## trident (2 policies)

| Component | Ingress | Egress |
|---|---|---|
| **controller** | (none) | DNS, kube-apiserver, 192.168.0.240:8080 (QNAP NAS) |
| **operator** | (none) | DNS, kube-apiserver |
