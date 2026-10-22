<script lang="ts" setup>
import { computed, onUnmounted, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';

import { isRemoteImageUrl, useRemoteImages } from '@/composables/useRemoteImages';

/**
 * An image named by a profile or a relay, loaded only when "Load remote images" allows it (T32,
 * diogel-io/workspace#148).
 *
 * Every remote image on Porwr's pages goes through this component; `no-remote-resources.test.ts`
 * fails on an `<img>` or `<q-img>` that binds its own `src`. While the image is held back it shows
 * a local placeholder, which the user can press to load that one image. Inside a control that
 * already takes the click, such as a select's option, pass `interactive: false`. The page notice
 * still loads it, but it alone does not raise the notice.
 *
 * Attributes such as `class` land on whichever is shown, so the placeholder takes the image's box.
 */

defineOptions({ name: 'RemoteImage' });

const props = withDefaults(
  defineProps<{
    src: string;
    alt?: string;
    variant?: 'avatar' | 'banner' | 'icon';
    interactive?: boolean;
  }>(),
  { alt: '', variant: 'avatar', interactive: true },
);

const { t } = useI18n();
const { ready, canLoad, loadOne, register, setHidden, release } = useRemoteImages();

const show = computed(() => canLoad(props.src));
const placeholderIcon = computed(
  () => ({ avatar: 'person', banner: 'image', icon: 'hub' })[props.variant],
);

const id = register();
watchEffect(() => {
  setHidden(
    id,
    ready.value && !show.value && isRemoteImageUrl(props.src) ? props.src : null,
    props.interactive,
  );
});
onUnmounted(() => release(id));
</script>

<template>
  <img v-if="show" :src="src" :alt="alt" />
  <button
    v-else-if="ready && interactive"
    :aria-label="t('remoteImages.loadOne')"
    :title="t('remoteImages.loadOne')"
    :class="`remote-image-placeholder remote-image-placeholder--${variant}`"
    data-testid="remote-image-placeholder"
    type="button"
    @click.stop.prevent="loadOne(src)"
  >
    <q-icon :name="placeholderIcon" />
  </button>
  <span
    v-else
    :class="`remote-image-placeholder remote-image-placeholder--${variant}`"
    aria-hidden="true"
    data-testid="remote-image-placeholder"
  >
    <q-icon :name="placeholderIcon" />
  </span>
</template>

<style scoped>
.remote-image-placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  opacity: 0.6;
  font-size: inherit;
}

button.remote-image-placeholder {
  cursor: pointer;
}

button.remote-image-placeholder:hover,
button.remote-image-placeholder:focus-visible {
  opacity: 1;
}

.remote-image-placeholder--banner {
  font-size: 2rem;
}
</style>
