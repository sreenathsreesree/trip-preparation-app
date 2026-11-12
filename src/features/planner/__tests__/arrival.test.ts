import {
  cleanArrivalSettings,
  DEFAULT_ARRIVAL,
  distanceMeters,
  emptyArrivalState,
  snooze,
  updateArrival,
  type ArrivalTarget,
} from '../arrival';

// Echo Point, Munnar and a spot ~2 km away.
const echo: ArrivalTarget = { nodeId: 'echo', name: 'Echo Point', location: { latitude: 10.1149, longitude: 77.1885 } };
const dam: ArrivalTarget = { nodeId: 'dam', name: 'Mattupetty Dam', location: { latitude: 10.1063, longitude: 77.1239 } };
const settings = { radiusMeters: 150, dwellMinutes: 4 };
const MIN = 60_000;
const at = (lat: number, lon: number, t: number, accuracy: number | null = 20) => ({ latitude: lat, longitude: lon, accuracy, timestamp: t });
// ~60 m north of Echo Point; ~400 m away.
const near = (t: number, accuracy: number | null = 20) => at(10.1154, 77.1885, t, accuracy);
const away = (t: number) => at(10.1185, 77.1885, t);

describe('distance', () => {
  it('measures great-circle distance in metres', () => {
    expect(distanceMeters(echo.location, echo.location)).toBe(0);
    const d = distanceMeters(echo.location, dam.location);
    expect(d).toBeGreaterThan(7000);
    expect(d).toBeLessThan(7300);
  });
});

describe('arrival prompts', () => {
  it('asks only after staying within the radius for the dwell time, once', () => {
    let state = emptyArrivalState();
    let result = updateArrival(state, near(0), [echo, dam], settings);
    expect(result.prompt).toBeNull();
    result = updateArrival(result.state, near(3 * MIN), [echo, dam], settings);
    expect(result.prompt).toBeNull();
    result = updateArrival(result.state, near(4 * MIN), [echo, dam], settings);
    expect(result.prompt).toMatchObject({ nodeId: 'echo', name: 'Echo Point' });
    state = result.state;
    // Already asked: no repeat while still there.
    expect(updateArrival(state, near(10 * MIN), [echo, dam], settings).prompt).toBeNull();
  });

  it('passing by without stopping never asks', () => {
    let result = updateArrival(emptyArrivalState(), near(0), [echo], settings);
    result = updateArrival(result.state, away(2 * MIN), [echo], settings);
    result = updateArrival(result.state, near(3 * MIN), [echo], settings);
    result = updateArrival(result.state, near(5 * MIN), [echo], settings);
    expect(result.prompt).toBeNull(); // only 2 minutes since re-entering
    result = updateArrival(result.state, near(7 * MIN), [echo], settings);
    expect(result.prompt?.nodeId).toBe('echo');
  });

  it('"Not yet" snoozes that place until it is left or the snooze ends', () => {
    let result = updateArrival(emptyArrivalState(), near(0), [echo], settings);
    result = updateArrival(result.state, near(5 * MIN), [echo], settings);
    expect(result.prompt?.nodeId).toBe('echo');
    let state = snooze(result.state, 'echo', 5 * MIN);
    expect(updateArrival(state, near(20 * MIN), [echo], settings).prompt).toBeNull();
    // After the snooze, a full dwell is needed again.
    result = updateArrival(state, near(36 * MIN), [echo], settings);
    expect(result.prompt).toBeNull();
    result = updateArrival(result.state, near(41 * MIN), [echo], settings);
    expect(result.prompt?.nodeId).toBe('echo');
    // Leaving clears it: the next visit asks again after the dwell.
    state = snooze(result.state, 'echo', 41 * MIN);
    result = updateArrival(state, away(42 * MIN), [echo], settings);
    result = updateArrival(result.state, near(43 * MIN), [echo], settings);
    result = updateArrival(result.state, near(48 * MIN), [echo], settings);
    expect(result.prompt?.nodeId).toBe('echo');
  });

  it('ignores very inaccurate fixes and tracks parent and child places independently', () => {
    const coarse = updateArrival(emptyArrivalState(), near(0, 2000), [echo], settings);
    expect(coarse.state).toEqual(emptyArrivalState());
    const parent: ArrivalTarget = { nodeId: 'munnar', name: 'Munnar', location: { latitude: 10.0889, longitude: 77.0595 } };
    let result = updateArrival(emptyArrivalState(), near(0), [parent, echo], settings);
    result = updateArrival(result.state, near(4 * MIN), [parent, echo], settings);
    expect(result.prompt?.nodeId).toBe('echo'); // Munnar centre is far away
    expect(result.state.targets.munnar?.enteredAt).toBeNull();
  });

  it('cleans stored settings', () => {
    expect(cleanArrivalSettings(null)).toEqual(DEFAULT_ARRIVAL);
    expect(cleanArrivalSettings({ enabled: true, radiusMeters: 5, dwellMinutes: 99 })).toEqual({ enabled: true, radiusMeters: 50, dwellMinutes: 30 });
  });
});
