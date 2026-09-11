# ChatGPT AutoDev Protocol

This protocol defines the supported automation loop for Opera Agent development.
It uses ChatGPT Scheduled Tasks, the connected GitHub app, and GitHub Actions.
It does not automate the ChatGPT web UI and does not use Codex or an OpenAI API endpoint.

## Goals

- Continue development without manual `lanjut` messages.
- Keep project state in GitHub, not in chat history.
- Make every run recoverable after timeout or interruption.
- Use official product surfaces and granted app permissions only.

## Hard boundaries

1. Do not automate, scrape, click, or type into the ChatGPT website to create a self-triggering loop.
2. Do not try to bypass task-frequency limits, model limits, rate limits, or safety controls.
3. Do not create multiple staggered tasks to simulate a frequency that the product does not permit.
4. Do not use Codex or ChatGPT Work for this loop unless the user explicitly changes this rule.
5. Do not use an OpenAI API endpoint for this loop.
6. Do not write directly to `main`.
7. Do not merge a pull request, publish a release, deploy production changes, rotate secrets, or change credentials without explicit user approval.
8. Do not weaken the product invariants in `docs/semantic-runtime-plan.md`.

## Source of truth

Read these files at the start of every run:

1. `AUTODEV_STATE.json`
2. `docs/semantic-runtime-plan.md`
3. The active pull request and its latest GitHub Actions result

Do not reconstruct state from chat history when GitHub state is available.

## Run algorithm

For each scheduled run:

1. Read `AUTODEV_STATE.json`.
2. Stop if `paused` is `true`.
3. Read the latest commit and CI result for the AutoDev branch or pull request.
4. If CI is still running, record `ci.status = "pending"` and stop.
5. If CI failed, inspect the failing job and log.
6. Make one bounded repair attempt for the active checkpoint.
7. If CI passed, continue the next unfinished task in the active checkpoint.
8. Keep the change small enough for one reviewable commit.
9. Update tests with the implementation when applicable.
10. Update `AUTODEV_STATE.json` in the same run.
11. Commit to the AutoDev branch.
12. Let GitHub Actions validate the commit.
13. Stop. The next scheduled run continues from GitHub state.

## Checkpoint rules

A checkpoint is complete only when its documented exit evidence exists.
Do not mark a checkpoint complete because code was written.
Do not skip a failed test.
Do not remove a test only to make CI pass.
Do not change an acceptance criterion without explicit user approval.

## Failure handling

If the same failure occurs three times:

- Set `blocked` to `true`.
- Record the failure in `block_reason`.
- Record the exact next diagnostic action.
- Stop automatic code changes.
- Ask the user for review.

If a required action needs credentials, a production deployment, a release, a merge, or another consequential approval:

- Set `approval_required` to `true`.
- Record the requested action.
- Stop before the action.

## GitHub Actions

Use GitHub-hosted runners for normal unit, static, and Chromium tests.
A self-hosted Windows runner can be added later for real Opera acceptance.
Keep a self-hosted runner isolated from the user's normal browser profile and personal secrets.
Use it only for this private repository.

## Scheduled-task cadence

Use one supported ChatGPT recurring task.
The default cadence is once per hour.
Do not create extra staggered tasks to increase the effective frequency.

## Completion

When all tasks in the active checkpoint pass:

- Set the checkpoint status to `complete`.
- Select the next checkpoint from `docs/semantic-runtime-plan.md`.
- Do not merge or release automatically.

When the milestone reaches its release gate:

- Set `approval_required` to `true`.
- Record the proposed merge or release action.
- Wait for the user.
