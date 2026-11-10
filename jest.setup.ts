// Uses Node's crypto for UUIDs in tests (expo-crypto is native).
jest.mock('expo-crypto', () => ({
  randomUUID: () => jest.requireActual<typeof import('crypto')>('crypto').randomUUID(),
}));
