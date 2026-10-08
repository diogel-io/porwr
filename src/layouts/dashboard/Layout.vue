<template>
  <q-layout view="lHh Lpr lFf" class="dashboard-layout">
    <dashboard-header @toggle-menu="toggleDrawer" />

    <q-drawer
      v-model="leftDrawerOpen"
      show-if-above
      side="left"
      bordered
      :width="260"
      :breakpoint="1024"
      class="dashboard-layout__drawer"
    >
      <div class="dashboard-layout__drawer-content">
        <dashboard-navigation vertical />
      </div>
    </q-drawer>

    <q-page-container>
      <div class="dashboard-page-shell">
        <router-view />
      </div>
    </q-page-container>

    <dashboard-footer />
  </q-layout>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useQuasar } from 'quasar';
import DashboardHeader from '@/components/dashboard/DashboardHeader.vue';
import DashboardNavigation from '@/components/dashboard/DashboardNavigation.vue';
import DashboardFooter from '@/components/dashboard/DashboardFooter.vue';

defineOptions({ name: 'DashboardLayout' });

const $q = useQuasar();
const leftDrawerOpen = ref($q.screen.gt.md);

const toggleDrawer = () => {
  leftDrawerOpen.value = !leftDrawerOpen.value;
};
</script>
