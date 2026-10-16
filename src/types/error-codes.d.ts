/**
 * Error codes for programmatic error handling.
 * These are ADDITIONAL to the existing string error messages.
 */

export enum ErrorCode {
  // Vault errors (VLT prefix)
  VLT_LOCKED = 'VLT_LOCKED',
  VLT_NOT_CREATED = 'VLT_NOT_CREATED',
  VLT_INVALID_PASSWORD = 'VLT_INVALID_PASSWORD',
  VLT_CORRUPTED = 'VLT_CORRUPTED',
  VLT_SESSION_EXPIRED = 'VLT_SESSION_EXPIRED',

  // Permission errors (PER prefix)
  PER_DENIED = 'PER_DENIED',
  PER_PROMPT_FAILED = 'PER_PROMPT_FAILED',
  PER_EXPIRED = 'PER_EXPIRED',

  // Signing errors (SIG prefix)
  SIG_FAILED = 'SIG_FAILED',
  SIG_INVALID_EVENT = 'SIG_INVALID_EVENT',
  SIG_NO_ACTIVE_KEY = 'SIG_NO_ACTIVE_KEY',

  // Network errors (NET prefix)
  NET_OFFLINE = 'NET_OFFLINE',
  NET_TIMEOUT = 'NET_TIMEOUT',
  NET_SERVER_ERROR = 'NET_SERVER_ERROR',

  // General errors (GEN prefix)
  GEN_UNKNOWN = 'GEN_UNKNOWN',
  GEN_USER_REJECTED = 'GEN_USER_REJECTED',
  GEN_INVALID_INPUT = 'GEN_INVALID_INPUT',
}

export enum ErrorSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

export interface ErrorMetadata {
  code: ErrorCode;
  severity: ErrorSeverity;
  userAction?: string | undefined;
  technicalDetails?: string | undefined;
}

// Default metadata for each error code
export const ERROR_METADATA: Record<ErrorCode, Omit<ErrorMetadata, 'code'>> = {
  [ErrorCode.VLT_LOCKED]: {
    severity: ErrorSeverity.INFO,
    userAction: 'Please unlock your vault to continue',
  },
  [ErrorCode.VLT_NOT_CREATED]: {
    severity: ErrorSeverity.WARNING,
    userAction: 'Create a new vault to get started',
  },
  [ErrorCode.VLT_INVALID_PASSWORD]: {
    severity: ErrorSeverity.WARNING,
    userAction: 'Please check your password and try again',
  },
  [ErrorCode.VLT_CORRUPTED]: {
    severity: ErrorSeverity.CRITICAL,
    userAction: 'Restore from backup or create a new vault',
  },
  [ErrorCode.VLT_SESSION_EXPIRED]: {
    severity: ErrorSeverity.INFO,
    userAction: 'Your session expired. Please unlock again',
  },
  [ErrorCode.PER_DENIED]: {
    severity: ErrorSeverity.INFO,
    userAction: 'Grant permission when prompted',
  },
  [ErrorCode.PER_PROMPT_FAILED]: {
    severity: ErrorSeverity.ERROR,
    userAction: 'Try again or check extension permissions',
  },
  [ErrorCode.PER_EXPIRED]: {
    severity: ErrorSeverity.INFO,
    userAction: 'Permission has expired. Grant again',
  },
  [ErrorCode.SIG_FAILED]: {
    severity: ErrorSeverity.ERROR,
    userAction: 'Try again or check your account status',
  },
  [ErrorCode.SIG_INVALID_EVENT]: {
    severity: ErrorSeverity.WARNING,
    userAction: 'Check the event format and try again',
  },
  [ErrorCode.SIG_NO_ACTIVE_KEY]: {
    severity: ErrorSeverity.WARNING,
    userAction: 'Select or create an account first',
  },
  [ErrorCode.NET_OFFLINE]: {
    severity: ErrorSeverity.WARNING,
    userAction: 'Check your internet connection',
  },
  [ErrorCode.NET_TIMEOUT]: {
    severity: ErrorSeverity.WARNING,
    userAction: 'Try again. The operation timed out',
  },
  [ErrorCode.NET_SERVER_ERROR]: {
    severity: ErrorSeverity.ERROR,
    userAction: 'The server encountered an error. Try again later',
  },
  [ErrorCode.GEN_UNKNOWN]: {
    severity: ErrorSeverity.ERROR,
    userAction: 'An unexpected error occurred. Try again',
  },
  [ErrorCode.GEN_USER_REJECTED]: {
    severity: ErrorSeverity.INFO,
  },
  [ErrorCode.GEN_INVALID_INPUT]: {
    severity: ErrorSeverity.WARNING,
    userAction: 'Check your input and try again',
  },
};

/**
 * Get error metadata for a code
 */
export function getErrorMetadata(code: ErrorCode): ErrorMetadata {
  const meta = ERROR_METADATA[code];
  return {
    code,
    severity: meta?.severity ?? ErrorSeverity.ERROR,
    userAction: meta?.userAction,
    technicalDetails: meta?.technicalDetails,
  };
}

/**
 * Format error for user display
 * Returns a user-friendly string combining message and action
 */
export function formatErrorForUser(message: string | undefined, code?: ErrorCode): string {
  if (!message && !code) return 'An unexpected error occurred';

  const parts: string[] = [];

  if (message) {
    parts.push(message);
  }

  if (code) {
    const meta = getErrorMetadata(code);
    if (meta.userAction) {
      parts.push(meta.userAction);
    }
  }

  return parts.join('\n\n');
}

/**
 * Format error for logging
 * Returns a string with technical details for debugging
 */
export function formatErrorForLog(
  message: string | undefined,
  code?: ErrorCode,
  technicalDetails?: string,
): string {
  const parts: string[] = [];

  if (code) {
    const meta = getErrorMetadata(code);
    parts.push(`[${code}] ${meta.severity.toUpperCase()}`);
  }

  if (message) {
    parts.push(message);
  }

  if (technicalDetails) {
    parts.push(`Details: ${technicalDetails}`);
  }

  return parts.join(' | ');
}
