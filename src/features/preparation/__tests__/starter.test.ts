import { tripInput } from '../../../../test/fixtures';
import type { TripInput } from '../../trips/model';
import { getStandardSectionsFor, STANDARD_SECTION_KINDS } from '../model';
import { buildStarterChecklist, buildStarterSection } from '../starter';

const base = tripInput({
  startDate: '2026-12-01',
  endDate: '2026-12-03',
  travellers: [{ name: 'A', kind: 'adult' }, { name: 'B', kind: 'adult' }],
  transportMode: 'train',
  category: 'leisure',
});

const kinds = (input: TripInput) => buildStarterChecklist(input).sections.map((s) => s.kind);
const tasks = (input: TripInput) => buildStarterChecklist(input).sections.flatMap((s) => s.tasks);
const titles = (input: TripInput) => tasks(input).map((t) => t.title);
const priorityOf = (input: TripInput, title: string) => tasks(input).find((t) => t.title === title)?.priority;

describe('getStandardSectionsFor', () => {
  it('includes vehicle readiness only for self-driven transport', () => {
    expect(getStandardSectionsFor('car')).toContain('vehicle');
    expect(getStandardSectionsFor('bike')).toContain('vehicle');
    expect(getStandardSectionsFor('mixed')).toContain('vehicle');
    expect(getStandardSectionsFor('flight')).not.toContain('vehicle');
    expect(getStandardSectionsFor('train')).toEqual(STANDARD_SECTION_KINDS.filter((s) => s !== 'vehicle'));
  });
});

describe('buildStarterChecklist', () => {
  it('covers every applicable standard section except Packing (packing lives in the Packing list), in order', () => {
    expect(kinds(base)).toEqual(getStandardSectionsFor('train').filter((k) => k !== 'packing'));
    expect(kinds({ ...base, transportMode: 'car' })).toEqual(getStandardSectionsFor('car').filter((k) => k !== 'packing'));
    expect(kinds(base)).not.toContain('packing');
  });

  it('tailors tasks to transport, duration, category and travellers', () => {
    // Packing starter tasks are no longer part of a new trip's checklist…
    expect(titles(base)).not.toContain('Clothes for 3 days');
    // …but the Packing section can still be built on request (e.g. by a template or an explicit add).
    const packingTitles = (t: typeof base) => buildStarterSection('packing', t).sections[0]?.tasks.map((x) => x.title) ?? [];
    expect(packingTitles(base)).toContain('Clothes for 3 days');
    expect(titles(base)).toContain('Train e-ticket and PNR saved offline');
    expect(titles({ ...base, transportMode: 'car' })).toContain('Top up FASTag balance');
    expect(titles({ ...base, transportMode: 'bike' })).toContain('Lubricate and adjust the chain');
    expect(packingTitles({ ...base, category: 'mountains' })).toContain('Warm layers and rain jacket');
    expect(packingTitles({ ...base, travellers: [...base.travellers, { name: 'C', kind: 'child' }] })).toContain(
      "Kids' clothes, snacks and comfort items",
    );
    expect(titles(base)).not.toContain('Driving licence');
  });

  it('assigns priorities: IDs and tickets are essential, extras optional', () => {
    expect(priorityOf(base, 'Government photo ID for every traveller (Aadhaar, PAN or passport)')).toBe('essential');
    expect(priorityOf(base, 'Train e-ticket and PNR saved offline')).toBe('essential');
    expect(buildStarterSection('packing', base).sections[0]?.tasks.find((t) => t.title === 'Toiletries kit')?.priority).toBe('recommended');
    expect(priorityOf(base, 'Snacks for the journey')).toBe('optional');
    expect(new Set(tasks(base).map((t) => t.priority))).toEqual(new Set(['essential', 'recommended', 'optional']));
  });

  it('never produces empty or duplicate titles within a section', () => {
    for (const mode of ['car', 'bike', 'train', 'bus', 'flight', 'mixed'] as const) {
      const plan = buildStarterChecklist({ ...base, transportMode: mode, category: 'wedding' });
      for (const section of plan.sections) {
        const sectionTitles = section.tasks.map((t) => t.title);
        expect(new Set(sectionTitles).size).toBe(sectionTitles.length);
        expect(sectionTitles.every((t) => t.trim().length > 0)).toBe(true);
      }
    }
  });

  it('builds a single section on request', () => {
    const plan = buildStarterSection('vehicle', { ...base, transportMode: 'car' });
    expect(plan.sections).toHaveLength(1);
    expect(plan.sections[0]?.kind).toBe('vehicle');
    expect(plan.sections[0]?.tasks.length).toBeGreaterThan(0);
  });
});
