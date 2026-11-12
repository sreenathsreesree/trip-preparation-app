/**
 * Phase N: cross-feature integration. One trip uses every feature (planner,
 * route, Navigation, destination companion, journal + photos + Drive queue,
 * shared space, expenses, settlements, budget); then the trip is duplicated
 * and deleted. The database must stay consistent: no orphan rows, no foreign
 * key violations, nothing from another trip touched.
 */
import { setupRepositories, tripInput } from '../../test/fixtures';

type Repos = Awaited<ReturnType<typeof setupRepositories>>;

async function fullTrip(repos: Repos, name: string) {
  const trip = await repos.trips.create(
    tripInput({ name, destinations: [], travellers: [{ name: 'Asha', kind: 'adult' }, { name: 'Ben', kind: 'adult' }] }),
    { sections: [{ kind: 'documents', title: 'Documents', tasks: [{ title: 'Passport', priority: 'essential' }] }] } as never,
  );
  const munnar = (await repos.planner.addNode(trip.id, { name: 'Munnar', parentId: null, addToRoute: true })).node;
  const echo = (await repos.planner.addNode(trip.id, { name: 'Echo Point', parentId: munnar.id, addToRoute: true })).node;
  await repos.companion.addToNavigation(trip.id, echo.id);
  await repos.companion.updateProfile(munnar.id, { saved: true, tags: ['Must visit'] });
  await repos.companion.addTask(munnar.id, { title: 'Book jeep' });
  await repos.companion.addNote(munnar.id, { kind: 'food', body: 'Tea' });
  await repos.companion.addAlert(munnar.id, { kind: 'info', title: 'Road work', source: 'Notice board' });
  await repos.companion.saveMemory(munnar.id, { visitedOn: '2026-12-20', rating: 5, photos: [`file:///${name}-memory.jpg`] });
  const entry = await repos.journal.create(trip.id, { entryDate: '2026-12-20', title: 'Day one', nodeId: munnar.id });
  const photo = await repos.journal.addPhoto(entry.id, `file:///${name}-journal.jpg`);
  await repos.journal.saveDriveRecord({ kind: 'photo', localId: photo.id, driveFileId: `drive-${name}`, contentHash: photo.id });
  await repos.photoUploads.enqueue({ accountId: 'acct', tripId: trip.id, source: 'journal', sourceId: photo.id, localUri: photo.uri, fileName: 'p.jpg' });
  await repos.photoUploads.enqueue({ accountId: 'acct', tripId: trip.id, source: 'memory', sourceId: munnar.id, localUri: `file:///${name}-memory.jpg`, fileName: 'm.jpg' });
  await repos.expenses.ensureParticipants(trip.id);
  const [a, b] = (await repos.expenses.workspace(trip.id)).participants.map((p) => p.id) as [string, string];
  await repos.expenses.saveExpense(trip.id, {
    scope: 'group',
    title: 'Boat',
    amountMinor: 1000,
    currency: 'INR',
    category: 'transport',
    spentOn: '2026-12-20',
    paidBy: a,
    splits: [{ participantId: a, value: 0 }, { participantId: b, value: 0 }],
  });
  await repos.expenses.saveExpense(trip.id, { scope: 'personal', title: 'Tea', amountMinor: 50, currency: 'INR', category: 'food', spentOn: '2026-12-20' });
  await repos.expenses.addSettlement(trip.id, { fromId: b, toId: a, amountMinor: 500, currency: 'INR', settledOn: '2026-12-21' });
  await repos.expenses.saveBudget(trip.id, { currency: 'INR', totalMinor: 5000, dailyLimitMinor: 1000, lines: [] });
  await repos.expenses.addCategory(trip.id, `Souvenirs ${name}`);
  return trip;
}

/** Every table that holds trip-owned rows, with how to find this trip's rows. */
const TRIP_TABLES: [string, string][] = [
  ['trip_destinations', 'trip_id = ?'],
  ['trip_travellers', 'trip_id = ?'],
  ['checklist_sections', 'trip_id = ?'],
  ['trip_plan_nodes', 'trip_id = ?'],
  ['trip_route_stops', 'trip_id = ?'],
  ['trip_navigation_items', 'trip_id = ?'],
  ['plan_node_profiles', 'trip_id = ?'],
  ['plan_node_tasks', 'trip_id = ?'],
  ['plan_node_notes', 'trip_id = ?'],
  ['plan_node_alerts', 'trip_id = ?'],
  ['plan_node_memories', 'trip_id = ?'],
  ['journal_entries', 'trip_id = ?'],
  ['drive_photo_uploads', 'trip_id = ?'],
  ['shared_spaces', 'trip_id = ?'],
  ['shared_outbox', 'trip_id = ?'],
  ['expense_participants', 'trip_id = ?'],
  ['expense_categories', 'trip_id = ?'],
  ['expenses', 'trip_id = ?'],
  ['expense_settlements', 'trip_id = ?'],
  ['expense_budgets', 'trip_id = ?'],
  ['expense_settings', 'trip_id = ?'],
  ['expense_outbox', 'trip_id = ?'],
];

