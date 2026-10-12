<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import type { AccountSummary } from '@/types/accounts';
import {
  nip05Service,
  parseNip05Identifier,
  type Nip05VerificationResult,
  type Nip05VerificationStatus,
} from '@/services/nip05-service';

/**
 * The NIP-05 identifier and Lightning Address: what other people check about a profile, rather
 * than what they read. Part of `ProfileEditor`'s form and saved with it; verification is the only
 * state this section owns (#200).
 */
defineOptions({ name: 'ProfileIdentityFields' });

const props = defineProps<{
  storedKey: AccountSummary;
}>();

const nip05 = defineModel<string>('nip05', { required: true });
const lud16 = defineModel<string>('lud16', { required: true });

const $q = useQuasar();
const { t } = useI18n();

const nip05Verifying = ref(false);
const nip05Status = ref<Nip05VerificationStatus | null>(null);
const nip05Result = ref<Nip05VerificationResult | null>(null);
let nip05RequestId = 0;

function getNip05VerificationMessage(status: Nip05VerificationStatus): string {
  switch (status) {
    case 'verified':
      return t('profile.nip05Verified');
    case 'malformed':
      return t('profile.nip05Malformed');
    case 'network-error':
      return t('profile.nip05NetworkError');
    case 'invalid-response':
      return t('profile.nip05InvalidResponse');
    case 'not-found':
      return t('profile.nip05NotFound');
    case 'pubkey-mismatch':
      return t('profile.nip05PubkeyMismatch');
    default:
      return t('profile.nip05NetworkError');
  }
}

const hasNip05Identifier = computed(() => Boolean(nip05.value.trim()));

const parsedNip05 = computed(() => parseNip05Identifier(nip05.value));

const isNip05VerifyDisabled = computed(() => nip05Verifying.value || parsedNip05.value === null);

type Nip05Tone = 'neutral' | 'checking' | 'success' | 'failure';

const nip05Tone = computed((): Nip05Tone => {
  if (nip05Verifying.value) return 'checking';
  if (!nip05Status.value) return 'neutral';
  if (nip05Status.value === 'verified') return 'success';
  return 'failure';
});

const nip05StatusTitle = computed((): string => {
  switch (nip05Tone.value) {
    case 'checking':
      return t('profile.nip05StatusVerifying');
    case 'success':
      return t('profile.nip05StatusVerifiedTitle');
    case 'failure':
      return t('profile.nip05StatusFailureTitle');
    default:
      return t('profile.nip05StatusIdle');
  }
});

const nip05StatusDescription = computed((): string => {
  if (nip05Tone.value === 'success') {
    return nip05Result.value?.domain
      ? t('profile.nip05StatusVerifiedDescriptionDomain', { domain: nip05Result.value.domain })
      : t('profile.nip05StatusVerifiedDescription');
  }
  if (nip05Tone.value === 'failure' && nip05Status.value) {
    return getNip05VerificationMessage(nip05Status.value);
  }
  return '';
});

async function verifyNip05() {
  const identifier = nip05.value;
  if (parseNip05Identifier(identifier) === null) {
    nip05Status.value = 'malformed';
    nip05Result.value = null;
    $q.notify({
      type: 'negative',
      message: getNip05VerificationMessage('malformed'),
    });
    return;
  }

  const requestId = ++nip05RequestId;
  nip05Verifying.value = true;
  try {
    const result = await nip05Service.verifyIdentifier(identifier, props.storedKey.id);
    if (requestId !== nip05RequestId) return;

    nip05Status.value = result.status;
    nip05Result.value = result;

    $q.notify({
      type: result.status === 'verified' ? 'positive' : 'negative',
      message: getNip05VerificationMessage(result.status),
    });
  } finally {
    if (requestId === nip05RequestId) {
      nip05Verifying.value = false;
    }
  }
}

/** A result belongs to one identifier on one account; either changing makes it stale. */
function resetVerification() {
  nip05RequestId++;
  nip05Status.value = null;
  nip05Result.value = null;
  nip05Verifying.value = false;
}

