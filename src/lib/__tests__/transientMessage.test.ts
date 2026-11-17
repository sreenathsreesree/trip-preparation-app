import { createTransientMessage, TRANSIENT_MESSAGE_MS } from '../transientMessage';

describe('transient success messages', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows at once and dismisses itself after 3 seconds', () => {
    const seen: (string | null)[] = [];
    const m = createTransientMessage<string>((v) => seen.push(v));
    m.show('1 added from Inventory.');
    expect(seen).toEqual(['1 added from Inventory.']);
    jest.advanceTimersByTime(TRANSIENT_MESSAGE_MS - 1);
    expect(seen).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(seen).toEqual(['1 added from Inventory.', null]);
    expect(TRANSIENT_MESSAGE_MS).toBe(3000);
  });

  it('can be dismissed by hand, and the old timer never fires later', () => {
    const seen: (string | null)[] = [];
    const m = createTransientMessage<string>((v) => seen.push(v));
    m.show('Saved');
    m.dismiss();
    jest.advanceTimersByTime(10_000);
    expect(seen).toEqual(['Saved', null]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('repeated operations replace the message and restart one timer (no stale or overlapping timers)', () => {
    const seen: (string | null)[] = [];
    const m = createTransientMessage<string>((v) => seen.push(v));
    m.show('First');
    jest.advanceTimersByTime(2000);
    m.show('Second');
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(2000);
    // The first timer would have fired by now; it was cancelled.
    expect(seen).toEqual(['First', 'Second']);
    jest.advanceTimersByTime(1000);
    expect(seen).toEqual(['First', 'Second', null]);
  });

  it('stops its timer when the screen goes away', () => {
    const seen: (string | null)[] = [];
    const m = createTransientMessage<string>((v) => seen.push(v));
    m.show('Moved');
    m.dispose();
    jest.advanceTimersByTime(5000);
    expect(seen).toEqual(['Moved']);
    expect(jest.getTimerCount()).toBe(0);
  });
});
