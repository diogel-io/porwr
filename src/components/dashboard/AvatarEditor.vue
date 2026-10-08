<script lang="ts" setup>
import { useI18n } from 'vue-i18n';
import type { StoredKey } from '@/types';
import ImagePreview from '@/components/dashboard/ImagePreview.vue';
import ImageUploader from '@/components/dashboard/ImageUploader.vue';

defineOptions({ name: 'AvatarEditor' });

withDefaults(
  defineProps<{
    modelValue: string | undefined;
    storedKey: StoredKey;
    name?: string | null | undefined;
    size?: string;
  }>(),
  { size: '80px' },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'uploading', status: boolean): void;
  (e: 'save', field: 'picture', url: string): void;
}>();

const { t } = useI18n();

function onUploaded(url: string) {
  emit('update:modelValue', url);
  // Emit save so the parent can update the profile on relays
  emit('save', 'picture', url);
}

function onUploading(status: boolean) {
  emit('uploading', status);
}
</script>

<template>
  <q-card class="full-width full-height">
    <q-card-section class="text-left">
      <p class="text-h7 text-orange-5">{{ t('profile.avatarTitle') }}</p>
    </q-card-section>
    <q-card-section class="flex flex-center">
      <ImagePreview
        :is-avatar="true"
        :name="name"
        :size="size"
        :url="modelValue"
      />
    </q-card-section>
    <q-card-actions align="center" class="q-gutter-sm">
      <ImageUploader
        :label="t('profile.picture')"
        :stored-key="storedKey"
        upload-id="avatar"
        @avatar-uploaded="onUploaded"
        @avatar-uploading="onUploading"
      />
    </q-card-actions>
  </q-card>
</template>
