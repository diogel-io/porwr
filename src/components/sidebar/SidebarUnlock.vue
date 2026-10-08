<script lang="ts" setup>
import { useI18n } from 'vue-i18n';

import { useVault } from '@/composables/useVault';
import type { ApprovalRequestRecord } from '@/../src-bex/types/background';

defineOptions({ name: 'SidebarUnlock' });

defineProps<{
  waitingRequest: ApprovalRequestRecord | null;
}>();

const emit = defineEmits<{
  (event: 'reject', id: string): void;
}>();

const { t } = useI18n();
const { vaultStore, password, loading, loginError, handleUnlock } = useVault();
</script>

<template>
  <section class="sidebar-unlock" :aria-label="t('sidebar.unlock.ariaLabel')">
    <h2 class="sidebar-unlock__title">{{ t('sidebar.unlock.title') }}</h2>

    <!--
      A waiting request is named, but its content is not shown before the vault is unlocked
      (specification §8). Unlocking never approves it (ADR D14).
    -->
    <div v-if="waitingRequest" class="sidebar-unlock__waiting">
      <p class="sidebar-unlock__waiting-text">
        {{ t('sidebar.unlock.waiting', { origin: waitingRequest.origin }) }}
      </p>
      <p class="sidebar-unlock__waiting-note">{{ t('sidebar.unlock.noAutoApprove') }}</p>
    </div>

    <q-input
      v-model="password"
      filled
      dense
      type="password"
      :label="t('sidebar.unlock.password')"
      @keyup.enter="handleUnlock"
    />

    <div v-if="loginError" class="sidebar-unlock__error">{{ loginError }}</div>

    <div class="sidebar-unlock__actions">
      <!-- Reject stays available while locked: it must not require unlocking first (FR-10). -->
      <q-btn
        v-if="waitingRequest"
        no-caps
        flat
        class="diogel-btn-danger"
        :label="t('request.reject')"
        @click="emit('reject', waitingRequest.id)"
      />
      <q-btn
        no-caps
        class="diogel-btn-primary"
        :loading="loading"
        :disable="!vaultStore.vaultExists"
        :label="t('sidebar.unlock.action')"
        @click="handleUnlock"
      />
    </div>
  </section>
</template>

<style scoped>
/* The column inset belongs to the page, once. See SidebarHome. */
.sidebar-unlock {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.sidebar-unlock__title {
  margin: 0;
  font-size: 1rem;
}

.sidebar-unlock__waiting {
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.sidebar-unlock__waiting-text {
  margin: 0;
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}

.sidebar-unlock__waiting-note {
  margin: 4px 0 0;
  font-size: 0.75rem;
  color: var(--text-muted, #888);
}

.sidebar-unlock__error {
  color: var(--q-negative, #c10015);
  font-size: 0.8rem;
}

.sidebar-unlock__actions {
  display: flex;
  gap: 8px;
}

.sidebar-unlock__actions .q-btn {
  flex: 1 1 0;
}
</style>