watch(() => props.storedKey.id, resetVerification);
watch(nip05, resetVerification);
</script>

<template>
  <div class="profile-identity">
    <section class="profile-identity__nip05">
      <div class="profile-identity__nip05-header">
        <div>
          <div class="profile-identity__nip05-title">{{ t('profile.nip05IdentityTitle') }}</div>
          <p class="profile-identity__nip05-description">
            {{ t('profile.nip05IdentityDescription') }}
          </p>
        </div>
        <span class="profile-identity__nip05-badge">{{ t('profile.nip05Badge') }}</span>
      </div>

      <div class="profile-identity__nip05-control">
        <q-input
          v-model="nip05"
          :label="t('profile.nip05')"
          outlined
          dense
          class="diogel-input"
          hide-bottom-space
        />
        <q-btn
          :label="t('profile.nip05VerifyIdentifier')"
          :loading="nip05Verifying"
          :disable="isNip05VerifyDisabled"
          color="primary"
          outline
          dense
          no-caps
          @click="verifyNip05"
        />
      </div>

      <div
        v-if="hasNip05Identifier"
        class="profile-identity__nip05-status"
        :class="`profile-identity__nip05-status--${nip05Tone}`"
      >
        <div class="profile-identity__nip05-status-title">{{ nip05StatusTitle }}</div>
        <div v-if="nip05StatusDescription" class="profile-identity__nip05-status-description">
          {{ nip05StatusDescription }}
        </div>
      </div>
    </section>

    <div class="profile-identity__lud16">
      <q-input
        v-model="lud16"
        :label="t('profile.lud16')"
        outlined
        dense
        class="diogel-input"
        hide-bottom-space
      >
        <template #prepend>
          <q-icon name="bolt" />
        </template>
      </q-input>
      <p class="profile-identity__lud16-description">{{ t('profile.lud16Description') }}</p>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.profile-identity {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}

.profile-identity__nip05 {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 16px;
  background: rgba(249, 115, 22, 0.05);
}

.profile-identity__nip05-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.profile-identity__nip05-title {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-color);
  margin-bottom: 4px;
}

.profile-identity__nip05-description,
.profile-identity__lud16-description {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin: 0;
}

.profile-identity__lud16-description {
  margin-top: 8px;
}

.profile-identity__nip05-badge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 8px;
  background: #f97316;
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.05em;
}

.profile-identity__nip05-control {
  display: flex;
  gap: 8px;
  align-items: flex-start;

  .diogel-input {
    flex: 1;
    min-width: 0;
  }
}

.profile-identity__nip05-status {
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 0.8125rem;
}

.profile-identity__nip05-status-title {
  font-weight: 600;
}

.profile-identity__nip05-status-description {
  margin-top: 2px;
  font-size: 0.75rem;
  opacity: 0.85;
}

// Light mode status tones
.profile-identity__nip05-status--neutral {
  background: rgba(100, 116, 139, 0.08);
  color: #475569;
}

.profile-identity__nip05-status--checking {
  background: rgba(59, 130, 246, 0.08);
  color: #2563eb;
}

.profile-identity__nip05-status--success {
  background: rgba(22, 163, 74, 0.08);
  color: #15803d;
}

.profile-identity__nip05-status--failure {
  background: rgba(220, 38, 38, 0.08);
  color: #b91c1c;
}

// Dark mode status tones — lighter text on dark backgrounds
:global(.body--dark) .profile-identity__nip05-status--neutral {
  background: rgba(100, 116, 139, 0.15);
  color: #94a3b8;
}

:global(.body--dark) .profile-identity__nip05-status--checking {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
}

:global(.body--dark) .profile-identity__nip05-status--success {
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
}

:global(.body--dark) .profile-identity__nip05-status--failure {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
}

@media (max-width: 720px) {
  .profile-identity {
    grid-template-columns: 1fr;
  }

  .profile-identity__nip05-control {
    flex-direction: column;

    .diogel-input {
      width: 100%;
    }
  }
}
</style>
