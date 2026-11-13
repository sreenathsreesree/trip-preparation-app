const mockLaunchLibrary = jest.fn();
const mockLaunchCamera = jest.fn();
const mockCopies: { from: string; to: string }[] = [];
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (o: unknown) => mockLaunchLibrary(o),
  launchCameraAsync: (o: unknown) => mockLaunchCamera(o),
  requestCameraPermissionsAsync: async () => ({ granted: true }),
  UIImagePickerPreferredAssetRepresentationMode: { Automatic: 'automatic', Compatible: 'compatible', Current: 'current' },
}));
jest.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    exists = true;
    constructor(...parts: unknown[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
    }
    create() {}
  }
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
    }
    async copy(to: { uri: string }) {
      mockCopies.push({ from: this.uri, to: to.uri });
    }
  }
  return { Directory, File, Paths: { document: { uri: 'file:///docs' } } };
});
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));

import { pickAndStoreImage, pickAndStoreImages, pickerOptions, storedExtension } from '../imageStore';

const asset = (uri: string, width: number, height: number, mimeType = 'image/jpeg') => ({ uri, width, height, mimeType });

beforeEach(() => {
  mockLaunchLibrary.mockReset();
  mockLaunchCamera.mockReset();
  mockCopies.length = 0;
});

describe('original photo picking (memories, journal, covers)', () => {
  it('never opens a crop editor and never re-encodes', () => {
    const o = pickerOptions('original', false, true);
    expect(o.allowsEditing).toBe(false);
    expect(o.aspect).toBeUndefined();
    expect(o.quality).toBe(1); // Android: byte-for-byte RawImageExporter
    expect(o.preferredAssetRepresentationMode).toBe('current'); // iOS: no HEIC→JPEG conversion
    expect(o.allowsMultipleSelection).toBe(true);
  });

  it('keeps portrait, landscape and very large photos exactly as picked, in the chosen order', async () => {
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [asset('file:///cache/portrait.jpg', 3024, 4032), asset('file:///cache/landscape.heic', 8000, 6000, 'image/heic'), asset('file:///cache/pano.png', 20000, 2400, 'image/png')],
    });
    const uris = await pickAndStoreImages('library', { mode: 'original', multiple: true });
    expect(uris).toHaveLength(3);
    // Plain file copies (no resize/compress step exists in between), original formats kept.
    expect(mockCopies.map((c) => c.from)).toEqual(['file:///cache/portrait.jpg', 'file:///cache/landscape.heic', 'file:///cache/pano.png']);
    expect(uris.map((u) => u.split('.').pop())).toEqual(['jpg', 'heic', 'png']);
  });

  it('stops at the remaining photo limit', async () => {
    mockLaunchLibrary.mockResolvedValue({ canceled: false, assets: [asset('file:///a.jpg', 1, 1), asset('file:///b.jpg', 1, 1), asset('file:///c.jpg', 1, 1)] });
    expect(await pickAndStoreImages('library', { mode: 'original', multiple: true, limit: 2 })).toHaveLength(2);
    expect(mockLaunchLibrary.mock.calls[0][0].selectionLimit).toBe(2);
  });

  it('takes one original from the camera, without cropping', async () => {
    mockLaunchCamera.mockResolvedValue({ canceled: false, assets: [asset('file:///cache/cam.jpg', 4000, 3000)] });
    expect(await pickAndStoreImages('camera', { mode: 'original', multiple: true })).toHaveLength(1);
    expect(mockLaunchCamera.mock.calls[0][0]).toMatchObject({ allowsEditing: false, quality: 1, allowsMultipleSelection: false });
  });

  it('returns nothing when cancelled', async () => {
    mockLaunchLibrary.mockResolvedValue({ canceled: true, assets: null });
    expect(await pickAndStoreImages('library', { mode: 'original', multiple: true })).toEqual([]);
  });
});

describe('inventory photos keep the square crop', () => {
  it('uses the crop editor and a compressed copy', async () => {
    expect(pickerOptions('square', false, false)).toMatchObject({ allowsEditing: true, aspect: [1, 1], quality: 0.7 });
    mockLaunchLibrary.mockResolvedValue({ canceled: false, assets: [asset('file:///x.jpg', 1, 1)] });
    await pickAndStoreImage('library');
    expect(mockLaunchLibrary.mock.calls[0][0]).toMatchObject({ allowsEditing: true, aspect: [1, 1] });
  });
});

it('derives a stored extension from the file or its type', () => {
  expect(storedExtension('file:///x/IMG_1.HEIC')).toBe('heic');
  expect(storedExtension('content://media/123', 'image/png')).toBe('png');
  expect(storedExtension('content://media/123', null)).toBe('jpg');
});
