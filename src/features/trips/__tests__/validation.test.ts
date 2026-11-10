import { blankDraft } from '../tripDraftStore';
import {
  draftToTripInput,
  editMinStartDate,
  pickErrors,
  tripToDraft,
  validateTripDraft,
  type TripDraft,
} from '../validation';
import type { Trip } from '../model';

const TODAY = '2026-11-10';
const create = { minStartDate: TODAY };

const valid: TripDraft = {
  name: '  Goa Getaway ',
  destinations: [
    { key: 'd1', name: ' North Goa ' },
    { key: 'd2', id: 'dest-2', name: 'South Goa' },
  ],
  startDate: '2026-12-20',
  endDate: '2026-12-24',
  travellers: [
    { key: 't1', name: ' Asha ', kind: 'adult' },
    { key: 't2', id: 'trav-2', name: 'Mia', kind: 'child' },
  ],
  transportMode: 'flight',
  category: 'beach',
};

describe('validateTripDraft', () => {
  it('accepts a complete draft', () => {
    expect(validateTripDraft(valid, create)).toEqual({});
  });

  it('reports every missing field on a blank draft', () => {
    const errors = validateTripDraft({ ...blankDraft(), travellers: [] }, create);
    expect(Object.keys(errors).sort()).toEqual(
      ['category', 'destinations', 'destinationItems', 'endDate', 'name', 'startDate', 'transportMode', 'travellers'].sort(),
    );
  });

  it('flags each empty destination row', () => {
    const errors = validateTripDraft(
      { ...valid, destinations: [...valid.destinations, { key: 'd3', name: '  ' }] },
      create,
    );
    expect(errors.destinationItems).toEqual({ d3: 'Enter a place or remove this stop.' });
    expect(errors.destinations).toBe('Enter a place or remove this stop.');
  });

  it('limits destinations to ten', () => {
    const destinations = Array.from({ length: 11 }, (_, i) => ({ key: `d${i}`, name: `Stop ${i}` }));
    expect(validateTripDraft({ ...valid, destinations }, create).destinations).toBeDefined();
  });

  it('requires at least one named traveller', () => {
    expect(validateTripDraft({ ...valid, travellers: [] }, create).travellers).toBeDefined();
    const errors = validateTripDraft(
      { ...valid, travellers: [{ key: 't1', name: ' ', kind: 'adult' }] },
      create,
    );
    expect(errors.travellerItems).toEqual({ t1: 'Enter a name or remove this traveller.' });
  });

  it('allows a trip with only children (e.g. a school trip)', () => {
    expect(
      validateTripDraft({ ...valid, travellers: [{ key: 't1', name: 'Kid', kind: 'child' }] }, create),
    ).toEqual({});
  });

  it('rejects past start dates when creating, inverted ranges and overlong trips', () => {
    expect(validateTripDraft({ ...valid, startDate: '2026-11-09' }, create).startDate).toBeDefined();
    expect(
      validateTripDraft({ ...valid, startDate: '2026-12-24', endDate: '2026-12-20' }, create).endDate,
    ).toBeDefined();
    expect(
      validateTripDraft({ ...valid, startDate: '2027-01-01', endDate: '2028-01-01' }, create).endDate,
    ).toBeDefined();
  });

  it('lets an edited trip keep a start date that is already in the past', () => {
    const minStartDate = editMinStartDate('2026-11-01', TODAY);
    expect(minStartDate).toBe('2026-11-01');
    expect(
      validateTripDraft({ ...valid, startDate: '2026-11-01', endDate: '2026-11-12' }, { minStartDate }),
    ).toEqual({});
    expect(
      validateTripDraft({ ...valid, startDate: '2026-10-31' }, { minStartDate }).startDate,
    ).toBeDefined();
    expect(editMinStartDate('2026-12-01', TODAY)).toBe(TODAY);
  });

  it('rejects unknown enum values', () => {
    expect(validateTripDraft({ ...valid, transportMode: 'rocket' }, create).transportMode).toBeDefined();
    expect(validateTripDraft({ ...valid, category: 'space' }, create).category).toBeDefined();
  });
});

describe('pickErrors', () => {
  it('limits errors (and row errors) to the requested fields', () => {
    const errors = validateTripDraft({ ...blankDraft(), travellers: [] }, create);
    expect(Object.keys(pickErrors(errors, ['name', 'destinations'])).sort()).toEqual([
      'destinationItems',
      'destinations',
      'name',
    ]);
    expect(pickErrors(errors, ['transportMode'])).toEqual({ transportMode: 'How are you travelling?' });
  });
});

describe('draftToTripInput / tripToDraft', () => {
  it('trims text and keeps ids of saved rows', () => {
    expect(draftToTripInput(valid, create)).toEqual({
      name: 'Goa Getaway',
      destinations: [{ name: 'North Goa' }, { id: 'dest-2', name: 'South Goa' }],
      startDate: '2026-12-20',
      endDate: '2026-12-24',
      travellers: [
        { name: 'Asha', kind: 'adult' },
        { id: 'trav-2', name: 'Mia', kind: 'child' },
      ],
      transportMode: 'flight',
      category: 'beach',
    });
  });

  it('throws for invalid drafts', () => {
    expect(() => draftToTripInput(blankDraft(), create)).toThrow();
  });

  it('prefills a draft from a saved trip', () => {
    const trip: Trip = {
      id: 'trip-1',
      name: 'Spiti',
      destinations: [{ id: 'd1', name: 'Kaza' }],
      startDate: '2026-12-01',
      endDate: '2026-12-05',
      travellers: [{ id: 't1', name: 'Asha', kind: 'adult' }],
      transportMode: 'bike',
      category: 'mountains',
      completedAt: null,
      archivedAt: null,
      createdAt: 'x',
      updatedAt: 'x',
    };
    expect(tripToDraft(trip)).toEqual({
      name: 'Spiti',
      destinations: [{ key: 'd1', id: 'd1', name: 'Kaza' }],
      startDate: '2026-12-01',
      endDate: '2026-12-05',
      travellers: [{ key: 't1', id: 't1', name: 'Asha', kind: 'adult' }],
      transportMode: 'bike',
      category: 'mountains',
    });
  });
});
