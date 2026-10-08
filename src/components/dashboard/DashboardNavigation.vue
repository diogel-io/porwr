<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useVault } from '@/composables/useVault';
import { useNavigation } from '@/composables/useNavigation';
import DiogelLogo from '@/components/shared/DiogelLogo.vue';
import type { NavigationItem, UtilityLinkItem } from '@/types/navigation';

const { handleLock } = useVault();
const { t } = useI18n();
const router = useRouter();
const { navigationItems, utilityLinks } = useNavigation();

const appVersion = import.meta.env.APP_VERSION;

function navigateTo(item: NavigationItem) {
  if (item.isActive()) {
    return;
  }

  void router.push(item.target);
}

/*function openNewSignature() {
  void router.push({ name: 'dashboard', hash: '#quick-sign' });
}*/

function openUtilityLink(item: UtilityLinkItem) {
  if (item.href === '#') {
    return;
  }

  window.open(item.href, '_blank', 'noopener,noreferrer');
}
</script>

<template>
  <q-list class="main-navigation main-navigation--vertical">
    <div class="main-navigation__brand">
      <DiogelLogo size="lg" />
      <div class="main-navigation__brand-content">
        <p class="main-navigation__brand-title">Diogel</p>
        <p class="main-navigation__brand-version">{{ t('footer.version') }} {{ appVersion }}</p>
      </div>
    </div>

    <div class="main-navigation__primary-list">
      <q-item
        v-for="item in navigationItems"
        :key="item.id"
        v-ripple
        clickable
        :active="item.isActive()"
        active-class="main-navigation__item--active"
        class="main-navigation__item"
        @click="navigateTo(item)"
      >
        <q-item-section avatar>
          <q-icon :name="item.icon" size="sm" />
        </q-item-section>
        <q-item-section>
          <q-item-label>{{ item.label }}</q-item-label>
        </q-item-section>
      </q-item>
    </div>

    <div class="main-navigation__footer">
      <!-- intentionally commented out this functionality will be implemented in the future -->
      <!--      <q-btn
        color="primary"
        class="main-navigation__new-signature"
        icon="edit_note"
        no-caps
        unelevated
        :label="t('navigation.newSignature')"
        @click="openNewSignature"
      />-->

      <q-separator class="main-navigation__separator" />

      <q-item
        v-for="item in utilityLinks"
        :key="item.id"
        v-ripple
        clickable
        :disable="item.href === '#'"
        class="main-navigation__item"
        @click="openUtilityLink(item)"
      >
        <q-item-section avatar>
          <q-icon :name="item.icon" size="sm" />
        </q-item-section>
        <q-item-section>
          <q-item-label>{{ item.label }}</q-item-label>
        </q-item-section>
      </q-item>

      <q-item v-ripple clickable class="main-navigation__item" @click="handleLock">
        <q-item-section avatar>
          <q-icon name="lock" size="sm" />
        </q-item-section>
        <q-item-section>
          <q-item-label>{{ t('navigation.lock.label') }}</q-item-label>
        </q-item-section>
      </q-item>
    </div>
  </q-list>
</template>

<style scoped></style>
