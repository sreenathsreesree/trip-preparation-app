import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { AppText, Button, Card, EmptyState, IconButton, Notice, OptionTile, SegmentedControl, TextField } from '@/components/ui';
import { getRepositories } from '@/db/repositories';
import { useAuthStore } from '@/features/auth/authStore';
import { formatDate } from '@/lib/dates';
import { toErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme';

import { journeyLegs } from '../places/mapsLinks';
import { canTargetMapsApp, openInMapsApp, openMapsUrl } from '../places/openMaps';
import { usePlannerStore } from '../planner/plannerStore';
import { useSharingStore, useTripSharing } from '../sharing/sharingStore';
import type { GroupItem, GroupKind } from './groupRepository';
import { asGroupPlace, copyGroupItinerary, groupRoute, planToGroupPlaces } from './itinerary';

type Section = 'itinerary' | 'checklist' | 'documents' | 'notes' | 'members';

export const SHARED_DOC_TYPES = [
  { value: 'hotel', label: 'Hotel' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'transport_ticket', label: 'Transport ticket' },
  { value: 'group_ticket', label: 'Group ticket' },
  { value: 'epass', label: 'E-pass' },
  { value: 'activity', label: 'Activity booking' },
  { value: 'other', label: 'Other' },
] as const;

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function ConflictBanner({ item, onResolve }: { item: GroupItem; onResolve: (c: 'mine' | 'theirs') => void }) {
  if (!item.conflict) return null;
  return (
    <View style={styles.group} testID={`group-conflict-${item.id}`}>
      <Notice
        tone="warning"
        title={`${item.conflict.authorName || 'Another member'} changed this too`}
        message={`Theirs: ${str(item.conflict.data.title ?? item.conflict.data.name ?? item.conflict.data.body)}${item.conflict.deleted ? ' (removed)' : ''}. Nothing was overwritten — choose which to keep.`}
      />
      <View style={styles.row}>
        <Button label="Keep mine" size="sm" onPress={() => onResolve('mine')} testID={`group-keep-mine-${item.id}`} />
        <Button label="Take theirs" size="sm" variant="ghost" onPress={() => onResolve('theirs')} testID={`group-take-theirs-${item.id}`} />
      </View>
    </View>
  );
}

/**
 * Group Trip: what the members of a shared trip share — itinerary, route and
 * navigation, group checklist, documents and bookings, notes, and who is
 * ready. Private preparation stays in My Trip. Owners and editors change it;
 * viewers read it; everyone sets their own "ready".
 */
export function GroupTripScreen({ tripId }: { tripId: string }) {
  const sharing = useTripSharing(tripId);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [section, setSection] = useState<Section>('itinerary');
  const [items, setItems] = useState<GroupItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const role = sharing.space?.role ?? null;
  const canEdit = role === 'owner' || role === 'editor';
  const me = { id: userId ?? '', displayName: sharing.space?.displayName ?? '' };

  const reload = useCallback(async () => {
    const { group } = await getRepositories();
    setItems(await group.list(tripId, undefined, { includeDeleted: false }));
  }, [tripId]);
  useFocusEffect(
    useCallback(() => {
      void useSharingStore.getState().load(tripId);
      void reload();
    }, [tripId, reload]),
  );

  const run = (fn: () => Promise<unknown>, ok?: string) => {
    setError(null);
    setNotice(null);
    fn()
      .then(async () => {
        await reload();
        if (ok) setNotice(ok);
        void useSharingStore
          .getState()
          .sync(tripId)
          .then(reload)
          .catch(() => undefined);
      })
      .catch((e: unknown) => setError(toErrorMessage(e, 'Not saved.')));
  };
  const save = (kind: GroupKind, data: Record<string, unknown>, id?: string) =>
    run(async () => {
      const { group } = await getRepositories();
      await group.save(tripId, { id, kind, data }, me);
    });
  const remove = (id: string) =>
    run(async () => {
      const { group } = await getRepositories();
      await group.remove(tripId, id);
    });
  const resolve = (id: string, choice: 'mine' | 'theirs') =>
    run(async () => {
      const { group } = await getRepositories();
      await group.resolve(tripId, id, choice);
    });

  const of = (kind: GroupKind) => items.filter((i) => i.kind === kind);
  const places = useMemo(() => items.filter((i) => i.kind === 'place').map((i) => ({ item: i, p: asGroupPlace(i) })), [items]);
  const route = useMemo(() => groupRoute(items), [items]);
  const ready = of('readiness');
  const myReady = ready.find((r) => r.id === userId)?.data.ready === true;
  const pendingCount = items.filter((i) => i.pending).length;

  if (!sharing.space || role === 'removed') {
    return (
      <Screen testID="group-trip-screen">
        <ScreenHeader showBack title="Group Trip" />
        <EmptyState
          icon="account-group-outline"
          title={role === 'removed' ? 'You are no longer a member' : 'This trip is not shared'}
          message={role === 'removed' ? 'Your own copy of the trip stays in My Trip.' : 'Share the trip to plan it together. Your private preparation stays in My Trip.'}
          action={role === 'removed' ? undefined : { label: 'Share this trip', icon: 'account-plus-outline', onPress: () => router.push({ pathname: '/trips/[tripId]/share', params: { tripId } }) }}
          testID="group-not-shared"
        />
      </Screen>
    );
  }

  const navigate = () =>
    run(async () => {
      // Only names and coordinates are used for the Maps link (same builder as Navigation).
      const stops = route.filter((r) => !r.visited) as unknown as Parameters<typeof journeyLegs>[0];
      const legs = journeyLegs(stops, canTargetMapsApp ? 'app' : 'browser');
      if (!legs[0]) throw new Error('The group route has no stops yet.');
      if (!(await openInMapsApp(legs[0].url))) await openMapsUrl(journeyLegs(stops, 'browser')[0]!.url);
    });

  return (
    <Screen testID="group-trip-screen">
      <ScreenHeader showBack eyebrow={`Group Trip · ${role}`} title="Plan together" subtitle="Shared with every member. Private preparation stays in My Trip." />
      {!canEdit ? <Notice tone="info" title="View only" message="Viewers can read the Group Trip and set whether they are ready." testID="group-viewer" /> : null}
      {pendingCount > 0 ? (
        <AppText variant="caption" tone="textMuted" testID="group-pending">
          {pendingCount} change(s) waiting to sync{sharing.error ? ` — ${sharing.error}` : ''}.
        </AppText>
      ) : null}
      {error ? <Notice tone="danger" title={error} testID="group-error" /> : null}
      {notice ? <Notice tone="success" title={notice} testID="group-notice" /> : null}
      <SegmentedControl
        options={[
          { value: 'itinerary', label: 'Plan' },
          { value: 'checklist', label: 'Tasks' },
          { value: 'documents', label: 'Docs' },
          { value: 'notes', label: 'Notes' },
          { value: 'members', label: 'People' },
        ]}
        value={section}
        onChange={setSection}
        accessibilityLabel="Group Trip section"
      />

      {section === 'itinerary' ? (
        <View style={styles.group} testID="group-itinerary">
          {canEdit ? (
            <Button
              label="Publish my plan to the group"
              icon="upload-outline"
              variant="secondary"
              onPress={() =>
                run(async () => {
                  const { planner, dayPlan, group } = await getRepositories();
                  const plan = await planner.load(tripId);
                  const days = await dayPlan.list(tripId);
                  for (const p of planToGroupPlaces(plan, days)) await group.save(tripId, { id: p.id, kind: 'place', data: p.data as unknown as Record<string, unknown> }, me);
                }, 'Plan shared: names, nesting, route order, days and locations only. Your notes, memories and photos stay private.')
              }
              testID="group-publish"
            />
          ) : null}
          {places.length === 0 ? (
            <AppText variant="caption" tone="textMuted" testID="group-itinerary-empty">
              No shared itinerary yet.{canEdit ? ' Publish your plan to share it.' : ''}
            </AppText>
          ) : (
            <>
              {route.length > 0 ? (
                <Card>
                  <View style={styles.group}>
                    <AppText variant="label" tone="textSecondary">
                      Shared route
                    </AppText>
                    {route.map((r, i) => (
                      <View key={r.id} style={styles.row} testID={`group-route-${r.name}`}>
                        <AppText variant="body" tone={r.visited ? 'textMuted' : 'textPrimary'} style={styles.flex}>
                          {i + 1}. {r.name}
                          {r.visited ? ' · visited' : ''}
                          {r.place?.location ? '' : ' · no location'}
                        </AppText>
                        {canEdit ? (
                          <IconButton
                            icon={r.visited ? 'undo' : 'check-circle-outline'}
                            size="sm"
                            variant="plain"
                            tone="accent"
                            accessibilityLabel={r.visited ? `Mark ${r.name} as upcoming for the group` : `Mark ${r.name} as visited for the group`}
                            onPress={() => {
                              const item = items.find((x) => x.id === r.id);
                              if (item) save('place', { ...item.data, visited: !r.visited }, r.id);
                            }}
                            testID={`group-visit-${r.name}`}
                          />
                        ) : null}
                      </View>
                    ))}
                    <Button label="Navigate the group route" icon="navigation-variant" size="sm" onPress={navigate} testID="group-navigate" />
                  </View>
                </Card>
              ) : null}
              {places
                .filter((x) => x.p.parentId === null)
                .sort((a, b) => a.p.position - b.p.position)
                .map(({ item, p }) => (
                  <Card key={item.id} testID={`group-place-${p.name}`}>
                    <ConflictBanner item={item} onResolve={(c) => resolve(item.id, c)} />
                    <AppText variant="bodyStrong">{p.name}</AppText>
                    <AppText variant="caption" tone="textMuted">
                      {[p.day ? `Day ${p.day}` : '', p.date ? formatDate(p.date) : ''].filter(Boolean).join(' · ') || 'No day set'}
                    </AppText>
                    {places
                      .filter((c) => c.p.parentId === item.id)
                      .map((c) => (
                        <AppText key={c.item.id} variant="caption" tone="textSecondary">
                          • {c.p.name}
                        </AppText>
                      ))}
                  </Card>
                ))}
              <Button
                label="Add the group plan to My Trip"
                icon="content-copy"
                variant="ghost"
                onPress={() =>
                  run(async () => {
                    const { planner, dayPlan, group } = await getRepositories();
                    const r = await copyGroupItinerary(tripId, await group.list(tripId, 'place'), { planner, dayPlan });
                    await usePlannerStore.getState().load(tripId);
                    setNotice(`${r.added} places added to your plan, ${r.reused} already there. Nothing was removed.`);
                  })
                }
                testID="group-copy-plan"
              />
            </>
          )}
        </View>
      ) : null}

      {section === 'checklist' ? (
        <View style={styles.group} testID="group-checklist">
          {of('checklist').map((item) => (
            <View key={item.id} style={styles.line} testID={`group-task-${str(item.data.title)}`}>
              <ConflictBanner item={item} onResolve={(c) => resolve(item.id, c)} />
              <View style={styles.row}>
                <IconButton
                  icon={item.data.done ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  tone={item.data.done ? 'accent' : 'textMuted'}
                  accessibilityLabel={`${item.data.done ? 'Not done' : 'Done'}: ${str(item.data.title)}`}
                  onPress={() => canEdit && save('checklist', { ...item.data, done: !item.data.done }, item.id)}
                  disabled={!canEdit}
                  testID={`group-task-toggle-${str(item.data.title)}`}
                />
                <View style={styles.flex}>
                  <AppText variant="body">{str(item.data.title)}</AppText>
                  <AppText variant="caption" tone="textMuted">
                    {[item.data.assignee ? `For ${sharing.members.find((m) => m.userId === item.data.assignee)?.displayName ?? 'a member'}` : '', `Added by ${item.authorName || 'a member'}`].filter(Boolean).join(' · ')}
                  </AppText>
                </View>
                {canEdit ? <IconButton icon="close" size="sm" variant="plain" accessibilityLabel={`Remove ${str(item.data.title)}`} onPress={() => remove(item.id)} /> : null}
              </View>
            </View>
          ))}
          {canEdit ? (
            <Card>
              <View style={styles.group}>
                <TextField label="Group task (e.g. hotel confirmation)" value={draft.task ?? ''} onChangeText={(v) => setDraft((d) => ({ ...d, task: v }))} maxLength={120} testID="group-task-input" />
                <View style={styles.chips}>
                  {sharing.members.map((m) => (
                    <OptionTile key={m.userId} layout="chip" icon="account-outline" label={m.displayName || 'Member'} selected={draft.assignee === m.userId} onPress={() => setDraft((d) => ({ ...d, assignee: d.assignee === m.userId ? '' : m.userId }))} />
                  ))}
                </View>
                <Button
                  label="Add to group checklist"
                  size="sm"
                  disabled={!draft.task?.trim()}
                  onPress={() => {
                    save('checklist', { title: draft.task!.trim(), done: false, assignee: draft.assignee || null });
                    setDraft((d) => ({ ...d, task: '', assignee: '' }));
                  }}
                  testID="group-task-add"
                />
              </View>
            </Card>
          ) : null}
          <AppText variant="caption" tone="textMuted">
            Your personal packing and checklist are in My Trip and are never shared.
          </AppText>
        </View>
      ) : null}

      {section === 'documents' ? (
        <View style={styles.group} testID="group-documents">
          {of('document').map((item) => (
            <Card key={item.id} testID={`group-doc-${str(item.data.title)}`}>
              <ConflictBanner item={item} onResolve={(c) => resolve(item.id, c)} />
              <View style={styles.row}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">{str(item.data.title)}</AppText>
                  <AppText variant="caption" tone="textMuted">
                    {[SHARED_DOC_TYPES.find((t) => t.value === item.data.type)?.label, str(item.data.date) ? formatDate(str(item.data.date)) : '', str(item.data.reference) ? `Ref ${str(item.data.reference)}` : '', str(item.data.place), str(item.data.expiry) ? `Expires ${formatDate(str(item.data.expiry))}` : '', `By ${item.authorName || 'a member'}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </AppText>
                  {str(item.data.link) ? (
                    <AppText variant="caption" tone="info" onPress={() => void openMapsUrl(str(item.data.link))}>
                      {str(item.data.link)}
                    </AppText>
                  ) : null}
                </View>
                {canEdit ? <IconButton icon="close" size="sm" variant="plain" accessibilityLabel={`Remove ${str(item.data.title)}`} onPress={() => remove(item.id)} /> : null}
              </View>
            </Card>
          ))}
          {canEdit ? (
            <Card>
              <View style={styles.group}>
                <TextField label="Title (e.g. hotel booking)" value={draft.docTitle ?? ''} onChangeText={(v) => setDraft((d) => ({ ...d, docTitle: v }))} maxLength={120} testID="group-doc-title" />
                <View style={styles.chips}>
                  {SHARED_DOC_TYPES.map((t) => (
                    <OptionTile key={t.value} layout="chip" icon="file-document-outline" label={t.label} selected={(draft.docType ?? 'hotel') === t.value} onPress={() => setDraft((d) => ({ ...d, docType: t.value }))} testID={`group-doc-type-${t.value}`} />
                  ))}
                </View>
                <TextField label="Date (YYYY-MM-DD, optional)" value={draft.docDate ?? ''} onChangeText={(v) => setDraft((d) => ({ ...d, docDate: v }))} testID="group-doc-date" />
                <TextField label="Reference / booking number" value={draft.docRef ?? ''} onChangeText={(v) => setDraft((d) => ({ ...d, docRef: v }))} maxLength={80} testID="group-doc-ref" />
                <TextField label="Place" value={draft.docPlace ?? ''} onChangeText={(v) => setDraft((d) => ({ ...d, docPlace: v }))} maxLength={80} />
                <TextField label="Link to the file (optional, e.g. a shared Drive link)" value={draft.docLink ?? ''} onChangeText={(v) => setDraft((d) => ({ ...d, docLink: v }))} maxLength={500} autoCapitalize="none" />
                <Button
                  label="Share with the group"
                  size="sm"
                  disabled={!draft.docTitle?.trim() || (!!draft.docDate && !DATE.test(draft.docDate))}
                  onPress={() => {
                    save('document', { title: draft.docTitle!.trim(), type: draft.docType ?? 'hotel', date: draft.docDate || null, reference: draft.docRef ?? '', place: draft.docPlace ?? '', link: draft.docLink ?? '', expiry: null });
                    setDraft((d) => ({ ...d, docTitle: '', docDate: '', docRef: '', docPlace: '', docLink: '' }));
                  }}
                  testID="group-doc-add"
                />
                <AppText variant="caption" tone="textMuted">
                  Passports, IDs, insurance and medical papers can’t be shared here — keep them in My Trip.
                </AppText>
              </View>
            </Card>
          ) : null}
        </View>
      ) : null}

      {section === 'notes' ? (
        <View style={styles.group} testID="group-notes">
          {of('note').map((item) => (
            <Card key={item.id} testID={`group-note-${str(item.data.title)}`}>
              <ConflictBanner item={item} onResolve={(c) => resolve(item.id, c)} />
              <View style={styles.row}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">{str(item.data.title)}</AppText>
                  <AppText variant="body">{str(item.data.body)}</AppText>
                  <AppText variant="caption" tone="textMuted">
                    {item.authorName || 'A member'} · {formatDate(item.updatedAt.slice(0, 10))}
                    {item.pending ? ' · not synced yet' : ''}
                  </AppText>
                </View>
                {canEdit ? <IconButton icon="close" size="sm" variant="plain" accessibilityLabel={`Remove note ${str(item.data.title)}`} onPress={() => remove(item.id)} /> : null}
              </View>
            </Card>
          ))}
          {canEdit ? (
            <Card>
              <View style={styles.group}>
                <TextField label="Note title (e.g. meeting point)" value={draft.noteTitle ?? ''} onChangeText={(v) => setDraft((d) => ({ ...d, noteTitle: v }))} maxLength={120} testID="group-note-title" />
                <TextField label="Note" value={draft.noteBody ?? ''} onChangeText={(v) => setDraft((d) => ({ ...d, noteBody: v }))} multiline maxLength={4000} testID="group-note-body" />
                <Button
                  label="Add group note"
                  size="sm"
                  disabled={!draft.noteTitle?.trim()}
                  onPress={() => {
                    save('note', { title: draft.noteTitle!.trim(), body: draft.noteBody ?? '' });
                    setDraft((d) => ({ ...d, noteTitle: '', noteBody: '' }));
                  }}
                  testID="group-note-add"
                />
              </View>
            </Card>
          ) : null}
          <AppText variant="caption" tone="textMuted">
            Private notes stay on each destination and in My Trip.
          </AppText>
        </View>
      ) : null}

      {section === 'members' ? (
        <View style={styles.group} testID="group-members">
          <Card>
            <View style={styles.group}>
              <AppText variant="h3" testID="group-ready-summary">
                {ready.filter((r) => r.data.ready === true).length} of {Math.max(sharing.members.length, 1)} members are ready
              </AppText>
              <AppText variant="caption" tone="textMuted">
                Only “ready” is shared — never what anyone has packed.
              </AppText>
              <Button
                label={myReady ? 'I’m not ready yet' : 'I’m ready'}
                icon={myReady ? 'undo' : 'check-decagram-outline'}
                size="sm"
                variant={myReady ? 'ghost' : 'primary'}
                onPress={() => userId && save('readiness', { ready: !myReady }, userId)}
                testID="group-ready-toggle"
              />
            </View>
          </Card>
          {sharing.members.map((m) => (
            <View key={m.userId} style={styles.row} testID={`group-member-${m.displayName}`}>
              <AppText variant="body" style={styles.flex}>
                {m.displayName || 'Member'} · {m.role}
              </AppText>
              <AppText variant="caption" tone={ready.find((r) => r.id === m.userId)?.data.ready ? 'accent' : 'textMuted'}>
                {ready.find((r) => r.id === m.userId)?.data.ready ? 'Ready' : '—'}
              </AppText>
            </View>
          ))}
          <Button label="Members, roles and invitations" icon="account-cog-outline" variant="secondary" onPress={() => router.push({ pathname: '/trips/[tripId]/share', params: { tripId } })} testID="group-manage" />
          <Button label="Group expenses and balances" icon="calculator-variant-outline" variant="ghost" onPress={() => router.push({ pathname: '/calculator/[tripId]', params: { tripId } })} testID="group-calculator" />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  line: { gap: spacing.xs, padding: spacing.xs, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border },
});
