<template>
  <q-toggle v-model="checked" color="primary" :size="size" />
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { useQuasar } from 'quasar';
import useSettingsStore from '@/stores/settings-store';

const $q = useQuasar();
const settingsStore = useSettingsStore();

defineOptions({ name: 'ThemeSwitch' });

withDefaults(
  defineProps<{
    size?: string;
  }>(),
  {
    size: 'xl',
  },
);
const checked = computed({
  get: () => settingsStore.darkMode,
  set: (v: boolean) => {
    void settingsStore.setDarkMode(v);
    $q.dark.set(v);
  },
});
</script>

<style scoped></style>
