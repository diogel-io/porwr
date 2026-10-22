<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import type { NostrProfile } from '@/types';
import type { AccountSummary } from '@/types/accounts';
import { profileService } from '@/services/profile-service';
import { PROFILE_UPDATED_KEY, storageService } from '@/services/storage-service';
import ImageUploader from '@/components/dashboard/ImageUploader.vue';
import RemoteImage from '@/components/shared/RemoteImage.vue';

defineOptions({ name: 'ProfileImage' });

const props = defineProps<{
  storedKey: AccountSummary;
}>();

const $q = useQuasar();
const { t } = useI18n();

const profile = ref<NostrProfile>({});
const loading = ref(false);

const title = computed(
  () => profile.value.display_name || profile.value.name || t('account.anonymous'),
);
const handle = computed(() => {
  const name = profile.value.name?.trim();
  return name && profile.value.display_name ? `@${name}` : '';
});

/**
 * Read the published profile.
 *
 * Quiet on a refresh: the header is already showing the profile, and swapping it for a spinner each
 * time the editor saves would make the whole page jump for a change to one field.
 */
async function fetchProfile(quiet = false) {
  const pubkey = props.storedKey.id;
  if (!pubkey) return;

  if (!quiet) {
    profile.value = {};
    loading.value = true;
  }
  try {
    const profileData = await profileService.fetchProfile(pubkey);
    // The account changed while this was in flight; its own fetch will land.
    if (pubkey !== props.storedKey.id) return;
    profile.value = profileData ?? {};
  } finally {
    if (!quiet) loading.value = false;
  }
}

/**
 * Publishes the one field changed, over the latest profile on the relays.
 *
 * Shown at once, and put back if no relay takes it: a header showing an image that is not on any
 * relay would be telling the user something about their profile that is not true.
 */
async function saveImage(field: 'picture' | 'banner', url: string) {
  const previous = profile.value[field];
  profile.value = { ...profile.value, [field]: url };
  try {
    await profileService.saveProfile(props.storedKey.id, { [field]: url });
    $q.notify({ type: 'positive', message: t('profile.saveSuccess') });
  } catch (error) {
    console.error('Error saving profile:', error);
    profile.value = { ...profile.value, [field]: previous };
    $q.notify({ type: 'negative', message: t('profile.saveError') });
  }
}

/**
 * Re-read when the profile is published, so the name under the avatar follows a Save in the editor.
 * The same signal the side panel listens for (#201).
 */
const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>): void => {
  const updated = changes[PROFILE_UPDATED_KEY]?.newValue as { pubkey?: string } | undefined;
  if (updated?.pubkey !== props.storedKey.id) return;
  void fetchProfile(true);
};

onMounted(() => {
  void fetchProfile();
  storageService.onChanged(onStorageChanged);
});

onUnmounted(() => {
  storageService.removeOnChanged(onStorageChanged);
});

watch(
  () => props.storedKey.id,
  () => {
    void fetchProfile();
  },
);
</script>

<template>
  <div class="profile-header">
    <div v-if="loading" class="flex flex-center q-pa-xl">
      <q-spinner color="primary" size="3em" />
    </div>

    <template v-else>
      <div class="profile-header__banner">
        <RemoteImage
          v-if="profile.banner"
          :alt="t('profile.bannerTitle')"
          :src="profile.banner"
          class="profile-header__banner-image"
          variant="banner"
        />
        <div class="profile-header__action profile-header__action--banner">
          <ImageUploader
            :label="t('profile.banner')"
            :stored-key="storedKey"
            :text="t('profile.bannerTitle')"
            upload-id="banner"
            @banner-uploaded="(url: string) => saveImage('banner', url)"
          />
        </div>
      </div>

      <div class="profile-header__identity">
        <!--
          Sized from the header, not fixed. A 150px avatar in a quarter-width column was cut off at
          every tab narrower than 1440px, and the card's `overflow: hidden` hid that it was (#200).
        -->
        <div class="profile-header__avatar">
          <RemoteImage
            v-if="profile.picture"
            :alt="t('profile.avatarTitle')"
            :src="profile.picture"
            class="profile-header__avatar-image profile-header__avatar-icon"
          />
          <q-icon v-else color="grey-6" name="person" class="profile-header__avatar-icon" />
        </div>

        <div class="profile-header__names">
          <div class="profile-header__title">{{ title }}</div>
          <div v-if="handle" class="profile-header__handle">{{ handle }}</div>
        </div>

        <div class="profile-header__action">
          <ImageUploader
            :label="t('profile.picture')"
            :stored-key="storedKey"
            :text="t('profile.avatarTitle')"
            upload-id="avatar"
            @avatar-uploaded="(url: string) => saveImage('picture', url)"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
.profile-header {
  // One value for the avatar's size and for the space the names leave for it.
  --avatar-size: clamp(64px, 18%, 120px);
}

.profile-header__banner {
  position: relative;
  aspect-ratio: 3 / 1;
  border-radius: 12px 12px 0 0;
  overflow: hidden;
  // Neutral, not brand orange: an empty banner is not a default banner, and an orange one told
  // users that Nostr banners come orange (#301). Matches the empty avatar's fill.
  background: var(--surface-soft);
}

.profile-header__banner-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.profile-header__identity {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 12px 20px 16px calc(20px + var(--avatar-size) + 16px);
  min-height: calc(var(--avatar-size) / 2 + 28px);
}

.profile-header__avatar {
  position: absolute;
  left: 20px;
  top: 0;
  width: var(--avatar-size);
  aspect-ratio: 1;
  transform: translateY(-50%);
  border-radius: 50%;
  border: 4px solid var(--card-bg);
  background: var(--surface-soft);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.profile-header__avatar-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.profile-header__avatar-icon {
  font-size: calc(var(--avatar-size) / 2);
}

.profile-header__names {
  flex: 1;
  min-width: 0;
}

.profile-header__title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-header__handle {
  font-size: 0.8rem;
  color: $primary;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-header__action {
  flex: none;
  border-radius: 999px;
  background: var(--card-bg);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.profile-header__action--banner {
  position: absolute;
  top: 10px;
  right: 10px;
}
</style>
