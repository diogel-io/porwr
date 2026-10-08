<script lang="ts" setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import AccountDropdown from '@/components/shared/AccountDropdown.vue';


const route = useRoute();
const { t } = useI18n();

const routeTitleOverrides: Record<string, string> = {
  keys: 'navigation.keys.label',
  'edit-account': 'account.editAccount',
  'view-key': 'keyManagement.viewTitle',
  'import-key': 'keyManagement.importTitle',
  'add-new-key': 'keyManagement.addNewTitle',
};

const pageTitle = computed(() => {
  const routeName = typeof route.name === 'string' ? route.name : '';

  if (routeName && routeTitleOverrides[routeName]) {
    return t(routeTitleOverrides[routeName]);
  }

  if (routeName) {
    return routeName
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  const pathSegment = route.path
    .split('/')
    .filter(Boolean)[0];

  if (!pathSegment) {
    return t('navigation.dashboard.label');
  }

  return pathSegment.charAt(0).toUpperCase() + pathSegment.slice(1);
});

</script>

<template>
  <q-header class="dashboard-topbar">
    <q-toolbar class="dashboard-topbar__toolbar">
      <div class="dashboard-topbar__brand">
      </div>
      <q-toolbar-title class="dashboard-topbar__title">{{ pageTitle }}</q-toolbar-title>
      <div class="dashboard-topbar__account"><account-dropdown /></div>
    </q-toolbar>
  </q-header>
</template>

<style scoped></style>
