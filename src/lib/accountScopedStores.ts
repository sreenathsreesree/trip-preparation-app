import type { StoreApi } from 'zustand';

type Resettable = Pick<StoreApi<object>, 'setState' | 'getInitialState'>;
const stores = new Set<Resettable>();

/**
 * Marks a Zustand store as holding one account's data. When the signed-in
 * account changes, every registered store goes back to its initial state, so
 * nothing loaded for the previous account stays in memory or on screen.
 */
export function accountScoped<T extends Resettable>(store: T): T {
  stores.add(store);
  return store;
}

export function resetAccountScopedStores(): void {
  for (const store of stores) store.setState(store.getInitialState(), true);
}
