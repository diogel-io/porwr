export interface Nip05WellKnownResponse {
  names: Record<string, string>;
  relays?: Record<string, string[]>;
  nip46?: Record<string, string[]>;
}

export type Nip05VerificationStatus =
  | 'verified'
  | 'malformed'
  | 'network-error'
  | 'invalid-response'
  | 'not-found'
  | 'pubkey-mismatch';

export interface Nip05VerificationResult {
  status: Nip05VerificationStatus;
  identifier: string;
  name?: string;
  domain?: string;
  expectedPubkey?: string;
  actualPubkey?: string;
  message?: string;
}

export interface ParsedNip05Identifier {
  name: string;
  domain: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === 'string');
}

function isWellKnownResponse(value: unknown): value is Nip05WellKnownResponse {
  if (!isRecord(value) || !isStringRecord(value.names)) {
    return false;
  }

  return true;
}

export function parseNip05Identifier(identifier: string): ParsedNip05Identifier | null {
  const trimmed = identifier.trim();
  const match = /^(?<name>[^@\s]+)@(?<domain>[^@\s]+)$/u.exec(trimmed);
  if (!match?.groups) {
    return null;
  }

  const { name, domain } = match.groups;
  if (!name || !domain) {
    return null;
  }

  try {
    const url = new URL(`https://${domain}`);
    if (!url.hostname) {
      return null;
    }
  } catch {
    return null;
  }

  return { name, domain };
}

export const nip05Service = {
  async verifyIdentifier(
    identifier: string,
    expectedPubkey: string,
  ): Promise<Nip05VerificationResult> {
    const parsed = parseNip05Identifier(identifier);
    const normalizedIdentifier = identifier.trim();

    if (!parsed || !expectedPubkey.trim()) {
      return {
        status: 'malformed',
        identifier: normalizedIdentifier,
        message: 'Invalid NIP-05 identifier format.',
      };
    }

    const url = new URL(`https://${parsed.domain}/.well-known/nostr.json`);
    url.searchParams.set('name', parsed.name);

    let json: unknown;
    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      json = (await response.json()) as unknown;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        status: 'network-error',
        identifier: normalizedIdentifier,
        name: parsed.name,
        domain: parsed.domain,
        expectedPubkey,
        message: errorMessage,
      };
    }

    if (!isWellKnownResponse(json)) {
      return {
        status: 'invalid-response',
        identifier: normalizedIdentifier,
        name: parsed.name,
        domain: parsed.domain,
        expectedPubkey,
      };
    }

    const actualPubkey = json.names[parsed.name];
    if (!actualPubkey) {
      return {
        status: 'not-found',
        identifier: normalizedIdentifier,
        name: parsed.name,
        domain: parsed.domain,
        expectedPubkey,
      };
    }

    if (actualPubkey !== expectedPubkey) {
      return {
        status: 'pubkey-mismatch',
        identifier: normalizedIdentifier,
        name: parsed.name,
        domain: parsed.domain,
        expectedPubkey,
        actualPubkey,
      };
    }

    return {
      status: 'verified',
      identifier: normalizedIdentifier,
      name: parsed.name,
      domain: parsed.domain,
      expectedPubkey,
      actualPubkey,
    };
  },
};
