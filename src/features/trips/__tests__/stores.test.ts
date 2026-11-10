import { setupRepositories, tripInput } from '../../../../test/fixtures';
import { useChecklistStore } from '../../preparation/checklistStore';
import { tripOwner, type ChecklistOwner } from '../../preparation/model';
import { getDepartureStatus, readinessPercent } from '../../preparation/readiness';
import { useTemplatesStore } from '../../preparation/templatesStore';
import { useTripsStore } from '../tripsStore';

// Point the stores at an in-memory SQLite database instead of expo-sqlite.
const mockState: { repos: unknown; fail: boolean } = { repos: null, fail: false };
jest.mock('@/db/repositories', () => ({
  getRepositories: async () => {
    if (mockState.fail) throw new Error('disk unavailable');
    return mockState.repos;
  },
}));

const input = tripInput({ transportMode: 'bike', category: 'mountains' });

beforeEach(async () => {
  const repos = await setupRepositories();
  mockState.repos = repos;
  mockState.fail = false;
  useTripsStore.setState({ trips: [], status: 'idle', error: null });
  useChecklistStore.setState({ byOwner: {} });
  useTemplatesStore.setState({ templates: [], status: 'idle', error: null });
});

const tripIn = (id: string) => useTripsStore.getState().trips.find((t) => t.id === id);
const checklistOf = (owner: ChecklistOwner) => useChecklistStore.getState().byOwner[`${owner.type}:${owner.id}`];

describe('trips store', () => {
  it('loads, creates, edits, duplicates and removes trips', async () => {
    await useTripsStore.getState().load();
    expect(useTripsStore.getState()).toMatchObject({ status: 'ready', trips: [] });

    const trip = await useTripsStore.getState().create(input, { withStarterChecklist: true });
    expect(trip.readiness.total).toBeGreaterThan(0);

    const edited = await useTripsStore.getState().update(trip.id, { ...input, name: 'Ladakh loop' });
    expect(tripIn(trip.id)?.name).toBe('Ladakh loop');
    expect(edited.readiness).toEqual(trip.readiness);

    const copy = await useTripsStore.getState().duplicate(trip.id);
    expect(useTripsStore.getState().trips.map((t) => t.id).sort()).toEqual([trip.id, copy.id].sort());

    await useTripsStore.getState().remove(trip.id);
    expect(useTripsStore.getState().trips.map((t) => t.id)).toEqual([copy.id]);
  });

  it('starts a trip with empty standard sections when the starter checklist is off', async () => {
    const trip = await useTripsStore.getState().create(input, { withStarterChecklist: false });
    expect(trip.readiness.total).toBe(0);
    await useChecklistStore.getState().load(tripOwner(trip.id));
    expect(checklistOf(tripOwner(trip.id))?.sections.map((s) => s.kind)).toEqual([
      'packing',
      'documents',
      'vehicle',
      'tasks',
      'shopping',
      'home',
    ]);
  });

  it('creates a trip from selected templates', async () => {
    const template = await useTemplatesStore.getState().create({ name: 'Camera kit', description: '' });
    await useChecklistStore.getState().load({ type: 'template', id: template.id });
    const section = await useChecklistStore.getState().addSection({ type: 'template', id: template.id }, 'Camera');
    await useChecklistStore.getState().addTask({ type: 'template', id: template.id }, section.id, {
      title: 'Spare SD card',
      description: '',
      notes: '',
      priority: 'essential',
    });

    const trip = await useTripsStore
      .getState()
      .create(input, { withStarterChecklist: false, templateIds: [template.id] });
    expect(trip.readiness.essential.total).toBe(1);
    expect(useTemplatesStore.getState().templates[0]?.taskCount).toBe(1);
  });

  it('archives, restores and completes trips', async () => {
    const trip = await useTripsStore.getState().create(input, { withStarterChecklist: false });
    await useTripsStore.getState().setArchived(trip.id, true);
    expect(tripIn(trip.id)?.archivedAt).not.toBeNull();
    await useTripsStore.getState().setArchived(trip.id, false);
    expect(tripIn(trip.id)?.archivedAt).toBeNull();
    await useTripsStore.getState().setCompleted(trip.id, true);
    expect(tripIn(trip.id)?.completedAt).not.toBeNull();
  });

  it('exposes load failures as an error state', async () => {
    mockState.fail = true;
    await useTripsStore.getState().load();
    expect(useTripsStore.getState()).toMatchObject({ status: 'error', error: 'disk unavailable' });
  });
});

