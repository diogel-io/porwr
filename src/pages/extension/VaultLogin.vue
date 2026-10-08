<template>
  <q-page class="q-pa-md flex flex-center">
    <div class="full-width q-pa-sm" style="max-width: 450px">
      <q-card bordered class="vault-card shadow-2" flat>
        <q-card-section class="flex flex-center q-pt-lg q-pb-none">
          <DiogelLogo size="xl" />
        </q-card-section>

        <q-card-section>
          <div class="text-h6 text-center">
            {{ vaultStore.vaultExists ? 'Unlock Vault' : 'Create Vault' }}
          </div>
          <div
            v-if="vaultStore.vaultExists && vaultStore.lastLockReason === 'inactivity'"
            class="q-mt-sm text-center text-orange-8 text-weight-medium"
          >
            Vault locked due to inactivity.
          </div>
          <div
            v-if="showApprovalVaultLockedMessage"
            class="q-mt-sm text-center text-orange-8 text-weight-medium"
          >
            Vault is locked. Unlock your vault to approve the signer request.
          </div>
        </q-card-section>

        <q-card-section v-if="!vaultStore.vaultExists">
          <p>Set a password for your new vault.</p>

          <q-input
            v-model="password"
            :rules="[(val) => val.length >= 8 || 'Minimum 8 characters']"
            class="q-mb-md"
            filled
            label="Password"
            type="password"
          />
          <q-input
            v-model="confirmPassword"
            :rules="[(val) => val === password || 'Passwords must match']"
            filled
            label="Confirm Password"
            type="password"
          />

          <div v-if="loginError" class="q-mt-sm text-negative text-center text-weight-medium">
            {{ loginError }}
          </div>
        </q-card-section>

        <q-card-section v-else>
          <q-input
            v-model="password"
            filled
            label="Password"
            type="password"
            @keyup.enter="handleUnlock"
          />

          <div v-if="loginError" class="q-mt-sm text-negative text-center text-weight-medium">
            {{ loginError }}
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn
            v-if="!vaultStore.vaultExists"
            :loading="loading"
            class="diogel-btn-primary"
            label="Create"
            @click="handleCreate"
          />
          <q-btn v-else :loading="loading" class="diogel-btn-primary" label="Unlock" @click="handleUnlock" />
        </q-card-actions>
      </q-card>
    </div>
  </q-page>
</template>

<script lang="ts" setup>
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { useVault } from '@/composables/useVault';
import DiogelLogo from '@/components/shared/DiogelLogo.vue';

const {
  vaultStore,
  password,
  confirmPassword,
  loading,
  loginError,
  handleCreate,
  handleUnlock,
  getPostLoginRouteName,
} = useVault();

const router = useRouter();
const route = useRoute();
const $q = useQuasar();

const showApprovalVaultLockedMessage = computed(
  () => vaultStore.vaultExists && route.query.approvalVaultLocked === 'true',
);

function notifyApprovalVaultLocked(): void {
  if (!showApprovalVaultLockedMessage.value) {
    return;
  }

  $q.notify({
    type: 'warning',
    message: 'Vault is locked. Unlock your vault to approve the signer request.',
    position: 'top',
    timeout: 6000,
  });
}

onMounted(async () => {
  if (vaultStore.isLoading) {
    return; // App.vue will handle initial check and redirection
  }
  await vaultStore.checkVaultStatus();

  notifyApprovalVaultLocked();

  if (vaultStore.isUnlocked && (route.path === '/login' || route.name === 'login')) {
    await router.push({ name: getPostLoginRouteName() });
  }
});

watch(
  () => vaultStore.isUnlocked,
  (unlocked) => {
    if (unlocked && (route.path === '/login' || route.name === 'login')) {
      const redirect = route.query.redirect as string;
      if (redirect) {
        void router.push({ path: redirect, query: route.query });
      } else {
        void router.push({ name: getPostLoginRouteName() });
      }
    }
  },
);
</script>

<style scoped>
.vault-card {
  width: 100%;
}
</style>
