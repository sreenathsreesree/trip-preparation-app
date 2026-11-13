import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { AppText, Button, Card, IconButton, LoadingState, Notice, OptionTile, TextField } from '@/components/ui';
import { getRepositories } from '@/db/repositories';
import { formatDate } from '@/lib/dates';
import { toErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme';
import type { IconName } from '@/theme/icons';

import { usePlannerStore } from '../planner/plannerStore';
import type { ImportSummary } from './applyDraft';
import type { DraftItem, DraftKind, ItineraryDraft } from './itinerary';
import type { PdfImport } from './pdfImportRepository';
import { confirmImport, draftFromPastedText, importPdf, saveDraft } from './pdfImportService';

const KINDS: { kind: DraftKind; label: string; icon: IconName }[] = [
  { kind: 'destination', label: 'Destination', icon: 'map-marker-radius' },
  { kind: 'attraction', label: 'Sight', icon: 'star-outline' },
  { kind: 'hotel', label: 'Stay', icon: 'bed-outline' },
  { kind: 'restaurant', label: 'Food', icon: 'silverware-fork-knife' },
  { kind: 'transport', label: 'Transport', icon: 'bus' },
  { kind: 'note', label: 'Note', icon: 'note-text-outline' },
];

function ItemRow({ item, onChange, onMove, onRemove, first, last }: { item: DraftItem; onChange: (patch: Partial<DraftItem>) => void; onMove: (dir: -1 | 1) => void; onRemove: () => void; first: boolean; last: boolean }) {
  return (
    <View style={[styles.item, !item.include && styles.excluded]} testID={`import-item-${item.name}`}>
      <View style={styles.row}>
        <IconButton
          icon={item.include ? 'checkbox-marked' : 'checkbox-blank-outline'}
          tone={item.include ? 'accent' : 'textMuted'}
          accessibilityLabel={item.include ? `Leave out ${item.name}` : `Include ${item.name}`}
          onPress={() => onChange({ include: !item.include })}
          testID={`import-include-${item.name}`}
        />
        <View style={styles.flex}>
          <TextField label={item.time ? `${item.time}` : 'Name'} value={item.name} onChangeText={(name) => onChange({ name })} maxLength={item.kind === 'note' ? 2000 : 80} testID={`import-name-${item.key}`} />
        </View>
        <View>
          <IconButton icon="chevron-up" size="sm" accessibilityLabel={`Move ${item.name} up`} onPress={() => onMove(-1)} disabled={first} />
          <IconButton icon="chevron-down" size="sm" accessibilityLabel={`Move ${item.name} down`} onPress={() => onMove(1)} disabled={last} />
        </View>
        <IconButton icon="close" size="sm" accessibilityLabel={`Remove ${item.name}`} onPress={onRemove} testID={`import-remove-${item.name}`} />
      </View>
      <View style={styles.chips}>
        {KINDS.map((k) => (
          <OptionTile key={k.kind} layout="chip" icon={k.icon} label={k.label} selected={item.kind === k.kind} onPress={() => onChange({ kind: k.kind })} testID={`import-kind-${item.name}-${k.kind}`} />
        ))}
      </View>
      {item.match ? (
        <View style={styles.row} testID={`import-match-${item.name}`}>
          <AppText variant="caption" tone={item.match.certainty === 'exact' ? 'textSecondary' : 'warning'} style={styles.flex}>
            {item.match.certainty === 'exact' ? `Already in your plan as “${item.match.name}”.` : `Might be “${item.match.name}” in your plan — please check.`}
          </AppText>
          <OptionTile layout="chip" icon="link-variant" label="Use existing" selected={item.reuse} onPress={() => onChange({ reuse: true })} testID={`import-reuse-${item.name}`} />
          <OptionTile layout="chip" icon="plus" label="Add new" selected={!item.reuse} onPress={() => onChange({ reuse: false })} testID={`import-new-${item.name}`} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Import Plan from PDF: choose a PDF (read on the phone), or paste the text;
 * review an editable draft grouped by day; confirm to add it to the trip.
 * Nothing changes in the trip before Confirm, and confirming only adds.
 */
export function ImportPlanScreen({ tripId }: { tripId: string }) {
  const [imports, setImports] = useState<PdfImport[] | null>(null);
  const [current, setCurrent] = useState<PdfImport | null>(null);
  const [draft, setDraft] = useState<ItineraryDraft | null>(null);
  const [busy, setBusy] = useState<'reading' | 'importing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [done, setDone] = useState<ImportSummary | null>(null);

  const refresh = useCallback(async () => {
    const { pdfImports } = await getRepositories();
    setImports(await pdfImports.list(tripId));
  }, [tripId]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const open = (record: PdfImport) => {
    setCurrent(record);
    setDraft(record.draft);
    setDone(null);
    setError(record.status === 'failed' || record.status === 'needs_text' ? record.error : null);
  };

  const choose = async () => {
    setError(null);
    setDone(null);
    setBusy('reading');
    try {
      const record = await importPdf(tripId);
      if (record) open(record);
      await refresh();
    } catch (e) {
      setError(toErrorMessage(e, 'Could not open the PDF.'));
    } finally {
      setBusy(null);
    }
  };

  const readPasted = async () => {
    setBusy('reading');
    try {
      open(await draftFromPastedText(tripId, current && current.status !== 'imported' ? current.id : null, paste));
      setPaste('');
      await refresh();
    } catch (e) {
      setError(toErrorMessage(e, 'Could not read the text.'));
    } finally {
      setBusy(null);
    }
  };

  const update = (next: ItineraryDraft) => {
    setDraft(next);
    if (current) void saveDraft(current.id, next);
  };
  const patchItem = (key: string, patch: Partial<DraftItem>) => draft && update({ ...draft, items: draft.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) });
  const removeItem = (key: string) => draft && update({ ...draft, items: draft.items.filter((i) => i.key !== key) });
  const moveItem = (key: string, dir: -1 | 1) => {
    if (!draft) return;
    const items = [...draft.items];
    const i = items.findIndex((x) => x.key === key);
    const day = items[i]?.day;
    let j = i + dir;
    while (j >= 0 && j < items.length && items[j]?.day !== day) j += dir;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j] as DraftItem, items[i] as DraftItem];
    update({ ...draft, items });
  };

  const confirm = async () => {
    if (!current || !draft) return;
    setBusy('importing');
    setError(null);
    try {
      const summary = await confirmImport(tripId, current.id, draft);
      setDone(summary);
      await usePlannerStore.getState().load(tripId);
      await refresh();
      setCurrent(null);
      setDraft(null);
    } catch (e) {
      setError(toErrorMessage(e, 'Could not add the plan. Nothing was lost — the draft is saved.'));
    } finally {
      setBusy(null);
    }
  };

  const groups = useMemo(() => {
    if (!draft) return [];
    const days = new Map<string, DraftItem[]>();
    for (const item of draft.items) {
      const k = item.day === null ? 'other' : String(item.day);
      days.set(k, [...(days.get(k) ?? []), item]);
    }
    return [...days.entries()].map(([k, items]) => {
      const day = draft.days.find((d) => String(d.number) === k);
      return { key: k, title: day ? `Day ${day.number}${day.date ? ` · ${formatDate(day.date)}` : ''}${day.title ? ` · ${day.title}` : ''}` : 'Other', items };
    });
  }, [draft]);
  const included = draft?.items.filter((i) => i.include).length ?? 0;

  return (
    <Screen testID="import-plan-screen">
      <ScreenHeader showBack eyebrow="Plan" title="Import plan from PDF" subtitle="Review before anything is added" />
      {error ? <Notice tone={current?.status === 'needs_text' ? 'warning' : 'danger'} title={error} testID="import-error" /> : null}
      {done ? (
        <Notice
          tone="success"
          title="Plan added"
          message={`${done.destinations} destinations and ${done.places} places added, ${done.reused} existing reused, ${done.notes} notes. Nothing existing was changed.`}
          action={{ label: 'Open plan', icon: 'map-marker-path', onPress: () => router.back() }}
          testID="import-done"
        />
      ) : null}
      {busy === 'reading' ? <LoadingState label="Reading the itinerary…" /> : null}

      {!draft ? (
        <>
          <Button label="Choose a PDF" icon="file-pdf-box" onPress={() => void choose()} fullWidth disabled={busy !== null} testID="import-choose" />
          <AppText variant="caption" tone="textMuted">
            The PDF is read on this phone and kept with the trip. Text PDFs work best; for a scanned PDF, paste the text below (text recognition isn’t available in the app yet).
          </AppText>
          <Card>
            <View style={styles.group}>
              <TextField label="…or paste the itinerary text" value={paste} onChangeText={setPaste} multiline maxLength={200_000} testID="import-paste" />
              <Button label="Read pasted text" variant="secondary" onPress={() => void readPasted()} disabled={!paste.trim() || busy !== null} testID="import-paste-go" />
            </View>
          </Card>
          {imports && imports.length > 0 ? (
            <View style={styles.group}>
              <AppText variant="label" tone="textMuted">
                Earlier imports
              </AppText>
              {imports.map((r) => (
                <Card key={r.id} onPress={r.status === 'imported' ? undefined : () => open(r)} testID={`import-record-${r.fileName}`}>
                  <AppText variant="bodyStrong">{r.fileName}</AppText>
                  <AppText variant="caption" tone="textMuted">
                    {r.status === 'imported' ? `Added · ${r.summary}` : r.status === 'draft' ? 'Draft — tap to review' : r.status === 'needs_text' ? 'Needs the text pasted (scanned PDF)' : r.status === 'failed' ? `Couldn’t read it: ${r.error ?? ''}` : 'Reading…'}
                  </AppText>
                </Card>
              ))}
            </View>
          ) : null}
        </>
      ) : (
        <View style={styles.group} testID="import-draft">
          <AppText variant="caption" tone="textSecondary">
            {draft.tripName ? `“${draft.tripName}” · ` : ''}
            {draft.startDate ? `${formatDate(draft.startDate)}${draft.endDate && draft.endDate !== draft.startDate ? ` – ${formatDate(draft.endDate)}` : ''} · ` : ''}
            {included} of {draft.items.length} items will be added. Each day’s destination holds the places of that day.
          </AppText>
          {groups.map((g) => (
            <View key={g.key} style={styles.group}>
              <AppText variant="h3">{g.title}</AppText>
              {g.items.map((item, i) => (
                <ItemRow key={item.key} item={item} first={i === 0} last={i === g.items.length - 1} onChange={(p) => patchItem(item.key, p)} onMove={(d) => moveItem(item.key, d)} onRemove={() => removeItem(item.key)} />
              ))}
            </View>
          ))}
          {draft.items.length === 0 ? <Notice tone="warning" title="No places found in this text" message="Paste the itinerary text or add places by hand." /> : null}
          <Button label={`Add ${included} to the trip`} icon="check" onPress={() => void confirm()} disabled={included === 0 || busy !== null} loading={busy === 'importing'} fullWidth testID="import-confirm" />
          <Button
            label="Back (draft is saved)"
            variant="ghost"
            onPress={() => {
              setDraft(null);
              setCurrent(null);
            }}
            testID="import-back"
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  flex: { flex: 1, minWidth: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  item: { gap: spacing.xs, padding: spacing.sm, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  excluded: { opacity: 0.55 },
});
