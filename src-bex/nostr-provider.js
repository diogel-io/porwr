const DEBUG = false; // Manually controlled as this script is injected into the page
const getCurrentWindowOrigin = () => window.location.origin;
const isSameWindowOrigin = (event) => event.origin === getCurrentWindowOrigin();
const normalizeErrorMessage = (error) => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    if (typeof error.message === 'string') return error.message;
    if (typeof error.error === 'string') return error.error;
    if (error.error && typeof error.error === 'object' && typeof error.error.message === 'string') {
      return error.error.message;
    }
    if (typeof error.code === 'string') return error.code;
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown error';
    }
  }
  return String(error);
};

const callDiogelBridge = (type, payload) => {
  if (DEBUG) console.log('[BEX] Provider calling:', type, payload);
  const id = Math.random().toString(36).substring(2);
  try {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        window.removeEventListener('message', handler);
        console.error(`[BEX] Request timed out for ID ${id}: ${type}`);
        reject(new Error(`Request timed out: ${type}`));
      }, 30000); // 30 second timeout

      const handler = (event) => {
        if (
          event.source === window &&
          isSameWindowOrigin(event) &&
          event.data &&
          event.data.id === id &&
          event.data.response
        ) {
          if (DEBUG) console.log(`[BEX] Provider received response for ID ${id}:`, event.data);
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          if (event.data.error) {
            reject(new Error(normalizeErrorMessage(event.data.error)));
          } else {
            resolve(event.data.result);
          }
        }
      };
      window.addEventListener('message', handler);
      if (DEBUG) console.log(`[BEX] Provider posting message for ID ${id}:`, type);
      window.postMessage(
        {
          id,
          type: 'diogel-request',
          method: type,
          payload,
        },
        getCurrentWindowOrigin(),
      );
    });
  } catch (e) {
    console.error(`[BEX] Error in provider call for ID ${id}:`, e);
    throw e;
  }
};

const nostr = {
  name: 'Porwr',
  getPublicKey: async () => {
    return nostr.call('getPublicKey', {});
  },
  signEvent: async (event) => {
    return nostr.call('signEvent', { event });
  },
  getRelays: async () => {
    return nostr.call('getRelays', {});
  },
  nip04: {
    encrypt: async (pubkey, plaintext) => {
      return nostr.call('nip04.encrypt', { pubkey, plaintext });
    },
    decrypt: async (pubkey, ciphertext) => {
      return nostr.call('nip04.decrypt', { pubkey, ciphertext });
    },
  },
  nip44: {
    encrypt: async (pubkey, plaintext) => {
      return nostr.call('nip44.encrypt', { pubkey, plaintext });
    },
    decrypt: async (pubkey, ciphertext) => {
      return nostr.call('nip44.decrypt', { pubkey, ciphertext });
    },
  },
  diogel: {
    getZapCapabilities: async () => {
      return nostr.call('diogel.getZapCapabilities', {});
    },
    sendZap: async (request) => {
      return nostr.call('diogel.sendZap', { request });
    },
  },

  // Internal call helper
  call: callDiogelBridge,

  // Ping method to verify communication
  ping: () => {
    return nostr.call('ping', {}).catch(() => {
      // Internal ping to content script
      return new Promise((resolve, reject) => {
        const id = Math.random().toString(36).substring(2);
        const timeout = setTimeout(() => {
          window.removeEventListener('message', handler);
          reject(new Error('Ping timed out'));
        }, 5000);
        const handler = (event) => {
          if (
            event.source === window &&
            isSameWindowOrigin(event) &&
            event.data &&
            event.data.id === id &&
            event.data.response
          ) {
            clearTimeout(timeout);
            window.removeEventListener('message', handler);
            resolve(event.data.result);
          }
        };
        window.addEventListener('message', handler);
        window.postMessage({ id, type: 'diogel-ping' }, getCurrentWindowOrigin());
      });
    });
  },
};

const webln = {
  enable: async () => callDiogelBridge('webln.enable', {}),
  getInfo: async () => callDiogelBridge('webln.getInfo', {}),
  sendPayment: async (paymentRequest) => callDiogelBridge('webln.sendPayment', { paymentRequest }),
};

window.nostr = nostr;
if (!window.webln) {
  window.webln = webln;
} else {
  window.diogelWebln = webln;
}
window.dispatchEvent(new CustomEvent('nostr-provider-ready'));
window.dispatchEvent(new CustomEvent('webln:provider-ready'));
if (DEBUG) console.log('[BEX] Nostr provider ready and events dispatched');
window.dispatchEvent(
  new CustomEvent('nostr:registration', {
    detail: {
      name: 'Porwr',
      methods: [
        'getPublicKey',
        'signEvent',
        'getRelays',
        'nip04.encrypt',
        'nip04.decrypt',
        'nip44.encrypt',
        'nip44.decrypt',
        'diogel.getZapCapabilities',
        'diogel.sendZap',
      ],
    },
  }),
);
