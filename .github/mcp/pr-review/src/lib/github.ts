import { Octokit } from "@octokit/rest";

let octokit: Octokit | null = null;

function getOctokit(): Octokit {
  if (!octokit) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error("GITHUB_TOKEN environment variable is required");
    octokit = new Octokit({ auth: token });
  }
  return octokit;
}

export interface PrData {
  title: string;
  body: string;
  changedFiles: string[];
  headRef: string;
  baseRef: string;
}

export async function getPrData(
  owner: string,
  repo: string,
  prNumber: number
): Promise<PrData> {
  const ok = getOctokit();

  const [pr, files] = await Promise.all([
    ok.pulls.get({ owner, repo, pull_number: prNumber }),
    ok.pulls.listFiles({ owner, repo, pull_number: prNumber, per_page: 100 }),
  ]);

  return {
    title: pr.data.title,
    body: pr.data.body || "",
    changedFiles: files.data.map((f) => f.filename),
    headRef: pr.data.head.ref,
    baseRef: pr.data.base.ref,
  };
}

async function tryGetRelease(
  owner: string,
  repo: string,
  tag: string
): Promise<string | null> {
  const ok = getOctokit();
  try {
    const release = await ok.repos.getReleaseByTag({ owner, repo, tag });
    return release.data.body || null;
  } catch {
    return null;
  }
}

export async function getReleaseNotes(
  owner: string,
  repo: string,
  tag: string,
  chartName?: string
): Promise<string | null> {
  const stripV = tag.replace(/^v/, "");
  const withV = tag.startsWith("v") ? tag : `v${tag}`;

  const candidates = [tag, withV, stripV];

  // Monorepo tag format: <chart-name>-<version> (e.g. kube-prometheus-stack-72.6.2)
  if (chartName) {
    candidates.push(`${chartName}-${stripV}`, `${chartName}-${withV}`);
  }

  for (const candidate of candidates) {
    const notes = await tryGetRelease(owner, repo, candidate);
    if (notes) return notes;
  }

  return null;
}

interface UpstreamRepo {
  owner: string;
  repo: string;
  tagPrefix?: string;
}

const HELM_CHART_REPOS: Record<string, UpstreamRepo> = {
  cilium: { owner: "cilium", repo: "cilium" },
  "argo-cd": { owner: "argoproj", repo: "argo-cd" },
  "argo-workflows": { owner: "argoproj", repo: "argo-workflows" },
  "argo-events": { owner: "argoproj", repo: "argo-events" },
  grafana: { owner: "grafana", repo: "grafana" },
  loki: { owner: "grafana", repo: "loki" },
  tempo: { owner: "grafana", repo: "tempo" },
  alloy: { owner: "grafana", repo: "alloy" },
  "kube-prometheus-stack": {
    owner: "prometheus-community",
    repo: "helm-charts",
    tagPrefix: "kube-prometheus-stack-",
  },
  "cert-manager": { owner: "cert-manager", repo: "cert-manager" },
  "external-dns": {
    owner: "kubernetes-sigs",
    repo: "external-dns",
  },
  tetragon: { owner: "cilium", repo: "tetragon" },
  seaweedfs: { owner: "seaweedfs", repo: "seaweedfs" },
  kanidm: { owner: "kanidm", repo: "kanidm" },
};

export function getUpstreamRepo(
  chartName: string
): UpstreamRepo | null {
  return HELM_CHART_REPOS[chartName] || null;
}