describe('checklist store', () => {
  it('updates trip readiness immediately when tasks change', async () => {
    const trip = await useTripsStore.getState().create(input, { withStarterChecklist: true });
    const owner = tripOwner(trip.id);
    await useChecklistStore.getState().load(owner);
    const essentials = checklistOf(owner)?.tasks.filter((t) => t.priority === 'essential') ?? [];
    expect(getDepartureStatus(tripIn(trip.id)?.readiness ?? trip.readiness)).toBe('blocked');

    // Toggle is optimistic: readiness updates before the write resolves.
    const pending = Promise.all(essentials.map((t) => useChecklistStore.getState().toggleTask(owner, t.id)));
    expect(tripIn(trip.id)?.readiness.essential.done).toBe(essentials.length);
    await pending;
    expect(getDepartureStatus(tripIn(trip.id)?.readiness ?? trip.readiness)).toBe('ready');

    // Optional tasks never block readiness.
    const optional = checklistOf(owner)?.tasks.find((t) => t.priority === 'optional');
    await useChecklistStore.getState().addTask(owner, optional?.sectionId ?? '', {
      title: 'Optional extra',
      description: '',
      notes: '',
      priority: 'optional',
    });
    const readinessBefore = readinessPercent(tripIn(trip.id)?.readiness ?? trip.readiness);
    expect(getDepartureStatus(tripIn(trip.id)?.readiness ?? trip.readiness)).toBe('ready');
    expect(readinessPercent(tripIn(trip.id)?.readiness ?? trip.readiness)).toBe(readinessBefore);

    // The database agrees with the optimistic state.
    const optimistic = tripIn(trip.id)?.readiness;
    await useTripsStore.getState().load();
    expect(tripIn(trip.id)?.readiness).toEqual(optimistic);
  });

  it('reverts an optimistic toggle when the write fails', async () => {
    const trip = await useTripsStore.getState().create(input, { withStarterChecklist: true });
    const owner = tripOwner(trip.id);
    await useChecklistStore.getState().load(owner);
    const task = checklistOf(owner)?.tasks[0];
    if (!task) throw new Error('expected a task');

    mockState.fail = true;
    await expect(useChecklistStore.getState().toggleTask(owner, task.id)).rejects.toThrow('disk unavailable');
    expect(checklistOf(owner)?.tasks[0]?.isDone).toBe(false);
    expect(tripIn(trip.id)?.readiness.done).toBe(0);
  });

  it('applies templates to an existing trip and reports what was added', async () => {
    const trip = await useTripsStore.getState().create(input, { withStarterChecklist: true });
    const template = await useTemplatesStore.getState().create({ name: 'Extras', description: '' });
    const templateRef = { type: 'template' as const, id: template.id };
    const section = await useChecklistStore.getState().addSection(templateRef, 'Packing');
    await useChecklistStore.getState().addTask(templateRef, section.id, {
      title: 'Toiletries kit', // already on the starter checklist
      description: '',
      notes: '',
      priority: 'recommended',
    });
    await useChecklistStore.getState().addTask(templateRef, section.id, {
      title: 'Binoculars',
      description: '',
      notes: '',
      priority: 'optional',
    });

    const before = tripIn(trip.id)?.readiness.total ?? 0;
    const result = await useChecklistStore.getState().applyTemplates(trip.id, [template.id]);
    expect(result).toEqual({ added: 1, skipped: 1, sectionsAdded: 0 });
    expect(tripIn(trip.id)?.readiness.total).toBe(before + 1);
  });
});
