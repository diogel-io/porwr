<script lang="ts" setup>
import AccountDropdown from '@/components/shared/AccountDropdown.vue';
import ExtensionNavigation from '@/components/extension/ExtensionNavigation.vue';
import useVaultStore from '@/stores/vault-store';

const vaultStore = useVaultStore();

</script>

<template>
  <q-header>
    <q-toolbar>
      <div class="q-pa-lg-lg">
        <extension-navigation />
      </div>
      <q-space />
      <div v-if="vaultStore.isUnlocked" class="q-pa-lg-lg"><account-dropdown /></div>
    </q-toolbar>
  </q-header>
</template>

<style scoped></style>
