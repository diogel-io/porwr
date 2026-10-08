
import { computed } from 'vue';

import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import type { NavigationItem, UseNavigationResult, UtilityLinkItem } from 'src/types/navigation';

export function useNavigation(): UseNavigationResult {
  const { t } = useI18n();
  const route = useRoute();

  const routeName = computed(() => (typeof route.name === 'string' ? route.name : ''));

  const utilityLinks = computed<UtilityLinkItem[]>(() => [
    {
      id: 'support',
      icon: 'support_agent',
      label: t('navigation.support.label'),
      caption: t('navigation.support.caption'),
      href: 'https://github.com/threenine/diogel/issues',
    },
    {
      id: 'documentation',
      icon: 'description',
      label: t('navigation.documentation.label'),
      caption: t('navigation.documentation.caption'),
      href: 'https://diogel.io/docs/porwr',
    },
  ]);

  const navigationItems = computed<NavigationItem[]>(() => [
    {
      id: 'dashboard',
      icon: 'dashboard',
      label: t('navigation.dashboard.label'),
      caption: t('navigation.dashboard.caption'),
      target: { name: 'dashboard' },
      isActive: () => routeName.value === 'dashboard',
    },
    {
      id: 'keys',
      icon: 'key',
      label: t('navigation.keys.label'),
      caption: t('navigation.keys.caption'),
      target: { name: 'keys' },
      isActive: () =>
        routeName.value === 'keys' ||
        routeName.value === 'view-key' ||
        routeName.value === 'import-key' ||
        routeName.value === 'add-new-key' ||
        routeName.value === 'edit-account',
    },
    {
      id: 'profile',
      icon: 'person',
      label: t('navigation.profile.label'),
      caption: t('navigation.profile.caption'),
      target: { name: 'profile', query: { tab: 'profile' } },
      isActive: () => routeName.value === 'profile',
    },
    {
      id: 'relays',
      icon: 'hub',
      label: t('navigation.relays.label'),
      caption: t('navigation.relays.caption'),
      target: { name: 'relays' },
      isActive: () => routeName.value === 'relays',
    },
    {
      id: 'connected-sites',
      icon: 'link',
      label: t('navigation.connectedSites.label'),
      caption: t('navigation.connectedSites.caption'),
      target: { name: 'connected-sites' },
      isActive: () => routeName.value === 'connected-sites',
    },
    {
      id: 'contacts',
      icon: 'contacts',
      label: t('navigation.contacts.label'),
      caption: t('navigation.contacts.caption'),
      target: { name: 'contacts' },
      isActive: () => routeName.value === 'contacts',
    },
    {
      id: 'media-management',
      icon: 'perm_media',
      label: t('navigation.mediaManagement.label'),
      caption: t('navigation.mediaManagement.caption'),
      target: { name: 'media-management' },
      isActive: () => routeName.value === 'media-management',
    },
    {
      id: 'wallet-connections',
      icon: 'account_balance_wallet',
      label: t('navigation.walletConnections.label'),
      caption: t('navigation.walletConnections.caption'),
      target: { name: 'wallet-connections' },
      isActive: () => routeName.value === 'wallet-connections',
    },
    {
      id: 'event-history',
      icon: 'flaky',
      label: t('navigation.logs.label'),
      caption: t('navigation.logs.caption'),
      target: { name: 'event-history' },
      isActive: () => routeName.value === 'event-history' || routeName.value === 'logs',
    },
    {
      id: 'settings',
      icon: 'settings',
      label: t('navigation.settings.label'),
      caption: t('navigation.settings.caption'),
      target: { name: 'settings' },
      isActive: () => routeName.value === 'settings',
    },
  ]);

  return {
    navigationItems,
    utilityLinks,
  };
}
