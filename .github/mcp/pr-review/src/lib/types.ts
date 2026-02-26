export type UpdateType = "helm" | "docker" | "github-action" | "other";
export type UpdateLevel = "major" | "minor" | "patch" | "digest" | "unknown";

export interface PackageUpdate {
  name: string;
  from: string;
  to: string;
  level: UpdateLevel;
  sourceUrl?: string;
}

export interface PrSummaryResult {
  update_type: UpdateType;
  packages: PackageUpdate[];
  release_notes_summary: string;
  release_notes_file: string | null;
  affected_helm_values: string[];
  changed_files: string[];
}

export interface DiffStats {
  added: number;
  removed: number;
  changed: number;
}

export interface ImpactItem {
  key: string;
  issue: "removed" | "renamed" | "default_changed";
  detail: string;
}

export interface AppVersionChange {
  from: string;
  to: string;
  level: UpdateLevel;
  upstream_repo: string | null;
  release_notes_summary: string;
  release_notes_file: string | null;
}

export interface HelmValuesDiffResult {
  summary: DiffStats;
  removed_keys: string[];
  potentially_renamed: Array<{ old: string; new: string }>;
  impact_on_user_values: ImpactItem[];
  user_values_error: string | null;
  app_version_change: AppVersionChange | null;
  files: {
    full_diff: string;
    sections_dir: string;
    impact: string;
  };
  section_files: string[];
}
