import type { NostrProfile } from '@/types';

/**
 * Formatting shared between the surfaces that render a profile.
 *
 * The panel and the dashboard preview each grew their own copy of this while they were separate
 * components showing different fields (#200, #201). One of them is going away, but until it does,
 * two implementations of "what does a birthday look like" is one too many.
 */

/**
 * A NIP-24 birthday as `YYYY-MM-DD`, with whatever parts are present.
 *
 * Each field is optional and independently so: a user may publish a day and month without a year,
 * which is common for people who want the date without the age. Empty when nothing is set, so a
 * caller can treat it as "no birthday" without inspecting the object.
 */
export const formatBirthday = (birthday: NostrProfile['birthday']): string => {
  if (!birthday) return '';

  const parts: string[] = [];
  if (birthday.year !== undefined) parts.push(String(birthday.year));
  if (birthday.month !== undefined) parts.push(String(birthday.month).padStart(2, '0'));
  if (birthday.day !== undefined) parts.push(String(birthday.day).padStart(2, '0'));

  return parts.join('-');
};

/**
 * A profile's website as an `https:` link, or undefined when it cannot safely be one.
 *
 * The value is authored by whoever published the profile and lands in a bound `href`, which Vue does
 * not sanitise. So the scheme is allowlisted rather than patched up: a bare host gets `https://`, so
 * it is not resolved against the extension's own origin, the result must parse as `https:` with a
 * host, and credentials (`https://bank.example@evil.example`) are refused. Anything else, `http:`
 * and `javascript:` included, is shown as text instead (#373).
 */
export const normalizeWebsiteUrl = (website: string): string | undefined => {
  const trimmed = website.trim();
  if (!trimmed) return undefined;

  let url: URL;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return undefined;
  }

  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return undefined;
  return url.href;
};
