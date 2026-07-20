# MOLO repository instructions

## Mandatory workflow

- Always start from the latest `main`.
- One task must use one new branch and one pull request to `main`.
- Never merge pull requests.
- Never continue or reuse an old conflicted branch.
- Do not cherry-pick or merge an old PR unless the task explicitly requires it.
- Before editing, inspect the current branch, latest commit and working tree.
- Never claim that a PR or branch was updated until the commit exists in GitHub.
- Never claim that tests or builds passed unless the commands actually exited successfully.
- If dependency installation or a test fails because of the environment, report it clearly.

## Product language and terminology

- All visible website interface text must be Ukrainian.
- Use the role name `Директор`, never `Власник`.
- Use `Кальянник`, never `кальянний майстер`.
- Do not invent an administrator phone number.
- Do not add placeholder contact information.

## Protected project areas

Do not change these items unless the task explicitly and separately requests it:

- SVG table contours.
- Table contour coordinates, dimensions and rotations.
- Table numbers and click zones.
- Restaurant photographs and image paths.
- `hero-bg.jpg` and daily images.
- `SitePhotoController`.
- Title rotation v2.
- Existing role test switch.
- Existing booking deletion and history.
- Existing waiter button behavior.
- Polling interval of exactly 15 seconds.
- Generated images or replacement images must not be introduced.

## Table status colors

Preserve these values:

- `free`: hidden outline.
- `pending`: `#38bdf8`.
- `reserved`: `#fb923c`.
- `occupied`: `#ff3b4f`.
- `cleaning`: `#67e8f9`.
- `closed`: `#bdbdbd`.
- selected: `#facc15`.

For today, preserve this priority:

1. hidden or closed;
2. occupied;
3. cleaning;
4. pending or reserved;
5. free.

Future dates show booking state only.

## Guest booking invariants

- A raw `guestDeviceId` may exist only in the browser.
- The backend must store only its SHA-256 hash.
- A guest may have only one active booking per date by device or normalized phone.
- Active duplicate-protection statuses are `pending` and `approved`.
- The duplicate rule must be atomic at database level, not only a read-before-write check.
- Bookings on different dates are allowed.
- After `cancelled`, `rejected`, `completed` or `no-show`, a new booking for that date is allowed.
- Existing token-based bookings must remain compatible.
- Each booking card must use its own `bookingId` and `guestAccessToken`.
- Never return access tokens or device/phone hashes from the backend.
- Guests see only active bookings for today and future dates.
- Guest history must not be shown.
- Lateness must never automatically cancel a booking or free a table.
- Table changes must be atomic and preserve the old table until the new table is successfully assigned.
- Review prompts are allowed only after a completed checked-in visit.
- Cancelled, rejected and no-show bookings must not receive a review prompt.
- Preserve waiter calls, hookah calls and the `Бажаєте кальян?` block.

## Database changes

- Every database schema change requires a TypeORM migration.
- Do not rely on TypeORM `synchronize`.
- Every migration must include a safe `up` and `down`.
- Concurrency-sensitive business rules must be protected by database constraints, transactions or locking.
- PostgreSQL unique violations must be converted into understandable Ukrainian API messages.

## Required testing

For booking-related changes, add or update tests for:

- simultaneous duplicate booking requests;
- duplicate detection by device;
- duplicate detection by normalized phone;
- booking on different dates;
- booking after cancellation or completion;
- old bookings found by access token;
- combined device and token booking lists;
- blocked or unavailable localStorage;
- per-booking action tokens;
- completed-visit review flow.

After test infrastructure exists, run:

- `npm --prefix backend ci`
- `npm --prefix frontend ci`
- `npm --prefix backend run build`
- `npm --prefix frontend run build`
- `npm --prefix backend test`
- `npm --prefix frontend test`
- `git diff --check`
- `git show --check HEAD`

Before finishing, inspect the diff and confirm that protected project areas were not changed.

## Pull request requirements

Every PR description must include:

- what behavior changed;
- which files changed;
- migrations added or changed;
- tests that were actually executed;
- commands that failed and their real errors;
- confirmation that protected assets and polling were not changed.
