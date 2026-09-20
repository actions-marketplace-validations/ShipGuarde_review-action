# ShipGuarde Review Action

Run a [ShipGuarde](https://shipguarde.com) review on a pull request from CI, wait for the verdict, and gate the job on it.

ShipGuarde is an AI quality gate for every release. A panel of AI examiners reviews the diff for correctness and security, and a vision-grounded agent can drive your live app like a real user. Every run ends in one signed verdict: **cleared, conditional, or denied**.

This Action starts a PR-mode run, polls until the verdict is in, and exits non-zero based on your `fail-on` setting, so you can make ShipGuarde a required check in branch protection.

## Quick start

1. Create a ShipGuarde API key (`sg_pat_…`) and find your **project id** in your project settings at [shipguarde.com](https://shipguarde.com).
2. Add the key as a repository secret named `SHIPGUARDE_API_KEY` (**Settings → Secrets and variables → Actions**).
3. Add a workflow:

```yaml
name: ShipGuarde
on:
  pull_request:

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: shipguarde/review-action@v1
        with:
          api-key: ${{ secrets.SHIPGUARDE_API_KEY }}
          project-id: your-project-id
```

The job fails if the verdict is `block`, so a required check keeps risky changes from merging.

## Examples

**Also drive browser checks against a deployed preview**

```yaml
- uses: shipguarde/review-action@v1
  with:
    api-key: ${{ secrets.SHIPGUARDE_API_KEY }}
    project-id: your-project-id
    target-url: https://pr-${{ github.event.number }}.preview.example.com
```

**Drive a journey on the preview and deny the merge if it breaks**

```yaml
- uses: ShipGuarde/review-action@v1
  with:
    api-key: ${{ secrets.SHIPGUARDE_API_KEY }}
    project-id: your-project-id
    target-url: https://pr-${{ github.event.number }}.preview.example.com
    flow: Click the Status filter, choose Failed, and confirm only Failed rows remain.
```

**Run specific agents and also fail on warnings**

```yaml
- uses: shipguarde/review-action@v1
  with:
    api-key: ${{ secrets.SHIPGUARDE_API_KEY }}
    project-id: your-project-id
    agents: code-review,security
    fail-on: block_or_warn
```

**Use the verdict in later steps**

```yaml
- id: shipguarde
  uses: shipguarde/review-action@v1
  with:
    api-key: ${{ secrets.SHIPGUARDE_API_KEY }}
    project-id: your-project-id

- run: echo "Verdict was ${{ steps.shipguarde.outputs.verdict }} (run ${{ steps.shipguarde.outputs.run-id }})"
```

## Private repos and the PR comment without the App

The Action passes the workflow's own token to ShipGuarde (input `github-token`, default `${{ github.token }}`). With it, a private repo is cloned and the verdict is posted back to the PR with no ShipGuarde GitHub App installed. Grant the job what those need:

```yaml
permissions:
  contents: read
  pull-requests: write
  checks: write
```

Leave the permissions out and the job still gates on the verdict; you lose the PR comment and, on a private repo, the code agents.

The token is held by ShipGuarde for the run and dropped once the verdict is published. It is never written to the run record.

## Inputs

| Name              | Required | Default                      | Description                                                                 |
| ----------------- | -------- | ---------------------------- | --------------------------------------------------------------------------- |
| `api-key`         | yes      | —                            | ShipGuarde API key (`sg_pat_…`). Store it as a repo secret.                  |
| `project-id`      | yes      | —                            | ShipGuarde project id to run against.                                        |
| `api-url`         | no       | `https://api.shipguarde.com` | ShipGuarde API base URL.                                                     |
| `target-url`      | no       | `''`                         | Deployment / preview URL to drive browser checks against.                   |
| `github-token`    | no       | `${{ github.token }}`        | Token for cloning a private repo and posting the verdict without the App.   |
| `flow`            | no       | `''`                         | A plain-English journey for the vision agent to drive on `target-url`.      |
| `agents`          | no       | `''`                         | Comma-separated agent kinds to run. Defaults to the project policy.         |
| `fail-on`         | no       | `block`                      | When to fail the job: `block`, `block_or_warn`, or `never`.                  |
| `timeout-seconds` | no       | `900`                        | Maximum seconds to wait for the verdict.                                     |

## Outputs

| Name      | Description                                                          |
| --------- | ------------------------------------------------------------------ |
| `run-id`  | The ShipGuarde run id.                                              |
| `verdict` | The verdict decision (`ship`, `ship_with_warnings`, `block`, `inconclusive`). |

## How `fail-on` works

| Value           | Job fails when the verdict is…           |
| --------------- | ---------------------------------------- |
| `block`         | `block` (default)                        |
| `block_or_warn` | `block` or `ship_with_warnings`          |
| `never`         | never — report-only, the job always passes |

A run that errors, is cancelled, or times out without a verdict also fails the job (unless `fail-on: never`), so a broken review never passes silently.

## Notes

- Runs in PR mode and posts the verdict back to the pull request. On non-PR events it falls back to an on-demand run.
- Zero dependencies — runs on `node24`, nothing to install.

## Links

- Website: https://shipguarde.com
- PR reviews: https://shipguarde.com/pr-reviews
- FAQ: https://shipguarde.com/faq

## License

[MIT](LICENSE)
