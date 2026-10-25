import type { ApprovalDuration } from '@/../src-bex/types/background';

export type WebLnMethod = 'enable' | 'getInfo' | 'sendPayment';

export type WebLnErrorCode =
  | 'VAULT_LOCKED'
  | 'NO_ACTIVE_WALLET'
  | 'WALLET_UNSUPPORTED'
  | 'PERMISSION_DENIED'
  | 'INVALID_INVOICE'
  | 'PAYMENT_REJECTED'
  | 'PAYMENT_FAILED';

export interface WebLnGetInfoResponse {
  node: {
    alias: string;
    pubkey: string;
    color?: string;
  };
}

export interface WebLnSendPaymentResponse {
  preimage: string;
}

export interface WebLnPermissionGrant {
  origin: string;
  connectionId: string;
  methods: WebLnMethod[];
  createdAt: string;
  expiresAt?: string;
}

export interface WebLnEnableRequest {
  origin: string;
  approved?: boolean;
  /** How long the user allowed it. Set by the background from the decision, never by the site. */
  duration?: ApprovalDuration;
}

export interface WebLnGetInfoRequest {
  origin: string;
}

export interface WebLnSendPaymentRequest {
  origin: string;
  paymentRequest: string;
  approved?: boolean;
}
