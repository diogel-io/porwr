<script lang="ts" setup>
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import useAccountStore from '@/stores/account-store';
import RelayEditor from '@/components/dashboard/RelayEditor.vue';
import DmRelayEditor from '@/components/dashboard/DmRelayEditor.vue';

const { t } = useI18n();
const accountStore = useAccountStore();

const activeStoredKey = computed(() => accountStore.activeAccountOrFirst);
const showNoAccount = computed(() => accountStore.hasNoAccounts);

onMounted(async () => {
  await accountStore.getKeys();

  if (!accountStore.activeKey && activeStoredKey.value) {
    await accountStore.setActiveKey(activeStoredKey.value.alias);
  }
});
</script>

<template>
  <q-page class="dashboard-page relay-page">
    <section class="dashboard-hero">
      <h1 class="dashboard-hero-title">{{ t('navigation.relays.label') }}</h1>
      <p class="dashboard-hero-caption">{{ t('navigation.relays.caption') }}</p>
    </section>

    <q-card class="dashboard-card relay-page__card">
      <div v-if="activeStoredKey">
        <RelayEditor :stored-key="activeStoredKey" />
      </div>
      <div v-else-if="showNoAccount" class="text-center q-pa-xl">
        <q-icon color="grey-5" name="account_circle" size="4em" />
        <div class="text-h6 text-grey-7 q-mt-md">{{ t('account.noAccounts') }}</div>
        <p class="text-grey-6">{{ t('account.noAccountDesc') }}</p>
        <q-btn
          class="q-mt-md diogel-btn-primary"
          :label="t('account.create')"
          :to="{ name: 'add-new-key' }"
        />
      </div>

      <!-- Not yet read from the vault, which is not the same as holding no accounts (#211). -->
      <div v-else class="text-center q-pa-xl" role="status">
        <q-spinner color="grey-5" size="3em" />
        <div class="text-h6 text-grey-7 q-mt-md">{{ t('account.loading') }}</div>
      </div>
    </q-card>

    <q-card v-if="activeStoredKey" class="dashboard-card relay-page__card q-mt-lg">
      <DmRelayEditor :stored-key="activeStoredKey" />
    </q-card>
  </q-page>
</template>

<style scoped>
.relay-page {
  width: 100%;
}

.relay-page__card {
  overflow: hidden;
}
</style>
