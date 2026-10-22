<script lang="ts" setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { useRemoteImages } from '@/composables/useRemoteImages';

/**
 * Says that remote images on this page are held back, and loads them all at once (T32,
 * diogel-io/workspace#148). Shown only while "Load remote images" is off and an image is waiting.
 */

defineOptions({ name: 'RemoteImagesNotice' });

const { t } = useI18n();
const { ready, blocking, hiddenCount, pageLoaded, loadAll } = useRemoteImages();

const visible = computed(
  () => ready.value && blocking.value && !pageLoaded.value && hiddenCount.value > 0,
);
</script>

<template>
  <q-banner
    v-if="visible"
    class="remote-images-notice"
    dense
    rounded
    data-testid="remote-images-notice"
  >
    <template #avatar>
      <q-icon name="image_not_supported" />
    </template>
    {{ t('remoteImages.hidden') }}
    <template #action>
      <q-btn
        :label="t('remoteImages.loadAll')"
        color="primary"
        data-testid="remote-images-load-all"
        flat
        no-caps
        @click="loadAll"
      />
    </template>
  </q-banner>
</template>

<style scoped>
.remote-images-notice {
  margin-bottom: 16px;
  background: var(--surface-soft);
  color: var(--text-color);
}
</style>
