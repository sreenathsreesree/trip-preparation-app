import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { setupRepositories, tripInput } from '../../../../test/fixtures';
import { createDayPlanRepository } from '../../planner/dayPlanRepository';
import { applyDraft } from '../applyDraft';
import { explainResult } from '../explain';
import { classify, findDates, matchExisting, parseItinerary, placeName } from '../itinerary';
import { createPdfImportRepository } from '../pdfImportRepository';
import { extractPdfText, parseCMap } from '../pdfText';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, '../../../../test/pdf', name)));

/** A minimal hand-written PDF: uncompressed, one-byte font, one page. */
function simplePdf(lines: string[]): Uint8Array {
  const content = `BT /F1 12 Tf 72 720 Td ${lines.map((l, i) => `${i ? '0 -16 Td ' : ''}(${l.replace(/[()\\]/g, '\\$&')}) Tj`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  objs.forEach((o, i) => (pdf += `${i + 1} 0 obj\n${o}\nendobj\n`));
  return new Uint8Array(Buffer.from(`${pdf}trailer << /Root 1 0 R >>\n%%EOF`, 'latin1'));
}

describe('reading PDFs on the device', () => {
  it('reads a multi-page browser-made PDF (compressed, Unicode fonts, tables) in order', () => {
    const r = extractPdfText(fixture('itinerary-chrome.pdf'));
    expect(r.pages).toHaveLength(2);
    expect(r.looksScanned).toBe(false);
    expect(r.pages[0]).toContain('Day 1 – Kochi to Munnar (21 Nov 2026)');
    expect(r.pages[0]).toContain('Visit Cheeyappara Waterfalls en route');
    expect(r.pages[0]).toContain('09:00 Eravikulam National Park');
    expect(r.pages[1]).toContain('Day 3 – Munnar to Alleppey');
  });

  it('reads a simple uncompressed PDF', () => {
    expect(extractPdfText(simplePdf(['Day 1 - Goa', 'Visit Fort Aguada (Sinquerim)'])).text).toBe('Day 1 - Goa\nVisit Fort Aguada (Sinquerim)');
  });

  it('recognises a scanned (image-only) PDF instead of inventing text', () => {
    expect(extractPdfText(fixture('scanned-image-only.pdf')).looksScanned).toBe(true);
  });

  it('refuses a file that is not a PDF', () => {
    expect(() => extractPdfText(new Uint8Array(Buffer.from('hello')))).toThrow('not a PDF');
  });

  it('parses ToUnicode maps (single codes and ranges)', () => {
    const { map, bytes } = parseCMap('begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfchar <0003> <0020> endbfchar 1 beginbfrange <0024> <0026> <0041> endbfrange');
    expect(bytes).toBe(2);
    expect([map.get(3), map.get(0x24), map.get(0x26)]).toEqual([' ', 'A', 'C']);
  });
});

describe('turning itinerary text into a draft', () => {
  const draft = parseItinerary(extractPdfText(fixture('itinerary-chrome.pdf')).text);

  it('finds the trip name, dates and days, counting dates from Day 1', () => {
    expect([draft.tripName, draft.startDate, draft.endDate]).toEqual(['Kerala Getaway', '2026-11-20', '2026-11-23']);
    expect(draft.days.map((d) => [d.number, d.date, d.destination])).toEqual([
      [1, '2026-11-21', 'Munnar'],
      [2, '2026-11-22', 'Munnar'],
      [3, '2026-11-23', 'Alleppey'],
      [4, '2026-11-24', null],
    ]);
  });

  it('classifies places instead of making everything a destination', () => {
    const kinds = Object.fromEntries(draft.items.map((i) => [i.name, i.kind]));
    expect(kinds).toMatchObject({
      Munnar: 'destination',
      Alleppey: 'destination',
      'Cheeyappara Waterfalls': 'attraction',
      'Mattupetty Dam': 'attraction',
      'Echo Point': 'attraction',
      'Top Station viewpoint': 'attraction',
      'Tea County Resort': 'hotel',
      'Saravana Bhavan': 'restaurant',
      'Rapsy Restaurant': 'restaurant',
      'Cochin International Airport': 'transport',
      'Ernakulam Junction Railway Station': 'transport',
    });
    expect(draft.items.filter((i) => i.kind === 'destination')).toHaveLength(2);
    expect(draft.items.find((i) => i.kind === 'note')?.name).toMatch(/light jacket/);
    // Day order kept; transport and notes are offered but left out by default.
    expect(draft.items.filter((i) => i.day === 2).map((i) => i.name)).toEqual(['Eravikulam National Park', 'Rapsy Restaurant', 'Tea Museum', 'carry a light jacket, evenings are cold.']);
    expect(draft.items.find((i) => i.kind === 'transport')?.include).toBe(false);
  });

  it('helpers: dates in several formats, names without verbs and times', () => {
    expect(findDates('21 Nov 2026, Nov 22 2026, 2026-11-23 and 24/11/2026')).toEqual(['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24']);
    expect(placeName('09:00 Check in at Tea County Resort, Munnar')).toBe('Tea County Resort');
    expect(classify('Overnight stay on the houseboat')).toBe('hotel');
  });

  it('matches places the trip already has: exact names reused, near-matches flagged for the user', () => {
    const m = matchExisting(draft, [
      { id: 'n-munnar', name: 'munnar' },
      { id: 'n-dam', name: 'Mattupetty Dam Reservoir' },
    ]);
    expect(m.items.find((i) => i.name === 'Munnar')).toMatchObject({ match: { nodeId: 'n-munnar', certainty: 'exact' }, reuse: true });
    expect(m.items.find((i) => i.name === 'Mattupetty Dam')).toMatchObject({ match: { nodeId: 'n-dam', certainty: 'likely' }, reuse: false });
    expect(m.items.find((i) => i.name === 'Echo Point')?.match).toBeNull();
  });
});

describe('confirming an import', () => {
  async function setup() {
    const r = await setupRepositories();
    const trip = await r.trips.create(tripInput({ name: 'Kerala', destinations: [], startDate: '2026-11-20', endDate: '2026-11-24' }), { sections: [] });
    const munnar = (await r.planner.addNode(trip.id, { name: 'Munnar', parentId: null, addToRoute: true })).node;
    await r.companion.addNote(munnar.id, { kind: 'other', body: 'My own note' });
    const dayPlan = createDayPlanRepository(r.database);
    return { r, trip, munnar, dayPlan };
  }

  it('only adds: reuses the existing destination, nests the day’s places under it, plans days, keeps existing notes', async () => {
    const { r, trip, munnar, dayPlan } = await setup();
    const plan = await r.planner.load(trip.id);
    let draft = matchExisting(parseItinerary(extractPdfText(fixture('itinerary-chrome.pdf')).text), plan.nodes);
    draft = { ...draft, items: draft.items.map((i) => (i.kind === 'note' ? { ...i, include: true } : i)) };
    const summary = await applyDraft(trip.id, draft, { planner: r.planner, companion: r.companion, dayPlan });
    expect(summary).toMatchObject({ destinations: 1, reused: 1, notes: 1 });
    const after = await r.planner.load(trip.id);
    const byName = new Map(after.nodes.map((n) => [n.name, n]));
    expect(byName.get('Munnar')?.id).toBe(munnar.id);
    expect(after.nodes.filter((n) => n.name === 'Munnar')).toHaveLength(1);
    expect(byName.get('Mattupetty Dam')?.parentId).toBe(munnar.id);
    expect(byName.get('Tea Museum')?.parentId).toBe(munnar.id);
    expect(byName.get('Top Station viewpoint')?.parentId).toBe(byName.get('Alleppey')?.id);
    expect(byName.has('Cochin International Airport')).toBe(false); // left out by default
    const days = new Map((await dayPlan.list(trip.id)).map((d) => [d.nodeId, d]));
    expect(days.get(byName.get('Tea Museum')!.id)).toMatchObject({ dayNumber: 2, date: '2026-11-22' });
    const notes = (await r.companion.node(munnar.id)).notes.map((n) => n.body);
    expect(notes).toEqual(expect.arrayContaining(['My own note', 'carry a light jacket, evenings are cold.']));
  });

  it('a near-match the user chose to add as new is added; importing the same draft twice creates no duplicates', async () => {
    const { r, trip, dayPlan } = await setup();
    const draft = matchExisting(parseItinerary('Day 1 - Munnar\nVisit Mattupetty Dam\nEcho Point'), [{ id: 'x', name: 'Mattupetty Dam Area' }]);
    await applyDraft(trip.id, draft, { planner: r.planner, companion: r.companion, dayPlan });
    await applyDraft(trip.id, draft, { planner: r.planner, companion: r.companion, dayPlan });
    const nodes = (await r.planner.load(trip.id)).nodes;
    expect(nodes.filter((n) => n.name === 'Mattupetty Dam')).toHaveLength(1);
    expect(nodes.filter((n) => n.name === 'Echo Point')).toHaveLength(1);
  });

  it('drafts and the original file stay saved for later (offline) and after a failed read', async () => {
    const { r, trip } = await setup();
    const repo = createPdfImportRepository(r.database, { createId: r.deps.createId });
    const rec = await repo.create(trip.id, 'itinerary.pdf', null);
    await repo.setFile(rec.id, 'file:///docs/pdf-imports/x.pdf');
    await repo.update(rec.id, { status: 'failed', error: 'Could not read this PDF.' });
    const draft = parseItinerary('Day 1 - Munnar\nEcho Point');
    await repo.update(rec.id, { status: 'draft', draft, error: null });
    const back = await repo.get(rec.id);
    expect(back).toMatchObject({ status: 'draft', fileUri: 'file:///docs/pdf-imports/x.pdf', error: null });
    expect(back?.draft?.items.map((i) => i.name)).toEqual(['Munnar', 'Echo Point']);
    expect((await repo.list(trip.id)).map((x) => x.id)).toEqual([rec.id]);
  });
});

describe('more itinerary layouts', () => {
  const places = (text: string) => parseItinerary(text).items.filter((i) => i.kind !== 'note');

  it('reads date headings instead of “Day N”', () => {
    const d = parseItinerary('Kerala\nMon, 21 Nov 2026 – Kochi to Munnar\n• Cheeyappara Waterfalls\n22 Nov 2026: Munnar\n- Eravikulam National Park\n- Mattupetty Dam');
    expect(d.days.map((x) => [x.number, x.date, x.destination])).toEqual([
      [1, '2026-11-21', 'Munnar'],
      [2, '2026-11-22', 'Munnar'],
    ]);
    expect(places('Mon, 21 Nov 2026 – Kochi to Munnar\n• Cheeyappara Waterfalls').map((i) => [i.kind, i.name, i.day])).toEqual([
      ['destination', 'Munnar', 1],
      ['attraction', 'Cheeyappara Waterfalls', 1],
    ]);
  });

  it('reads “N nights” sections and ordinal days', () => {
    const d = parseItinerary('Munnar (2 Nights)\n• Tea Museum\n• Echo Point\nAlleppey – 1N\n• Houseboat cruise on the backwaters\n2nd Day | Thekkady\n• Periyar Lake boating');
    expect(d.items.filter((i) => i.kind === 'destination').map((i) => i.name)).toEqual(['Munnar', 'Alleppey', 'Thekkady']);
    expect(d.items.find((i) => i.name === 'Echo Point')?.day).toBe(d.items.find((i) => i.name === 'Munnar')?.day);
  });

  it('reads a plain bullet list: headings followed by bullets become destinations', () => {
    const d = parseItinerary('Our Kerala plan\nMunnar\n- Top Station viewpoint\n- Kolukkumalai Tea Estate\nAlleppey\n- Marari Beach');
    expect(d.items.filter((i) => i.kind === 'destination').map((i) => i.name)).toEqual(['Munnar', 'Alleppey']);
    const beach = d.items.find((i) => i.name === 'Marari Beach');
    expect(beach?.day).toBe(d.items.find((i) => i.name === 'Alleppey')?.day);
  });

  it('never silently drops lines: unrecognised text before the first day is kept as an unticked note', () => {
    const d = parseItinerary('Kerala trip\nPrepared by Sunny Travels for the Nair family\nDay 1 – Munnar\nTea Museum');
    expect(d.items.find((i) => i.kind === 'note' && /Sunny Travels/.test(i.name))).toMatchObject({ include: false, day: null });
  });

  it('offers place-like lines even when there are no sections at all', () => {
    const d = parseItinerary('Things to see\nAthirappilly Falls, Thrissur\nFort Kochi beach walk\nbuy spices');
    expect(d.items.filter((i) => i.kind !== 'note').map((i) => i.name)).toEqual(['Athirappilly Falls', 'Fort Kochi beach walk']);
  });
});

describe('more PDF structures', () => {
  const build = (objs: string[], trailer = '<< /Root 1 0 R >>') => {
    let pdf = '%PDF-1.4\n';
    objs.forEach((o, i) => (pdf += `${i + 1} 0 obj\n${o}\nendobj\n`));
    return new Uint8Array(Buffer.from(`${pdf}trailer ${trailer}\n%%EOF`, 'latin1'));
  };
  const stream = (s: string, extra = '') => `<< /Length ${s.length}${extra} >>\nstream\n${s}\nendstream`;

  it('reads text drawn inside form XObjects, with resources inherited from the page tree', () => {
    const form = 'BT /F1 12 Tf 72 700 Td (Day 1 - Munnar) Tj 0 -16 Td (Tea Museum) Tj ET';
    const pdf = build([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 /Resources << /Font << /F1 5 0 R >> /XObject << /Fm1 6 0 R >> >> >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
      stream('q /Fm1 Do Q'),
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      stream(form, ' /Type /XObject /Subtype /Form /BBox [0 0 612 792]'),
    ]);
    expect(extractPdfText(pdf).text).toBe('Day 1 - Munnar\nTea Museum');
  });

  it('explains encrypted PDFs instead of returning nothing', () => {
    const pdf = build(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [] /Count 0 >>', '<< /Filter /Standard /V 2 >>'], '<< /Root 1 0 R /Encrypt 3 0 R >>');
    expect(() => extractPdfText(pdf)).toThrow(/password-protected or encrypted/);
  });

  it('counts fonts whose text cannot be decoded', () => {
    const pdf = build([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      stream('BT /F1 12 Tf <00410042> Tj ET'),
      '<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H >>',
    ]);
    expect(extractPdfText(pdf).unreadableFonts).toBe(1);
  });
});

describe('explaining what was read', () => {
  it('says which pages had no text, which fonts could not be read, and what was kept as notes', () => {
    const draft = parseItinerary('Day 1 – Munnar\nTea Museum\nBring cash');
    const message = explainResult({ pages: ['Day 1 – Munnar Tea Museum', ''], unreadableFonts: 1 }, draft);
    expect(message).toMatch(/font without a text map/);
    expect(message).toMatch(/1 of 2 pages have no readable text/);
    expect(message).toMatch(/kept as unticked notes/);
    expect(explainResult({ pages: ['x'.repeat(40)], unreadableFonts: 0 }, parseItinerary('Day 1 – Munnar\nTea Museum'))).toBeNull();
  });
});
