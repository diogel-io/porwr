/** Keys for `protected-settings.ts`, kept apart so they can be imported without the database. */

/** Grants: `PermissionGrant[]`, owned by `src-bex/handlers/permission-handler.ts`. */
export const PROTECTED_PERMISSIONS = 'protected:permissions' as const;

/** Site-to-account bindings: `SiteBinding[]`, owned by `src-bex/services/site-binding-store.ts`. */
export const PROTECTED_SITE_BINDINGS = 'protected:site-bindings' as const;

/** The auto-lock timeout in whole minutes; 0 turns auto-lock off. */
export const PROTECTED_AUTO_LOCK_MINUTES = 'protected:auto-lock-minutes' as const;

/** When the user last used one of Porwr's own surfaces, in epoch milliseconds. */
export const PROTECTED_LAST_ACTIVITY = 'protected:last-activity' as const;

/**
 * Whether Porwr's pages load profile pictures, banners and relay icons from the hosts that publish
 * them. Only an explicit `false` turns it off. Kept here rather than in `chrome.storage.local` so a
 * content script cannot switch it back on (T32, diogel-io/workspace#148).
 */
export const PROTECTED_LOAD_REMOTE_IMAGES = 'protected:load-remote-images' as const;

export type ProtectedKey =
  | typeof PROTECTED_PERMISSIONS
  | typeof PROTECTED_SITE_BINDINGS
  | typeof PROTECTED_AUTO_LOCK_MINUTES
  | typeof PROTECTED_LAST_ACTIVITY
  | typeof PROTECTED_LOAD_REMOTE_IMAGES;
