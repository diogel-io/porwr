<script lang="ts" setup>
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import useAccountStore from '@/stores/account-store';
import ProfileImage from '@/components/dashboard/ProfileImage.vue';
import ProfileEditor from '@/components/dashboard/ProfileEditor.vue';

const { t } = useI18n();
const accountStore = useAccountStore();
const route = useRoute();
const router = useRouter();

function clearLegacyTabQuery() {
  if (typeof route.query.tab === 'undefined') {
    return;
  }

  const queryWithoutTab = { ...route.query };
  delete queryWithoutTab.tab;
  void router.replace({ query: queryWithoutTab });
}

const activeStoredKey = computed(() => accountStore.activeAccount);

onMounted(async () => {
  await accountStore.getKeys();
  clearLegacyTabQuery();
});

watch(
  () => route.query.tab,
  () => {
    clearLegacyTabQuery();
  },
);
</script>

<template>
  <q-page class="dashboard-page profile-page">
    <section class="dashboard-hero">
      <h1 class="dashboard-hero-title">{{ t('profile.title') }}</h1>
      <p class="dashboard-hero-caption">{{ t('profile.dashboardCaption') }}</p>
    </section>

    <!--
      One column, in the order a profile is read: how it looks, who it is, how it is verified and
      paid. There is no preview: the side panel shows the profile beside this tab (#201, #200).
    -->
    <div v-if="activeStoredKey" class="profile-page__layout">
      <q-card class="dashboard-card">
        <ProfileImage :stored-key="activeStoredKey" />
      </q-card>

      <ProfileEditor :stored-key="activeStoredKey" />
    </div>

    <q-card v-else class="dashboard-card">
      <div class="text-center q-pa-xl">
        <q-icon color="grey-5" name="account_circle" size="4em" />
        <div class="text-h6 text-grey-7 q-mt-md">{{ t('account.noAccounts') }}</div>
        <p class="text-grey-6">{{ t('account.noAccountDesc') }}</p>
        <q-btn
          class="q-mt-md diogel-btn-primary"
          :label="t('account.create')"
          :to="{ name: 'add-new-key' }"
        />
      </div>
    </q-card>
  </q-page>
</template>

<style scoped>
.profile-page {
  width: 100%;
}

/*
 * Capped rather than stretched: fields wider than this are harder to scan, not easier, and with the
 * side panel open the tab is rarely much wider anyway.
 */
.profile-page__layout {
  display: grid;
  gap: 16px;
  width: 100%;
  max-width: 760px;
}
</style>
