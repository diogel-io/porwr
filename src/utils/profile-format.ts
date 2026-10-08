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

/** Adds a scheme to a bare host so the link is not resolved against the extension's own origin. */
export const normalizeWebsiteUrl = (website: string): string =>
  /^https?:\/\//i.test(website) ? website : `https://${website}`;
