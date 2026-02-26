import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  GetPrSummarySchema,
  getPrSummary,
} from "./tools/get-pr-summary.js";
import {
  HelmValuesDiffSchema,
  helmValuesDiff,
} from "./tools/helm-values-diff.js";

const server = new McpServer({
  name: "pr-review",
  version: "1.0.0",
});

server.tool(
  "get_pr_summary",
  "Get a structured summary of a Renovate PR including package updates, release notes, and affected helm values. Release notes are written to /tmp/pr-review/release-notes.md for detailed reading.",
  GetPrSummarySchema.shape,
  async ({ pr_number, owner, repo }) => {
    try {
      const result = await getPrSummary(
        GetPrSummarySchema.parse({ pr_number, owner, repo })
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "helm_values_diff",
  "Compare default values between two versions of a Helm chart. Writes full diff to /tmp/pr-review/diff/full.diff and per-section diffs to /tmp/pr-review/diff/sections/. Optionally analyzes impact on user's values.yaml.",
  HelmValuesDiffSchema.shape,
  async ({ repo_url, chart, old_version, new_version, user_values_path }) => {
    try {
      const result = await helmValuesDiff(
        HelmValuesDiffSchema.parse({
          repo_url,
          chart,
          old_version,
          new_version,
          user_values_path,
        })
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
