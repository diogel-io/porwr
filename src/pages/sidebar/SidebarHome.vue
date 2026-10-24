<script lang="ts" setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';

import useAccountStore from '@/stores/account-store';
import ProfileView from '@/components/shared/ProfileView.vue';
import RemoteImagesNotice from '@/components/shared/RemoteImagesNotice.vue';
import CurrentRequest from '@/components/sidebar/CurrentRequest.vue';
import PendingRequestList from '@/components/sidebar/PendingRequestList.vue';
import SidebarSetup from '@/components/sidebar/SidebarSetup.vue';
import SidebarUnlock from '@/components/sidebar/SidebarUnlock.vue';
import SiteAccountNotice from '@/components/sidebar/SiteAccountNotice.vue';
import { useActiveTab } from '@/composables/useActiveTab';
import { useApprovalQueue } from '@/composables/useApprovalQueue';
import { resetRemoteImageReveals } from '@/composables/useRemoteImages';
import { isNotice } from '@/services/approval-preview';
import useVaultStore from '@/stores/vault-store';
import { switchSiteToActiveAccount } from '@/services/connected-sites-service';
import type { ApprovalDuration, ApprovalRequestRecord } from '@/../src-bex/types/background';

defineOptions({ name: 'SidebarHome' });

const $q = useQuasar();
const { t } = useI18n();
const accountStore = useAccountStore();
const { activeOrigin } = useActiveTab();
const vaultStore = useVaultStore();
const { pending, current, content, decide, dismiss, present } = useApprovalQueue();

const busy = ref(false);

/**
 * Body precedence from the interaction specification §3: unlock, then the current request, then
 * the pending list, then the idle view.
 */
/**
 * A vault that does not exist cannot be unlocked.
 *
 * The contract names S16 for "no account configured", meaning an unlocked vault with no keys, and
 * says nothing about there being no vault at all. Without this distinction the panel fell through
 * to its unlock view and offered to unlock nothing (#158).
 */
const showSetup = computed(() => !vaultStore.vaultExists);

const showUnlock = computed(() => vaultStore.vaultExists && !vaultStore.isUnlocked);

async function onDecide(id: string, approved: boolean, duration: ApprovalDuration): Promise<void> {
  busy.value = true;
  try {
    await decide(id, approved, duration);
  } finally {
    busy.value = false;
  }
}

/**
 * Reject the request, then connect its site as the active account.
 *
 * Never the other way round, and never approving: the request named the account it would act as,
 * and nothing is signed with any other (diogel-io/workspace#23). The site's next request, such as
 * signing in again, comes from the active account.
 */
async function onRejectAndSwitch(request: ApprovalRequestRecord): Promise<void> {
  const names = { origin: request.origin, active: request.activeAccountAlias ?? '' };
  busy.value = true;
  try {
    await decide(request.id, false, 'once');
    const result = await switchSiteToActiveAccount(request.origin);
    $q.notify(
      result.success
        ? {
            type: 'positive',
            message: t('request.account.switched', {
              ...names,
              active: result.site.boundAlias ?? names.active,
            }),
          }
        : { type: 'negative', message: t('request.account.switchFailed', names) },
    );
  } finally {
    busy.value = false;
  }
}

/** Dismiss an expired or interrupted notice; the panel moves on to whatever is next (S13, S14). */
async function onDismiss(id: string): Promise<void> {
  busy.value = true;
  try {
    await dismiss(id);
  } finally {
    busy.value = false;
  }
}

/**
 * Show the request chosen from the pending list (S7).
 *
 * The choice is made in the background, which owns what is current. Setting it only here was
 * overwritten by the next read, so the panel stayed on the request it was showing (porwr#334).
 */
async function onSelect(id: string): Promise<void> {
  if (!pending.value.some((request) => request.id === id)) return;
  busy.value = true;
  try {
    // Choosing another request is moving on from the notice, so it is dismissed first. Otherwise
    // the background would keep answering with the notice and the choice would not take.
    if (current.value && isNotice(current.value)) await dismiss(current.value.id);
    await present(id);
  } finally {
    busy.value = false;
  }
}

/** A notice cannot be rejected, so the unlock view is never handed one to name. */
const waitingRequest = computed(() => (isNotice(current.value) ? null : current.value));

/**
 * Which view the panel is showing. Views are branches of this page, not routes, so the router's
 * scroll behaviour never sees them change (#321). A request is its own view, but a refresh of the
 * same request keeps its key and so keeps the user where they are.
 */
const viewKey = computed(() => {
  if (showSetup.value) return 'setup';
  if (showUnlock.value) return 'unlock';
  return current.value ? `request:${current.value.id}` : 'idle';
});

const page = ref<{ $el: HTMLElement } | null>(null);

