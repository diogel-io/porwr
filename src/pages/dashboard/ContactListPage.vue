<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import useAccountStore from '@/stores/account-store';
import type { ContactProfile, ContactSearchResult, Nip02Contact } from '@/types/contact-list';
import type { AccountSummary } from '@/types/accounts';
import { useContactCache } from '@/composables/useContactCache';
import RemoteImage from '@/components/shared/RemoteImage.vue';
import { upsertProfiles, writeContactList } from '@/services/contact-cache';
import { MAX_CONTACTS_PER_ACCOUNT } from '@/services/contact-fetch';
import {
  formatContactNpub,
  getContactDisplayName,
  publishContactList,
  searchContacts,
} from '@/services/contact-list-service';

const { t } = useI18n();
const $q = useQuasar();
const accountStore = useAccountStore();

const contacts = ref<Nip02Contact[]>([]);
/** Profiles of contacts added from search and not yet published; the cache holds the rest. */
const addedProfiles = ref<Record<string, ContactProfile>>({});
const sourceEventId = ref<string | undefined>();
const sourceCreatedAt = ref<number | undefined>();
const publishing = ref(false);
const publishError = ref('');
const dirty = ref(false);
const dialogOpen = ref(false);
const searchQuery = ref('');
const searchResults = ref<ContactSearchResult[]>([]);
const searchingContacts = ref(false);
const formError = ref('');

const activeStoredKey = computed<AccountSummary | undefined>(
  () => accountStore.activeAccountOrFirst,
);
const contactCache = useContactCache(() => activeStoredKey.value?.id);

/** Until relays have answered once for this account, there is no list to show — not an empty one. */
const loading = computed(() => contactCache.status.value === 'loading');
/**
 * The account's list has reached the cache, so edits start from it. Before that the page holds no
 * list, and publishing edits to it would replace the whole follow list with them (#429).
 */
const listReady = computed(() => contactCache.status.value === 'ready');
/** No relay answered and nothing was cached: the list is unknown, not empty (#435). */
const unreachable = computed(() => contactCache.status.value === 'unreachable');
const profiles = computed<Record<string, ContactProfile>>(() => ({
  ...contactCache.profiles.value,
  ...addedProfiles.value,
}));
const errorMessage = computed(() => publishError.value || contactCache.error.value);
/**
 * The list on the page came from a published list longer than Porwr keeps, so publishing it back
 * would drop follows. Set with the list in `applyCachedList`, so it stays with edits to that list
 * even if a newer list reaches the cache meanwhile.
 */
const truncated = ref(false);
/** More contacts than the cache keeps: published, the cached copy would lose the extra ones. */
const overLimit = computed(() => contacts.value.length > MAX_CONTACTS_PER_ACCOUNT);
const canPublish = computed(
  () => listReady.value && dirty.value && !publishing.value && !truncated.value && !overLimit.value,
);
/**
 * A list published after the one the edits started from, which Publish would replace (#430).
 * Another client, or the background refresh, can put it in the cache while the user edits.
 */
const newerList = ref<{ sourceEventId: string; sourceCreatedAt: number | undefined }>();
/** The open "replace the newer list?" dialog, closed with the page so it cannot publish later. */
let replaceDialog: { hide: () => void } | undefined;

/**
 * Shows the cached list, unless the user is part-way through editing it. Then it only notes that
 * the cache now holds a different list: the cache never goes back to an older one
 * (`writeContactList`), so a different event is at least as new as the edits' starting point.
 */
function applyCachedList() {
  const list = contactCache.list.value;
  if (dirty.value) {
    newerList.value =
      list?.sourceEventId && list.sourceEventId !== sourceEventId.value
        ? { sourceEventId: list.sourceEventId, sourceCreatedAt: list.sourceCreatedAt }
        : undefined;
    return;
  }
  newerList.value = undefined;
  contacts.value = list ? list.contacts.map((contact) => ({ ...contact })) : [];
  truncated.value = list?.truncated === true;
  sourceEventId.value = list?.sourceEventId;
  sourceCreatedAt.value = list?.sourceCreatedAt;
}

watch(contactCache.list, applyCachedList, { immediate: true });

watch(
  () => activeStoredKey.value?.id,
  () => {
    // Another account's edits do not carry over.
    dirty.value = false;
    addedProfiles.value = {};
    publishError.value = '';
    applyCachedList();
  },
);

// An Add panel left open when the list stops being ready, as on switching to an account whose list
// has not loaded, would add to a list that is not there (#429).
watch(listReady, (ready) => {
  if (!ready) closeAddContactForm();
});

const sortedContacts = computed(() => contacts.value);
/** A contact row's usual height in px at panel width, where the npub wraps; rows are measured. */
const CONTACT_ROW_HEIGHT = 126;

const newerListDate = computed(() =>
  newerList.value?.sourceCreatedAt
    ? new Date(newerList.value.sourceCreatedAt * 1000).toLocaleString()
    : '',
);

