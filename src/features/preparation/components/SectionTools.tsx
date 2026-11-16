import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ActionSheet, AppText, Button, Card, Icon, IconButton, MiniStepper, Notice, OptionTile, SearchField, TextField } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme';

import { useInventoryStore } from '../../inventory/inventoryStore';
import type { ChecklistOwner, ChecklistSection } from '../model';
import { GROUP_LIMITS, isClothingSection, supportsInventory, type ChecklistGroup } from '../sectionExtrasRepository';
import { useSectionExtras, useSectionExtrasStore } from '../sectionExtrasStore';

/** The dedicated organiser for a category, when there is one (bags, quantities, shopping). */
export function CategoryShortcut({ tripId, section }: { tripId: string; section: ChecklistSection }) {
  const target =
    section.kind === 'packing'
      ? { label: 'Open the packing list (bags and quantities)', icon: 'bag-suitcase-outline' as const, go: () => router.push({ pathname: '/trips/[tripId]/packing', params: { tripId } }) }
      : isClothingSection(section)
        ? { label: 'Bags and packed status (Clothing & luggage)', icon: 'tshirt-crew-outline' as const, go: () => router.push({ pathname: '/trips/[tripId]/clothing', params: { tripId } }) }
        : section.kind === 'shopping'
          ? { label: 'Open the shopping list', icon: 'cart-outline' as const, go: () => router.push('/inventory/shopping') }
          : null;
  if (!target) return null;
  return <Button label={target.label} icon={target.icon} variant="ghost" size="sm" onPress={target.go} style={styles.left} testID="section-shortcut" />;
}

/** Where a new task goes: no group or one of the section's groups. */
export function GroupChips({ groups, value, onChange }: { groups: ChecklistGroup[]; value: string | null; onChange: (id: string | null) => void }) {
  if (groups.length === 0) return null;
  return (
    <View style={styles.chips} testID="section-add-to">
      <AppText variant="caption" tone="textMuted">
        Add to:
      </AppText>
      <OptionTile layout="chip" role="radio" label="No group" icon="tray" selected={value === null} onPress={() => onChange(null)} testID="section-add-to-none" />
      {groups.map((g) => (
        <OptionTile key={g.id} layout="chip" role="radio" label={g.title} icon="folder-outline" selected={value === g.id} onPress={() => onChange(g.id)} testID={`section-add-to-${g.title}`} />
      ))}
    </View>
  );
}

/** Create, rename and delete the section's groups. Deleting asks where its tasks go. */
export function GroupsManager({ sectionId }: { sectionId: string }) {
  const { groups } = useSectionExtras(sectionId);
  const [title, setTitle] = useState('');
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<ChecklistGroup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const store = useSectionExtrasStore.getState;
  const run = (fn: () => Promise<unknown>, fallback: string) =>
    fn().then(
      () => {
        setError(null);
        return true;
      },
      (e: unknown) => {
        setError(toErrorMessage(e, fallback));
        return false;
      },
    );
  return (
    <View style={styles.group} testID="section-groups">
      {groups.map((g) =>
        editing?.id === g.id ? (
          <View key={g.id} style={styles.row}>
            <View style={styles.flex}>
              <TextField label="Group name" value={editing.title} onChangeText={(t) => setEditing({ id: g.id, title: t })} maxLength={GROUP_LIMITS.titleMax} testID="section-group-rename-input" />
            </View>
            <Button label="Save" size="sm" onPress={() => void run(() => store().renameGroup(sectionId, g.id, editing.title), 'Could not rename it.').then((ok) => ok && setEditing(null))} style={styles.fieldButton} testID="section-group-rename-save" />
          </View>
        ) : (
          <View key={g.id} style={styles.groupRow}>
            <Icon name="folder-outline" tone="textSecondary" />
            <AppText variant="body" style={styles.flex}>
              {g.title}
            </AppText>
            <IconButton icon="pencil-outline" size="sm" variant="plain" accessibilityLabel={`Rename ${g.title}`} onPress={() => setEditing({ id: g.id, title: g.title })} testID={`section-group-rename-${g.title}`} />
            <IconButton icon="trash-can-outline" size="sm" variant="plain" accessibilityLabel={`Delete ${g.title}`} onPress={() => setDeleting(g)} testID={`section-group-delete-${g.title}`} />
          </View>
        ),
      )}
      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField label="New group" placeholder="e.g. Tops, Footwear, Chargers" value={title} onChangeText={setTitle} maxLength={GROUP_LIMITS.titleMax} testID="section-group-input" />
        </View>
        <Button
          label="Add"
          size="sm"
          variant="secondary"
          disabled={!title.trim()}
          onPress={() => void run(() => store().addGroup(sectionId, title), 'Could not add the group.').then((ok) => ok && setTitle(''))}
          style={styles.fieldButton}
          testID="section-group-add"
        />
      </View>
      {error ? <Notice tone="danger" title={error} testID="section-group-error" /> : null}
      <ActionSheet
        visible={deleting !== null}
        title={deleting ? `Delete the group “${deleting.title}”?` : ''}
        subtitle="Its tasks are kept. Where should they go?"
        actions={[
          ...groups
            .filter((g) => g.id !== deleting?.id)
            .map((g) => ({ key: g.id, label: `Move them to ${g.title}`, icon: 'folder-move-outline' as const, onPress: () => { const d = deleting; setDeleting(null); if (d) void run(() => store().deleteGroup(sectionId, d.id, g.id), 'Could not delete it.'); } })),
          { key: 'none', label: 'Keep them without a group', icon: 'tray' as const, destructive: true, onPress: () => { const d = deleting; setDeleting(null); if (d) void run(() => store().deleteGroup(sectionId, d.id, null), 'Could not delete it.'); } },
        ]}
        onClose={() => setDeleting(null)}
        testID="section-group-delete-sheet"
      />
    </View>
  );
}