// `.sidebar-body` in the sidebar layout is the one scroller, and it outlives every view, so a new
// view would otherwise open at the previous one's offset and hide its heading.
watch(viewKey, async () => {
  await nextTick();
  const scroller = page.value?.$el.closest('.sidebar-body');
  if (scroller) scroller.scrollTop = 0;
});

const activeStoredKey = computed(() => accountStore.activeAccount);

/**
 * The panel never changes route, so the router's reset never runs here. Images the user loaded
 * stay with the idle view of one account: switching account, or a request taking the panel,
 * holds them back again (T32, diogel-io/workspace#148).
 */
watch([() => activeStoredKey.value?.id, () => current.value?.id], () => resetRemoteImageReveals());

/**
 * S16 is a vault that was read and holds no accounts. Until the vault has been read there is
 * nothing to say, and saying S16 anyway is what #211 reported: the panel mounts while the vault is
 * locked, so it hydrated from a locked vault and announced "no active account" to users who had
 * one.
 */
const showNoAccount = computed(() => accountStore.hasNoAccounts);

function openInTab(path: string): void {
  const url = chrome.runtime.getURL(`www/index.html#${path}`);
  void chrome.tabs.create({ url });
}

onMounted(async () => {
  await accountStore.getKeys();
});
</script>

<template>
  <q-page ref="page" class="sidebar-home">
    <!-- Nothing else is reachable without a vault, so this precedes even the unlock view (#158). -->
    <!--
      S17. One screen: what Porwr is, and the form that creates the vault. It was briefly two,
      behind a "Create vault" button, which traded a browser tab for a click in the flow that was
      reported as clunky to begin with (#198).
    -->
    <SidebarSetup v-if="showSetup" />

    <!-- Unlock takes precedence over everything else, and names any waiting request (S5, S15). -->
    <SidebarUnlock
      v-else-if="showUnlock"
      :waiting-request="waitingRequest"
      @reject="(id) => onDecide(id, false, 'once')"
    />

    <template v-else-if="current">
      <CurrentRequest
        :request="current"
        :content="content"
        :busy="busy"
        @decide="onDecide"
        @reject-and-switch="onRejectAndSwitch"
        @dismiss="onDismiss"
      />
      <PendingRequestList :requests="pending" :current-id="current.id" @select="onSelect" />
    </template>

    <template v-else>
      <!-- Idle view: shown only when the vault is unlocked and nothing is waiting. -->
      <section
        v-if="activeOrigin"
        class="sidebar-home__context"
        :aria-label="t('sidebar.activeSite.ariaLabel')"
      >
        <div class="sidebar-home__context-label">{{ t('sidebar.activeSite.label') }}</div>
        <div class="sidebar-home__context-origin">{{ activeOrigin }}</div>
        <SiteAccountNotice :origin="activeOrigin" :active-pubkey="activeStoredKey?.id ?? null" />
      </section>

      <!-- The lock action lives in the header, so it stays reachable once a request is presented. -->
      <div v-if="activeStoredKey" class="sidebar-home__account">
        <RemoteImagesNotice />
        <ProfileView :stored-key="activeStoredKey" />
      </div>

      <div v-else-if="showNoAccount" class="sidebar-home__empty">
        <q-icon color="grey-5" name="account_circle" size="3em" />
        <div class="text-subtitle1 text-grey-7 q-mt-sm">{{ t('account.noActiveAccount') }}</div>
        <p class="text-grey-6">{{ t('account.noActiveAccountDesc') }}</p>
        <q-btn
          no-caps
          class="diogel-btn-primary"
          :label="t('sidebar.links.keys')"
          @click="openInTab('/keys')"
        />
      </div>

      <!-- The vault has not been read yet, which is not the same as holding no accounts (#211). -->
      <div v-else class="sidebar-home__empty" role="status">
        <q-spinner color="grey-5" size="2em" />
        <div class="text-subtitle1 text-grey-7 q-mt-sm">{{ t('account.loading') }}</div>
      </div>
    </template>
  </q-page>
</template>

<style scoped>
/*
 * The panel column is inset once, here. The request components used to add 12px of their own on
 * top of this, so request content sat 24px from each edge and cost 48px of a 320px floor, while
 * the idle view sat at 12px — an inset that changed with the state on screen.
 */
.sidebar-home {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  min-width: 0;
}

.sidebar-home__context {
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  min-width: 0;
}

.sidebar-home__context-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted, #888);
}

/* Origins can be long and must never force the panel to scroll sideways. */
.sidebar-home__context-origin {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.sidebar-home__account {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.sidebar-home__empty {
  text-align: center;
  padding: 24px 8px;
}

.sidebar-setup {
  text-align: center;
  padding: 24px 8px;
  min-width: 0;
}

.sidebar-setup__title {
  margin: 8px 0 4px;
  font-size: 1rem;
  font-weight: 600;
}

.sidebar-setup__body {
  color: var(--text-muted, #888);
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}
</style>
