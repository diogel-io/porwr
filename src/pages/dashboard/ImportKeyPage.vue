<script lang="ts" setup>
import { useI18n } from 'vue-i18n';
import ImportKeyForm from '@/components/dashboard/key-management/ImportKeyForm.vue';
import DashboardBreadcrumbs from '@/components/dashboard/DashboardBreadcrumbs.vue';

const { t } = useI18n();
</script>

<template>
  <q-page class="dashboard-page dashboard-page--with-breadcrumbs import-key-page">
    <dashboard-breadcrumbs
      :items="[
        { label: t('navigation.keys.label'), to: { name: 'keys' } },
        { label: t('keyManagement.importTitle') },
      ]"
    />

    <section class="dashboard-hero">
      <h1 class="dashboard-hero-title">{{ t('keyManagement.importTitle') }}</h1>
      <p class="dashboard-hero-caption">{{ t('keyManagement.importCaption') }}</p>
    </section>

    <q-card class="dashboard-card import-key-page__card">
      <q-card-section>
        <import-key-form />
      </q-card-section>
    </q-card>
  </q-page>
</template>

<style scoped>
.import-key-page {
  width: 100%;
}

.import-key-page__card {
  overflow: hidden;
}
</style>
