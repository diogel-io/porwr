<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import type { NostrProfile } from '@/types';
import type { AccountSummary } from '@/types/accounts';
import { profileService } from '@/services/profile-service';
import ProfileIdentityFields from '@/components/dashboard/ProfileIdentityFields.vue';

defineOptions({ name: 'ProfileEditor' });

const props = defineProps<{
  storedKey: AccountSummary;
}>();

const $q = useQuasar();
const { t } = useI18n();

/**
 * Every text field the form edits, with each one required: the form always holds a value, if only
 * an empty one.
 *
 * `picture` and `banner` are deliberately absent. The images are published from the profile header
 * as soon as they are uploaded; a copy held here would be the one loaded with the page, and saving
 * it would put back an avatar the user had just replaced (#200).
 */
interface ProfileEditorForm {
  name: string;
  display_name: string;
  about: string;
  website: string;
  nip05: string;
  lud16: string;
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

function parseBirthdayValue(
  value: string,
  min: number,
  max: number,
  exactDigits?: number,
): ParsedBirthdayValue {
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

function emptyForm(): ProfileEditorForm {
  return {
    name: '',
    display_name: '',
    about: '',
    website: '',
    nip05: '',
    lud16: '',
    bot: false,
    birthday: { year: '', month: '', day: '' },
  };
}

const profile = ref<ProfileEditorForm>(emptyForm());

const loading = ref(false);
const saving = ref(false);

/**
 * The form as last loaded or saved. With the Save button now below two sections rather than beside
 * the fields it covers, the bar says when there is something it would publish.
 */
const savedSnapshot = ref(JSON.stringify(profile.value));
const isDirty = computed(() => JSON.stringify(profile.value) !== savedSnapshot.value);

function markSaved() {
  savedSnapshot.value = JSON.stringify(profile.value);
}

async function fetchProfile() {
  if (!props.storedKey.id) return;

  // Reset profile data before fetching new one
  profile.value = emptyForm();

  loading.value = true;
  try {
    const profileData = await profileService.fetchProfile(props.storedKey.id);

    if (profileData) {
      profile.value = {
        name: profileData.name || '',
        display_name: profileData.display_name || '',
        about: profileData.about || '',
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
    markSaved();
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

    await profileService.saveProfile(props.storedKey.id, profileToSave);
    markSaved();

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
    void fetchProfile();
  },
);
</script>

<template>
  <div class="profile-editor">
    <div v-if="loading" class="dashboard-card flex flex-center q-pa-xl">
      <q-spinner color="primary" size="3em" />
    </div>
    <q-form v-else class="profile-editor__form" @submit="saveProfile">
      <section class="dashboard-card profile-editor__section">
        <h2 class="profile-editor__section-title">{{ t('profile.editorTitle') }}</h2>
        <div class="profile-editor__grid">
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
            class="diogel-input profile-editor__field profile-editor__field--full"
            hide-bottom-space
          />
          <q-input
            v-model="profile.about"
            :label="t('profile.about')"
            outlined
            dense
            class="diogel-input profile-editor__field profile-editor__field--full"
            type="textarea"
            hide-bottom-space
          />

          <div class="profile-editor__field profile-editor__birthday">
            <div class="profile-editor__birthday-label text-caption">
              {{ t('profile.birthday') }}
            </div>
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
          <q-toggle
            v-model="profile.bot"
            :label="t('profile.bot')"
            color="primary"
            class="profile-editor__field profile-editor__field--toggle"
          />
        </div>
      </section>

      <section class="dashboard-card profile-editor__section">
        <h2 class="profile-editor__section-title">{{ t('profile.identityTitle') }}</h2>
        <ProfileIdentityFields
          v-model:nip05="profile.nip05"
          v-model:lud16="profile.lud16"
          :stored-key="storedKey"
        />
      </section>

      <!--
        One Save for both sections (#200). Not sticky: app.scss gives html and body their own
        overflow, so body is the scroll container sticky positioning would attach to, and body never
        scrolls.
      -->
      <div class="dashboard-card profile-editor__savebar">
        <span class="profile-editor__savebar-status">
          {{ isDirty ? t('profile.unsavedChanges') : '' }}
        </span>
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
  gap: 16px;
}

.profile-editor__section {
  padding: 16px 20px 20px;
}

.profile-editor__section-title {
  margin: 0 0 16px;
  font-size: 1.05rem;
  font-weight: 500;
  line-height: 1.4;
  color: var(--text-color);
}

.profile-editor__grid {
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
  align-self: center;
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

.profile-editor__savebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
}

.profile-editor__savebar-status {
  font-size: 0.8125rem;
  color: var(--text-muted);
}

@media (max-width: 720px) {
  .profile-editor__grid {
    grid-template-columns: 1fr;
  }

  .profile-editor__birthday-grid {
    grid-template-columns: 1fr;
  }
}
</style>
