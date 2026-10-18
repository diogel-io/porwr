import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

import type { ApprovalRequestContent } from '@/../src-bex/types/background';

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));

import RequestPreview from '@/components/sidebar/RequestPreview.vue';

const noteId = 'c'.repeat(64);
const author = 'a'.repeat(64);

const repostContent = (): ApprovalRequestContent => ({
  allowRemember: true,
  event: {
    kind: 6,
    created_at: 1_700_000_000,
    tags: [
      ['e', noteId],
      ['p', author],
    ],
    content: JSON.stringify({ id: noteId, pubkey: author, kind: 1, content: 'hello nostr' }),
  },
});

const mountPreview = (content: ApprovalRequestContent) =>
  mount(RequestPreview, {
    props: { content, riskClass: 'standard' },
    global: {
      stubs: {
        'q-btn-toggle': {
          template:
            '<div class="modes"><button v-for="o in options" :key="o.value" :class="`mode-${o.value}`" @click="$emit(\'update:modelValue\', o.value)">{{ o.label }}</button></div>',
          props: ['options', 'modelValue'],
        },
        'q-btn': {
          template:
            '<button class="request-preview__expand" @click="$emit(\'click\')">{{ label }}</button>',
          props: ['label'],
        },
      },
    },
  });

describe('a repost request (kind 6, #323)', () => {
  it('summarises the note in the formatted view instead of printing its JSON', () => {
    const wrapper = mountPreview(repostContent());

    expect(wrapper.text()).toContain('Reposted note');
    expect(wrapper.text()).toContain(noteId);
    expect(wrapper.text()).toContain('hello nostr');
    expect(wrapper.text()).not.toContain('{"');
    expect(wrapper.find('.request-preview__expand').exists()).toBe(false);
  });

  it('still shows the embedded JSON in the raw view', async () => {
    const wrapper = mountPreview(repostContent());

    await wrapper.find('.mode-raw').trigger('click');

    expect(wrapper.find('pre').text()).toContain('{"id"');
  });

  it('keeps the content for other kinds', () => {
    const wrapper = mountPreview({
      allowRemember: true,
      event: { kind: 1, created_at: 1_700_000_000, tags: [], content: 'plain note' },
    });

    expect(wrapper.text()).toContain('plain note');
  });

  it('summarises a generic repost (kind 16) the same way', async () => {
    const wrapper = mountPreview({
      allowRemember: true,
      event: {
        kind: 16,
        created_at: 1_700_000_000,
        tags: [
          ['e', noteId],
          ['p', author],
          ['k', '30023'],
        ],
        content: JSON.stringify({ id: noteId, pubkey: author, kind: 30023, content: 'An article' }),
      },
    });

    expect(wrapper.text()).toContain('Reposted kind');
    expect(wrapper.text()).toContain('An article');
    expect(wrapper.text()).not.toContain('{"');

    await wrapper.find('.mode-raw').trigger('click');

    expect(wrapper.find('pre').text()).toContain('{"id"');
  });
});
