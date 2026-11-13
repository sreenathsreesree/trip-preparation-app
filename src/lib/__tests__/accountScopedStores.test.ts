import { create } from 'zustand';

import { accountScoped, resetAccountScopedStores } from '../accountScopedStores';

it('clears every account-scoped store on an account switch, leaving others alone', () => {
  const trips = accountScoped(create<{ trips: string[] }>()(() => ({ trips: [] })));
  const device = create<{ theme: string }>()(() => ({ theme: 'dark' }));
  trips.setState({ trips: ['A’s Kerala trip'] });
  device.setState({ theme: 'light' });
  resetAccountScopedStores();
  expect(trips.getState().trips).toEqual([]);
  expect(device.getState().theme).toBe('light');
});
