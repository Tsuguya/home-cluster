import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { DiffStats, ImpactItem, AppVersionChange } from "./types.js";
import { getReleaseNotes, getUpstreamRepo } from "./github.js";
import { detectLevel, summarizeReleaseNotes } from "./utils.js";

const execFileAsync = promisify(execFile);

function repoAlias(repoUrl: string): string {
  const hash = createHash("sha256").update(repoUrl).digest("hex").slice(0, 8);
  return `r${hash}`;
}

async function ensureRepo(repoUrl: string): Promise<string> {
  const alias = repoAlias(repoUrl);
  try {
    await execFileAsync("helm", ["repo", "add", alias, repoUrl], {
      timeout: 30_000,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("already exists")) {
      throw new Error(`Failed to add helm repo ${repoUrl}: ${msg}`);
    }
  }
  await execFileAsync("helm", ["repo", "update", alias], { timeout: 60_000 });
  return alias;
}

async function helmShow(
  alias: string,
  subcommand: "values" | "chart",
  chart: string,
  version: string
): Promise<string> {
  const { stdout } = await execFileAsync(
    "helm",
    ["show", subcommand, `${alias}/${chart}`, "--version", version],
    { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 }
  );
  return stdout;
}

function flattenYaml(
  obj: unknown,
  prefix = ""
): Map<string, string> {
  const result = new Map<string, string>();

  function walk(value: unknown, path: string) {
    if (value === null || value === undefined) {
      result.set(path, String(value));
      return;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        walk(value[i], `${path}[${i}]`);
      }
      return;
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, path ? `${path}.${k}` : k);
      }
      return;
    }
    result.set(path, String(value));
  }

  walk(obj, prefix);
  return result;
}

