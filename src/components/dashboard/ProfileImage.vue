<script lang="ts" setup>
import { onMounted, ref, watch, computed } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import type { NostrProfile } from '@/types';
import type { AccountSummary } from '@/types/accounts';
import { SimplePool } from 'nostr-tools';
import { signAsAccount } from '@/services/account-signing-client';
import useSettingsStore from '@/stores/settings-store';
import { notifyProfileChanged } from '@/services/profile-service';
import BannerEditor from '@/components/dashboard/BannerEditor.vue';
import AvatarEditor from '@/components/dashboard/AvatarEditor.vue';

defineOptions({ name: 'ProfileImage' });

const props = defineProps<{
  storedKey: AccountSummary;
}>();

const $q = useQuasar();
const { t } = useI18n();
const settingsStore = useSettingsStore();

const uploading = ref(false);

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
const saving = ref(false);

const fallbackRelays = computed(() => settingsStore.fallbackRelays);

const pool = new SimplePool();

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
  };

  loading.value = true;
  try {
    const event = await pool.get(fallbackRelays.value, {
      authors: [props.storedKey.id],
      kinds: [0],
    });

    if (event && event.content) {
      const content = JSON.parse(event.content) as NostrProfile;
      profile.value = {
        ...profile.value,
        ...content,
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

async function saveProfile(field: 'picture' | 'banner', url: string) {
  saving.value = true;
  try {
    const pk = props.storedKey.id;

    // Fetch latest profile to avoid overwriting other fields
    const latestEvent = await pool.get(fallbackRelays.value, {
      authors: [pk],
      kinds: [0],
    });

    let currentProfile: NostrProfile = {};
    if (latestEvent && latestEvent.content) {
      currentProfile = JSON.parse(latestEvent.content) as NostrProfile;
    }

    // SURGICAL UPDATE: Only touch the one field requested.
    const updatedProfile = {
      ...currentProfile,
      [field]: url,
    };

    // Signed in the background, which holds the key (#240).
    const signedEvent = await signAsAccount(pk, {
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify(updatedProfile),
    });
    await Promise.any(pool.publish(fallbackRelays.value, signedEvent));

    // This path publishes its own event rather than going through `profileService`, so it has to
    // signal for itself. Changing an avatar is changing a profile, and a panel that missed it
    // would show the old picture until it was reopened (#201).
    await notifyProfileChanged(pk);

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

onMounted(async () => {
  await settingsStore.getSettings();
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
  <div class="q-pa-md">
    <div v-if="loading" class="flex flex-center q-pa-lg">
      <q-spinner color="primary" size="3em" />
    </div>
    <div v-else class="row q-col-gutter-md items-stretch">
      <div class="col-3">
        <AvatarEditor
          v-model="profile.picture"
          :name="profile.name"
          :stored-key="storedKey"
          @save="(field, url) => saveProfile(field, url)"
          @uploading="(status) => (uploading = status)"
          class="full-height"
          size="150px"
        />
      </div>
      <div class="col-9">
        <BannerEditor
          v-model="profile.banner"
          :name="profile.name"
          :stored-key="storedKey"
          @save="(field, url) => saveProfile(field, url)"
          @uploading="(status) => (uploading = status)"
          class="full-height"
        />
      </div>
    </div>
  </div>
</template>
