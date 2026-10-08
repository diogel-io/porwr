<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { get, getActive } from '@/services/dexie-storage';
import {
  buildQuickSignPreviewEvent,
  getQuickSignAvailability,
  listQuickSignAccountRelayUrls,
  listQuickSignAccounts,
  quickSignEvent,
  type QuickSignSupportedKind,
  type QuickSignTagType,
} from '@/services/quick-sign-service';
import type {
  QuickSignAccountOption,
  QuickSignFormInput,
  QuickSignPreparedEvent,
  QuickSignTagInput,
} from '@/types';

const { t } = useI18n();

const loading = ref(false);
const accountAlias = ref('');
const accounts = ref<QuickSignAccountOption[]>([]);
const kind = ref<QuickSignSupportedKind>(1);
const content = ref('');
const tags = ref<QuickSignTagInput[]>([]);
const relayOptions = ref<string[]>([]);
const selectedRelayUrls = ref<string[]>([]);
const showPreviewDialog = ref(false);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);
const previewEvent = ref<QuickSignPreparedEvent | null>(null);

const kindOptions = computed<{ label: string; value: QuickSignSupportedKind }[]>(() => [
  {
    label: t('dashboard.widgets.quickSign.textNoteKind'),
    value: 1,
  },
  {
    label: t('dashboard.widgets.quickSign.longFormKind'),
    value: 30023,
  },
]);

const tagTypeOptions: QuickSignTagType[] = ['p', 'a', 't', 'e'];

const selectedAccount = computed(() => {
  const selected = accounts.value.find((account) => account.value === accountAlias.value);
  return selected ?? null;
});

const selectedAccountLabel = computed(() => selectedAccount.value?.value ?? '-');

const selectedAccountNpub = computed(() => selectedAccount.value?.npub ?? '-');

const selectedKindLabel = computed(() => {
  const selected = kindOptions.value.find((option) => option.value === kind.value);
  return selected?.label ?? `Kind ${kind.value}`;
});

const stateMessage = computed(() => {
  if (errorMessage.value) {
    return errorMessage.value;
  }
  return t('dashboard.widgets.quickSign.ready');
});

const kindContentHint = computed(() =>
  kind.value === 30023
    ? t('dashboard.widgets.quickSign.contentHelpLongForm')
    : t('dashboard.widgets.quickSign.contentHelpTextNote'),
);

function buildInput(): QuickSignFormInput {
  return {
    accountAlias: accountAlias.value,
    kind: kind.value,
    content: content.value,
    tags: tags.value,
  };
}

function addTag(): void {
  tags.value = [...tags.value, { type: 't', value: '' }];
}

function removeTag(index: number): void {
  tags.value = tags.value.filter((_, currentIndex) => currentIndex !== index);
}

async function loadOptions(): Promise<void> {
  const [loadedAccounts, activeAlias] = await Promise.all([listQuickSignAccounts(), getActive()]);

  accounts.value = loadedAccounts;

  if (activeAlias && loadedAccounts.some((account) => account.value === activeAlias)) {
    accountAlias.value = activeAlias;
  } else {
    accountAlias.value = loadedAccounts[0]?.value ?? '';
  }

  relayOptions.value = await listQuickSignAccountRelayUrls(accountAlias.value);
  selectedRelayUrls.value = relayOptions.value;
}

watch(accountAlias, async (alias) => {
  relayOptions.value = await listQuickSignAccountRelayUrls(alias);
  selectedRelayUrls.value = relayOptions.value;
});

async function openPreview(): Promise<void> {
  successMessage.value = null;
  errorMessage.value = null;

  const availability = await getQuickSignAvailability(true, selectedRelayUrls.value);
  if (availability.state !== 'ready') {
    if (availability.state === 'locked') {
      errorMessage.value = t('dashboard.widgets.quickSign.states.locked');
      return;
    }

    if (availability.state === 'no-account') {
      errorMessage.value = t('dashboard.widgets.quickSign.states.noAccount');
      return;
    }

    if (availability.state === 'no-relay') {
      errorMessage.value = t('dashboard.widgets.quickSign.states.noRelay');
      return;
    }

    if (availability.state === 'invalid-account') {
      errorMessage.value = t('dashboard.widgets.quickSign.states.invalidAccount');
      return;
    }

    errorMessage.value = t('dashboard.widgets.quickSign.states.error');
    return;
  }

  const keys = await get();
  const selectedAccount = keys[accountAlias.value];
  if (!selectedAccount) {
    errorMessage.value = t('dashboard.widgets.quickSign.states.invalidAccount');
    return;
  }

  const prepared = buildQuickSignPreviewEvent(selectedAccount.id, buildInput());
  if (!prepared.validation.valid) {
    errorMessage.value = prepared.validation.errors.join(' ');
    return;
  }

  previewEvent.value = prepared;
  showPreviewDialog.value = true;
}

