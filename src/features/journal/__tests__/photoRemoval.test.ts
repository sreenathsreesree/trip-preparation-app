import { photoRemovalMessage } from '../drive/photoRemoval';

jest.mock('@/db/repositories', () => ({ getRepositories: jest.fn() }));
jest.mock('@/lib/confirm', () => ({ confirmAction: jest.fn() }));


describe('removing a photo says exactly what happens', () => {
  it('uploaded: the Drive original stays; only Trip Prep’s link and copy go', () => {
    const m = photoRemovalMessage('uploaded');
    expect(m.message).toMatch(/original stays in your Google Drive/);
    expect(m.destructive).toBe(false);
  });

  it('pending, failed or never queued: warns that Trip Prep’s copy is the only one', () => {
    for (const status of ['pending', 'failed', null] as const) {
      const m = photoRemovalMessage(status);
      expect(m.message).toMatch(/only one/);
      expect(m.destructive).toBe(true);
    }
    expect(photoRemovalMessage('pending').message).toMatch(/hasn’t finished uploading/);
  });
});
