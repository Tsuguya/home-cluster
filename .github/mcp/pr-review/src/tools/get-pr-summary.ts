import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { getPrData, getReleaseNotes, getUpstreamRepo } from "../lib/github.js";
import { buildPackageUpdates } from "../lib/renovate.js";
import { summarizeReleaseNotes } from "../lib/utils.js";
import type { PrSummaryResult } from "../lib/types.js";

export const GetPrSummarySchema = z.object({
  pr_number: z.number().describe("Pull request number"),
  owner: z.string().default("Tsuguya").describe("Repository owner"),
  repo: z.string().default("home-cluster").describe("Repository name"),
});

export type GetPrSummaryInput = z.infer<typeof GetPrSummarySchema>;

function inferHelmValuesPath(changedFiles: string[]): string[] {
  const paths: string[] = [];
  for (const f of changedFiles) {
    if (f.startsWith("helm-values/")) {
      paths.push(f);
      continue;
    }
    const appMatch = f.match(/^apps\/(.+)\.yaml$/);
    if (appMatch) {
      paths.push(`helm-values/${appMatch[1]}/values.yaml`);
    }
  }
  return [...new Set(paths)];
}

export async function getPrSummary(
  input: GetPrSummaryInput
): Promise<PrSummaryResult> {
  const { pr_number, owner, repo } = input;
  const prData = await getPrData(owner, repo, pr_number);

  const parsed = buildPackageUpdates(
    prData.title,
    prData.body,
    prData.changedFiles
  );

  // Try to get release notes from GitHub Releases if not in PR body
  let releaseNotesContent = parsed.releaseNotes;

  if (!releaseNotesContent && parsed.packages.length > 0) {
    const pkg = parsed.packages[0];
    const upstream = getUpstreamRepo(pkg.name);
    if (upstream) {
      releaseNotesContent = await getReleaseNotes(
        upstream.owner,
        upstream.repo,
        pkg.to,
        pkg.name
      );
    }
  }

  // Write release notes to file
  let releaseNotesFile: string | null = null;
  if (releaseNotesContent) {
    const outDir = "/tmp/pr-review";
    await mkdir(outDir, { recursive: true });
    releaseNotesFile = `${outDir}/release-notes.md`;
    await writeFile(releaseNotesFile, releaseNotesContent);
  }

  const releaseNotesSummary = releaseNotesContent
    ? summarizeReleaseNotes(releaseNotesContent, "release-notes.md")
    : "No release notes found";

  const affectedHelmValues = inferHelmValuesPath(prData.changedFiles);

  return {
    update_type: parsed.updateType,
    packages: parsed.packages,
    release_notes_summary: releaseNotesSummary,
    release_notes_file: releaseNotesFile,
    affected_helm_values: affectedHelmValues,
    changed_files: prData.changedFiles,
  };
}
