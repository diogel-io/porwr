import {
  REQUEST_EXPIRY_DEFAULT_MINUTES,
  REQUEST_EXPIRY_MAX_MINUTES,
  REQUEST_EXPIRY_MIN_MINUTES,
} from '@/services/request-expiry';

export const REQUEST_TIMEOUT_MS = 60000;

// Re-exported so background code keeps a single constants entry point. The values live in
// `src/services/request-expiry.ts` because both the background and the settings UI need them,
// and the UI cannot import from `src-bex`.
export {
  REQUEST_EXPIRY_DEFAULT_MINUTES,
  REQUEST_EXPIRY_MAX_MINUTES,
  REQUEST_EXPIRY_MIN_MINUTES,
};

export const MESSAGE_TYPE_REQUEST = 'diogel-request';
export const MESSAGE_TYPE_PING = 'diogel-ping';
