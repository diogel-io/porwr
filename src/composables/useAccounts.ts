import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import useAccountStore from '@/stores/account-store';
import type { DropdownItem, StoredKey } from '@/types';
import { useI18n } from 'vue-i18n';
import { profileService } from '@/services/profile-service';

export interface AccountDropdownItem extends DropdownItem<string> {
  avatarUrl?: string;
  pubkey?: string;
}

export function useAccounts() {
  const accountStore = useAccountStore();
  const router = useRouter();
  const { t } = useI18n();
  const model = ref<string | null>(null);
  const avatarUrls = ref<Record<string, string>>({});

  const CREATE_VALUE = 'create-account';

  const accountKeys = computed<StoredKey[]>(() =>
    Array.from(accountStore.storedKeys).filter((key) => key.alias !== 'Main Account'),
  );

  const items = computed<AccountDropdownItem[]>(() => {
    const fromStore: AccountDropdownItem[] = accountKeys.value.map((key) => {
      const avatarUrl = avatarUrls.value[key.id];
      return {
        label: key.alias,
        value: key.alias,
        pubkey: key.id,
        ...(avatarUrl ? { avatarUrl } : {}),
      };
    });

    return [
      ...fromStore,
      {
        label: `➕ ${t('account.create')}`,
        value: CREATE_VALUE,
      },
    ];
  });

  async function loadAccountAvatars(): Promise<void> {
    const avatarEntries = await Promise.all(
      accountKeys.value.map(async (key): Promise<[string, string] | null> => {
        const profile = await profileService.fetchProfile(key.id);
        const picture = profile?.picture?.trim();
        return picture ? [key.id, picture] : null;
      }),
    );

    avatarUrls.value = avatarEntries.reduce<Record<string, string>>((acc, entry) => {
      if (entry) {
        const [pubkey, avatarUrl] = entry;
        acc[pubkey] = avatarUrl;
      }
      return acc;
    }, {});
  }

  async function refreshAccounts(): Promise<void> {
    await accountStore.getKeys();
  }

  function openKeyManagementInBrowser(): void {
    const path = '/keys';

    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL && chrome.tabs?.create) {
      const url = chrome.runtime.getURL(`www/index.html#${path}`);
      void chrome.tabs.create({ url });
      return;
    }

    router.push({ name: 'keys' }).catch(() => {});
  }

  watch(accountKeys, () => {
    void loadAccountAvatars();
  });

  onMounted(async () => {
    await refreshAccounts();
    model.value = accountStore.activeKey ?? null;
    accountStore.listenToStorageChanges();
  });

  watch(
    () => accountStore.activeKey,
    (newKey) => {
      model.value = newKey ?? null;
    },
  );

  watch(model, async (v, oldV) => {
    if (v === oldV) return;

    if (v === CREATE_VALUE) {
      openKeyManagementInBrowser();
      model.value = accountStore.activeKey ?? oldV ?? null;
      return;
    }

    if (v && v !== accountStore.activeKey) {
      await accountStore.setActiveKey(v);

      const currentPath = router.currentRoute.value.path;
      const managementPaths = [
        '/',
        '/profile',
        '/settings',
        '/logs',
        '/popup',
        '/sidebar',
        '/login',
      ];
      const isManagementPath =
        managementPaths.includes(currentPath) ||
        currentPath.startsWith('/edit-account') ||
        currentPath.startsWith('/keys');

      if (!isManagementPath) {
        router.push({ path: '/' }).catch(() => {});
      }
    }
  });

  return {
    items,
    model,
    setActiveKey: (alias: string) => accountStore.setActiveKey(alias),
    getKeys: () => accountStore.getKeys(),
    createValue: CREATE_VALUE,
  };
}
