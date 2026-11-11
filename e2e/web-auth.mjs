// Account routes in a build WITHOUT Supabase configuration (the default for local
// web exports): the app stays guest-only and offline-first, the sign-in screen
// offers no non-working control, the protected account screen is unreachable,
// and a stray /auth/callback returns to Profile. Real Google sign-in needs the
// provider configured and a development build; it is not exercised here.
//
//   npx expo export --platform web --output-dir dist && npm run e2e:auth

import { BASE, byId, check, launch, run, setStep, shot } from './harness.mjs';

await run('Web auth (unconfigured) test', async () => {
  const { page, errors } = await launch();

  setStep('profile shows the offline-only account card');
  await page.goto(`${BASE}/profile`);
  await byId(page, 'account-card-offline-only').waitFor();
  check((await byId(page, 'account-sign-in').count()) === 0, 'no sign-in button without configuration');
  await shot(page, 'auth-01-profile-unconfigured');

  setStep('sign-in screen explains that sign-in is unavailable');
  await page.goto(`${BASE}/auth/sign-in`);
  await byId(page, 'sign-in-unavailable').waitFor();
  check((await byId(page, 'sign-in-google').count()) === 0, 'no Google button without configuration');
  await shot(page, 'auth-02-sign-in-unconfigured');

  setStep('protected account screen is not reachable as a guest');
  await page.goto(`${BASE}/account`);
  await page.waitForTimeout(1000);
  check((await byId(page, 'account-screen').count()) === 0, 'account screen is guarded');

  setStep('callback without a code returns to profile');
  await page.goto(`${BASE}/auth/callback`);
  await byId(page, 'profile-screen').waitFor();
  check(true, 'callback without a code goes back to Profile');

  check(errors.length === 0, `no uncaught page errors (${errors.join('; ') || 'none'})`);
});
