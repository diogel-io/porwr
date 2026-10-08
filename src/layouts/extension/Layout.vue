<template>
  <q-layout class="extension-window-layout" view="hHh Lpr lFf">
    <extension-window-header />
    <q-page-container>
      <div class="page-center-container">
        <div class="page-content-wrapper">
          <router-view />
        </div>
      </div>
    </q-page-container>
  </q-layout>
</template>

<script lang="ts" setup>
import ExtensionWindowHeader from '@/components/extension/ExtensionWindowHeader.vue';

defineOptions({ name: 'ExtensionLayout' });
</script>

<style scoped>
.extension-window-layout {
  width: 100%;
  height: 100%;
}
</style>
