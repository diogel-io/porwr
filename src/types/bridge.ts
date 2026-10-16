/**
 * Type-safe bridge communication between content script and background
 */

export * from './bridge-types.d';
export * from './index.d';

// Union of all requests
import type { BridgeRequestMap, BridgeAction, BridgeResponseMap } from './bridge-types';
export type AnyBridgeRequest = BridgeRequestMap[keyof BridgeRequestMap];

// Union of all responses
export type AnyBridgeResponse = BridgeResponseMap[keyof BridgeResponseMap];

/**
 * Type-safe bridge message utilities
 */

// Generate unique ID for messages
export function generateBridgeId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Create a typed request
export function createBridgeRequest<T extends BridgeAction>(
  action: T,
  payload: Omit<BridgeRequestMap[T], 'id' | 'action'>,
): BridgeRequestMap[T] {
  return {
    id: generateBridgeId(),
    action,
    ...payload,
  } as BridgeRequestMap[T];
}

// Type guard for error responses
export function isBridgeError(
  response: unknown,
): response is { id: string; error: { code: string; message: string } } {
  return response !== null && typeof response === 'object' && 'error' in response;
}

// Type guard for success responses
export function isBridgeSuccess<T extends BridgeAction>(
  response: unknown,
): response is BridgeResponseMap[T] {
  return response !== null && typeof response === 'object' && !('error' in response);
}
