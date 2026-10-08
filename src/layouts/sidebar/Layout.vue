<script lang="ts" setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import DiogelLogo from '@/components/shared/DiogelLogo.vue';
import SidebarFooterLinks from '@/components/sidebar/SidebarFooterLinks.vue';
import AccountSwitcher from '@/components/sidebar/AccountSwitcher.vue';
import { useApprovalQueue } from '@/composables/useApprovalQueue';
import { useVault } from '@/composables/useVault';
import useVaultStore from '@/stores/vault-store';

defineOptions({ name: 'SidebarLayout' });

const { t } = useI18n();
const vaultStore = useVaultStore();
const { handleLock } = useVault();

// Shared queue state, so this count and the request the page is showing can never disagree.
const { pendingCount } = useApprovalQueue();

const hasPending = computed(() => pendingCount.value > 0);

/**
 * The badge carries the number visually; this is what a screen reader announces instead (NFR-4).
 */
const switchedAlias = ref<string | null>(null);

/**
 * Announced rather than shown as a toast: the panel is 360px and the change is deliberately
 * undramatic, but a screen-reader user needs to know the choice took effect.
 */
function onAccountSwitched(alias: string): void {
  switchedAlias.value = alias;
}

const pendingLabel = computed(() =>
  t('sidebar.header.pending.ariaLabel', { count: pendingCount.value }, pendingCount.value),
);
</script>

<template>
  <q-layout class="sidebar-root" view="hHh Lpr lFf">
    <header class="sidebar-header" :aria-label="t('sidebar.header.ariaLabel')">
      <div class="sidebar-brand">
        <DiogelLogo size="md" />
        <span class="sidebar-brand__name">Diogel</span>
      </div>

      <div class="sidebar-header__actions">
        <!--
          Specification §3's account switcher. It chooses the identity a *new* site binds to; it
          cannot re-target one already connected, and says so (#116).
        -->
        <AccountSwitcher v-if="vaultStore.isUnlocked" @switched="onAccountSwitched" />

        <q-badge
          v-if="hasPending"
          class="sidebar-header__pending"
          aria-hidden="true"
          rounded
        >
          {{ pendingCount }}
        </q-badge>

        <!--
          Polite, never assertive: a request arriving must not interrupt what the user is reading
          in the panel body (NFR-4).
        -->
        <span class="sidebar-header__sr-only" role="status" aria-live="polite">
          {{ pendingLabel }}
          <template v-if="switchedAlias">
            {{ t('sidebar.accountSwitcher.switched', { alias: switchedAlias }) }}
          </template>
        </span>

        <q-btn
          v-if="vaultStore.isUnlocked"
          flat
          dense
          round
          icon="lock"
          class="sidebar-header__lock"
          :aria-label="t('navigation.lock.caption')"
          :title="t('navigation.lock.caption')"
          @click="handleLock"
        />
      </div>
    </header>

    <q-page-container class="sidebar-body diogel-scrollbar">
      <router-view />
    </q-page-container>

    <!--
      Shown only when the vault is unlocked (specification §3, amended 2026-08-22).

      Every destination behind it needs an unlocked vault to be useful, so offering them earlier
      advertises navigation that leads nowhere — and on the setup and creation views it implies the
      user may go elsewhere when the one thing to do is in front of them. The same reasoning covers
      the unlock views, S2, S5 and S15.

      Accepted consequence: while locked, the panel offers no route to a management surface.
    -->
    <SidebarFooterLinks v-if="vaultStore.isUnlocked" />
  </q-layout>
</template>

<style scoped>
/*
 * The panel is a single narrow column. Width is owned by the browser, so the layout is fluid
 * from the 320px floor upward and never scrolls horizontally (NFR-11, NFR-12).
 */
.sidebar-root {
  display: flex;
  flex-direction: column;
  min-width: 0;
  width: 100%;
  height: 100vh;
  background: var(--page-bg);
  overflow-x: hidden;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  /* Trimmed from 12px: the header was 67px tall before any request content appeared (#188). */
  padding: 8px 12px;
  background: var(--header-bg);
  border-bottom: 1px solid var(--header-border);
  flex-shrink: 0;
}

/*
 * The brand gives way first.
 *
 * It is decoration; the account switcher beside it names the identity new sites will bind to. When
 * the header runs short of room the ornamental element should yield, not the functional one (#188).
 */
.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 0 1 auto;
  overflow: hidden;
}

.sidebar-brand__name {
  font-weight: 600;
  font-size: 1rem;
  color: var(--text-color);
  letter-spacing: -0.0125em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Below this the wordmark is dropped entirely; the logo still identifies the panel. */
@media (max-width: 360px) {
  .sidebar-brand__name {
    display: none;
  }
}

/* Actions keep their width so the brand is what gives way when the panel is narrow. */
/*
 * Allowed to shrink now, but only after the brand has: the switcher's own minimum holds the alias
 * legible, so shrinking here reduces slack rather than squeezing the identity.
 */
.sidebar-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 1 auto;
  min-width: 0;
}

/* Theme-aware: a dark pill on light chrome, an amber pill on dark chrome (#153). */
.sidebar-header__pending {
  background: var(--badge-bg);
  color: var(--on-badge);
  font-weight: 700;
  font-size: 0.7rem;
  min-width: 20px;
  justify-content: center;
}

.sidebar-header__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.sidebar-body {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
</style>
