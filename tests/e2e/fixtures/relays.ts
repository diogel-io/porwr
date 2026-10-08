import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { connect, createServer } from 'node:net';

import { test as extensionTest } from './extension';

/**
 * Local Nostr relays for end-to-end tests, run with `nak serve` (https://github.com/fiatjaf/nak).
 *
 * Two relays, because real messaging touches two kinds:
 * - `plain`: an open relay standing in for the fallback relays — profiles, contact lists and the
 *   kind 10050 DM relay lists everyone reads.
 * - `inbox`: a DM inbox relay that, like real ones, requires NIP-42 AUTH, so the tests prove Porwr
 *   authenticates before it can read or deliver gift wraps.
 *
 * CI installs a pinned `nak` (see `.github/workflows/e2e.yml`). Locally, a spec using this fixture is
 * skipped with a reason when `nak` is not on the PATH, rather than failing for a missing tool.
 */
export interface LocalRelays {
  plain: string;
  inbox: string;
}

const START_TIMEOUT_MS = 10_000;

function nakAvailable(): boolean {
  return spawnSync('nak', ['--version'], { stdio: 'ignore' }).status === 0;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

async function waitForPort(port: number): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (open) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`nak serve did not start on port ${port} within ${START_TIMEOUT_MS} ms`);
}

async function startRelay(extraArgs: string[]): Promise<{ url: string; process: ChildProcess }> {
  const port = await freePort();
  const child = spawn('nak', ['serve', '--port', String(port), ...extraArgs], { stdio: 'ignore' });
  await waitForPort(port);
  return { url: `ws://localhost:${port}`, process: child };
}

export const test = extensionTest.extend<{ relays: LocalRelays }>({
  relays: async ({}, use, testInfo) => {
    if (!nakAvailable()) {
      if (process.env.CI) {
        throw new Error('nak is required for the messaging end-to-end tests and was not found on the PATH.');
      }
      testInfo.skip(true, 'install nak to run messaging e2e');
      return;
    }

    const plain = await startRelay([]);
    const inbox = await startRelay(['--auth', '--eager-auth']);
    try {
      await use({ plain: plain.url, inbox: inbox.url });
    } finally {
      plain.process.kill();
      inbox.process.kill();
    }
  },
});

export { expect } from './extension';