const count = async (repos: Repos, table: string, where: string, id: string) =>
  (await repos.db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, [id]))?.n ?? 0;

async function assertConsistent(repos: Repos) {
  expect(await repos.db.getAllAsync('PRAGMA foreign_key_check', [])).toEqual([]);
  expect(await repos.db.getAllAsync('PRAGMA integrity_check', [])).toEqual([{ integrity_check: 'ok' }]);
  // Child tables without a trip_id must not outlive their parents.
  for (const [sql, label] of [
    ['SELECT COUNT(*) AS n FROM journal_photos p LEFT JOIN journal_entries e ON e.id = p.entry_id WHERE e.id IS NULL', 'journal_photos'],
    ['SELECT COUNT(*) AS n FROM expense_splits s LEFT JOIN expenses e ON e.id = s.expense_id WHERE e.id IS NULL', 'expense_splits'],
    ['SELECT COUNT(*) AS n FROM checklist_tasks k LEFT JOIN checklist_sections s ON s.id = k.section_id WHERE s.id IS NULL', 'checklist_tasks'],
  ] as const) {
    expect([label, (await repos.db.getFirstAsync<{ n: number }>(sql, []))?.n]).toEqual([label, 0]);
  }
}

describe('cross-feature integration', () => {
  it('a trip using every feature is consistent, can be duplicated, and deletes cleanly without touching other trips', async () => {
    const repos = await setupRepositories();
    const kerala = await fullTrip(repos, 'Kerala');
    const goa = await fullTrip(repos, 'Goa');
    // The delete warning names everything personal that goes with the trip.
    expect(await repos.trips.deletionImpact(kerala.id)).toMatchObject({ journalEntries: 1, photos: 2, expenses: 2, settlements: 1, sharedRole: null });
    await repos.sharing.linkSpace({ tripId: kerala.id, cloudTripId: 'cloud-k', accountId: 'acct', role: 'owner', displayName: 'Asha' });
    expect((await repos.trips.deletionImpact(kerala.id)).sharedRole).toBe('owner');
    await repos.expenses.enqueueAll(kerala.id);
    await assertConsistent(repos);
    for (const [table, where] of TRIP_TABLES.filter(([t]) => !['shared_spaces', 'shared_outbox', 'expense_outbox', 'expense_settings', 'trip_destinations'].includes(t))) {
      expect([table, (await count(repos, table, where, kerala.id)) > 0]).toEqual([table, true]);
    }

    // Duplicating copies the plan, never personal records (journal, memories, expenses) or sharing.
    const copy = await repos.trips.duplicate(kerala.id);
    for (const table of ['journal_entries', 'expenses', 'expense_settlements', 'shared_spaces', 'drive_photo_uploads', 'plan_node_memories']) {
      expect([table, await count(repos, table, 'trip_id = ?', copy.id)]).toEqual([table, 0]);
    }
    expect(await count(repos, 'trip_plan_nodes', 'trip_id = ?', copy.id)).toBe(2);

    const goaBefore: Record<string, number> = {};
    for (const [table, where] of TRIP_TABLES) goaBefore[table] = await count(repos, table, where, goa.id);

    expect(await repos.trips.remove(kerala.id)).toBe(true);
    for (const [table, where] of TRIP_TABLES) expect([table, await count(repos, table, where, kerala.id)]).toEqual([table, 0]);
    for (const [table, where] of TRIP_TABLES) expect([table, await count(repos, table, where, goa.id)]).toEqual([table, goaBefore[table]]);
    await assertConsistent(repos);
  });

  it('deleting a destination keeps the journal entry (unlinked) and the trip consistent', async () => {
    const repos = await setupRepositories();
    const trip = await fullTrip(repos, 'Kerala');
    const munnar = (await repos.planner.load(trip.id)).nodes.find((n) => n.name === 'Munnar')!;
    await repos.planner.removeNode(munnar.id, 'withChildren');
    expect((await repos.journal.list(trip.id)).map((e) => [e.title, e.nodeId])).toEqual([['Day one', null]]);
    await assertConsistent(repos);
  });
});
