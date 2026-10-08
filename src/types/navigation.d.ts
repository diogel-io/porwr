import type { ComputedRef } from 'vue';
type NavigationRouteName =
  | 'dashboard'
  | 'keys'
  | 'view-key'
  | 'import-key'
  | 'add-new-key'
  | 'profile'
  | 'relays'
  | 'connected-sites'
  | 'contacts'
  | 'messaging'
  | 'media-management'
  | 'wallet-connections'
  | 'settings'
  | 'event-history'
  | 'edit-account';
type ProfileTab = 'profile' | 'images';

interface NavigationTarget {
  name: NavigationRouteName;
  query?: {
    tab?: ProfileTab;
  };
}

interface NavigationItem {
  id:
    | 'dashboard'
    | 'keys'
    | 'profile'
    | 'relays'
    | 'connected-sites'
    | 'contacts'
    | 'messaging'
    | 'media-management'
    | 'wallet-connections'
    | 'event-history'
    | 'settings';
  icon: string;
  label: string;
  caption: string;
  target: NavigationTarget;
  isActive: () => boolean;
}

interface UtilityLinkItem {
  id: 'support' | 'documentation';
  icon: string;
  label: string;
  caption: string;
  href: string;
}

interface UseNavigationResult {
  navigationItems: ComputedRef<NavigationItem[]>;
  utilityLinks: ComputedRef<UtilityLinkItem[]>;
}
