import type { UpdateLevel } from "./types.js";

export function detectLevel(from: string, to: string): UpdateLevel {
  if (!from || !to) return "unknown";

  const stripV = (v: string) => v.replace(/^v/, "");
  const fromParts = stripV(from).split(".");
  const toParts = stripV(to).split(".");

  if (fromParts[0] !== toParts[0]) return "major";
  if (fromParts[1] !== toParts[1]) return "minor";
  return "patch";
}

export function summarizeReleaseNotes(
  content: string,
  fileRef: string
): string {
  const lines = content.split("\n").filter((l) => l.trim());
  const breakingMatch = content.match(
    /breaking|deprecat|removed|renamed|migration/gi
  );
  if (breakingMatch) {
    return `Contains potentially breaking keywords: ${[...new Set(breakingMatch)].join(", ")}. See ${fileRef} for details.`;
  }
  if (lines.length <= 5) {
    return lines.join(" ").slice(0, 500);
  }
  return `${lines.length} lines of release notes. No breaking change keywords detected. See ${fileRef} for full details.`;
}
