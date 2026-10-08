<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import useAccountStore from '@/stores/account-store';
import type { ContactProfile, ContactSearchResult, Nip02Contact } from '@/types/contact-list';
import type { StoredKey } from '@/types';
import {
  fetchContactList,
  fetchContactProfiles,
  formatContactNpub,
  getContactDisplayName,
  publishContactList,
  searchContacts,
} from '@/services/contact-list-service';

const { t } = useI18n();
const $q = useQuasar();
const accountStore = useAccountStore();

const contacts = ref<Nip02Contact[]>([]);
const profiles = ref<Record<string, ContactProfile>>({});
const sourceEventId = ref<string | undefined>();
const sourceCreatedAt = ref<number | undefined>();
const loading = ref(false);
const publishing = ref(false);
const loadingProfiles = ref(false);
const errorMessage = ref('');
const dirty = ref(false);
const dialogOpen = ref(false);
const searchQuery = ref('');
const searchResults = ref<ContactSearchResult[]>([]);
const searchingContacts = ref(false);
const formError = ref('');

const activeStoredKey = computed<StoredKey | undefined>(() => accountStore.activeAccountOrFirst);

const sortedContacts = computed(() => contacts.value);

const sourceSummary = computed(() => {
  if (!sourceEventId.value || !sourceCreatedAt.value) {
    return t('contacts.noPublishedList');
  }

  return t('contacts.sourceSummary', {
    eventId: sourceEventId.value.slice(0, 12),
    date: new Date(sourceCreatedAt.value * 1000).toLocaleString(),
  });
});

function getProfile(contact: Nip02Contact): ContactProfile | undefined {
  return profiles.value[contact.pubkey];
}

function getDisplayName(contact: Nip02Contact): string {
  return getContactDisplayName(contact, getProfile(contact));
}

function getContactSubtitle(contact: Nip02Contact): string {
  const profile = getProfile(contact);
  if (profile?.nip05) {
    return profile.nip05;
  }

  if (contact.petname && (profile?.displayName || profile?.name)) {
    return contact.petname;
  }

  return formatContactNpub(contact.pubkey);
}

function getContactBio(contact: Nip02Contact): string {
  return getProfile(contact)?.about ?? '';
}

function getSearchResultName(result: ContactSearchResult): string {
  return result.profile?.displayName || result.profile?.name || result.profile?.nip05 || formatContactNpub(result.pubkey);
}

function getSearchResultSubtitle(result: ContactSearchResult): string {
  return result.profile?.nip05 || formatContactNpub(result.pubkey);
}

async function enrichProfiles() {
  const pubkeys = contacts.value.map((contact) => contact.pubkey);
  if (pubkeys.length === 0) {
    profiles.value = {};
    return;
  }

  loadingProfiles.value = true;
  try {
    profiles.value = await fetchContactProfiles(pubkeys);
  } catch {
    profiles.value = {};
  } finally {
    loadingProfiles.value = false;
  }
}

function resetForm() {
  searchQuery.value = '';
  searchResults.value = [];
  searchingContacts.value = false;
  formError.value = '';
}

function openAddDialog() {
  resetForm();
  dialogOpen.value = !dialogOpen.value;
}

async function runContactSearch() {
  const query = searchQuery.value.trim();
  if (!query) {
    formError.value = t('contacts.searchRequired');
    searchResults.value = [];
    return;
  }

  searchingContacts.value = true;
  formError.value = '';

  try {
    searchResults.value = await searchContacts(query);
    if (searchResults.value.length === 0) {
      formError.value = t('contacts.noSearchResults');
    }
  } catch (error: unknown) {
    formError.value = error instanceof Error ? error.message : String(error);
    searchResults.value = [];
  } finally {
    searchingContacts.value = false;
  }
}