function cancelPreview(): void {
  previewEvent.value = null;
  showPreviewDialog.value = false;
}

function backToEdit(): void {
  showPreviewDialog.value = false;
}

async function confirmSign(): Promise<void> {
  if (!previewEvent.value) {
    return;
  }

  loading.value = true;
  errorMessage.value = null;
  successMessage.value = null;

  try {
    const availability = await getQuickSignAvailability(true, selectedRelayUrls.value);
    if (availability.state === 'locked') {
      errorMessage.value = t('dashboard.widgets.quickSign.states.locked');
      showPreviewDialog.value = true;
      return;
    }

    const result = await quickSignEvent(
      previewEvent.value.event,
      true,
      selectedRelayUrls.value,
      accountAlias.value,
    );
    if (!result.success || !result.signedEvent) {
      errorMessage.value = result.error || t('dashboard.widgets.quickSign.signFailure');
      return;
    }

    if (result.publishStatus === 'partial-failure') {
      successMessage.value = t('dashboard.widgets.quickSign.signPublishPartialFailure');
    } else {
      successMessage.value = t('dashboard.widgets.quickSign.signPublishSuccess');
    }
    kind.value = 1;
    content.value = '';
    tags.value = [];
    showPreviewDialog.value = false;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await loadOptions();
});
</script>

