import { INITIAL_DRAFT } from '../tripDraftStore';
import { draftToTripInput, pickErrors, validateTripDraft, type TripDraft } from '../validation';

const TODAY = '2026-11-10';

const valid: TripDraft = {
  name: '  Goa Getaway ',
  destination: ' North Goa ',
  startDate: '2026-12-20',
  endDate: '2026-12-24',
  adults: 2,
  children: 1,
  transportMode: 'flight',
  category: 'beach',
};

describe('validateTripDraft', () => {
  it('accepts a complete draft', () => {
    expect(validateTripDraft(valid, TODAY)).toEqual({});
  });

  it('reports every missing field on an empty draft', () => {
    const errors = validateTripDraft(INITIAL_DRAFT, TODAY);
    expect(Object.keys(errors).sort()).toEqual(
      ['category', 'destination', 'endDate', 'name', 'startDate', 'transportMode'].sort(),
    );
  });

  it('rejects whitespace-only and too-long names', () => {
    expect(validateTripDraft({ ...valid, name: '   ' }, TODAY).name).toBeDefined();
    expect(validateTripDraft({ ...valid, name: 'x'.repeat(61) }, TODAY).name).toBeDefined();
  });

  it('rejects past start dates and inverted ranges', () => {
    expect(validateTripDraft({ ...valid, startDate: '2026-11-09' }, TODAY).startDate).toBeDefined();
    expect(
      validateTripDraft({ ...valid, startDate: '2026-12-24', endDate: '2026-12-20' }, TODAY).endDate,
    ).toBeDefined();
  });

  it('allows a trip that starts today and ends the same day', () => {
    expect(validateTripDraft({ ...valid, startDate: TODAY, endDate: TODAY }, TODAY)).toEqual({});
  });

  it('caps trip length at 365 days', () => {
    expect(
      validateTripDraft({ ...valid, startDate: '2027-01-01', endDate: '2028-01-01' }, TODAY).endDate,
    ).toBeDefined();
    expect(
      validateTripDraft({ ...valid, startDate: '2027-01-01', endDate: '2027-12-31' }, TODAY).endDate,
    ).toBeUndefined();
  });

  it('enforces traveller limits', () => {
    expect(validateTripDraft({ ...valid, adults: 0 }, TODAY).adults).toBeDefined();
    expect(validateTripDraft({ ...valid, children: 21 }, TODAY).children).toBeDefined();
  });

  it('rejects unknown enum values', () => {
    expect(validateTripDraft({ ...valid, transportMode: 'rocket' }, TODAY).transportMode).toBeDefined();
    expect(validateTripDraft({ ...valid, category: 'space' }, TODAY).category).toBeDefined();
  });
});

describe('pickErrors', () => {
  it('limits errors to the requested fields', () => {
    const errors = validateTripDraft(INITIAL_DRAFT, TODAY);
    expect(Object.keys(pickErrors(errors, ['name', 'adults']))).toEqual(['name']);
  });
});

describe('draftToTripInput', () => {
  it('trims text and builds typed input', () => {
    expect(draftToTripInput(valid, TODAY)).toEqual({
      name: 'Goa Getaway',
      destination: 'North Goa',
      startDate: '2026-12-20',
      endDate: '2026-12-24',
      travellers: { adults: 2, children: 1 },
      transportMode: 'flight',
      category: 'beach',
    });
  });

  it('throws for invalid drafts', () => {
    expect(() => draftToTripInput(INITIAL_DRAFT, TODAY)).toThrow();
  });
});
