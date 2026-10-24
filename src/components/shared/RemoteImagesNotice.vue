<script lang="ts" setup>
import { computed, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';

import { useRemoteImages } from '@/composables/useRemoteImages';

/**
 * Says that remote images on this page are held back, and loads them all at once (T32,
 * diogel-io/workspace#148). Shown only while "Load remote images" is off and an image in the page's
 * content is waiting.
 *
 * Only the most recently mounted notice shows, so a dialog's notice stands in for the layout's one
 * behind it rather than doubling it.
 */

defineOptions({ name: 'RemoteImagesNotice' });

const { t } = useI18n();
const { ready, blocking, hiddenCount, loadAll, registerNotice, isTopNotice, releaseNotice } =
  useRemoteImages();

const id = registerNotice();
onUnmounted(() => releaseNotice(id));

const visible = computed(
  () => isTopNotice(id) && ready.value && blocking.value && hiddenCount.value > 0,
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