<template>
  <q-card id="quick-sign" class="dashboard-card quick-sign-card">
    <q-card-section class="dashboard-card-section quick-sign-card__section">
      <div class="quick-sign-card__header">
        <q-icon name="edit_note" size="sm" color="primary" />
        <h2 class="quick-sign-card__title">{{ t('dashboard.widgets.quickSign.title') }}</h2>
      </div>

      <p class="quick-sign-card__caption">{{ t('dashboard.widgets.quickSign.caption') }}</p>

      <q-select
        v-model="accountAlias"
        :label="t('dashboard.widgets.quickSign.account')"
        :options="accounts"
        option-label="label"
        option-value="value"
        emit-value
        map-options
        outlined
        dense
      />

      <q-select
        v-model="kind"
        :label="t('dashboard.widgets.quickSign.kind')"
        :options="kindOptions"
        option-label="label"
        option-value="value"
        emit-value
        map-options
        outlined
        dense
      />

      <q-input
        v-model="content"
        :label="t('dashboard.widgets.quickSign.content')"
        outlined
        type="textarea"
        autogrow
        dense
      />

      <p class="quick-sign-card__hint">{{ kindContentHint }}</p>

      <div class="quick-sign-card__tags-header">
        <p class="quick-sign-card__hint">{{ t('dashboard.widgets.quickSign.tags') }}</p>
        <q-btn
          flat
          dense
          icon="add"
          :label="t('dashboard.widgets.quickSign.addTag')"
          @click="addTag"
        />
      </div>

      <div v-for="(tag, index) in tags" :key="`tag-${index}`" class="quick-sign-card__tag-row">
        <q-select
          v-model="tag.type"
          :label="t('dashboard.widgets.quickSign.tagType')"
          :options="tagTypeOptions"
          outlined
          dense
        />
        <q-input
          v-model="tag.value"
          :label="t('dashboard.widgets.quickSign.tagValue')"
          outlined
          dense
        />
        <q-btn
          flat
          dense
          color="negative"
          icon="delete"
          :aria-label="t('dashboard.widgets.quickSign.removeTag')"
          @click="removeTag(index)"
        />
      </div>

      <p class="quick-sign-card__hint">
        {{
          t('dashboard.widgets.quickSign.publishDestinationSummary', {
            count: selectedRelayUrls.length,
          })
        }}
      </p>

      <p
        v-if="selectedRelayUrls.length === 0"
        class="quick-sign-card__hint quick-sign-card__hint--warning"
      >
        {{ t('dashboard.widgets.quickSign.noRelayMeta') }}
      </p>

      <q-btn
        color="primary"
        :label="t('dashboard.widgets.quickSign.preview')"
        @click="openPreview"
      />

      <q-banner v-if="successMessage" class="bg-positive text-white">{{ successMessage }}</q-banner>
      <q-banner v-else-if="stateMessage" class="bg-grey-2 text-dark">{{ stateMessage }}</q-banner>
    </q-card-section>
  </q-card>

  <q-dialog v-model="showPreviewDialog" persistent>
    <q-card class="quick-sign-preview">
      <q-card-section>
        <div class="text-h6">{{ t('dashboard.widgets.quickSign.previewTitle') }}</div>
      </q-card-section>

      <q-card-section>
        <p class="quick-sign-preview__meta">
          {{ t('dashboard.widgets.quickSign.previewAccountAlias') }}
          <strong>{{ selectedAccountLabel }}</strong>
        </p>
        <p class="quick-sign-preview__meta">
          {{ t('dashboard.widgets.quickSign.previewAccountNpub') }}
          <strong>{{ selectedAccountNpub }}</strong>
        </p>
        <p class="quick-sign-preview__meta">
          {{ t('dashboard.widgets.quickSign.previewKind') }}
          <strong>{{ selectedKindLabel }}</strong>
        </p>
        <p class="quick-sign-preview__meta">
          {{ t('dashboard.widgets.quickSign.previewContent') }}
        </p>
        <pre class="quick-sign-preview__content">{{ previewEvent?.event.content || '-' }}</pre>
        <p class="quick-sign-preview__meta">
          {{
            t('dashboard.widgets.quickSign.previewTagCount', {
              count: previewEvent?.event.tags.length ?? 0,
            })
          }}
        </p>
        <ul v-if="(previewEvent?.event.tags.length ?? 0) > 0" class="quick-sign-preview__list">
          <li v-for="(tag, index) in previewEvent?.event.tags ?? []" :key="`preview-tag-${index}`">
            <code>{{ tag[0] }}</code
            >: {{ tag[1] }}
          </li>
        </ul>
        <p class="quick-sign-preview__meta">
          {{ t('dashboard.widgets.quickSign.previewRelays') }}
        </p>
        <p class="quick-sign-preview__meta">
          <strong>{{
            t('dashboard.widgets.quickSign.previewRelayCount', { count: selectedRelayUrls.length })
          }}</strong>
        </p>
        <ul v-if="selectedRelayUrls.length > 0" class="quick-sign-preview__list">
          <li v-for="relayUrl in selectedRelayUrls" :key="relayUrl">
            <code>{{ relayUrl }}</code>
          </li>
        </ul>
        <p class="quick-sign-preview__warning">
          {{ t('dashboard.widgets.quickSign.previewWarning') }}
        </p>
        <q-expansion-item
          dense
          :label="t('dashboard.widgets.quickSign.previewTechnicalDetails')"
          icon="code"
        >
          <pre class="quick-sign-preview__json">{{
            JSON.stringify(previewEvent?.event, null, 2)
          }}</pre>
        </q-expansion-item>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat :label="t('dashboard.widgets.quickSign.backToEdit')" @click="backToEdit" />
        <q-btn flat :label="t('dashboard.widgets.quickSign.cancel')" @click="cancelPreview" />
        <q-btn
          color="primary"
          :label="t('dashboard.widgets.quickSign.confirm')"
          :loading="loading"
          @click="confirmSign"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.quick-sign-card__section {
  min-height: 180px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.quick-sign-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.quick-sign-card__title {
  margin: 0;
  color: var(--text-color);
  font-size: 1rem;
  font-weight: 600;
}

.quick-sign-card__caption {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.875rem;
  line-height: 1.5;
}

.quick-sign-card__hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.quick-sign-card__hint--warning {
  color: #c62828;
}

.quick-sign-card__tags-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.quick-sign-card__tag-row {
  display: grid;
  grid-template-columns: minmax(0, 120px) 1fr auto;
  gap: 8px;
  align-items: center;
}

.quick-sign-preview {
  min-width: min(90vw, 640px);
}

.quick-sign-preview__json {
  margin: 0;
  max-height: 320px;
  overflow: auto;
  background: #111;
  color: #e9e9e9;
  padding: 12px;
  border-radius: 8px;
}

.quick-sign-preview__meta {
  margin: 0 0 8px;
}

.quick-sign-preview__content {
  margin: 0 0 12px;
  max-height: 180px;
  overflow: auto;
  background: #f5f5f5;
  color: #222;
  padding: 12px;
  border-radius: 8px;
  white-space: pre-wrap;
}

.quick-sign-preview__list {
  margin: 0 0 12px;
  padding-left: 20px;
}

.quick-sign-preview__warning {
  margin: 0;
  color: #c62828;
  font-size: 0.875rem;
}
</style>
