<script lang="ts" setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import useAccountStore from '@/stores/account-store';
import type { StoredKey } from '@/types';

defineOptions({ name: 'AccountSwitcher' });

/**
 * Chooses the identity a site binds to on first contact.
 *
 * It cannot change what an already-connected site signs as: a site keeps the account it was bound
 * to, and a pending request keeps the account captured when it was created (#116, S10, FR-13). The
 * control says so rather than leaving the user to infer a scope they cannot see — a switcher that
 * looked like it re-pointed existing sessions would be misleading about which key signs what.
 */
const { t } = useI18n();
const accountStore = useAccountStore();

const accounts = computed<StoredKey[]>(() => Array.from(accountStore.storedKeys));

const activeAlias = computed(() => accountStore.activeKey);

const hasChoice = computed(() => accounts.value.length > 1);

const emit = defineEmits<{ (event: 'switched', alias: string): void }>();

async function choose(alias: string): Promise<void> {
  if (alias === activeAlias.value) return;

  await accountStore.setActiveKey(alias);
  emit('switched', alias);
}

function openKeys(): void {
  const url = chrome.runtime.getURL('www/index.html#/keys');
  void chrome.tabs.create({ url });
}
</script>

<template>
  <q-btn
    flat
    dense
    no-caps
    class="account-switcher"
    :aria-label="t('sidebar.accountSwitcher.ariaLabel')"
    :title="t('sidebar.accountSwitcher.ariaLabel')"
  >
    <span class="account-switcher__alias">
      {{ activeAlias ?? t('sidebar.accountSwitcher.none') }}
    </span>
    <q-icon name="expand_more" size="xs" />

    <q-menu class="account-switcher__menu">
      <div class="account-switcher__heading">
        {{ t('sidebar.accountSwitcher.current') }}
      </div>

      <q-list dense>
        <q-item
          v-for="account in accounts"
          :key="account.id"
          v-close-popup
          clickable
          :active="account.alias === activeAlias"
          @click="choose(account.alias)"
        >
          <q-item-section>{{ account.alias }}</q-item-section>
          <q-item-section v-if="account.alias === activeAlias" side>
            <q-icon name="check" size="xs" />
          </q-item-section>
        </q-item>

        <q-item v-if="accounts.length === 0" dense>
          <q-item-section class="text-grey-6">
            {{ t('sidebar.accountSwitcher.none') }}
          </q-item-section>
        </q-item>
      </q-list>

      <!--
        Stated whenever there is a choice to make. Without it the control reads as "sign as this
        account", which is not what it does.
      -->
      <p v-if="hasChoice" class="account-switcher__scope">
        {{ t('sidebar.accountSwitcher.scope') }}
      </p>

      <q-separator />

      <q-list dense>
        <q-item v-close-popup clickable @click="openKeys">
          <q-item-section>{{ t('sidebar.accountSwitcher.manage') }}</q-item-section>
        </q-item>
      </q-list>
    </q-menu>
  </q-btn>
</template>

<style scoped>
/*
 * Sized to its content, capped, and never squeezed below legibility.
 *
 * This carried `max-width: 40%`, which resolved against the header's actions block rather than the
 * header — and that block is sized by its own contents, so the constraint was circular and left the
 * alias rendering at 14px (#188). A fixed width would only trade one arbitrary number for another
 * and break differently on a long alias.
 */
.account-switcher {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 11rem;
}

/* An alias can be anything the user typed; it must not push the lock action off the header. */
.account-switcher__alias {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8rem;
  font-weight: 600;
  /* Enough for several characters before the ellipsis; an alias truncated to nothing names no one. */
  min-width: 4.5rem;
}

.account-switcher__heading {
  padding: 8px 12px 4px;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted, #888);
}

.account-switcher__scope {
  margin: 4px 0 8px;
  padding: 0 12px;
  max-width: 260px;
  font-size: 0.75rem;
  color: var(--text-muted, #888);
}
</style>
