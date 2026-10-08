<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import type { NostrProfile, StoredKey } from '@/types';
import { profileService } from '@/services/profile-service';
import { nip05Service, parseNip05Identifier, type Nip05VerificationResult, type Nip05VerificationStatus } from '@/services/nip05-service';

defineOptions({ name: 'ProfileEditor' });

const props = defineProps<{
  storedKey: StoredKey;
}>();

const emit = defineEmits<{
  saved: [];
}>();

const $q = useQuasar();
const { t } = useI18n();

interface ProfileEditorForm extends Omit<NostrProfile, 'bot' | 'birthday'> {
  bot: boolean;
  birthday: BirthdayFormState;
}

interface BirthdayFormState {
  year: string;
  month: string;
  day: string;
}

type ParsedBirthdayValue = number | undefined | null;

function toBirthdayFields(birthday?: NostrProfile['birthday']): BirthdayFormState {
  return {
    year: birthday?.year !== undefined ? String(birthday.year) : '',
    month: birthday?.month !== undefined ? String(birthday.month) : '',
    day: birthday?.day !== undefined ? String(birthday.day) : '',
  };
}

function parseBirthdayValue(value: string, min: number, max: number, exactDigits?: number): ParsedBirthdayValue {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return undefined;
  }

  if (!/^\d+$/.test(trimmedValue)) {
    return null;
  }

  if (exactDigits !== undefined && trimmedValue.length !== exactDigits) {
    return null;
  }

  const parsedValue = Number(trimmedValue);
  if (!Number.isInteger(parsedValue) || parsedValue < min || parsedValue > max) {
    return null;
  }

  return parsedValue;
}

function buildBirthdayPayload(form: BirthdayFormState): NostrProfile['birthday'] | undefined {
  const year = parseBirthdayValue(form.year, 1000, 9999, 4);
  const month = parseBirthdayValue(form.month, 1, 12);
  const day = parseBirthdayValue(form.day, 1, 31);

  if (year === null || month === null || day === null) {
    return undefined;
  }

  const birthday: NonNullable<NostrProfile['birthday']> = {
    ...(year !== undefined ? { year } : {}),
    ...(month !== undefined ? { month } : {}),
    ...(day !== undefined ? { day } : {}),
  };

  return Object.keys(birthday).length > 0 ? birthday : undefined;
}

const birthdayYearRules = [
  (value: string) => {
    const parsedYear = parseBirthdayValue(value, 1000, 9999, 4);
    return parsedYear !== null || t('profile.birthdayYearInvalid');
  },
];

const birthdayMonthRules = [
  (value: string) => {
    const parsedMonth = parseBirthdayValue(value, 1, 12);
    return parsedMonth !== null || t('profile.birthdayMonthInvalid');
  },
];

const birthdayDayRules = [
  (value: string) => {
    const parsedDay = parseBirthdayValue(value, 1, 31);
    return parsedDay !== null || t('profile.birthdayDayInvalid');
  },
];

const profile = ref<ProfileEditorForm>({
  name: '',
  display_name: '',
  about: '',
  picture: '',
  banner: '',
  website: '',
  nip05: '',
  lud16: '',
  bot: false,
  birthday: { year: '', month: '', day: '' },
});

const loading = ref(false);
const saving = ref(false);
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

const hasNip05Identifier = computed(() => Boolean(profile.value.nip05?.trim()));

const parsedNip05 = computed(() => parseNip05Identifier(profile.value.nip05 ?? ''));

function isNip05VerifyDisabled(): boolean {
  if (nip05Verifying.value) return true;
  return parsedNip05.value === null;
}

type Nip05Tone = 'neutral' | 'checking' | 'success' | 'failure';

const nip05Tone = computed((): Nip05Tone => {
  if (nip05Verifying.value) return 'checking';
  if (!nip05Status.value) return 'neutral';
  if (nip05Status.value === 'verified') return 'success';
  return 'failure';
});

