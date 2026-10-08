import { finalizeEvent, getPublicKey, SimplePool, nip04 } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';
import type { Event } from 'nostr-tools';
import {
  NIP47_REQUEST_KIND,
  NIP47_RESPONSE_KIND,
  NIP47_WALLET_INFO_KIND,
  type Nip47BalanceResponse,
  type Nip47Command,
  type Nip47Connection,
  type Nip47InfoResponse,
  type Nip47PayInvoiceResponse,
  type Nip47RpcRequest,
  type Nip47RpcResponse,
} from '@/types/nip47';

function parseJsonRecord(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('NIP-47 response was not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function parseCommands(content: string): Nip47Command[] {
  return content
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item): item is Nip47Command => item.length > 0);
}

function tagValues(event: Event, tagName: string): string[] {
  return event.tags
    .filter((tag) => tag[0] === tagName)
    .flatMap((tag) => tag.slice(1).join(' ').split(/\s+/))
    .filter((value) => value.length > 0);
}

function parseRpcResponse(content: string): Nip47RpcResponse {
  const record = parseJsonRecord(content);
  const errorRecord = record.error;
  const resultRecord = record.result;
  return {
    ...(typeof record.result_type === 'string' ? { result_type: record.result_type as Nip47Command } : {}),
    ...(resultRecord && typeof resultRecord === 'object' && !Array.isArray(resultRecord)
      ? { result: resultRecord as Record<string, unknown> }
      : {}),
    ...(errorRecord && typeof errorRecord === 'object' && !Array.isArray(errorRecord)
      ? {
          error: {
            code: typeof (errorRecord as Record<string, unknown>).code === 'string'
              ? String((errorRecord as Record<string, unknown>).code)
              : 'UNKNOWN',
            message: typeof (errorRecord as Record<string, unknown>).message === 'string'
              ? String((errorRecord as Record<string, unknown>).message)
              : 'NIP-47 wallet returned an error',
          },
        }
      : {}),
  };
}

export class Nip47Client {
  private readonly pool = new SimplePool();

  async getInfo(connection: Nip47Connection): Promise<Nip47InfoResponse> {
    const event = await this.pool.get(
      connection.relays,
      {
        kinds: [NIP47_WALLET_INFO_KIND],
        authors: [connection.walletServicePubkey],
        limit: 1,
      },
      { maxWait: 5000 },
    );

    if (!event) {
      throw new Error('No NIP-47 wallet info event found on configured relays');
    }

    return {
      pubkey: event.pubkey,
      capabilities: parseCommands(event.content),
      relays: connection.relays,
      encryption: tagValues(event, 'encryption'),
      notifications: tagValues(event, 'notifications'),
      rawContent: event.content,
      checkedAt: new Date().toISOString(),
    };
  }

  async getBalance(connection: Nip47Connection): Promise<Nip47BalanceResponse> {
    const response = await this.sendRequest(connection, { method: 'get_balance', params: {} });
    if (response.error) {
      throw new Error(`${response.error.code}: ${response.error.message}`);
    }

    const balance = response.result?.balance;
    if (typeof balance !== 'number') {
      throw new Error('NIP-47 get_balance response did not include numeric balance');
    }

    return {
      balanceMsat: balance,
      raw: response.result ?? {},
    };
  }

  async payInvoice(connection: Nip47Connection, invoice: string): Promise<Nip47PayInvoiceResponse> {
    const trimmedInvoice = invoice.trim();
    if (!trimmedInvoice) {
      throw new Error('Lightning invoice is required');
    }

    const response = await this.sendRequest(connection, {
      method: 'pay_invoice',
      params: { invoice: trimmedInvoice },
    });
    if (response.error) {
      throw new Error(`${response.error.code}: ${response.error.message}`);
    }

    const preimage = response.result?.preimage;
    if (typeof preimage !== 'string' || !preimage) {
      throw new Error('NIP-47 pay_invoice response did not include a preimage');
    }

    return {
      preimage,
      ...(typeof response.result?.fees_paid === 'number'
        ? { feesPaidMsat: response.result.fees_paid }
        : {}),
      ...(typeof response.result?.payment_hash === 'string'
        ? { paymentHash: response.result.payment_hash }
        : {}),
      raw: response.result ?? {},
    };
  }

  async sendRequest(connection: Nip47Connection, request: Nip47RpcRequest): Promise<Nip47RpcResponse> {
    const clientSecretBytes = hexToBytes(connection.clientSecret);
    const clientPubkey = getPublicKey(clientSecretBytes);
    const requestPayload = JSON.stringify({
      method: request.method,
      params: request.params,
    });
    const encryptedContent = nip04.encrypt(clientSecretBytes, connection.walletServicePubkey, requestPayload);

    const since = Math.floor(Date.now() / 1000) - 10;
    const event = finalizeEvent(
      {
        kind: NIP47_REQUEST_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', connection.walletServicePubkey]],
        content: encryptedContent,
      },
      clientSecretBytes,
    );
    const pending = this.waitForResponse(connection, clientPubkey, event.id, since, clientSecretBytes);

    try {
      await Promise.any(this.pool.publish(connection.relays, event, { maxWait: 5000 }));
    } catch (error: unknown) {
      // Publish failed on every relay: stop waiting for a response so the
      // subscription/timeout don't linger, and avoid an unhandled rejection
      // from the now-cancelled response promise.
      pending.cancel();
      void pending.promise.catch(() => undefined);
      throw new Error(
        `Failed to publish NIP-47 request to any relay: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return pending.promise;
  }

  close(): void {
    this.pool.destroy();
  }

  private waitForResponse(
    connection: Nip47Connection,
    clientPubkey: string,
    requestEventId: string,
    since: number,
    clientSecretBytes: Uint8Array,
  ): { promise: Promise<Nip47RpcResponse>; cancel: () => void } {
    let timeout: ReturnType<typeof setTimeout>;
    let closer: { close: (reason?: string) => void };

    const promise = new Promise<Nip47RpcResponse>((resolve, reject) => {
      timeout = setTimeout(() => {
        closer.close('nip47 response timeout');
        reject(new Error('Timed out waiting for NIP-47 wallet response'));
      }, 15000);

      closer = this.pool.subscribe(
        connection.relays,
        {
          kinds: [NIP47_RESPONSE_KIND],
          authors: [connection.walletServicePubkey],
          '#e': [requestEventId],
          '#p': [clientPubkey],
          since,
        },
        {
          maxWait: 15000,
          onevent: (event: Event) => {
            try {
              const hasMatchingRequestTag = event.tags.some(
                (tag) => tag[0] === 'e' && tag[1] === requestEventId,
              );
              if (!hasMatchingRequestTag) {
                return;
              }
              const decrypted = nip04.decrypt(clientSecretBytes, event.pubkey, event.content);
              clearTimeout(timeout);
              closer.close('nip47 response received');
              resolve(parseRpcResponse(decrypted));
            } catch (error: unknown) {
              clearTimeout(timeout);
              closer.close('nip47 response parse failure');
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          },
          onclose: () => undefined,
        },
      );
    });

    return {
      promise,
      cancel: () => {
        clearTimeout(timeout);
        closer.close('nip47 request publish failed');
      },
    };
  }
}

export const nip47Client = new Nip47Client();
