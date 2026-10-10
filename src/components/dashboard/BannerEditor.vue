<script lang="ts" setup>
import { useI18n } from 'vue-i18n';
import type { AccountSummary } from '@/types/accounts';
import ImagePreview from '@/components/dashboard/ImagePreview.vue';
import ImageUploader from '@/components/dashboard/ImageUploader.vue';

defineOptions({ name: 'BannerEditor' });

defineProps<{
  modelValue: string | undefined;
  storedKey: AccountSummary;
  name?: string | null | undefined;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'uploading', status: boolean): void;
  (e: 'save', field: 'banner', url: string): void;
}>();

const { t } = useI18n();

function onUploaded(url: string) {
  emit('update:modelValue', url);
  // Emit save so the parent can update the profile on relays
  emit('save', 'banner', url);
}

function onUploading(status: boolean) {
  emit('uploading', status);
}
</script>

<template>
  <q-card class="full-width full-height">
    <q-card-section class="text-left">
      <p class="text-h7 text-orange-5">{{ t('profile.bannerTitle') }}</p>
    </q-card-section>
    <q-card-section>
      <div class="q-pa-st"><ImagePreview :name="name" :url="modelValue" /></div>
    </q-card-section>
    <q-card-actions align="center" class="q-gutter-sm">
      <ImageUploader
        :label="t('profile.banner')"
        :stored-key="storedKey"
        upload-id="banner"
        @banner-uploaded="onUploaded"
        @banner-uploading="onUploading"
      />
    </q-card-actions>
  </q-card>
</template>
