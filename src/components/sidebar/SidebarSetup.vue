<script lang="ts" setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { useVault } from '@/composables/useVault';

defineOptions({ name: 'SidebarSetup' });

const { t } = useI18n();
const { password, confirmPassword, loading, loginError, handleCreate } = useVault();

/**
 * S17: no vault yet. Explains what Porwr is and creates the vault, in one screen.
 *
 * Creation used to open a full tab, which the specification required until 2026-08-22 and which put
 * a browser window in the middle of first-run onboarding. It briefly became a second panel screen
 * behind a "Create vault" button, which traded the tab for a click in the flow that was reported as
 * clunky in the first place. It is two password fields; it fits the column, so it is simply here.
 *
 * There is no navigation here and there must not be. `handleCreate` returns early on a panel route,
 * so the panel re-renders from vault state once the vault exists and lands on S16, the prompt to
 * add a key. Key creation and import stay full-tab: they involve seed phrases and their backup,
 * which a 320px ephemeral column is the wrong place to display.
 */
const tooShort = computed(() => password.value.length > 0 && password.value.length < 8);
const mismatched = computed(
  () => confirmPassword.value.length > 0 && confirmPassword.value !== password.value,
);
const submittable = computed(
  () => password.value.length >= 8 && confirmPassword.value === password.value && !loading.value,
);
</script>

<template>
  <section class="sidebar-setup" :aria-label="t('sidebar.setup.ariaLabel')">
    <q-icon class="sidebar-setup__icon" color="grey-5" name="lock_open" size="2.5em" />
    <h2 class="sidebar-setup__title">{{ t('sidebar.setup.title') }}</h2>
    <p class="sidebar-setup__body">{{ t('sidebar.setup.body') }}</p>
    <p class="sidebar-setup__warning">{{ t('sidebar.createVault.warning') }}</p>

    <q-input
      v-model="password"
      class="sidebar-setup__field"
      dense
      filled
      :error="tooShort"
      :error-message="t('sidebar.createVault.minimum')"
      :label="t('sidebar.createVault.password')"
      type="password"
    />
    <q-input
      v-model="confirmPassword"
      class="sidebar-setup__field"
      dense
      filled
      :error="mismatched"
      :error-message="t('sidebar.createVault.mismatch')"
      :label="t('sidebar.createVault.confirmPassword')"
      type="password"
      @keyup.enter="submittable && handleCreate()"
    />

    <div v-if="loginError" class="sidebar-setup__error">{{ loginError }}</div>

    <div class="sidebar-setup__actions">
      <q-btn
        no-caps
        class="diogel-btn-primary"
        :label="t('sidebar.setup.action')"
        :disable="!submittable"
        :loading="loading"
        @click="handleCreate"
      />
    </div>
  </section>
</template>

<style scoped>
.sidebar-setup {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 12px;
}

.sidebar-setup__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
}

.sidebar-setup__body {
  margin: 0;
  font-size: 0.85rem;
  opacity: 0.75;
}

.sidebar-setup__field {
  width: 100%;
}

.sidebar-setup__error {
  font-size: 0.85rem;
  color: var(--q-negative);
}

.sidebar-setup__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

/* NFR-7: a target small enough to miss is a target that fails the requirement. */
.sidebar-setup__actions .q-btn {
  min-height: 36px;
}
</style>
