import { installCryptoMock } from './unit/mocks/crypto';
import { afterEach, vi } from 'vitest';
import { protectedStore } from './unit/mocks/protected-settings';

// Install mocks before all tests
installCryptoMock();

// The protected store reads IndexedDB, which the test environment lacks (#140).
vi.mock('@/services/protected-settings', () => import('./unit/mocks/protected-settings'));

// Clean up after each test
afterEach(() => {
  protectedStore.clear();
});
