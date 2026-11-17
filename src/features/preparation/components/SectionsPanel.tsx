import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ActionSheet, AppText, Button, Icon, IconButton, Notice, OptionTile, ProgressBar, TextField, ToggleRow, type SheetAction } from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { toErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme';
import type { IconName } from '@/theme/icons';

import { useEnsureInventoryLoaded } from '../../inventory/hooks';
import { useInventoryStore } from '../../inventory/inventoryStore';
import { useChecklistStore } from '../checklistStore';
import { SECTION_META, type ChecklistOwner, type ChecklistSection, type ChecklistTask } from '../model';
import { completionPercent, computeStats, openCount } from '../readiness';
import { holdsItems, type SectionSettings } from '../sectionExtrasRepository';
import { useSectionSettingsStore } from '../sectionSettingsStore';
import { moved, ReorderList } from './ReorderList';
import { InventoryPicker } from './SectionTools';

export const SECTION_ICONS: readonly IconName[] = [
  'clipboard-check-outline',
  'passport',
  'car-wrench',
  'cart-outline',
  'home-outline',
  'bag-personal-outline',
  'tent',
  'camera-outline',
  'medical-bag',
  'toothbrush-paste',
  'cellphone-charging',
  'food-apple-outline',
  'gift-outline',
  'star-outline',
];

const sectionTestId = (section: { kind: string; title: string }) =>
  `section-card-${section.kind === 'custom' ? section.title.toLowerCase().replace(/\s+/g, '-') : section.kind}`;

export const sectionIcon = (section: ChecklistSection, settings?: SectionSettings | null): IconName => settings?.icon ?? SECTION_META[section.kind].icon;

type Mode = { kind: 'none' } | { kind: 'add' } | { kind: 'edit'; section: ChecklistSection } | { kind: 'category' } | { kind: 'pick'; section: ChecklistSection; categoryId: string };

/**
 * A trip's checklist sections inside its Checklist card: drag (or Move up / down) to reorder,
 * a compact menu per section (rename, icon, settings, delete), and Add section / From Inventory
 * — all here, without a separate management screen.
 */
export function SectionsPanel({
  tripId,
  owner,
  sections,
  allSectionIds,
  grouped,
}: {
  tripId: string;
  owner: ChecklistOwner;
  /** Sections shown (old packing sections without tasks are left out). */
  sections: ChecklistSection[];
  /** Every section id of the trip, in order (for saving a new order). */
  allSectionIds: string[];
  grouped: Map<string, ChecklistTask[]>;
}) {
  useEnsureInventoryLoaded();
  const settings = useSectionSettingsStore((s) => s.bySection);
  const store = useSectionSettingsStore.getState;
  const [mode, setMode] = useState<Mode>({ kind: 'none' });
  const [menuFor, setMenuFor] = useState<ChecklistSection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const ids = sections.map((s) => s.id).join(',');
  useEffect(() => {
    if (ids) void useSectionSettingsStore.getState().load(ids.split(','));
  }, [ids]);

  const run = (fn: () => Promise<unknown>, fallback: string) => {
    setError(null);
    setMessage(null);
    fn().catch((e: unknown) => setError(toErrorMessage(e, fallback)));
  };
  /** The full order after reordering only the shown sections (hidden ones keep their place at the end). */
  const fullOrder = (shown: string[]) => [...shown, ...allSectionIds.filter((id) => !shown.includes(id))];
  const reorder = (shown: string[]) => run(() => store().reorderSections(tripId, fullOrder(shown)), 'Could not reorder the sections.');

  async function remove(section: ChecklistSection) {
    const count = grouped.get(section.id)?.length ?? 0;
    const ok = await confirmAction({
      title: `Delete the “${section.title}” section?`,
      message: `${count === 0 ? 'It has no tasks.' : `Its ${count} ${count === 1 ? 'task is' : 'tasks are'} deleted from this trip.`} Inventory items linked to them are not touched.${section.kind !== 'custom' ? ' It is one of the standard sections; you can add its starter tasks again later from a template.' : ''}`,
      confirmLabel: 'Delete section',
      destructive: true,
    });
    if (ok) run(() => store().deleteSection(tripId, section.id), 'Could not delete the section.');
  }

  const menu: SheetAction[] = menuFor
    ? [
        { key: 'edit', label: 'Rename, icon and settings', icon: 'pencil-outline', onPress: () => setMode({ kind: 'edit', section: menuFor }) },
        { key: 'up', label: 'Move up', icon: 'arrow-up', onPress: () => reorder(moved(sections.map((s) => s.id), menuFor.id, -1)) },
        { key: 'down', label: 'Move down', icon: 'arrow-down', onPress: () => reorder(moved(sections.map((s) => s.id), menuFor.id, 1)) },
        { key: 'delete', label: 'Delete section', icon: 'delete-outline', destructive: true, onPress: () => void remove(menuFor) },
      ]
    : [];

  return (
    <View style={styles.root} testID={`sections-panel-${tripId}`}>
      <ReorderList
        items={sections}
        onReorder={reorder}
        testID={`sections-list-${tripId}`}
        renderItem={(section, context) => {
          const own = settings[section.id] ?? null;
          const meta = SECTION_META[section.kind];
          const stats = computeStats(grouped.get(section.id) ?? []);
          const essentials = openCount(stats.essential);
          return (
            <View style={[styles.row, context.isDragging && styles.dragging]} testID={`section-row-${section.title}`}>
              {context.handle}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${section.title}: ${stats.done} of ${stats.total} done${essentials > 0 ? `, ${essentials} essential open` : ''}`}
                onPress={() => router.push({ pathname: '/trips/[tripId]/sections/[sectionId]', params: { tripId, sectionId: section.id } })}
                style={({ pressed }) => [styles.open, pressed && styles.pressed]}
                testID={sectionTestId(section)}
              >
                <Icon name={sectionIcon(section, own)} color={meta.tint} size={18} />
                <AppText variant="body" style={styles.flex} numberOfLines={1}>
                  {section.title}
                </AppText>
                {essentials > 0 ? <Icon name="alert-decagram" size={16} color={colors.danger} /> : null}
                <View style={styles.bar}>
                  <ProgressBar value={completionPercent(stats) / 100} color={meta.tint} height={4} />
                </View>
                <AppText variant="caption" tone="textMuted" style={styles.count}>
                  {stats.done}/{stats.total}
                </AppText>
              </Pressable>
              <IconButton icon="dots-vertical" size="sm" variant="plain" accessibilityLabel={`${section.title} options`} onPress={() => setMenuFor(section)} testID={`section-menu-${section.title}`} />
            </View>
          );
        }}
      />

      {error ? <Notice tone="danger" title={error} testID="sections-error" /> : null}
      {message ? <Notice tone="success" title={message} testID="sections-message" /> : null}

      {mode.kind === 'add' || mode.kind === 'edit' ? (
        <SectionForm
          tripId={tripId}
          section={mode.kind === 'edit' ? mode.section : null}
          settings={mode.kind === 'edit' ? (settings[mode.section.id] ?? null) : null}
          onDone={(text) => {
            setMode({ kind: 'none' });
            if (text) setMessage(text);
          }}
        />
      ) : mode.kind === 'category' ? (
        <CategoryChooser
          onCancel={() => setMode({ kind: 'none' })}
          onChoose={(categoryId) =>
            run(async () => {
              const { sectionId, created } = await store().sectionForInventoryCategory(tripId, categoryId);
              const section = useChecklistStore.getState().byOwner[`trip:${tripId}`]?.sections.find((s) => s.id === sectionId);
              if (section) setMode({ kind: 'pick', section, categoryId });
              setMessage(created ? `Section “${section?.title ?? ''}” added. Choose which items to add.` : `Using the existing “${section?.title ?? ''}” section. Choose which items to add.`);
            }, 'Could not add the section.')
          }
        />
      ) : mode.kind === 'pick' ? (
        <View style={styles.root}>
          <InventoryPicker
            owner={owner}
            section={mode.section}
            groupId={null}
            categoryId={mode.categoryId}
            onDone={(m) => {
              setMode({ kind: 'none' });
              setMessage(m);
            }}
          />
          <Button label="Done" variant="ghost" size="sm" onPress={() => setMode({ kind: 'none' })} style={styles.left} />
        </View>
      ) : (
        <View style={styles.actions}>
          <Button label="Add section" icon="plus" variant="ghost" size="sm" onPress={() => setMode({ kind: 'add' })} testID="section-add-open" />
          <Button label="From Inventory category" icon="archive-arrow-down-outline" variant="ghost" size="sm" onPress={() => setMode({ kind: 'category' })} testID="section-from-category" />
        </View>
      )}

      <ActionSheet visible={menuFor !== null} title={menuFor?.title ?? ''} actions={menu} onClose={() => setMenuFor(null)} testID="section-menu-sheet" />
    </View>
  );
}

/** Add or edit a section: name, icon, description, whether it holds items; new ones can start from an Inventory category and starter tasks. */
function SectionForm({ tripId, section, settings, onDone }: { tripId: string; section: ChecklistSection | null; settings: SectionSettings | null; onDone: (message: string | null) => void }) {
  const [title, setTitle] = useState(section?.title ?? '');
  const [icon, setIcon] = useState<IconName>(settings?.icon ?? (section ? SECTION_META[section.kind].icon : 'clipboard-check-outline'));
  const [description, setDescription] = useState(settings?.description ?? '');
  const [items, setItems] = useState<boolean>(section ? holdsItems(section, settings) : false);
  const [starter, setStarter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const store = useSectionSettingsStore.getState;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (section) {
        if (title.trim() !== section.title) await store().renameSection(tripId, section.id, title);
        await store().saveSettings(tripId, section.id, { icon, description, holdsItems: items });
        onDone(`“${title.trim()}” updated.`);
      } else {
        await store().createSection(tripId, { title, icon, description, holdsItems: items, starterTasks: starter.split('\n') });
        onDone(`Section “${title.trim()}” added.`);
      }
    } catch (e) {
      setError(toErrorMessage(e, 'Could not save the section.'));
      setBusy(false);
    }
  }

  return (
    <View style={styles.form} testID="section-form">
      <AppText variant="label" tone="textSecondary">
        {section ? `Edit “${section.title}”` : 'New section'}
      </AppText>
      <TextField label="Name" value={title} onChangeText={setTitle} maxLength={60} placeholder="e.g. Camera gear" testID="section-form-name" />
      <View style={styles.icons}>
        {SECTION_ICONS.map((i) => (
          <OptionTile key={i} layout="chip" role="radio" label="" icon={i} selected={icon === i} onPress={() => setIcon(i)} testID={`section-form-icon-${i}`} />
        ))}
      </View>
      <TextField label="Description (optional)" value={description} onChangeText={setDescription} maxLength={200} testID="section-form-description" />
      <ToggleRow label="Holds physical items" description="Offers Add from Inventory in this section" value={items} onChange={setItems} testID="section-form-items" />
      {section ? null : (
        <TextField label="Starter tasks (optional, one per line)" value={starter} onChangeText={setStarter} multiline maxLength={2000} testID="section-form-starter" />
      )}
      {error ? <Notice tone="danger" title={error} testID="section-form-error" /> : null}
      <View style={styles.actions}>
        <Button label={section ? 'Save' : 'Add section'} icon="check" size="sm" loading={busy} disabled={!title.trim()} onPress={() => void save()} testID="section-form-save" />
        <Button label="Cancel" variant="ghost" size="sm" onPress={() => onDone(null)} />
      </View>
    </View>
  );
}

/** Choose an Inventory category to add as a section. */
function CategoryChooser({ onChoose, onCancel }: { onChoose: (categoryId: string) => void; onCancel: () => void }) {
  const categories = useInventoryStore((s) => s.categories).filter((c) => !c.parentId);
  const items = useInventoryStore((s) => s.items);
  return (
    <View style={styles.form} testID="section-category-chooser">
      <AppText variant="label" tone="textSecondary">
        Add an Inventory category as a section
      </AppText>
      <AppText variant="caption" tone="textMuted">
        You choose which of its items to add next. Nothing is added automatically.
      </AppText>
      <View style={styles.icons}>
        {categories.map((c) => {
          const n = items.filter((i) => !i.archivedAt && (i.categoryId === c.id || i.subcategoryId === c.id)).length;
          return <OptionTile key={c.id} layout="chip" role="button" label={`${c.name} · ${n}`} icon={c.icon} selected={false} onPress={() => onChoose(c.id)} testID={`section-category-${c.name}`} />;
        })}
      </View>
      <Button label="Cancel" variant="ghost" size="sm" onPress={onCancel} style={styles.left} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingLeft: spacing.xs },
  dragging: { backgroundColor: colors.surfaceRaised, borderRadius: radii.md },
  open: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  pressed: { backgroundColor: colors.surfaceRaised },
  flex: { flex: 1 },
  bar: { width: 48 },
  count: { minWidth: 32, textAlign: 'right' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingHorizontal: spacing.sm },
  form: { gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  icons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  left: { alignSelf: 'flex-start' },
});
