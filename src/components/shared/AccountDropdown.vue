<template>
  <q-select
    v-model="model"
    :behavior="behavior"
    :clearable="clearable"
    :dense="dense"
    :disable="disable"
    :dropdown-icon="dropdownIcon || 'expand_more'"
    :hint="hint"
    :loading="loading"
    :options="items"
    :outlined="outlined"
    :borderless="borderless"
    :use-chips="useChips"
    class="diogel-select"
    emit-value
    map-options
    option-label="label"
    option-value="value"
    menu-anchor="bottom left"
    menu-self="top left"
  >
    <!-- Custom option rendering to support themable icon for the Create option -->
    <template #option="scope">
      <q-item class="no-wrap" v-bind="scope.itemProps">
        <q-item-section avatar>
          <template v-if="scope.opt.value !== createAccountValue">
            <q-avatar v-if="scope.opt.avatarUrl" size="32px">
              <q-img :src="scope.opt.avatarUrl" />
            </q-avatar>
            <q-avatar v-else size="32px" color="primary" text-color="white" icon="person" />
          </template>
          <q-icon v-else name="add_circle" color="primary" />
        </q-item-section>
        <q-item-section>
          <q-item-label class="text-no-wrap">
            {{ scope.opt.value === createAccountValue ? t('account.create') : scope.opt.label }}
          </q-item-label>
        </q-item-section>
      </q-item>
    </template>

    <!-- Selected item chip/input rendering -->
    <template #selected-item="scope">
      <div class="row items-center no-wrap q-gutter-xs">
        <template v-if="scope.opt.value !== createAccountValue">
          <q-avatar v-if="scope.opt.avatarUrl" size="24px" >
            <q-img :src="scope.opt.avatarUrl" />
          </q-avatar>
          <q-avatar v-else size="24px" color="primary" text-color="white" icon="person" />
        </template>
        <q-icon v-else name="add_circle" size="18px" color="primary" />
        <span class="text-body text-no-wrap q-ml-sm">
          {{ scope.opt.value === createAccountValue ? t('account.create') : scope.opt.label }}
        </span>
      </div>
    </template>
  </q-select>
</template>

<script lang="ts" setup>
import { watch } from 'vue';
import { useAccounts } from '@/composables/useAccounts';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const { model, items, createValue: createAccountValue } = useAccounts();

defineOptions({ name: 'AccountDropdown' });
const props = withDefaults(
  defineProps<{
    /** External v-model */
    modelValue?: string | number | null;
    /** Label for the q-select input */
    label?: string;
    /** Text shown for the default option */
    createLabel?: string;
    /** Value used for the default option */
    createValue?: string | number;
    /** UI props passthroughs */
    useChips?: boolean;
    clearable?: boolean;
    dense?: boolean;
    outlined?: boolean;
    borderless?: boolean;
    loading?: boolean;
    disable?: boolean;
    hint?: string;
    behavior?: 'default' | 'dialog' | 'menu';
    dropdownIcon?: string;
  }>(),
  {
    modelValue: null,
    createLabel: '',
    createValue: 'create-account',
    useChips: false,
    clearable: false,
    dense: false,
    outlined: false,
    borderless: true,
    loading: false,
    disable: false,
    hint: '',
    behavior: 'default',
    dropdownIcon: 'arrow_drop_down',
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | number | null): void;
  (e: 'change', value: string | number | null): void;
}>();

watch(
  () => props.modelValue,
  (v) => {
    if (v === undefined) return;
    model.value = v as string | null;
  },
);

watch(model, (v) => {
  emit('update:modelValue', v);
  emit('change', v);
});
</script>

<style scoped></style>
