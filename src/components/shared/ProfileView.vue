<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import type { NostrProfile } from '@/types';
import type { AccountSummary } from '@/types/accounts';
import { profileService } from '@/services/profile-service';
import { PROFILE_UPDATED_KEY, storageService } from '@/services/storage-service';
import { formatBirthday, normalizeWebsiteUrl } from '@/utils/profile-format';
import { encodeNpub, formatNpubDisplay } from '@/utils/npub-format';
import RemoteImage from '@/components/shared/RemoteImage.vue';

defineOptions({ name: 'ProfileView' });

const props = defineProps<{
  storedKey: AccountSummary;
}>();

const { t } = useI18n();
const $q = useQuasar();

function openInTab(path: string) {
  const url = chrome.runtime.getURL(`www/index.html#${path}`);
  void chrome.tabs.create({ url });
}

const profile = ref<NostrProfile>({
  name: '',
  display_name: '',
  about: '',
  picture: '',
  banner: '',
  website: '',
  nip05: '',
  lud16: '',
});

const loading = ref(false);

/**
 * The account's npub, from the key rather than the profile (#303).
 *
 * Derived from the prop, so it follows an account switch without waiting on the relay fetch, and
 * it is there for an account that has never published a profile.
 */
const npub = computed(() => encodeNpub(props.storedKey.id));
const npubDisplay = computed(() => formatNpubDisplay(npub.value));

async function copyNpub() {
  if (!npub.value) return;

  try {
    await navigator.clipboard.writeText(npub.value);
    $q.notify({ type: 'positive', message: t('account.copySuccess') });
  } catch {
    $q.notify({ type: 'negative', message: t('keyManagement.table.copyPublicKeyFailed') });
  }
}

const birthdayText = computed(() => formatBirthday(profile.value.birthday));

// Undefined for anything that is not a plain https: link, which is then shown as text (#373).
const websiteHref = computed(() =>
  profile.value.website ? normalizeWebsiteUrl(profile.value.website) : undefined,
);

/**
 * Whether anything beyond the name and picture has been published.
 *
 * Said explicitly rather than left as an empty gap: a panel that simply shows nothing cannot be
 * told apart from one that has not finished loading.
 */
const hasDetails = computed(() =>
  Boolean(
    profile.value.website ||
    profile.value.nip05 ||
    profile.value.lud16 ||
    profile.value.bot ||
    birthdayText.value,
  ),
);

async function fetchProfile() {
  if (!props.storedKey.id) return;

  profile.value = {
    name: '',
    display_name: '',
    about: '',
    picture: '',
    banner: '',
    website: '',
    nip05: '',
    lud16: '',
  };

  loading.value = true;
  const profileData = await profileService.fetchProfile(props.storedKey.id);

  if (profileData) {
    profile.value = {
      ...profile.value,
      ...profileData,
    };
  }
  loading.value = false;
}

/**
 * Re-read when the profile is published from another surface.
 *
 * The dashboard's editor is a different page context, so nothing in this one hears about a save.
 * Before this, editing a profile in a tab left the panel showing the old one until it was reopened,
 * and the dashboard's own preview was the only thing that ever reflected an edit (#201).
 *
 * Storage rather than the panel port: this component also renders on the extension index page, and
 * the port is one connection per panel that the background counts for presence — opening one here
 * would make a single panel look like two (#113).
 */
