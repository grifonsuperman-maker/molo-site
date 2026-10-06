const MAX_CONFIRMATION_LIFETIME_MS = 5 * 60_000;

// Both timestamps belong to the server. Device wall-clock offsets must not
// invalidate its proof. Count elapsed request/consent time on a monotonic clock.
// Starting before the request conservatively includes the entire round trip.
export function syrveConfirmationDeadline(checkedAt: string, expiresAt: string, requestStartedAt: number): number | null {
  const lifetime = Date.parse(expiresAt) - Date.parse(checkedAt);
  const now = performance.now();
  if (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > MAX_CONFIRMATION_LIFETIME_MS
    || !Number.isFinite(requestStartedAt) || requestStartedAt < 0 || requestStartedAt > now) return null;
  const deadline = requestStartedAt + lifetime;
  return Number.isFinite(now) && now < deadline ? deadline : null;
}

// The backend remains authoritative: it verifies signature, expiry, actor,
// revision and table scope again before any command, including after tab sleep.
export function syrveConfirmationExpired(deadline: number): boolean {
  const now = performance.now();
  return !Number.isFinite(deadline) || !Number.isFinite(now) || now >= deadline;
}