const sourceSummary = computed(() => {
  if (loading.value) return t('contacts.loading');
  if (unreachable.value) return t('contacts.unreachableSummary');
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
  return (
    result.profile?.displayName ||
    result.profile?.name ||
    result.profile?.nip05 ||
    formatContactNpub(result.pubkey)
  );
}

function getSearchResultSubtitle(result: ContactSearchResult): string {
  return result.profile?.nip05 || formatContactNpub(result.pubkey);
}

function resetForm() {
  searchQuery.value = '';
  searchResults.value = [];
  searchingContacts.value = false;
  formError.value = '';
}

function openAddDialog() {
  if (!listReady.value) return;
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

/** Discards unpublished edits and asks relays again, even if the cache is fresh. */
function reloadContacts() {
  dirty.value = false;
  addedProfiles.value = {};
  publishError.value = '';
  applyCachedList();
  void contactCache.refresh(true);
}

function selectSearchResult(result: ContactSearchResult) {
  if (!listReady.value) return;
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
    addedProfiles.value = {
      ...addedProfiles.value,
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
  if (!listReady.value) return;
  contacts.value = contacts.value.filter((item) => item.pubkey !== contact.pubkey);
  const nextProfiles = { ...addedProfiles.value };
  delete nextProfiles[contact.pubkey];
  addedProfiles.value = nextProfiles;
  dirty.value = true;
}

/**
 * Publishes the edits, asking first when that would replace a newer list (#430). If yet another
 * list reaches the cache while the dialog is open, the user is asked again about that one.
 */
function requestPublish() {
  if (!canPublish.value) return;
  if (!newerList.value) {
    void publishChanges();
    return;
  }
  const shown = newerList.value.sourceEventId;
  const dialog = $q
    .dialog({
      title: t('contacts.replaceNewerTitle'),
      message: t('contacts.replaceNewerBody', { date: newerListDate.value }),
      ok: { label: t('contacts.replaceNewerConfirm'), color: 'negative', noCaps: true },
      cancel: { label: t('contacts.replaceNewerCancel'), flat: true, noCaps: true },
      persistent: true,
    })
    .onOk(() => {
      if (newerList.value && newerList.value.sourceEventId !== shown) {
        requestPublish();
        return;
      }
      void publishChanges();
    });
  // A closed dialog cannot be hidden again. OK may already have opened the next one, so only
  // forget this one if it is still the open dialog.
  dialog.onDismiss(() => {
    if (replaceDialog === dialog) replaceDialog = undefined;
  });
  replaceDialog = dialog;
}

async function publishChanges() {
  // Not only the button: nothing is published before the list has loaded (#429), or while the
  // other `canPublish` conditions hold.
  if (!activeStoredKey.value || !canPublish.value) {
    return;
  }

  publishing.value = true;
  publishError.value = '';

  const accountPubkey = activeStoredKey.value.id;
  const published = contacts.value.map((contact) => ({ ...contact }));

  try {
    const result = await publishContactList(accountPubkey, published);
    // Before the cache write below, so the page does not take its own list for a newer one.
    sourceEventId.value = result.event.id;
    sourceCreatedAt.value = result.event.created_at;
    // Every page reading the cache sees the published list now, not after the next refresh.
    await writeContactList(accountPubkey, {
      contacts: published,
      sourceEventId: result.event.id,
      sourceCreatedAt: result.event.created_at,
    });
    await upsertProfiles(accountPubkey, Object.values(addedProfiles.value));
    addedProfiles.value = {};
    dirty.value = false;
    applyCachedList();
    $q.notify({ type: 'positive', message: t('contacts.publishSuccess') });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    publishError.value = message;
    $q.notify({ type: 'negative', message });
  } finally {
    publishing.value = false;
  }
}

onBeforeUnmount(() => {
  replaceDialog?.hide();
});

onMounted(async () => {
  await accountStore.getKeys();

  if (!accountStore.activeKey && activeStoredKey.value) {
    await accountStore.setActiveKey(activeStoredKey.value.alias);
  }
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
        <q-btn
          class="q-mt-md diogel-btn-primary"
          :label="t('account.create')"
          :to="{ name: 'add-new-key' }"
        />
      </div>
    </q-card>

    <q-card v-else class="dashboard-card contacts-page__card">
      <q-card-section class="contacts-page__summary">
        <div>
          <div class="text-h6 contacts-page__alias">{{ activeStoredKey.alias }}</div>
          <div class="text-caption text-grey-7">{{ sourceSummary }}</div>
        </div>
        <q-chip v-if="dirty" color="warning" text-color="dark" icon="edit">
          {{ t('contacts.unsavedChanges') }}
        </q-chip>
      </q-card-section>

      <q-banner v-if="dirty" class="bg-orange-1 text-orange-10 q-ma-md" rounded>
        {{ t('contacts.replaceWarning') }}
      </q-banner>

      <q-banner
        v-if="dirty && newerList"
        class="bg-orange-1 text-orange-10 q-ma-md"
        rounded
        data-testid="contacts-newer-list"
      >
        {{ t('contacts.newerListWarning', { date: newerListDate }) }}
        <template #action>
          <q-btn
            flat
            color="primary"
            :label="t('contacts.loadNewerList')"
            @click="reloadContacts"
          />
        </template>
      </q-banner>

      <q-banner
        v-if="truncated"
        class="bg-orange-1 text-orange-10 q-ma-md"
        rounded
        data-testid="contacts-truncated"
      >
        {{ t('contacts.truncatedWarning', { max: MAX_CONTACTS_PER_ACCOUNT }) }}
      </q-banner>

      <q-banner
        v-else-if="overLimit"
        class="bg-orange-1 text-orange-10 q-ma-md"
        rounded
        data-testid="contacts-over-limit"
      >
        {{ t('contacts.overLimitWarning', { max: MAX_CONTACTS_PER_ACCOUNT }) }}
      </q-banner>

      <q-banner v-if="errorMessage" class="bg-red-1 text-red-10 q-ma-md" rounded>
        {{ errorMessage }}
      </q-banner>

      <q-card-section class="contacts-page__toolbar">
        <div class="contacts-page__count-actions">
          <!-- An unknown list has no count; "0 contacts" would say it is empty (#435). -->
          <div v-if="!unreachable" class="text-subtitle1">
            {{ t('contacts.count', { count: contacts.length }) }}
          </div>
          <q-btn
            flat
            icon="refresh"
            :label="t('contacts.refresh')"
            :loading="loading"
            @click="reloadContacts"
          />
        </div>
        <div class="contacts-page__actions">
          <q-btn
            icon="person_add"
            color="primary"
            :disable="!listReady"
            :label="t('contacts.add')"
            @click="openAddDialog"
          />
          <q-btn
            class="diogel-btn-primary"
            icon="publish"
            :disable="!canPublish"
            :label="t('contacts.publish')"
            :loading="publishing"
            @click="requestPublish"
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

          <q-list
            v-if="searchResults.length > 0"
            bordered
            separator
            class="contacts-page__search-results"
          >
            <q-item
              v-for="result in searchResults"
              :key="result.pubkey"
              clickable
              @click="selectSearchResult(result)"
            >
              <q-item-section avatar>
                <q-avatar v-if="result.profile?.picture">
                  <RemoteImage :src="result.profile.picture" />
                </q-avatar>
                <q-avatar v-else color="primary" text-color="white" icon="person" />
              </q-item-section>
              <q-item-section class="contacts-page__row-main">
                <q-item-label lines="1">{{ getSearchResultName(result) }}</q-item-label>
                <q-item-label caption lines="1">{{ getSearchResultSubtitle(result) }}</q-item-label>
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

      <q-card-section
        v-else-if="unreachable"
        class="text-center q-pa-xl"
        data-testid="contacts-unreachable"
      >
        <q-icon color="grey-5" name="cloud_off" size="4em" />
        <div class="text-h6 text-grey-7 q-mt-md">{{ t('contacts.unreachableTitle') }}</div>
        <p class="text-grey-6">{{ t('contacts.unreachableCaption') }}</p>
        <q-btn
          flat
          color="primary"
          icon="refresh"
          :label="t('contacts.refresh')"
          @click="reloadContacts"
        />
      </q-card-section>

      <!--
        Only the rows in view are rendered, so a long list stays quick to show and to edit (#428).
        The window scrolls, as for the rest of the page: "body" is how Quasar names it.
      -->
      <q-virtual-scroll
        v-else-if="sortedContacts.length > 0"
        v-slot="{ item: contact }"
        :items="sortedContacts"
        :virtual-scroll-item-size="CONTACT_ROW_HEIGHT"
        scroll-target="body"
        separator
        data-testid="contacts-list"
      >
        <q-item :key="contact.pubkey" class="contacts-page__contact">
          <q-item-section avatar>
            <q-avatar v-if="getProfile(contact)?.picture">
              <RemoteImage :src="getProfile(contact)?.picture ?? ''" />
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
          <q-item-section class="contacts-page__row-main">
            <q-item-label lines="1">{{ getDisplayName(contact) }}</q-item-label>
            <q-item-label caption lines="1">{{ getContactSubtitle(contact) }}</q-item-label>
            <q-item-label caption class="contacts-page__pubkey">
              {{ formatContactNpub(contact.pubkey) }}
            </q-item-label>
            <q-item-label v-if="contact.relayUrl" caption lines="1">
              {{ contact.relayUrl }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <div class="contacts-page__row-actions">
              <q-btn
                flat
                round
                dense
                color="negative"
                icon="delete"
                :aria-label="t('contacts.remove')"
                @click="removeContact(contact)"
              />
            </div>
          </q-item-section>
        </q-item>
      </q-virtual-scroll>

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

/*
 * A contact without a profile shows its npub as the name and subtitle, and a relay URL has no
 * spaces either. Those labels are one line with an ellipsis (`lines="1"`); the full npub stays on
 * the pubkey line. `min-width: 0` lets the ellipsis take effect inside the flex row, so a row never
 * grows wider than the card at the 320px floor (NFR-11).
 */
.contacts-page__row-main {
  min-width: 0;
}

.contacts-page__alias {
  overflow-wrap: anywhere;
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
