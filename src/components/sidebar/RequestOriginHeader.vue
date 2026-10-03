<script lang="ts" setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

defineOptions({ name: 'RequestOriginHeader' });

const props = defineProps<{
  origin: string;
  accountAlias: string | null;
  /** The active account, when it is not the one this site is connected as (workspace#23). */
  activeAccountAlias?: string | null;
}>();

const { t } = useI18n();

/**
 * The origin is rendered from the origin string itself. No favicon, title, or metadata is
 * fetched from anywhere: an approval must not disclose which site the user is transacting with
 * (ADR D13).
 */
const hostname = computed(() => {
  try {
    return new URL(props.origin).hostname;
  } catch {
    return props.origin;
  }
});

const isSecure = computed(() => props.origin.startsWith('https://'));

const initials = computed(() => hostname.value.replace(/^www\./, '').slice(0, 2).toUpperCase());
</script>

<template>
  <section class="request-origin" :aria-label="t('request.origin.ariaLabel')">
    <div class="request-origin__badge" aria-hidden="true">{{ initials }}</div>
    <div class="request-origin__detail">
      <div class="request-origin__label">{{ t('request.origin.label') }}</div>
      <div class="request-origin__value">{{ origin }}</div>
      <div v-if="!isSecure" class="request-origin__insecure">
        <q-icon name="warning" size="xs" />
        {{ t('request.origin.insecure') }}
      </div>
      <div class="request-origin__label q-mt-sm">{{ t('request.account.label') }}</div>
      <div class="request-origin__value">
        {{ accountAlias ?? t('request.account.none') }}
      </div>
      <div
        v-if="activeAccountAlias && accountAlias"
        class="request-origin__not-active"
        role="alert"
        data-testid="request-not-active"
      >
        <q-icon name="warning" size="xs" />
        {{ t('request.account.notActive', { active: activeAccountAlias, bound: accountAlias }) }}
      </div>
    </div>
  </section>
</template>

<style scoped>
.request-origin {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  min-width: 0;
}

.request-origin__badge {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.8rem;
  background: var(--header-bg);
  border: 1px solid var(--border-color);
}

.request-origin__detail {
  min-width: 0;
}

.request-origin__label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted, #888);
}

.request-origin__value {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.request-origin__insecure,
.request-origin__not-active {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  color: var(--q-warning, #b26a00);
}
</style>
