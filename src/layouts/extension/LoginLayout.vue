<script setup lang="ts">
defineOptions({ name: 'LoginLayout' });
</script>

<template>
  <q-layout class="extension-window-layout" view="hHh Lpr lFf">
    <q-page-container>
      <div class="page-center-container">
        <div class="page-content-wrapper">
          <router-view />
        </div>
      </div>
    </q-page-container>
  </q-layout>
</template>

<style scoped></style>