const nip05StatusTitle = computed((): string => {
  switch (nip05Tone.value) {
    case 'checking': return t('profile.nip05StatusVerifying');
    case 'success': return t('profile.nip05StatusVerifiedTitle');
    case 'failure': return t('profile.nip05StatusFailureTitle');
    default: return t('profile.nip05StatusIdle');
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

const nip05VerifyButtonLabel = computed(() => t('profile.nip05VerifyIdentifier'));

async function verifyNip05() {
  const identifier = profile.value.nip05 ?? '';
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

async function fetchProfile() {
  if (!props.storedKey.id) return;

  // Reset profile data before fetching new one
  profile.value = {
    name: '',
    display_name: '',
    about: '',
    picture: '',
    banner: '',
    website: '',
    nip05: '',
    lud16: '',
    bot: false,
    birthday: { year: '', month: '', day: '' },
  };

  loading.value = true;
  try {
    const profileData = await profileService.fetchProfile(props.storedKey.id);

    if (profileData) {
      profile.value = {
        name: profileData.name || '',
        display_name: profileData.display_name || '',
        about: profileData.about || '',
        picture: profileData.picture || '',
        banner: profileData.banner || '',
        website: profileData.website || '',
        nip05: profileData.nip05 || '',
        lud16: profileData.lud16 || '',
        bot: profileData.bot === true,
        birthday: toBirthdayFields(profileData.birthday),
      };
    }
  } catch (error) {
    console.error('Error fetching profile:', error);
    $q.notify({
      type: 'negative',
      message: t('profile.fetchError'),
    });
  } finally {
    loading.value = false;
  }
}

async function saveProfile() {
  saving.value = true;
  try {
    const { bot, birthday, ...profileBase } = profile.value;
    const birthdayPayload = buildBirthdayPayload(birthday);

    const profileToSave: NostrProfile = {
      ...profileBase,
    };

    if (bot) {
      profileToSave.bot = true;
    }

    if (birthdayPayload) {
      profileToSave.birthday = birthdayPayload;
    }

    await profileService.saveProfile(props.storedKey.account.privkey, profileToSave);

    emit('saved');

    $q.notify({
      type: 'positive',
      message: t('profile.saveSuccess'),
    });
  } catch (error) {
    console.error('Error saving profile:', error);
    $q.notify({
      type: 'negative',
      message: t('profile.saveError'),
    });
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void fetchProfile();
});

watch(
  () => props.storedKey.id,
  () => {
    nip05RequestId++;
    nip05Status.value = null;
    nip05Result.value = null;
    nip05Verifying.value = false;
    void fetchProfile();
  },
);

watch(
  () => profile.value.nip05,
  () => {
    nip05RequestId++;
    nip05Status.value = null;
    nip05Result.value = null;
    nip05Verifying.value = false;
  },
);
</script>

<template>
  <div class="q-pa-md">
    <div v-if="loading" class="flex flex-center q-pa-lg">
      <q-spinner color="primary" size="3em" />
    </div>
    <q-form v-else class="profile-editor__form" @submit="saveProfile">
      <q-input
        v-model="profile.name"
        :label="t('profile.name')"
        outlined
        dense
        class="diogel-input profile-editor__field"
        hide-bottom-space
      />
      <q-input
        v-model="profile.display_name"
        :label="t('profile.displayName')"
        outlined
        dense
        class="diogel-input profile-editor__field"
        hide-bottom-space
      />
      <q-input
        v-model="profile.website"
        :label="t('profile.website')"
        outlined
        dense
        class="diogel-input profile-editor__field"
        hide-bottom-space
      />
      <section class="profile-editor__nip05-card profile-editor__field--full">
        <div class="profile-editor__nip05-header">
          <div>
            <div class="profile-editor__nip05-title">{{ t('profile.nip05IdentityTitle') }}</div>
            <p class="profile-editor__nip05-description">
              {{ t('profile.nip05IdentityDescription') }}
            </p>
          </div>
          <span class="profile-editor__nip05-badge">{{ t('profile.nip05Badge') }}</span>
        </div>

        <div class="profile-editor__nip05-control">
          <q-input
            v-model="profile.nip05"
            :label="t('profile.nip05')"
            outlined
            dense
            class="diogel-input"
            hide-bottom-space
          />
          <q-btn
            :label="nip05VerifyButtonLabel"
            :loading="nip05Verifying"
            :disable="isNip05VerifyDisabled()"
            color="primary"
            outline
            dense
            no-caps
            @click="verifyNip05"
          />
        </div>

        <div
          v-if="hasNip05Identifier"
          class="profile-editor__nip05-status"
          :class="`profile-editor__nip05-status--${nip05Tone}`"
        >
          <div class="profile-editor__nip05-status-title">{{ nip05StatusTitle }}</div>
          <div v-if="nip05StatusDescription" class="profile-editor__nip05-status-description">
            {{ nip05StatusDescription }}
          </div>
        </div>
      </section>
      <q-input
        v-model="profile.lud16"
        :label="t('profile.lud16')"
        outlined
        dense
        class="diogel-input profile-editor__field"
        hide-bottom-space
      />
      <q-toggle
        v-model="profile.bot"
        :label="t('profile.bot')"
        color="primary"
        class="profile-editor__field profile-editor__field--toggle"
      />

      <div class="profile-editor__field profile-editor__birthday">
        <div class="profile-editor__birthday-label text-caption">{{ t('profile.birthday') }}</div>
        <div class="profile-editor__birthday-grid">
          <q-input
            v-model="profile.birthday.year"
            :label="t('profile.birthdayYear')"
            :rules="birthdayYearRules"
            outlined
            dense
            type="number"
            class="diogel-input"
          />
          <q-input
            v-model="profile.birthday.month"
            :label="t('profile.birthdayMonth')"
            :rules="birthdayMonthRules"
            outlined
            dense
            type="number"
            class="diogel-input"
          />
          <q-input
            v-model="profile.birthday.day"
            :label="t('profile.birthdayDay')"
            :rules="birthdayDayRules"
            outlined
            dense
            type="number"
            class="diogel-input"
          />
        </div>
      </div>
      <q-input
        v-model="profile.about"
        :label="t('profile.about')"
        outlined
        dense
        class="diogel-input profile-editor__field profile-editor__field--full"
        type="textarea"
        hide-bottom-space
      />

      <div class="row justify-end q-mt-sm profile-editor__field--full">
        <q-btn
          :label="t('profile.save')"
          :loading="saving"
          color="primary"
          type="submit"
          class="diogel-btn-primary"
        />
      </div>
    </q-form>
  </div>
</template>

<style lang="scss" scoped>
.profile-editor__form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.profile-editor__field {
  min-width: 0;
}

.profile-editor__field--full {
  grid-column: 1 / -1;
}

.profile-editor__field--toggle {
  display: flex;
  align-items: center;
  min-height: 40px;
}

.profile-editor__birthday-label {
  margin-bottom: 8px;
}

.profile-editor__birthday {
  display: flex;
  flex-direction: column;
}

.profile-editor__birthday-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.profile-editor__nip05-card {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 16px;
  background: rgba(249, 115, 22, 0.05);
}

.profile-editor__nip05-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.profile-editor__nip05-title {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-color);
  margin-bottom: 4px;
}

.profile-editor__nip05-description {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin: 0;
}

.profile-editor__nip05-badge {
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

.profile-editor__nip05-control {
  display: flex;
  gap: 8px;
  align-items: flex-start;

  .diogel-input {
    flex: 1;
    min-width: 0;
  }
}

.profile-editor__nip05-status {
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 0.8125rem;
}

.profile-editor__nip05-status-title {
  font-weight: 600;
}

.profile-editor__nip05-status-description {
  margin-top: 2px;
  font-size: 0.75rem;
  opacity: 0.85;
}

// Light mode status tones
.profile-editor__nip05-status--neutral {
  background: rgba(100, 116, 139, 0.08);
  color: #475569;
}

.profile-editor__nip05-status--checking {
  background: rgba(59, 130, 246, 0.08);
  color: #2563eb;
}

.profile-editor__nip05-status--success {
  background: rgba(22, 163, 74, 0.08);
  color: #15803d;
}

.profile-editor__nip05-status--failure {
  background: rgba(220, 38, 38, 0.08);
  color: #b91c1c;
}

// Dark mode status tones — lighter text on dark backgrounds
:global(.body--dark) .profile-editor__nip05-status--neutral {
  background: rgba(100, 116, 139, 0.15);
  color: #94a3b8;
}

:global(.body--dark) .profile-editor__nip05-status--checking {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
}

:global(.body--dark) .profile-editor__nip05-status--success {
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
}

:global(.body--dark) .profile-editor__nip05-status--failure {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
}

@media (max-width: 720px) {
  .profile-editor__form {
    grid-template-columns: 1fr;
  }

  .profile-editor__birthday-grid {
    grid-template-columns: 1fr;
  }

  .profile-editor__nip05-control {
    flex-direction: column;

    .diogel-input {
      width: 100%;
    }
  }
}
</style>
