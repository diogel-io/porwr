<script lang="ts" setup>
import { computed } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import * as nip19 from 'nostr-tools/nip19';

import type { StoredKey } from '@/types';

const { t, d } = useI18n();
const $q = useQuasar();

const props = defineProps<{
  keys: StoredKey[];
}>();

interface KeyRow {
  alias: string;
  npub: string;
  npubDisplay: string;
  canCopyNpub: boolean;
  createdAt: string | null;
  isActive: boolean;
}

const NPUB_DISPLAY_HEAD_LENGTH = 14;
const NPUB_DISPLAY_TAIL_LENGTH = 10;

const columns = computed(() => [
  { name: 'alias', label: t('keyManagement.table.name'), field: 'alias', align: 'left' as const },
  {
    name: 'npub',
    label: t('keyManagement.table.publicKey'),
    field: 'npub',
    align: 'left' as const,
  },
  {
    name: 'createdAt',
    label: t('keyManagement.table.createdDate'),
    field: 'createdAt',
    align: 'left' as const,
  },
  {
    name: 'action',
    label: t('keyManagement.table.action'),
    field: 'alias',
    align: 'right' as const,
  },
]);

const rows = computed<KeyRow[]>(() =>
  props.keys.map((key) => {
    let npub: string;
    try {
      npub = nip19.npubEncode(key.id);
    } catch {
      npub = '';
    }

    return {
      alias: key.alias,
      npub,
      npubDisplay: formatNpubDisplay(npub),
      canCopyNpub: npub.length > 0,
      createdAt: key.createdAt,
      isActive: false,
    };
  }),
);

function formatNpubDisplay(npub: string): string {
  if (npub.length <= NPUB_DISPLAY_HEAD_LENGTH + NPUB_DISPLAY_TAIL_LENGTH + 1) {
    return npub;
  }

  return `${npub.slice(0, NPUB_DISPLAY_HEAD_LENGTH)}…${npub.slice(-NPUB_DISPLAY_TAIL_LENGTH)}`;
}

function formatCreatedDate(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return t('keyManagement.table.unknownDate');
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return t('keyManagement.table.unknownDate');
  }

  try {
    const formatted = d(date, 'short');
    if (formatted.trim().length > 0) {
      return formatted;
    }
  } catch {
    // Fall through to Intl formatting fallback.
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

async function copyPublicKey(npub: string): Promise<void> {
  if (!npub) {
    return;
  }

  try {
    await navigator.clipboard.writeText(npub);
    $q.notify({ type: 'positive', message: t('account.copySuccess') });
  } catch {
    $q.notify({ type: 'negative', message: t('keyManagement.table.copyPublicKeyFailed') });
  }
}
</script>

<template>
  <q-table
    :columns="columns"
    :rows="rows"
    :no-data-label="t('keyManagement.table.noKeys')"
    class="key-management-table"
    flat
    row-key="alias"
  >
    <template v-slot:body-cell-npub="slotProps">
      <q-td :props="slotProps" class="key-management-table__public-key-cell">
        <div class="key-management-table__public-key-content">
          <span
            class="key-management-table__npub-display"
            :title="slotProps.row.npub || slotProps.row.npubDisplay"
          >
            {{ slotProps.row.npubDisplay }}
          </span>
          <q-btn
            :aria-label="t('keyManagement.table.copyPublicKeyAriaLabel', { alias: slotProps.row.alias })"
            class="key-management-table__copy-btn"
            color="secondary"
            :disable="!slotProps.row.canCopyNpub"
            flat
            icon="content_copy"
            round
            @click.stop="copyPublicKey(slotProps.row.npub)"
          />
        </div>
      </q-td>
    </template>

    <template v-slot:body-cell-createdAt="slotProps">
      <q-td :props="slotProps" class="key-management-table__created-date-cell">
        <span class="key-management-table__created-date-text" :title="formatCreatedDate(slotProps.row.createdAt)">
          {{ formatCreatedDate(slotProps.row.createdAt) }}
        </span>
      </q-td>
    </template>

    <template v-slot:body-cell-action="slotProps">
      <q-td :props="slotProps" class="text-right key-management-table__action-cell">
        <q-btn
          :label="t('keyManagement.viewAction')"
          :to="{ name: 'view-key', params: { alias: slotProps.row.alias } }"
          color="primary"
          flat
          no-caps
        />
      </q-td>
    </template>
  </q-table>
</template>

<style scoped>
.key-management-table {
  width: 100%;
}

.key-management-table__public-key-cell {
  min-width: 0;
}

.key-management-table__public-key-content {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.key-management-table__npub-display {
  display: block;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.875rem;
}

.key-management-table__copy-btn {
  flex-shrink: 0;
}

.key-management-table__created-date-cell {
  min-width: 0;
}

.key-management-table__created-date-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.key-management-table__action-cell {
  border-left: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  padding-left: 12px;
}

@media (max-width: 640px) {
  .key-management-table__public-key-content {
    gap: 4px;
  }

  .key-management-table__npub-display {
    max-width: 17ch;
  }
}
</style>
