<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { NostrProfile } from '@/types';
import type { AccountSummary } from '@/types/accounts';
import { profileService } from '@/services/profile-service';

defineOptions({ name: 'ProfilePreview' });

const props = defineProps<{
  storedKey: AccountSummary;
  refreshKey?: number;
}>();

const { t } = useI18n();

const emptyProfile: NostrProfile = {
  name: '',
  display_name: '',
  about: '',
  picture: '',
  banner: '',
  website: '',
  nip05: '',
  lud16: '',
  bot: false,
};

const profile = ref<NostrProfile>({ ...emptyProfile });
const loading = ref(false);

const title = computed(() => profile.value.display_name || profile.value.name || t('account.anonymous'));
const handle = computed(() => {
  const name = profile.value.name?.trim();
  return name ? `@${name}` : '';
});

const birthdayText = computed(() => {
  const birthday = profile.value.birthday;
  if (!birthday) {
    return '';
  }

  const birthdayParts: string[] = [];
  if (birthday.year !== undefined) {
    birthdayParts.push(String(birthday.year));
  }
  if (birthday.month !== undefined) {
    birthdayParts.push(String(birthday.month).padStart(2, '0'));
  }
  if (birthday.day !== undefined) {
    birthdayParts.push(String(birthday.day).padStart(2, '0'));
  }

  return birthdayParts.join('-');
});

function normalizeWebsiteUrl(website: string): string {
  if (/^https?:\/\//i.test(website)) {
    return website;
  }

  return `https://${website}`;
}

async function fetchProfile() {
  if (!props.storedKey.id) {
    return;
  }

  profile.value = { ...emptyProfile };
  loading.value = true;
  try {
    const profileData = await profileService.fetchProfile(props.storedKey.id);
    if (profileData) {
      profile.value = {
        ...emptyProfile,
        ...profileData,
      };
    }
  } finally {
    loading.value = false;
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

watch(
  () => props.refreshKey,
  () => {
    void fetchProfile();
  },
);
</script>

<template>
  <div class="profile-preview">
    <div v-if="loading" class="flex flex-center q-pa-xl">
      <q-spinner color="primary" size="2em" />
    </div>

    <div v-else class="profile-preview__card">
      <div class="profile-preview__banner">
        <q-img v-if="profile.banner" :src="profile.banner" class="profile-preview__banner-image" fit="contain" ratio="3" />
        <div v-else class="profile-preview__banner-placeholder" />
      </div>

      <div class="profile-preview__content">
        <q-avatar size="72px" class="profile-preview__avatar">
          <q-img v-if="profile.picture" :src="profile.picture" />
          <q-icon v-else name="person" color="grey-6" />
        </q-avatar>

        <div class="profile-preview__identity">
          <div class="text-h6 text-weight-bold">{{ title }}</div>
          <div v-if="handle" class="text-caption text-primary">{{ handle }}</div>
        </div>

        <p v-if="profile.about" class="profile-preview__about q-mt-md">{{ profile.about }}</p>
        <p v-else class="profile-preview__empty q-mt-md">{{ t('profile.previewNoAbout') }}</p>

        <div class="profile-preview__meta q-mt-md">
          <div v-if="profile.website" class="profile-preview__meta-row">
            <q-icon name="language" size="18px" />
            <a :href="normalizeWebsiteUrl(profile.website)" class="profile-preview__link" rel="noopener noreferrer" target="_blank">
              {{ profile.website }}
            </a>
          </div>

          <div v-if="profile.nip05" class="profile-preview__meta-row">
            <q-icon name="badge" size="18px" />
            <span>{{ profile.nip05 }}</span>
          </div>

          <div v-if="profile.lud16" class="profile-preview__meta-row">
            <q-icon name="bolt" size="18px" />
            <span>{{ profile.lud16 }}</span>
          </div>

          <div v-if="profile.bot" class="profile-preview__meta-row">
            <q-icon name="smart_toy" size="18px" />
            <span>{{ t('profile.previewBot') }}</span>
          </div>

          <div v-if="birthdayText" class="profile-preview__meta-row">
            <q-icon name="cake" size="18px" />
            <span>{{ birthdayText }}</span>
          </div>
        </div>

        <div v-if="!profile.website && !profile.nip05 && !profile.lud16 && !profile.bot && !birthdayText" class="profile-preview__empty q-mt-md">
          {{ t('profile.previewNoDetails') }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.profile-preview__banner {
  height: 140px;
  overflow: hidden;
  background: var(--page-bg);
}

.profile-preview__banner-image {
  width: 100%;
  height: 100%;
}

.profile-preview__banner-placeholder {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, $primary-light, $primary);
  opacity: 0.2;
}

.profile-preview__content {
  padding: 16px;
}

.profile-preview__avatar {
  margin-top: -52px;
  border: 4px solid var(--card-bg);
  background: var(--card-bg);
}

.profile-preview__identity {
  margin-top: 8px;
}

.profile-preview__about {
  white-space: pre-wrap;
  word-break: break-word;
}

.profile-preview__meta {
  display: grid;
  gap: 8px;
}

.profile-preview__meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-color);
}

.profile-preview__link {
  color: $primary;
  text-decoration: none;
}

.profile-preview__link:hover {
  text-decoration: underline;
}

.profile-preview__empty {
  color: var(--text-muted);
}
</style>
