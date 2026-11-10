import type { NewTripInput } from '../../trips/model';
import { getApplicableSections, PREP_SECTIONS } from '../model';
import { buildStarterChecklist } from '../templates';

const base: NewTripInput = {
  name: 'Test',
  destination: 'Somewhere',
  startDate: '2026-12-01',
  endDate: '2026-12-03',
  travellers: { adults: 2, children: 0 },
  transportMode: 'train',
  category: 'leisure',
};

const sectionsOf = (input: NewTripInput) =>
  new Set(buildStarterChecklist(input).map((item) => item.section));

describe('getApplicableSections', () => {
  it('includes vehicle readiness only for self-driven transport', () => {
    expect(getApplicableSections('car')).toContain('vehicle');
    expect(getApplicableSections('bike')).toContain('vehicle');
    expect(getApplicableSections('mixed')).toContain('vehicle');
    expect(getApplicableSections('flight')).not.toContain('vehicle');
    expect(getApplicableSections('train')).toEqual(PREP_SECTIONS.filter((s) => s !== 'vehicle'));
  });
});

describe('buildStarterChecklist', () => {
  it('covers every applicable section and nothing else', () => {
    expect(sectionsOf(base)).toEqual(new Set(getApplicableSections('train')));
    expect(sectionsOf({ ...base, transportMode: 'car' })).toEqual(
      new Set(getApplicableSections('car')),
    );
  });

  it('tailors items to transport, duration, category and travellers', () => {
    const titles = (input: NewTripInput) => buildStarterChecklist(input).map((item) => item.title);

    expect(titles(base)).toContain('Clothes for 3 days');
    expect(titles(base)).toContain('Train e-ticket and PNR saved offline');
    expect(titles({ ...base, transportMode: 'car' })).toContain('Top up FASTag balance');
    expect(titles({ ...base, transportMode: 'bike' })).toContain('Lubricate and adjust the chain');
    expect(titles({ ...base, category: 'mountains' })).toContain('Warm layers and rain jacket');
    expect(titles({ ...base, travellers: { adults: 2, children: 2 } })).toContain(
      "Kids' clothes, snacks and comfort items",
    );
    expect(titles(base)).not.toContain('Driving licence');
  });

  it('never produces empty or duplicate titles within a section', () => {
    for (const mode of ['car', 'bike', 'train', 'bus', 'flight', 'mixed'] as const) {
      const items = buildStarterChecklist({ ...base, transportMode: mode, category: 'wedding' });
      const keys = items.map((item) => `${item.section}:${item.title}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(items.every((item) => item.title.trim().length > 0)).toBe(true);
    }
  });
});
