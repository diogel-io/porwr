import { type Event as NostrEvent, SimplePool, type UnsignedEvent, verifyEvent } from 'nostr-tools';
import { signAsAccount } from './account-signing-client';
import { get, getActive } from './dexie-storage';
import { LogLevel, logService } from './log-service';
import { isVaultUnlocked } from './vault-service';
import { extractWritePreferredRelayUrls, fetchAccountRelayListEvent } from './relay-discovery';
import { ErrorCode } from '@/types/error-codes.d';
import type {
  QuickSignAccountOption,
  QuickSignAvailabilityResult,
  QuickSignContentValidationResult,
  QuickSignFormInput,
  QuickSignPreparedEvent,
  QuickSignPublishInput,
  QuickSignPublishStatus,
  QuickSignRelayPublishResult,
  QuickSignResult,
  QuickSignSanitizedInput,
  QuickSignValidationResult,
} from '@/types/bridge';
import type { AccountSummary } from '@/types/accounts';

import { QUICK_SIGN_SUPPORTED_KINDS, type QuickSignSupportedKind } from '@/types/account-signing';

export { QUICK_SIGN_SUPPORTED_KINDS, type QuickSignSupportedKind };

export type QuickSignTagType = 'p' | 'a' | 't' | 'e';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}


function extractPublishErrorMessage(error: unknown): string {
  if (error instanceof AggregateError) {
    const firstError = error.errors.find((nestedError): nestedError is Error => nestedError instanceof Error);
    if (firstError?.message) {
      return firstError.message;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

function isQuickSignTagType(value: string): value is QuickSignTagType {
  return value === 'p' || value === 'a' || value === 't' || value === 'e';
}

function containsRawHtml(content: string): boolean {
  return /<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s+[^<>]*)?\s*\/?>/.test(content);
}

export function validateQuickSignContent(
  kind: QuickSignSupportedKind,
  content: string,
): QuickSignContentValidationResult {
  const errors: string[] = [];

  if (content.trim().length === 0) {
    errors.push('Event content is required.');
  }

  // Intentionally blocks HTML-like tags (opening/closing/self-closing). Comparison
  // text like `1 < 2` is allowed because it does not match the tag pattern.
  if (containsRawHtml(content)) {
    errors.push('Event content cannot contain raw HTML tags.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function isValidRelayUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'ws:' || parsed.protocol === 'wss:';
  } catch {
    return false;
  }
}

export async function getQuickSignAvailability(publish: boolean, relayUrls: string[] = []): Promise<QuickSignAvailabilityResult> {
  const unlocked = await isVaultUnlocked();
  if (!unlocked) {
    return { state: 'locked' };
  }

  const activeAlias = await getActive();
  if (!activeAlias) {
    return { state: 'no-account' };
  }

  const accounts = await get();
  if (!accounts[activeAlias]) {
    return { state: 'no-account' };
  }

  if (publish) {
    const hasEligibleRelay = relayUrls.some((url) => url.trim().length > 0);
    if (!hasEligibleRelay) {
      return { state: 'no-relay' };
    }
  }

  return { state: 'ready' };
}

export async function listQuickSignAccounts(): Promise<QuickSignAccountOption[]> {
  const accounts = await get();

  return Object.values(accounts).map((account: AccountSummary) => ({
    label: `${account.alias} (${account.id})`,
    value: account.alias,
    npub: account.id,
  }));
}

export async function listQuickSignAccountRelayUrls(accountAlias: string): Promise<string[]> {
  const alias = accountAlias.trim();
  if (!alias) {
    return [];
  }

  const keys = await get();
  const selectedAccount = keys[alias];
  if (!selectedAccount) {
    return [];
  }

  const event = await fetchAccountRelayListEvent(selectedAccount.id);
  if (!event) {
    return [];
  }

  return extractWritePreferredRelayUrls(event);
}

function isQuickSignSupportedKind(kind: number): kind is QuickSignSupportedKind {
  return QUICK_SIGN_SUPPORTED_KINDS.includes(kind as QuickSignSupportedKind);
}

function parseQuickSignInput(input: QuickSignFormInput): { value?: QuickSignSanitizedInput; errors: string[] } {
  const errors: string[] = [];

  const kindRaw: number = input.kind;
  if (!Number.isInteger(kindRaw)) {
    errors.push('Event kind must be an integer.');
  } else if (!isQuickSignSupportedKind(kindRaw)) {
    errors.push('Event kind is not supported by quick-sign.');
  }

  const contentRaw = input.content;
  if (typeof contentRaw !== 'string') {
    errors.push('Event content must be a string.');
  } else {
    if (isQuickSignSupportedKind(kindRaw)) {
      const contentValidation = validateQuickSignContent(kindRaw, contentRaw);
      errors.push(...contentValidation.errors);
    } else if (contentRaw.trim().length === 0) {
      errors.push('Event content is required.');
    }
  }

  const tagsRaw = input.tags;
  if (!Array.isArray(tagsRaw)) {
    errors.push('Event tags must be an array.');
  } else {
    tagsRaw.forEach((tag, index) => {
      if (!isRecord(tag)) {
        errors.push(`Tag #${index + 1} is invalid.`);
        return;
      }

      if (!('type' in tag) || typeof tag.type !== 'string' || !isQuickSignTagType(tag.type)) {
        errors.push(`Tag #${index + 1} has unsupported type.`);
      }

      if (!('value' in tag) || typeof tag.value !== 'string' || tag.value.trim().length === 0) {
        errors.push(`Tag #${index + 1} value is required.`);
      }
    });
  }

  if (errors.length > 0) {
    return { errors };
  }

  const sanitizedValue: QuickSignSanitizedInput = {
    kind: kindRaw as QuickSignSupportedKind,
    content: contentRaw,
    tags: tagsRaw,
  };

  return {
    value: sanitizedValue,
    errors,
  };
}

export function validateQuickSignInput(input: QuickSignFormInput, publishInput?: QuickSignPublishInput): QuickSignValidationResult {
  const errors: string[] = [];

  if (!input.accountAlias.trim()) {
    errors.push('Signing account is required.');
  }

  const parsed = parseQuickSignInput(input);
  errors.push(...parsed.errors);

  if (publishInput) {
    if (publishInput.relayUrls.length === 0) {
      errors.push('Select at least one relay to publish.');
    }

    if (publishInput.relayUrls.some((url) => url.trim().length === 0 || !isValidRelayUrl(url.trim()))) {
      errors.push('Relay URLs must be valid ws:// or wss:// URLs.');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function buildQuickSignPreviewEvent(pubkey: string, input: QuickSignFormInput): QuickSignPreparedEvent {
  const validation = validateQuickSignInput(input);
  const parsed = parseQuickSignInput(input);

  const now = Math.floor(Date.now() / 1000);
  const sanitizedInput: QuickSignSanitizedInput = parsed.value || {
    kind: 1,
    content: '',
    tags: [],
  };

  const event: UnsignedEvent = {
    kind: sanitizedInput.kind,
    content: sanitizedInput.content,
    tags: sanitizedInput.tags.map((tag) => [tag.type, tag.value]),
    created_at: now,
    pubkey,
  };

  return {
    event,
    validation,
    normalizedJson: JSON.stringify(event, null, 2),
  };
}

async function publishSignedEvent(
  event: NostrEvent,
  relayUrls: string[],
): Promise<{ publishStatus: QuickSignPublishStatus; relayResults: QuickSignRelayPublishResult[] }> {
  if (relayUrls.length === 0) {
    return {
      publishStatus: 'failed',
      relayResults: [],
    };
  }

  const pool = new SimplePool();

  const relayResults = await Promise.all(
    relayUrls.map(async (relayUrl): Promise<QuickSignRelayPublishResult> => {
      try {
        const relayPublishResults = pool.publish([relayUrl], event);
        await Promise.any(relayPublishResults);
        return {
          relayUrl,
          success: true,
        };
      } catch (error: unknown) {
        return {
          relayUrl,
          success: false,
          error: extractPublishErrorMessage(error),
        };
      }
    }),
  );

  const successCount = relayResults.filter((relayResult) => relayResult.success).length;
  const publishStatus: QuickSignPublishStatus =
    successCount === 0 ? 'failed' : successCount === relayResults.length ? 'success' : 'partial-failure';

  return {
    publishStatus,
    relayResults,
  };
}

export async function quickSignEvent(
  event: UnsignedEvent,
  publish: boolean,
  relayUrls: string[] = [],
  accountAlias?: string,
): Promise<QuickSignResult> {
  const unlocked = await isVaultUnlocked();
  if (!unlocked) {
    return {
      success: false,
      publishStatus: 'not-attempted',
      relayResults: [],
      error: 'Vault is locked.',
      code: ErrorCode.VLT_LOCKED,
    };
  }

  const accounts = await get();
  let selectedAccount: AccountSummary | undefined;

  if (accountAlias) {
    selectedAccount = accounts[accountAlias];
  } else {
    const activeAlias = await getActive();
    if (activeAlias) {
      selectedAccount = accounts[activeAlias];
    }
  }

  if (!selectedAccount) {
    return {
      success: false,
      publishStatus: 'not-attempted',
      relayResults: [],
      error: 'No active account found for signing.',
      code: ErrorCode.SIG_NO_ACTIVE_KEY,
    };
  }

  let signedEvent: NostrEvent;
  try {
    // Signed in the background as the selected account, which need not be the active one (#240).
    signedEvent = await signAsAccount(selectedAccount.id, {
      kind: event.kind,
      content: event.content,
      tags: event.tags,
      created_at: event.created_at,
    });
  } catch (error: unknown) {
    return {
      success: false,
      publishStatus: 'not-attempted',
      relayResults: [],
      error: error instanceof Error ? error.message : 'Signing failed.',
      code: ErrorCode.SIG_FAILED,
    };
  }

  if (!verifyEvent(signedEvent)) {
    return {
      success: false,
      publishStatus: 'not-attempted',
      relayResults: [],
      error: 'Signed event failed verification.',
      code: ErrorCode.SIG_INVALID_EVENT,
    };
  }

  const operation = 'quick-sign';
  const relayCount = publish ? relayUrls.length : 0;

  logService.log(LogLevel.INFO, '[QuickSign] Event signed successfully', {
    operation,
    account: selectedAccount.alias,
    kind: signedEvent.kind,
    relayCount,
    result: 'signed',
  });

  if (publish) {
    const publishResult = await publishSignedEvent(signedEvent, relayUrls);
    logService.log(
      publishResult.publishStatus === 'failed' ? LogLevel.WARN : LogLevel.INFO,
      '[QuickSign] Event publish completed',
      {
        operation,
        account: selectedAccount.alias,
        kind: signedEvent.kind,
        relayCount,
        result: publishResult.publishStatus,
      },
    );

    if (publishResult.publishStatus === 'failed') {
      return {
        success: false,
        signedEvent,
        publishStatus: publishResult.publishStatus,
        relayResults: publishResult.relayResults,
        error: 'Failed to publish event to selected relays.',
        code: ErrorCode.NET_SERVER_ERROR,
      };
    }

    return {
      success: true,
      signedEvent,
      publishStatus: publishResult.publishStatus,
      relayResults: publishResult.relayResults,
    };
  }

  return {
    success: true,
    signedEvent,
    publishStatus: 'not-attempted',
    relayResults: [],
  };
}