/**
 * Picks Inventory items to add to the section, linked to the original
 * records (nothing is copied into Inventory). Items already in this section
 * are shown as added.
 */
export function InventoryPicker({ owner, section, groupId, onDone }: { owner: ChecklistOwner; section: ChecklistSection; groupId: string | null; onDone: (message: string) => void }) {
  const items = useInventoryStore((s) => s.items);
  const status = useInventoryStore((s) => s.status);
  const { links } = useSectionExtras(section.id);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void useInventoryStore.getState().load();
  }, []);
  const linked = new Set(Object.values(links).flatMap((l) => (l.inventoryItemId ? [l.inventoryItemId] : [])));
  const visible = items
    .filter((i) => !i.archivedAt)
    .filter((i) => !query.trim() || i.name.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 60);
  const count = Object.keys(chosen).length;
  if (!supportsInventory(section.kind, section.title)) return null;
  return (
    <Card variant="outline" testID="section-inventory">
      <View style={styles.group}>
        <AppText variant="label" tone="textSecondary">
          Add from Inventory
        </AppText>
        <SearchField value={query} onChangeText={setQuery} placeholder="Search your inventory" testID="section-inventory-search" />
        {status !== 'ready' && items.length === 0 ? (
          <AppText variant="caption" tone="textMuted">
            Loading your inventory…
          </AppText>
        ) : visible.length === 0 ? (
          <View style={styles.group}>
            <AppText variant="caption" tone="textMuted" testID="section-inventory-empty">
              {items.length === 0 ? 'Your Inventory is empty. Add the things you own there first, or add tasks by hand above.' : 'No matching items.'}
            </AppText>
            {items.length === 0 ? <Button label="Open Inventory" icon="archive-outline" variant="ghost" size="sm" onPress={() => router.push('/inventory')} style={styles.left} /> : null}
          </View>
        ) : (
          visible.map((i) => {
            const already = linked.has(i.id);
            const qty = chosen[i.id];
            return (
              <Pressable
                key={i.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: qty !== undefined, disabled: already }}
                disabled={already}
                onPress={() =>
                  setChosen((c) => {
                    const next = { ...c };
                    if (next[i.id] !== undefined) delete next[i.id];
                    else next[i.id] = 1;
                    return next;
                  })
                }
                style={[styles.pick, qty !== undefined && styles.pickOn]}
                testID={`section-inventory-item-${i.name}`}
              >
                <Icon name={already ? 'check-circle' : qty !== undefined ? 'checkbox-marked' : 'checkbox-blank-outline'} tone={already || qty !== undefined ? 'accent' : 'textMuted'} />
                <View style={styles.flex}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {i.name}
                  </AppText>
                  <AppText variant="caption" tone="textMuted">
                    {already ? 'Already in this section' : `You have ${i.quantity}`}
                  </AppText>
                </View>
                {qty !== undefined ? <MiniStepper label={`Quantity of ${i.name}`} value={qty} min={1} max={99} onChange={(v) => setChosen((c) => ({ ...c, [i.id]: v }))} /> : null}
              </Pressable>
            );
          })
        )}
        <Button
          label={count ? `Add ${count} ${count === 1 ? 'item' : 'items'}` : 'Choose items to add'}
          icon="plus"
          size="sm"
          disabled={count === 0 || busy}
          loading={busy}
          onPress={() => {
            setBusy(true);
            setError(null);
            useSectionExtrasStore
              .getState()
              .addFromInventory(owner, section.id, groupId, Object.entries(chosen).map(([itemId, quantity]) => ({ itemId, quantity })))
              .then((r) => {
                setChosen({});
                onDone(`${r.added} added from Inventory${r.skipped ? `, ${r.skipped} already here` : ''}. Your Inventory is unchanged.`);
              })
              .catch((e: unknown) => setError(toErrorMessage(e, 'Could not add them.')))
              .finally(() => setBusy(false));
          }}
          style={styles.left}
          testID="section-inventory-add"
        />
        {error ? <Notice tone="danger" title={error} /> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  left: { alignSelf: 'flex-start' },
  fieldButton: { marginTop: spacing.lg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pickOn: { borderColor: colors.accentBorder },
});
