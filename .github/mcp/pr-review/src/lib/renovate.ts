import type { UpdateType, PackageUpdate } from "./types.js";
import { detectLevel } from "./utils.js";

interface RenovateParseResult {
  updateType: UpdateType;
  packages: PackageUpdate[];
  releaseNotes: string | null;
}

export function parsePrTitle(title: string): {
  name: string;
  from: string;
  to: string;
} | null {
  // "Update dependency foo from v1.2.3 to v1.2.4"
  // "Update helm release cilium to 1.19.1"
  // "Update docker.io/grafana/loki Docker tag to v3.5.0"
  // "chore(deps): update helm release cilium to 1.19.1"
  const withFrom = title.match(
    /[Uu]pdate\s+(?:(?:helm\s+release|dependency|docker\s+tag|github[\s-]?action)\s+)?(.+?)\s+from\s+v?(\S+)\s+to\s+v?(\S+)/
  );
  if (withFrom) {
    const name = withFrom[1]
      .replace(/\s+Docker\s+tag$/i, "")
      .replace(/^docker\.io\//, "")
      .trim();
    return { name, from: withFrom[2], to: withFrom[3] };
  }

  const withoutFrom = title.match(
    /[Uu]pdate\s+(?:(?:helm\s+release|dependency|docker\s+tag|github[\s-]?action)\s+)?(.+?)\s+to\s+v?(\S+)/
  );
  if (!withoutFrom) return null;

  const name = withoutFrom[1]
    .replace(/\s+Docker\s+tag$/i, "")
    .replace(/^docker\.io\//, "")
    .trim();
  return { name, from: "", to: withoutFrom[2] };
}

function detectUpdateType(title: string, changedFiles: string[]): UpdateType {
  if (/helm\s+release/i.test(title)) return "helm";
  if (changedFiles.some((f) => f.startsWith("apps/") && f.endsWith(".yaml"))) {
    const hasHelmValues = changedFiles.some((f) =>
      f.startsWith("helm-values/")
    );
    if (hasHelmValues) return "helm";
  }

  if (/docker\s+tag|docker\.io|ghcr\.io|quay\.io/i.test(title)) return "docker";
  if (/github[\s-]?action/i.test(title)) return "github-action";
  if (changedFiles.some((f) => f.includes(".github/"))) return "github-action";

  return "other";
}

export function parseRenovateBody(body: string): {
  packages: Array<{ name: string; from: string; to: string }>;
  releaseNotes: string | null;
} {
  const packages: Array<{ name: string; from: string; to: string }> = [];

  // Table format: | package | from | to |
  const tableRows = body.matchAll(
    /\|\s*\[?([^\]|]+)\]?(?:\([^)]*\))?\s*\|\s*`?v?([\d][^`|]*?)`?\s*\|\s*`?v?([\d][^`|]*?)`?\s*\|/g
  );
  for (const row of tableRows) {
    packages.push({ name: row[1].trim(), from: row[2].trim(), to: row[3].trim() });
  }

  // Single update: "from v1.2.3 to v1.2.4" or "`1.2.3` → `1.2.4`"
  if (packages.length === 0) {
    const singleFrom = body.match(
      /(?:from|`)[\s`]*v?([\d][\d.]*[\d\w-]*)[\s`]*(?:to|→|->|`)[\s`]*v?([\d][\d.]*[\d\w-]*)/i
    );
    if (singleFrom) {
      packages.push({ name: "", from: singleFrom[1], to: singleFrom[2] });
    }
  }

  // Extract release notes section
  let releaseNotes: string | null = null;
  const rnMatch = body.match(
    /###?\s*Release\s*[Nn]otes[\s\S]*?(?=\n###?\s|\n---|\n\*\*Configuration\*\*|$)/
  );
  if (rnMatch) {
    releaseNotes = rnMatch[0].trim();
  }

  return { packages, releaseNotes };
}

export function buildPackageUpdates(
  title: string,
  body: string,
  changedFiles: string[]
): RenovateParseResult {
  const titleParsed = parsePrTitle(title);
  const bodyParsed = parseRenovateBody(body);
  const updateType = detectUpdateType(title, changedFiles);

  const packages: PackageUpdate[] = [];

  if (bodyParsed.packages.length > 0) {
    for (const bp of bodyParsed.packages) {
      const name = bp.name || titleParsed?.name || "unknown";
      const from = bp.from || titleParsed?.from || "";
      packages.push({
        name,
        from,
        to: bp.to,
        level: detectLevel(from, bp.to),
      });
    }
  } else if (titleParsed) {
    packages.push({
      name: titleParsed.name,
      from: titleParsed.from,
      to: titleParsed.to,
      level: detectLevel(titleParsed.from, titleParsed.to),
    });
  }

  return {
    updateType,
    packages,
    releaseNotes: bodyParsed.releaseNotes,
  };
}
