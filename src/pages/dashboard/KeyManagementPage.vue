<script lang="ts" setup>
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import useAccountStore from '@/stores/account-store';
import KeyManagementTable from '@/components/dashboard/key-management/KeyManagementTable.vue';
import SecurityWarning from '@/components/dashboard/SecurityWarning.vue';

const { t } = useI18n();
const accountStore = useAccountStore();

const storedKeys = computed(() => Array.from(accountStore.storedKeys));

onMounted(async () => {
  await accountStore.getKeys();
});
</script>

<template>
  <q-page class="dashboard-page key-management-page">
    <section class="dashboard-hero">
      <h1 class="dashboard-hero-title">{{ t('navigation.keys.label') }}</h1>
      <p class="dashboard-hero-caption">{{ t('navigation.keys.caption') }}</p>
    </section>

    <security-warning
      :title="t('keyManagement.securityWarning.title')"
      :message="t('keyManagement.securityWarning.message')"
    />

    <q-card class="dashboard-card key-management-page__card">
      <q-card-section class="row q-col-gutter-sm justify-end items-center">
        <div>
          <q-btn
            :label="t('keyManagement.importKey')"
            :to="{ name: 'import-key' }"
            class="diogel-btn-secondary q-mr-sm"
            no-caps
            outline
          />
          <q-btn
            :label="t('keyManagement.addNewKey')"
            :to="{ name: 'add-new-key' }"
            class="diogel-btn-primary"
            no-caps
          />
        </div>
      </q-card-section>

      <q-separator inset />

      <q-card-section>
        <key-management-table :keys="storedKeys" />
      </q-card-section>
    </q-card>
  </q-page>
</template>

<style scoped>
.key-management-page {
  width: 100%;
}

.key-management-page__card {
  overflow: hidden;
}
</style>