function getTopLevelKey(key: string): string {
  return key.split(/[.[]/)[0];
}

interface DiffEntry {
  key: string;
  type: "added" | "removed" | "changed";
  oldValue?: string;
  newValue?: string;
}

function computeDiff(
  oldFlat: Map<string, string>,
  newFlat: Map<string, string>
): DiffEntry[] {
  const entries: DiffEntry[] = [];

  for (const [key, oldVal] of oldFlat) {
    if (!newFlat.has(key)) {
      entries.push({ key, type: "removed", oldValue: oldVal });
    } else {
      const newVal = newFlat.get(key)!;
      if (oldVal !== newVal) {
        entries.push({ key, type: "changed", oldValue: oldVal, newValue: newVal });
      }
    }
  }

  for (const [key, newVal] of newFlat) {
    if (!oldFlat.has(key)) {
      entries.push({ key, type: "added", newValue: newVal });
    }
  }

  return entries.sort((a, b) => a.key.localeCompare(b.key));
}

function detectRenames(
  diff: DiffEntry[]
): Array<{ old: string; new: string }> {
  const removed = diff.filter((d) => d.type === "removed");
  const added = diff.filter((d) => d.type === "added");
  const renames: Array<{ old: string; new: string }> = [];

  for (const r of removed) {
    const oldLeaf = r.key.split(".").pop()!;
    for (const a of added) {
      const newLeaf = a.key.split(".").pop()!;
      if (
        oldLeaf === newLeaf &&
        r.oldValue === a.newValue &&
        getTopLevelKey(r.key) === getTopLevelKey(a.key)
      ) {
        renames.push({ old: r.key, new: a.key });
        break;
      }
    }
  }

  return renames;
}

function formatDiffSection(entries: DiffEntry[]): string {
  const lines: string[] = [];
  for (const e of entries) {
    switch (e.type) {
      case "removed":
        lines.push(`- ${e.key}: ${e.oldValue}`);
        break;
      case "added":
        lines.push(`+ ${e.key}: ${e.newValue}`);
        break;
      case "changed":
        lines.push(`- ${e.key}: ${e.oldValue}`);
        lines.push(`+ ${e.key}: ${e.newValue}`);
        break;
    }
  }
  return lines.join("\n");
}

function analyzeImpact(
  diff: DiffEntry[],
  renames: Array<{ old: string; new: string }>,
  userFlat: Map<string, string>
): ImpactItem[] {
  const impacts: ImpactItem[] = [];
  const renamedOldKeys = new Set(renames.map((r) => r.old));

  for (const entry of diff) {
    if (entry.type === "removed" && userFlat.has(entry.key)) {
      const rename = renames.find((r) => r.old === entry.key);
      if (rename) {
        impacts.push({
          key: entry.key,
          issue: "renamed",
          detail: `You set this to "${userFlat.get(entry.key)}" — key was renamed to "${rename.new}"`,
        });
      } else {
        impacts.push({
          key: entry.key,
          issue: "removed",
          detail: `You set this to "${userFlat.get(entry.key)}" but the key was removed in the new version`,
        });
      }
    }
    if (
      entry.type === "changed" &&
      userFlat.has(entry.key) &&
      !renamedOldKeys.has(entry.key)
    ) {
      const userVal = userFlat.get(entry.key)!;
      if (userVal === entry.oldValue) {
        impacts.push({
          key: entry.key,
          issue: "default_changed",
          detail: `Your value "${userVal}" matches the old default. New default is "${entry.newValue}"`,
        });
      }
    }
  }

  return impacts;
}

export async function diffHelmValues(
  repoUrl: string,
  chart: string,
  oldVersion: string,
  newVersion: string,
  userValuesPath?: string
): Promise<{
  stats: DiffStats;
  removedKeys: string[];
  potentiallyRenamed: Array<{ old: string; new: string }>;
  impacts: ImpactItem[];
  sectionFiles: string[];
  appVersionChange: AppVersionChange | null;
  userValuesError: string | null;
}> {
  const outDir = "/tmp/pr-review/diff";
  const sectionsDir = join(outDir, "sections");
  await mkdir(sectionsDir, { recursive: true });

  const alias = await ensureRepo(repoUrl);

  const [oldYamlStr, newYamlStr, oldChartStr, newChartStr] = await Promise.all([
    helmShow(alias, "values", chart, oldVersion),
    helmShow(alias, "values", chart, newVersion),
    helmShow(alias, "chart", chart, oldVersion),
    helmShow(alias, "chart", chart, newVersion),
  ]);

  const oldChartMeta = parseYaml(oldChartStr) as Record<string, unknown>;
  const newChartMeta = parseYaml(newChartStr) as Record<string, unknown>;
  const oldAppVersion = String(oldChartMeta.appVersion || "");
  const newAppVersion = String(newChartMeta.appVersion || "");

  const oldObj = parseYaml(oldYamlStr) || {};
  const newObj = parseYaml(newYamlStr) || {};

  const oldFlat = flattenYaml(oldObj);
  const newFlat = flattenYaml(newObj);

  const diff = computeDiff(oldFlat, newFlat);
  const renames = detectRenames(diff);
  const stats: DiffStats = {
    added: diff.filter((d) => d.type === "added").length,
    removed: diff.filter((d) => d.type === "removed").length,
    changed: diff.filter((d) => d.type === "changed").length,
  };

  await writeFile(join(outDir, "full.diff"), formatDiffSection(diff));

  const sectionMap = new Map<string, DiffEntry[]>();
  for (const entry of diff) {
    const section = getTopLevelKey(entry.key);
    if (!sectionMap.has(section)) sectionMap.set(section, []);
    sectionMap.get(section)!.push(entry);
  }

  const sectionFiles: string[] = [];
  for (const [section, entries] of sectionMap) {
    const filename = `${section}.diff`;
    await writeFile(join(sectionsDir, filename), formatDiffSection(entries));
    sectionFiles.push(filename);
  }

  let impacts: ImpactItem[] = [];
  let userValuesError: string | null = null;
  if (userValuesPath) {
    try {
      const userYamlStr = await readFile(userValuesPath, "utf-8");
      const userObj = parseYaml(userYamlStr) || {};
      const userFlat = flattenYaml(userObj);
      impacts = analyzeImpact(diff, renames, userFlat);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ENOENT")) {
        userValuesError = `User values file not found: ${userValuesPath}`;
      } else {
        userValuesError = `Failed to parse user values (${userValuesPath}): ${msg}`;
      }
    }
  }

  let appVersionChange: AppVersionChange | null = null;
  if (
    oldAppVersion &&
    newAppVersion &&
    oldAppVersion !== newAppVersion
  ) {
    const upstream = getUpstreamRepo(chart);
    let releaseNotesFile: string | null = null;
    let releaseNotesSummary = "No upstream release notes found";

    if (upstream) {
      const notes = await getReleaseNotes(
        upstream.owner,
        upstream.repo,
        newAppVersion,
        chart
      );
      if (notes) {
        releaseNotesFile = "/tmp/pr-review/app-release-notes.md";
        await writeFile(releaseNotesFile, notes);
        releaseNotesSummary = summarizeReleaseNotes(
          notes,
          "app-release-notes.md"
        );
      }
    }

    appVersionChange = {
      from: oldAppVersion,
      to: newAppVersion,
      level: detectLevel(oldAppVersion, newAppVersion),
      upstream_repo: upstream ? `${upstream.owner}/${upstream.repo}` : null,
      release_notes_summary: releaseNotesSummary,
      release_notes_file: releaseNotesFile,
    };
  }

  await writeFile(
    join(outDir, "..", "impact.json"),
    JSON.stringify({ impacts, renames, stats, appVersionChange }, null, 2)
  );

  return {
    stats,
    removedKeys: diff.filter((d) => d.type === "removed").map((d) => d.key),
    potentiallyRenamed: renames,
    impacts,
    sectionFiles,
    appVersionChange,
    userValuesError,
  };
}