const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>): void => {
  const updated = changes[PROFILE_UPDATED_KEY]?.newValue as { pubkey?: string } | undefined;
  if (!updated) return;
  // Another account's profile changing is not this card's business.
  if (updated.pubkey !== props.storedKey.id) return;

  void fetchProfile();
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
  <div class="profile-wrapper">
    <div v-if="loading" class="flex flex-center q-pa-xl">
      <q-spinner color="primary" size="2em" />
    </div>

    <q-card v-else class="profile-card" flat bordered>
      <!-- Banner Section -->
      <q-card-section class="q-pa-none">
        <div :class="{ 'banner-container--has-image': profile.banner }" class="banner-container">
          <RemoteImage
            v-if="profile.banner"
            :alt="t('profile.bannerTitle')"
            :src="profile.banner"
            class="banner-image"
            variant="banner"
          />
          <div v-else class="banner-placeholder" />
        </div>
      </q-card-section>

      <!-- Avatar & Info Section -->
      <q-card-section class="content-section">
        <div class="avatar-wrapper">
          <q-avatar size="60px" class="profile-avatar">
            <RemoteImage v-if="profile.picture" :src="profile.picture" />
            <q-icon v-else name="person" color="grey-7" />
          </q-avatar>
        </div>

        <div class="profile-info q-mt-sm">
          <div class="text-heading text-weight-bold">
            {{ profile.display_name || profile.name || t('account.anonymous') }}
          </div>
          <div v-if="profile.name && profile.display_name" class="text-caption text-primary">
            @{{ profile.name }}
          </div>

          <!--
            Shortened for display at the 320px floor; the full npub is what gets copied, and what
            the title and accessible name carry (#303).
          -->
          <button
            v-if="npub"
            :aria-label="t('profile.copyNpubAriaLabel', { npub })"
            :title="npub"
            class="profile-npub"
            type="button"
            @click="copyNpub"
          >
            <span class="profile-npub__value">{{ npubDisplay }}</span>
            <q-icon class="profile-npub__icon" name="content_copy" size="12px" />
            <q-tooltip>{{ t('profile.copyNpub') }}</q-tooltip>
          </button>

          <div v-if="profile.about" class="text-body q-mt-sm about-text">
            {{ profile.about }}
          </div>

          <!--
            The detail rows the dashboard preview carried and this did not (#201). Each is a
            separate row rather than a wrapped line: at the 320px floor a joined list wraps into
            something unreadable, and these are values a user checks rather than reads.
          -->
          <div class="profile-detail q-mt-sm">
            <div v-if="profile.website" class="profile-detail__row">
              <q-icon name="language" size="16px" />
              <a
                v-if="websiteHref"
                :href="websiteHref"
                class="website-link profile-detail__value"
                rel="noopener noreferrer"
                target="_blank"
              >
                {{ profile.website }}
              </a>
              <span v-else class="profile-detail__value">{{ profile.website }}</span>
            </div>

            <div v-if="profile.nip05" class="profile-detail__row">
              <q-icon name="badge" size="16px" />
              <span class="profile-detail__value">{{ profile.nip05 }}</span>
            </div>

            <div v-if="profile.lud16" class="profile-detail__row">
              <q-icon name="bolt" size="16px" />
              <span class="profile-detail__value">{{ profile.lud16 }}</span>
            </div>

            <div v-if="profile.bot" class="profile-detail__row">
              <q-icon name="smart_toy" size="16px" />
              <span class="profile-detail__value">{{ t('profile.previewBot') }}</span>
            </div>

            <div v-if="birthdayText" class="profile-detail__row">
              <q-icon name="cake" size="16px" />
              <span class="profile-detail__value">{{ birthdayText }}</span>
            </div>

            <div v-if="!hasDetails" class="profile-detail__empty">
              {{ t('profile.previewNoDetails') }}
            </div>
          </div>
        </div>
      </q-card-section>

      <!-- Actions -->
      <q-card-actions align="right">
        <q-btn round icon="edit" size="sm" class="diogel-btn-ghost" @click="openInTab('/profile')">
          <q-tooltip>{{ t('profile.edit') }}</q-tooltip>
        </q-btn>
      </q-card-actions>
    </q-card>

    <div v-if="!loading" class="text-center q-pa-md text-caption text-warning">
      <a @click="openInTab('/keys')"> {{ $t('warning.exportKeys') }}</a>
    </div>
  </div>
</template>

<style scoped lang="scss">
.profile-detail {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.profile-detail__row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 0.8rem;
}

/*
 * The panel floor is 320px and these values are user-supplied: a NIP-05 identifier or a Lightning
 * address can be long enough to push the column wider than the panel, which NFR-11 forbids.
 * `min-width: 0` above is what lets this actually take effect inside a flex row.
 */
.profile-detail__value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-npub {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  min-width: 0;
  margin-top: 2px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 0.75rem;
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    color: var(--text-color);
  }
}

.profile-npub__value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-npub__icon {
  flex: none;
}

.profile-detail__empty {
  font-size: 0.8rem;
  opacity: 0.6;
}

.profile-wrapper {
  padding: 16px;
}

.profile-card {
  .banner-container {
    position: relative;
    height: 120px;
    overflow: hidden;
    background: var(--page-bg);

    // The shade lifts the avatar off a picture. Over an empty, neutral placeholder it is only a
    // grey smudge (#301).
    &--has-image::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 40px;
      background: linear-gradient(to top, rgba(0, 0, 0, 0.3), transparent);
    }
  }

  .banner-image {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  // Neutral rather than brand orange, so an empty banner does not look like a default one (#301).
  .banner-placeholder {
    width: 100%;
    height: 100%;
    background: var(--surface-soft);
  }

  .content-section {
    position: relative;
    padding-top: 0;
  }

  .avatar-wrapper {
    margin-top: -30px;
    margin-bottom: 8px;
  }

  .profile-avatar {
    border: 4px solid var(--card-bg);
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    background: var(--card-bg);
  }

  .about-text {
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-muted);
  }

  .website-link {
    color: $primary; // Threenine Orange
    text-decoration: none;
    font-size: 0.875rem;

    &:hover {
      text-decoration: underline;
      color: $primary-light;
    }
  }
}
</style>
