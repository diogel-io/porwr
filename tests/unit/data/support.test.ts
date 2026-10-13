import { describe, expect, it } from 'vitest';
import { SUPPORT_NPUB, SUPPORT_PUBKEY } from '@/data/support';

describe('Diogel support account (#228)', () => {
  it('is the published support npub', () => {
    expect(SUPPORT_NPUB).toBe('npub1v2hascsnc9dsshmccucmc3qd92yx0ly4997dvhqdwr2zmx942g3qh3jmd4');
  });

  it('decodes to the support account hex pubkey', () => {
    expect(SUPPORT_PUBKEY).toBe('62afd86213c15b085f78c731bc440d2a8867fc95297cd65c0d70d42d98b55222');
  });
});
