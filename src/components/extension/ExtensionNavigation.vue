<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useVault } from '@/composables/useVault';
import { useNavigation } from '@/composables/useNavigation';
import type { NavigationItem, UtilityLinkItem } from '@/types/navigation';

const { t } = useI18n();
const { handleLock } = useVault();
const { navigationItems, utilityLinks } = useNavigation();

function openInTab(path: string) {
  const url = chrome.runtime.getURL(`www/index.html#${path}`);
  void chrome.tabs.create({ url });
}

function openNavigationItem(item: NavigationItem) {
  const href = item.target.name === 'profile' ? '/profile?tab=profile' : `/${item.target.name}`;
  openInTab(href);
}

function openUtilityLink(item: UtilityLinkItem) {
  if (item.href === '#') {
    return;
  }

  window.open(item.href, '_blank', 'noopener,noreferrer');
}
</script>

<template>
  <q-btn class="diogel-btn-ghost" dense icon="menu" round>
    <q-menu anchor="bottom left" self="top left">
      <q-list style="max-width: 300px" class="main-navigation">
        <q-item
          v-for="item in navigationItems"
          :key="item.id"
          v-ripple
          clickable
          :active="item.isActive()"
          active-class="main-navigation__item--active"
          class="main-navigation__item"
          @click="openNavigationItem(item)"
        >
          <q-item-section avatar>
            <q-icon :name="item.icon" size="sm" />
          </q-item-section>
          <q-item-section>{{ item.label }}</q-item-section>
        </q-item>

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
          <q-item-section>{{ item.label }}</q-item-section>
        </q-item>

        <q-item v-ripple clickable class="main-navigation__item" @click="handleLock">
          <q-item-section avatar>
            <q-icon name="lock" size="sm" />
          </q-item-section>
          <q-item-section>{{ t('navigation.lock.label') }}</q-item-section>
        </q-item>
      </q-list>
    </q-menu>
  </q-btn>
</template>

<style scoped></style>
