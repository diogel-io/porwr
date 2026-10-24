/**
 * The auto-lock timeout, shared by the background, which enforces it, and the settings page, which
 * offers it, so both clamp the same way (as `request-expiry.ts` does for request expiry).
 */

/** Used when nothing valid is stored. */
export const AUTO_LOCK_DEFAULT_MINUTES = 15;

/** A day. Any longer is not a timeout, and nothing in the settings offers it (#140). */
export const AUTO_LOCK_MAX_MINUTES = 1440;

/**
 * The timeout as the background will use it: whole minutes from 0 (off) to a day. Anything else
 * read from storage, including a missing or malformed value, falls back to the default (#140).
 */
export const clampAutoLockMinutes = (value: unknown): number => {
  const minutes = Number(value);
  if (value === undefined || value === null || !Number.isFinite(minutes)) {
    return AUTO_LOCK_DEFAULT_MINUTES;
  }
  return Math.min(AUTO_LOCK_MAX_MINUTES, Math.max(0, Math.floor(minutes)));
};
