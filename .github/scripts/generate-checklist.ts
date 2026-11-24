import { appendFile, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const marker = "<!-- amadeus-review-checklist -->";
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const explicitFiles = args
  .filter((argument) => argument.startsWith("--files="))
  .map((argument) => argument.slice("--files=".length));
const cliFiles = explicitFiles.flatMap((value) =>
  value.length > 0 ? value.split(",") : [],
);
const eventPath = process.env.GITHUB_EVENT_PATH;
const event = eventPath
  ? JSON.parse(await readFile(eventPath, "utf8"))
  : undefined;
const workflowRun = event?.workflow_run;
const apiUrl = process.env.GITHUB_API_URL ?? "https://api.github.com";
const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;

function assertTrustedWorkflowRun() {
  if (!workflowRun) {
    throw new Error("Expected a workflow_run event.");
  }
  if (workflowRun.event !== "pull_request") {
    throw new Error("Checklist generation only supports pull-request CI runs.");
  }
  if (
    typeof workflowRun.path !== "string" ||
    !workflowRun.path.startsWith(".github/workflows/pull-request.yml")
  ) {
    throw new Error("The completed workflow is not the pull-request CI entry.");
  }
  if (!repository || !token) {
    throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required.");
  }
}

async function githubRequest(path, options = {}) {
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(
      `GitHub API request failed (${response.status}): ${await response.text()}`,
    );
  }
  return response.status === 204 ? undefined : response.json();
}

async function getPullRequest() {
  const pullRequests =
    workflowRun.pull_requests?.length > 0
      ? workflowRun.pull_requests
      : await githubRequest(
          `/repos/${repository}/commits/${workflowRun.head_sha}/pulls`,
        );
  const pullRequest = pullRequests?.find(
    (candidate) =>
      candidate.state !== "closed" &&
      candidate.head?.sha === workflowRun.head_sha,
  );
  if (!pullRequest) {
    throw new Error(
      `Could not find an open pull request for CI commit ${workflowRun.head_sha}.`,
    );
  }
  return pullRequest;
}

async function getChangedFiles(pullRequest) {
  const files = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubRequest(
      `/repos/${repository}/pulls/${pullRequest.number}/files?per_page=100&page=${page}`,
    );
    files.push(...batch.map((file) => file.filename));
    if (batch.length < 100) return files;
  }
}

function globToRegExp(glob) {
  let pattern = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === "*" && glob[index + 1] === "*") {
      index += 1;
      if (glob[index + 1] === "/") {
        index += 1;
        pattern += "(?:.*/)?";
      } else {
        pattern += ".*";
      }
    } else if (character === "*") {
      pattern += "[^/]*";
    } else if (character === "?") {
      pattern += "[^/]";
    } else {
      pattern += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${pattern}$`);
}

function matchesAnyPath(file, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(file));
}

async function loadChecklists(files) {
  const directory = resolve(root, ".github/checklists");
  const checklistFiles = (await readdir(directory))
    .filter((file) => file.endsWith(".json"))
    .sort();
  const sections = [];

  for (const filename of checklistFiles) {
    const checklist = JSON.parse(
      await readFile(resolve(directory, filename), "utf8"),
    );
    if (
      typeof checklist.name !== "string" ||
      !Array.isArray(checklist.paths) ||
      !Array.isArray(checklist.checks) ||
      checklist.checks.some((check) => typeof check !== "string")
    ) {
      throw new Error(`Invalid checklist schema: ${filename}`);
    }
    const matchingFiles = files.filter((file) =>
      matchesAnyPath(file, checklist.paths),
    );
    if (matchingFiles.length > 0) {
      sections.push({
        name: checklist.name,
        files: matchingFiles,
        checks: checklist.checks,
      });
    }
  }
  return sections;
}

function formatChecklist({ pullRequest, files, sections, conclusion, runUrl }) {
  const status =
    conclusion === "success"
      ? "✅ passed"
      : conclusion === "failure"
        ? "❌ failed"
        : `⚠️ ${conclusion}`;
  const lines = [
    marker,
    "## Amadeus pull-request review checklist",
    "",
    `Automated CI: **${status}** ([view run](${runUrl})).`,
    `${files.length} changed file(s) detected.`,
    "",
    "### Reviewer checks",
    "- [ ] The change matches the PR description and introduces no unrelated changes.",
    "- [ ] CI results have been reviewed; failures are resolved or explicitly explained.",
    "- [ ] Behavior, edge cases, and error handling are appropriate for the affected features.",
    "- [ ] Documentation and configuration examples are updated where needed.",
  ];

  for (const section of sections) {
    lines.push("", `### ${section.name}`);
    for (const check of section.checks) lines.push(`- [ ] ${check}`);
  }

  if (sections.length === 0) {
    lines.push(
      "",
      "No component-specific checklist matched these files; use the reviewer checks above.",
    );
  }

  const sha = workflowRun?.head_sha ?? "local-dry-run";
  lines.push("", `<!-- PR #${pullRequest.number}; CI SHA ${sha} -->`);
  return lines.join("\n");
}

async function writeWorkflowOutputs(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
  if (process.env.GITHUB_OUTPUT) {
    const delimiter = `checklist_${crypto.randomUUID()}`;
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `checklist<<${delimiter}\n${markdown}\n${delimiter}\n`,
    );
  }
}

async function publishComment(pullRequest, markdown) {
  const comments = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubRequest(
      `/repos/${repository}/issues/${pullRequest.number}/comments?per_page=100&page=${page}`,
    );
    comments.push(...batch);
    if (batch.length < 100) break;
  }

  const existing = comments.find(
    (comment) =>
      comment.user?.login === "github-actions[bot]" &&
      comment.body?.includes(marker),
  );
  const endpoint = existing
    ? `/repos/${repository}/issues/comments/${existing.id}`
    : `/repos/${repository}/issues/${pullRequest.number}/comments`;
  await githubRequest(endpoint, {
    method: existing ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: markdown }),
  });
}

let pullRequest;
let files;
let conclusion;
let runUrl;
if (dryRun) {
  pullRequest = { number: 1 };
  files = cliFiles;
  conclusion = process.env.CI_RESULT ?? "success";
  runUrl = "https://github.com/";
} else {
  assertTrustedWorkflowRun();
  pullRequest = await getPullRequest();
  files = await getChangedFiles(pullRequest);
  conclusion = workflowRun.conclusion ?? "unknown";
  runUrl = workflowRun.html_url;
}

const sections = await loadChecklists(files);
const markdown = formatChecklist({
  pullRequest,
  files,
  sections,
  conclusion,
  runUrl,
});
console.log(markdown);
await writeWorkflowOutputs(markdown);

if (!dryRun) await publishComment(pullRequest, markdown);