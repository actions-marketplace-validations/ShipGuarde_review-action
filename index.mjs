// ShipGuarde GitHub Action (node20, zero dependencies).
// Triggers a ShipGuarde run for the PR, waits for the verdict, and fails the job
// per `fail-on`. Reads inputs from INPUT_* (GitHub Actions convention).
import { appendFileSync, readFileSync } from 'node:fs';

function input(name, def = '') {
  // GitHub exposes inputs as INPUT_<NAME> uppercased with spaces turned into
  // underscores. Hyphens are kept: `api-key` arrives as INPUT_API-KEY. The
  // underscore form is read too, for anyone invoking this outside the runner.
  const upper = name.toUpperCase();
  return (
    process.env[`INPUT_${upper}`] ??
    process.env[`INPUT_${upper.replace(/-/g, '_')}`] ??
    def
  );
}
function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const v = String(value ?? '');
  // Multi-line values need GitHub's heredoc delimiter syntax or they corrupt the
  // GITHUB_OUTPUT file. (run-id/verdict are single-line, but the helper is generic.)
  if (v.includes('\n')) {
    const delim = `__sg_${Math.random().toString(36).slice(2)}`;
    appendFileSync(file, `${name}<<${delim}\n${v}\n${delim}\n`);
  } else {
    appendFileSync(file, `${name}=${v}\n`);
  }
}
function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const apiKey = input('api-key');
const projectId = input('project-id');
const apiUrl = input('api-url', 'https://api.shipguarde.com').replace(/\/$/, '');
const targetUrl = input('target-url');
const githubToken = input('github-token');
const flow = input('flow').trim();
const agents = input('agents')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const failOn = input('fail-on', 'block');
const timeoutSeconds = Number(input('timeout-seconds', '900')) || 900;

if (!apiKey) fail('api-key is required');
if (!projectId) fail('project-id is required');

// Pull PR context from the GitHub event so the run can be a PR run (posts back).
let pr;
try {
  if (process.env.GITHUB_EVENT_PATH) {
    const ev = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    if (ev.pull_request && ev.repository) {
      pr = {
        repoFullName: ev.repository.full_name,
        number: ev.pull_request.number,
        headSha: ev.pull_request.head.sha,
        baseSha: ev.pull_request.base.sha,
        // The preview is the PR's deployment: recorded on the run so browser
        // findings count against this build and the diff-aware flow suggestion
        // has somewhere to run.
        ...(targetUrl ? { deploymentUrl: targetUrl } : {}),
        // The workflow token lets the API clone a private repo and post the
        // verdict without a ShipGuarde App installation. It is held for the run
        // only and never persisted.
        ...(githubToken ? { token: githubToken } : {}),
      };
    }
  }
} catch {
  // No usable PR context — fall back to an on_demand run.
}

const headers = { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
const body = {
  projectId,
  mode: pr ? 'pr' : 'on_demand',
  agentKinds: agents,
  ...(targetUrl ? { targetUrl } : {}),
  ...(pr ? { pr } : {}),
  ...(flow ? { adhocFlow: { description: flow } } : {}),
};

const createRes = await fetch(`${apiUrl}/api/runs`, {
  method: 'POST',
  headers,
  body: JSON.stringify(body),
});
if (!createRes.ok) {
  fail(`Failed to start run: HTTP ${createRes.status} ${await createRes.text().catch(() => '')}`);
}
const created = await createRes.json();
const runId = created.runId;
if (!runId) {
  fail(`Run created but the API response had no runId (HTTP ${createRes.status}) — cannot poll for a verdict.`);
}
console.log(`ShipGuarde run started: ${runId}`);
setOutput('run-id', runId);

const TERMINAL = new Set(['completed', 'errored', 'cancelled']);
const deadline = Date.now() + timeoutSeconds * 1000;
let verdict;
let status = created.status;

while (Date.now() < deadline) {
  await sleep(5000);
  const res = await fetch(`${apiUrl}/api/runs/${encodeURIComponent(runId)}`, { headers });
  // Fail fast on a definite error rather than retrying it until the timeout and
  // then reporting only a misleading "timed out".
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    fail(`Polling failed: HTTP ${res.status} for run ${runId} — check the api-key and project access.`);
  }
  if (!res.ok) continue; // transient (5xx / network) — retry
  let run;
  try {
    ({ run } = await res.json());
  } catch {
    continue; // a 200 with a non-JSON body (e.g. a proxy error page) — retry
  }
  if (!run) continue;
  status = run.status;
  if (run.verdict?.decision) verdict = run.verdict.decision;
  if (TERMINAL.has(status)) break;
}

setOutput('verdict', verdict ?? 'unknown');
console.log(`ShipGuarde verdict: ${verdict ?? 'unknown'} (run status: ${status})`);

if (!TERMINAL.has(status)) {
  fail(`Timed out after ${timeoutSeconds}s waiting for the verdict (last status: ${status}).`);
}
if (failOn === 'never') process.exit(0);

// A run that errored or was cancelled never produced a verdict - the review did
// not complete, so don't let the job pass silently.
if (status === 'errored' || status === 'cancelled') {
  fail(`ShipGuarde run ${status} without a verdict — the review did not complete.`);
}

const failing =
  failOn === 'block_or_warn'
    ? new Set(['block', 'ship_with_warnings'])
    : new Set(['block']);
if (verdict && failing.has(verdict)) {
  fail(`ShipGuarde verdict is "${verdict}" — failing the job (fail-on=${failOn}).`);
}
process.exit(0);
