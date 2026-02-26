import { z } from "zod";
import { diffHelmValues } from "../lib/helm.js";
import type { HelmValuesDiffResult } from "../lib/types.js";

export const HelmValuesDiffSchema = z.object({
  repo_url: z.string().describe("Helm chart repository URL"),
  chart: z.string().describe("Helm chart name"),
  old_version: z.string().describe("Old chart version"),
  new_version: z.string().describe("New chart version"),
  user_values_path: z
    .string()
    .optional()
    .describe("Path to user's values.yaml for impact analysis"),
});

export type HelmValuesDiffInput = z.infer<typeof HelmValuesDiffSchema>;

export async function helmValuesDiff(
  input: HelmValuesDiffInput
): Promise<HelmValuesDiffResult> {
  const { repo_url, chart, old_version, new_version, user_values_path } = input;

  const result = await diffHelmValues(
    repo_url,
    chart,
    old_version,
    new_version,
    user_values_path
  );

  return {
    summary: result.stats,
    removed_keys: result.removedKeys,
    potentially_renamed: result.potentiallyRenamed,
    impact_on_user_values: result.impacts,
    user_values_error: result.userValuesError,
    app_version_change: result.appVersionChange,
    files: {
      full_diff: "/tmp/pr-review/diff/full.diff",
      sections_dir: "/tmp/pr-review/diff/sections/",
      impact: "/tmp/pr-review/impact.json",
    },
    section_files: result.sectionFiles,
  };
}
