import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import useVaultStore from '@/stores/vault-store';
import { type ErrorCode, formatErrorForUser } from '@/types/error-codes.d';

type LoginContext = 'dashboard' | 'extension';
type PostLoginRouteName = 'dashboard' | 'home';

const dashboardRouteNames = new Set([
  'dashboard',
  'settings',
  'profile',
  'contacts',
  'logs',
  'keys',
  'view-key',
  'import-key',
  'add-new-key',
  'edit-account',
]);

function getLoginContextFromQuery(value: unknown): LoginContext | undefined {
  if (value === 'dashboard' || value === 'extension') {
    return value;
  }

  return undefined;
}

export function useVault() {
  const vaultStore = useVaultStore();
  const router = useRouter();
  const route = useRoute();
  const $q = useQuasar();

  const password = ref('');
  const confirmPassword = ref('');
  const mnemonic = ref('Generating...');
  const passphrase = ref('');
  const loading = ref(false);
  const loginError = ref('');

  function getPostLoginRouteName(): PostLoginRouteName {
    const loginContext = getLoginContextFromQuery(route.query.loginContext);
    return loginContext === 'extension' ? 'home' : 'dashboard';
  }

  /**
   * Whether this is running inside the sidebar panel.
   *
   * The panel owns a view for every vault state it can be in — setup, unlock, idle, a request — and
   * renders them itself. Navigating away from `/sidebar` for any of them puts a full-tab management
   * surface inside a 360px column, which the approved surface map forbids and which is what a user
   * actually sees: unlocking in the panel used to land them on the dashboard (#116).
   */
  function isPanelRoute(): boolean {
    return route.name === 'sidebar' || route.path === '/sidebar';
  }

  function getCurrentLoginContext(): LoginContext {
    const routeName = route.name;
    if (typeof routeName === 'string' && dashboardRouteNames.has(routeName)) {
      return 'dashboard';
    }

    return 'extension';
  }

  async function handleCreate() {
    if (password.value.length < 8 || password.value !== confirmPassword.value) {
      return;
    }
    loading.value = true;
    loginError.value = '';

    const result = await vaultStore.create(password.value, mnemonic.value, passphrase.value);
    loading.value = false;
    if (result.success) {
      $q.notify({ type: 'positive', message: 'Vault created successfully' });
      if (isPanelRoute()) return;

      /*
       * Key management, not the dashboard.
       *
       * A vault that has just been created holds no keys, and a dashboard with no keys has nothing
       * to show — it left the user to work out their own next step at the one moment they have
       * least context. Creation is unconditional here because a new vault always has zero keys;
       * `handleUnlock` still uses the login context, since an existing vault usually has some.
       */
      await router.push({ name: 'keys' });
    } else {
      loginError.value = formatErrorForUser(result.error, result.errorCode as ErrorCode);
      $q.notify({
        type: 'negative',
        message: loginError.value,
      });
    }
  }

  async function handleUnlock() {
    loading.value = true;
    loginError.value = '';
    const result = await vaultStore.unlock(password.value);
    loading.value = false;
    if (result.success) {
      // The panel re-renders itself from vault state: unlocking reveals the idle view, or the
      // request that was waiting (S6). There is nowhere to navigate to.
      if (isPanelRoute()) return;

      const redirect = route.query.redirect as string;
      if (redirect) {
        await router.push({ path: redirect, query: route.query });
      } else {
        await router.push({ name: getPostLoginRouteName() });
      }
    } else {
      loginError.value = formatErrorForUser(result.error, result.errorCode as ErrorCode);
      $q.notify({
        type: 'negative',
        message: loginError.value,
      });
    }
  }

  async function handleLock() {
    await vaultStore.lock();

    // Same rule as unlocking: the panel shows its own unlock view for a locked vault, exactly as it
    // already does when the background auto-locks.
    if (isPanelRoute()) return;

    void router.push({
      name: 'login',
      query: {
        loginContext: getCurrentLoginContext(),
      },
    });
  }

  return {
    vaultStore,
    password,
    confirmPassword,
    mnemonic,
    passphrase,
    loading,
    loginError,
    handleCreate,
    handleUnlock,
    handleLock,
    getPostLoginRouteName,
  };
}
