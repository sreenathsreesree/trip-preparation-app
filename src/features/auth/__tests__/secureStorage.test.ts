import { createMemorySecureStorage } from '../../../../test/fakeSupabase';
import { CHUNK_SIZE, toSecureKey } from '../secureStorage';

describe('chunked secure session storage', () => {
  it('round-trips small and large values', async () => {
    const { storage, entries } = createMemorySecureStorage();
    await storage.setItem('tripprep.auth', 'small');
    expect(await storage.getItem('tripprep.auth')).toBe('small');
    expect(entries.get('tripprep.auth.n')).toBe('1');

    const large = 'x'.repeat(CHUNK_SIZE * 3 + 7);
    await storage.setItem('tripprep.auth', large);
    expect(await storage.getItem('tripprep.auth')).toBe(large);
    expect(entries.get('tripprep.auth.n')).toBe('4');
    for (const value of entries.values()) expect(value.length).toBeLessThanOrEqual(CHUNK_SIZE);
  });

  it('removes leftover chunks when a value shrinks', async () => {
    const { storage, entries } = createMemorySecureStorage();
    await storage.setItem('k', 'y'.repeat(CHUNK_SIZE * 2 + 1));
    await storage.setItem('k', 'short');
    expect([...entries.keys()].sort()).toEqual(['k.0', 'k.n']);
    expect(await storage.getItem('k')).toBe('short');
  });

  it('reads a damaged session as signed out and clears it', async () => {
    const { storage, entries } = createMemorySecureStorage();
    await storage.setItem('k', 'z'.repeat(CHUNK_SIZE * 2));
    entries.delete('k.1');
    expect(await storage.getItem('k')).toBeNull();
    expect(entries.size).toBe(0);
  });

  it('removes every chunk and returns null for unknown keys', async () => {
    const { storage, entries } = createMemorySecureStorage();
    await storage.setItem('k', 'w'.repeat(CHUNK_SIZE + 1));
    await storage.removeItem('k');
    expect(entries.size).toBe(0);
    expect(await storage.getItem('missing')).toBeNull();
  });

  it('maps keys to the characters SecureStore allows', () => {
    expect(toSecureKey('tripprep.auth-code-verifier')).toBe('tripprep.auth-code-verifier');
    expect(toSecureKey('sb:auth/token')).toBe('sb_auth_token');
  });
});
