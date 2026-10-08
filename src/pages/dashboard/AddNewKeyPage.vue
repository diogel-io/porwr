<script lang="ts" setup>
import { useI18n } from 'vue-i18n';
import GenerateKeyForm from '@/components/dashboard/key-management/GenerateKeyForm.vue';

const { t } = useI18n();
</script>

<template>
  <q-page class="dashboard-page add-new-key-page">
    <section class="dashboard-hero">
      <h1 class="dashboard-hero-title">{{ t('keyManagement.addNewTitle') }}</h1>
      <p class="dashboard-hero-caption">{{ t('keyManagement.addNewCaption') }}</p>
    </section>

    <q-card class="dashboard-card add-new-key-page__card">
      <q-card-section>
        <generate-key-form />
      </q-card-section>
    </q-card>
  </q-page>
</template>

<style scoped>
.add-new-key-page {
  width: 100%;
}

.add-new-key-page__card {
  overflow: hidden;
}
</style>
