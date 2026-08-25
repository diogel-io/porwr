<template>
  <q-page>
    <div v-if="activeStoredKey" class="full-width">
      <ProfileView :stored-key="activeStoredKey" />
    </div>
    <div v-else-if="showNoAccount" class="q-pa-md">
      <div class="text-center">
        <q-icon color="grey-5" name="account_circle" size="4em" />
        <div class="text-h6 text-grey-7 q-mt-md">{{ $t('account.noAccountsAvailable') }}</div>
        <p class="text-grey-6">{{ $t('account.noAccountsAvailableDesc') }}</p>
        <q-btn
          class="q-mt-md diogel-btn-primary"
          :label="$t('account.create')"
          @click="openKeyManagement"
        />
      </div>
    </div>

    <!-- Not yet read from the vault, which is not the same as holding no accounts (#211). -->
    <div v-else class="q-pa-md">
      <div class="text-center" role="status">
        <q-spinner color="grey-5" size="3em" />
        <div class="text-h6 text-grey-7 q-mt-md">{{ $t('account.loading') }}</div>
      </div>
    </div>
  </q-page>
</template>

<script lang="ts" setup>
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import useAccountStore from 'src/stores/account-store';
import ProfileView from 'components/shared/ProfileView.vue';

const accountStore = useAccountStore();
const router = useRouter();

const activeStoredKey = computed(() => accountStore.activeAccount);
const showNoAccount = computed(() => accountStore.hasNoAccounts);

onMounted(async () => {
  await accountStore.getKeys();
});

async function openKeyManagement(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL && chrome.tabs?.create) {
    const url = chrome.runtime.getURL('www/index.html#/keys');
    await chrome.tabs.create({ url });
    return;
  }

  await router.push({ name: 'keys' });
}
</script>
