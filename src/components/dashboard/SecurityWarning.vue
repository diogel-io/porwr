<script lang="ts" setup>
import { ref, useId } from 'vue';

/**
 * A key-safety warning shown as a small yellow icon in the corner of a card (#298).
 *
 * It replaces a full-width banner. The warning opens on hover and on keyboard focus, and Escape
 * closes it. Quasar's QTooltip shows on hover only, so focus drives it explicitly, as in
 * `SidebarFooterLinks` (NFR-1, WCAG 1.4.13).
 *
 * The tooltip is only in the DOM while it shows, so screen readers get the same text from a hidden
 * description that is always present.
 */
const props = withDefaults(
  defineProps<{
    title: string;
    message: string;
    icon?: string;
  }>(),
  {
    icon: 'warning_amber',
  },
);

const descriptionId = `security-warning-${useId()}`;
const focused = ref(false);
</script>

<template>
  <q-btn
    class="security-warning"
    color="warning"
    flat
    round
    dense
    :icon="props.icon"
    :aria-label="title"
    :aria-describedby="descriptionId"
    @focus="focused = true"
    @blur="focused = false"
    @keydown.esc="focused = false"
  >
    <span :id="descriptionId" class="security-warning__description">{{ title }}. {{ message }}</span>
    <q-tooltip
      class="security-warning__panel bg-grey-10 text-white"
      anchor="bottom left"
      self="top left"
      :offset="[0, 6]"
      max-width="360px"
      :model-value="focused ? true : null"
    >
      <p class="security-warning__title">{{ title }}</p>
      <p class="security-warning__message">{{ message }}</p>
    </q-tooltip>
  </q-btn>
</template>

<style scoped>
/* Held open deliberately: a dense round q-btn shrinks to its icon, and WCAG 2.2 AA wants 24px (NFR-7). */
.security-warning {
  min-width: 36px;
  min-height: 36px;
}

/* The global `*:focus-visible` rule squares every focused element; keep this one round. */
.security-warning:focus-visible {
  border-radius: 50%;
}

.security-warning__description {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.security-warning__title {
  margin: 0 0 6px;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--q-warning);
}

.security-warning__message {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.45;
  white-space: pre-line;
}
</style>

<style>
/* The panel is teleported out of this component, so its own box cannot be scoped. */
.security-warning__panel {
  border: 1px solid var(--q-warning);
  padding: 10px 12px;
}
</style>