async function loadContacts() {
  if (!activeStoredKey.value) {
    return;
  }

  loading.value = true;
  errorMessage.value = '';

  try {
    const state = await fetchContactList(activeStoredKey.value);
    contacts.value = state.contacts;
    sourceEventId.value = state.sourceEventId;
    sourceCreatedAt.value = state.sourceCreatedAt;
    dirty.value = false;
    await enrichProfiles();
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

function selectSearchResult(result: ContactSearchResult) {
  if (contacts.value.some((contact) => contact.pubkey === result.pubkey)) {
    formError.value = t('contacts.duplicateContact');
    return;
  }

  const contact: Nip02Contact = {
    pubkey: result.pubkey,
    relayUrl: result.relayUrl,
    petname: result.profile?.displayName || result.profile?.name || '',
  };

  contacts.value = [...contacts.value, contact];
  if (result.profile) {
    profiles.value = {
      ...profiles.value,
      [result.pubkey]: result.profile,
    };
  }

  dirty.value = true;
  dialogOpen.value = false;
  resetForm();
}

function closeAddContactForm() {
  dialogOpen.value = false;
  resetForm();
}

function removeContact(contact: Nip02Contact) {
  contacts.value = contacts.value.filter((item) => item.pubkey !== contact.pubkey);
  const nextProfiles = { ...profiles.value };
  delete nextProfiles[contact.pubkey];
  profiles.value = nextProfiles;
  dirty.value = true;
}

async function publishChanges() {
  if (!activeStoredKey.value || !dirty.value) {
    return;
  }

  publishing.value = true;
  errorMessage.value = '';

  try {
    const result = await publishContactList(activeStoredKey.value, contacts.value);
    sourceEventId.value = result.event.id;
    sourceCreatedAt.value = result.event.created_at;
    dirty.value = false;
    $q.notify({ type: 'positive', message: t('contacts.publishSuccess') });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    errorMessage.value = message;
    $q.notify({ type: 'negative', message });
  } finally {
    publishing.value = false;
  }
}

onMounted(async () => {
  await accountStore.getKeys();

  if (!accountStore.activeKey && activeStoredKey.value) {
    await accountStore.setActiveKey(activeStoredKey.value.alias);
  }

  await loadContacts();
});
</script>

<template>
  <q-page class="dashboard-page contacts-page">
    <section class="dashboard-hero contacts-page__hero">
      <div>
        <h1 class="dashboard-hero-title">{{ t('contacts.title') }}</h1>
        <p class="dashboard-hero-caption">{{ t('contacts.dashboardCaption') }}</p>
      </div>
    </section>

    <q-card v-if="!activeStoredKey" class="dashboard-card contacts-page__card">
      <div class="text-center q-pa-xl">
        <q-icon color="grey-5" name="account_circle" size="4em" />
        <div class="text-h6 text-grey-7 q-mt-md">{{ t('account.noAccounts') }}</div>
        <p class="text-grey-6">{{ t('account.noAccountDesc') }}</p>
        <q-btn class="q-mt-md diogel-btn-primary" :label="t('account.create')" :to="{ name: 'add-new-key' }" />
      </div>
    </q-card>

    <q-card v-else class="dashboard-card contacts-page__card">
      <q-card-section class="contacts-page__summary">
        <div>
          <div class="text-h6">{{ activeStoredKey.alias }}</div>
          <div class="text-caption text-grey-7">{{ sourceSummary }}</div>
        </div>
        <q-chip v-if="dirty" color="warning" text-color="dark" icon="edit">
          {{ t('contacts.unsavedChanges') }}
        </q-chip>
      </q-card-section>

      <q-banner v-if="dirty" class="bg-orange-1 text-orange-10 q-ma-md" rounded>
        {{ t('contacts.replaceWarning') }}
      </q-banner>

      <q-banner v-if="errorMessage" class="bg-red-1 text-red-10 q-ma-md" rounded>
        {{ errorMessage }}
      </q-banner>

      <q-card-section class="contacts-page__toolbar">
        <div class="contacts-page__count-actions">
          <div class="text-subtitle1">
            {{ t('contacts.count', { count: contacts.length }) }}
            <span v-if="loadingProfiles" class="text-caption text-grey-7 q-ml-sm">
              {{ t('contacts.loadingProfiles') }}
            </span>
          </div>
          <q-btn
            flat
            icon="refresh"
            :label="t('contacts.refresh')"
            :loading="loading"
            @click="loadContacts"
          />
        </div>
        <div class="contacts-page__actions">
          <q-btn icon="person_add" color="primary" :label="t('contacts.add')" @click="openAddDialog" />
          <q-btn
            class="diogel-btn-primary"
            icon="publish"
            :disable="!dirty || publishing"
            :label="t('contacts.publish')"
            :loading="publishing"
            @click="publishChanges"
          />
        </div>
      </q-card-section>

      <q-slide-transition>
        <q-card-section v-if="dialogOpen" class="contacts-page__add-panel q-gutter-md">
          <div class="text-h6">{{ t('contacts.addTitle') }}</div>
          <div class="contacts-page__search-row">
            <q-input
              v-model="searchQuery"
              class="contacts-page__search-input"
              outlined
              :label="t('contacts.searchLabel')"
              :hint="t('contacts.searchHint')"
              @keyup.enter="runContactSearch"
            />
            <q-btn
              color="primary"
              icon="search"
              :label="t('contacts.search')"
              :loading="searchingContacts"
              @click="runContactSearch"
            />
            <q-btn flat :label="t('account.cancel')" @click="closeAddContactForm" />
          </div>

          <q-banner v-if="formError" class="bg-red-1 text-red-10" rounded>{{ formError }}</q-banner>

          <q-list v-if="searchResults.length > 0" bordered separator class="contacts-page__search-results">
            <q-item
              v-for="result in searchResults"
              :key="result.pubkey"
              clickable
              @click="selectSearchResult(result)"
            >
              <q-item-section avatar>
                <q-avatar v-if="result.profile?.picture">
                  <img :src="result.profile.picture" alt="" />
                </q-avatar>
                <q-avatar v-else color="primary" text-color="white" icon="person" />
              </q-item-section>
              <q-item-section>
                <q-item-label>{{ getSearchResultName(result) }}</q-item-label>
                <q-item-label caption>{{ getSearchResultSubtitle(result) }}</q-item-label>
                <q-item-label caption class="contacts-page__pubkey">
                  {{ formatContactNpub(result.pubkey) }}
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-btn flat dense color="primary" :label="t('contacts.select')" />
              </q-item-section>
            </q-item>
          </q-list>
        </q-card-section>
      </q-slide-transition>

      <q-separator />

      <q-card-section v-if="loading" class="text-center q-pa-xl">
        <q-spinner color="primary" size="3em" />
        <p class="text-grey-7 q-mt-md">{{ t('contacts.loading') }}</p>
      </q-card-section>

      <q-list v-else-if="sortedContacts.length > 0" separator>
        <q-item v-for="contact in sortedContacts" :key="contact.pubkey" class="contacts-page__contact">
          <q-item-section avatar>
            <q-avatar v-if="getProfile(contact)?.picture">
              <img :src="getProfile(contact)?.picture" alt="" />
              <q-tooltip v-if="getContactBio(contact)" class="contacts-page__bio-tooltip">
                {{ getContactBio(contact) }}
              </q-tooltip>
            </q-avatar>
            <q-avatar v-else color="primary" text-color="white" icon="person">
              <q-tooltip v-if="getContactBio(contact)" class="contacts-page__bio-tooltip">
                {{ getContactBio(contact) }}
              </q-tooltip>
            </q-avatar>
          </q-item-section>
          <q-item-section>
            <q-item-label>{{ getDisplayName(contact) }}</q-item-label>
            <q-item-label caption>{{ getContactSubtitle(contact) }}</q-item-label>
            <q-item-label caption class="contacts-page__pubkey">
              {{ formatContactNpub(contact.pubkey) }}
            </q-item-label>
            <q-item-label v-if="contact.relayUrl" caption>{{ contact.relayUrl }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <div class="contacts-page__row-actions">
              <q-btn flat round dense color="negative" icon="delete" :aria-label="t('contacts.remove')" @click="removeContact(contact)" />
            </div>
          </q-item-section>
        </q-item>
      </q-list>

      <q-card-section v-else class="text-center q-pa-xl">
        <q-icon color="grey-5" name="contacts" size="4em" />
        <div class="text-h6 text-grey-7 q-mt-md">{{ t('contacts.emptyTitle') }}</div>
        <p class="text-grey-6">{{ t('contacts.emptyCaption') }}</p>
      </q-card-section>
    </q-card>

  </q-page>
</template>

<style scoped>
.contacts-page {
  width: 100%;
}

.contacts-page__hero,
.contacts-page__summary,
.contacts-page__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.contacts-page__actions,
.contacts-page__count-actions,
.contacts-page__row-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.contacts-page__search-row {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.contacts-page__search-input {
  flex: 1;
}

.contacts-page__search-results {
  max-height: 28rem;
  overflow: auto;
}

.contacts-page__card {
  overflow: hidden;
}

.contacts-page__add-panel {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.contacts-page__pubkey {
  word-break: break-all;
}

:global(.contacts-page__bio-tooltip) {
  max-width: 22rem;
  white-space: normal;
}

@media (max-width: 700px) {
  .contacts-page__hero,
  .contacts-page__summary,
  .contacts-page__toolbar,
  .contacts-page__search-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .contacts-page__search-input {
    width: 100%;
  }
}
</style>
