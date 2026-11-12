import { GOOGLE_MAPS_ACTIVITY, GOOGLE_MAPS_PACKAGE, openInMapsApp } from '../openMaps';

const mockStartActivity = jest.fn();
jest.mock('expo-intent-launcher', () => ({ startActivityAsync: (...args: unknown[]) => mockStartActivity(...args) }));
jest.mock('react-native', () => ({ Platform: { OS: 'android' }, Linking: { openURL: jest.fn() } }));

describe('openInMapsApp', () => {
  beforeEach(() => mockStartActivity.mockReset());

  it('targets the Google Maps app explicitly, in its own task', async () => {
    mockStartActivity.mockResolvedValue({ resultCode: 0 });
    await expect(openInMapsApp('https://www.google.com/maps/dir/?api=1&destination=Kochi')).resolves.toBe(true);
    expect(mockStartActivity).toHaveBeenCalledWith('android.intent.action.VIEW', {
      data: 'https://www.google.com/maps/dir/?api=1&destination=Kochi',
      packageName: GOOGLE_MAPS_PACKAGE,
      className: GOOGLE_MAPS_ACTIVITY,
      flags: 0x10000000,
    });
  });

  it('reports false when the app is missing, so the journey is re-planned for a browser', async () => {
    mockStartActivity.mockRejectedValue(new Error('No Activity found to handle Intent'));
    await expect(openInMapsApp('https://www.google.com/maps/dir/?api=1&destination=Kochi')).resolves.toBe(false);
  });
});
