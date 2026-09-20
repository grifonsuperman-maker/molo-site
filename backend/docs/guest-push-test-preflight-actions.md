# Guest Push — phone-friendly Neon test preflight

This **manual GitHub Actions workflow only runs `guest-push-migration-operator.mjs --check`**. It cannot apply or roll back a migration, send Push, or start the live backend. Its job only accepts a `workflow_dispatch` on `main`; PR and push events do not run it. Merging does not run it automatically. The production Neon database and Render environment must remain unchanged.

## Before storing anything

1. Open **Neon → project MOLO → branch selector** and ensure that `test-push-migration` still exists. Neon may auto-delete temporary branches. If it expired, create a new test branch from `production` with schema and data, verify it is selected, and run the existing read-only baseline audit before continuing. Do not point Render at this branch.
2. In the **test branch connection panel**, obtain its branch-specific `postgresql://...` connection string with `sslmode=require` or `sslmode=verify-full`. Do **not** use Render's production `DB_URL`. The workflow's host check does not independently prove branch identity: verify the selected branch and its endpoint in Neon yourself. Prefer a database credential limited to read-only access on this test branch; the workflow itself only calls the preflight but cannot enforce database-role privileges.
3. Do not paste credentials, booking data, or connection strings into a chat, GitHub issue/PR, repository file, workflow input, screenshot, or Actions log. A GitHub Actions repository secret is accessible to workflows authorized by repository maintainers; give repository write access only to trusted people.

## One-time setup from a phone, after this PR is reviewed and manually merged

- **GitHub → molo-site → Settings → Secrets and variables → Actions → Secrets → New repository secret.** Name: `MOLO_TEST_PUSH_DB_URL`. Value: the full connection string from the **test branch**, never the production connection string. Keep it private.
- **GitHub → molo-site → Settings → Secrets and variables → Actions → Variables → New repository variable.** Name: `MOLO_TEST_PUSH_EXPECTED_HOST`. Value: only the test branch's Neon hostname (for example `ep-...neon.tech`), copied *independently* from that branch's connection panel, not extracted from the secret. This hostname is a non-secret configuration value; never put a password or entire URL here.
- Before pressing Run, recheck the selected Neon branch, both values' provenance, and that the test branch has not expired. If mobile GitHub hides Settings, use the browser's desktop-site view; do not send credentials to an assistant for setup.

## Execute and interpret

Open **GitHub → molo-site → Actions → Guest Push test-branch preflight (check only) → Run workflow**, choose `main`, and run. The button offers **no apply option**. Dependency install and build run *before* the test database secret becomes available to a step. The last step executes only `--check` with `MOLO_PUSH_BRANCH=test-push-migration` and `DB_SYNCHRONIZE=false`.

Success means that the connected database passed the eight-migration history and structural checks **without running the Push migration**. If it fails because the test branch expired, the host differs, a secret/variable is missing, SSL is invalid, or the history/schema changed: stop and investigate; do not replace the secret with production credentials, bypass guards, or manually change migration history. No database write is intentionally performed by this workflow, but an incorrectly configured connection could read metadata from the wrong branch, and storing credentials in GitHub is a separate security decision.

**Next stage requires its own review and explicit approval:** testing the actual TypeORM `--apply` on the test branch with a separately designed mechanism. This workflow does not implement that stage or authorize any production changes.
