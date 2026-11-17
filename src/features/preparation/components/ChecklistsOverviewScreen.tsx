import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import {
  AppText,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  LoadingState,
  Notice,
  ProgressBar,
  SegmentedControl,
  Tag,
} from '@/components/ui';
import { formatDate, formatDateRange } from '@/lib/dates';
import { toErrorMessage } from '@/lib/errors';
import { colors, spacing } from '@/theme';

import { useCurrentTrips, useEnsureTripsLoaded, useToday } from '../../trips/hooks';
import { describeTripTiming, TRANSPORT_MODE_META, type TripSummary } from '../../trips/model';
import { useTripsStore } from '../../trips/tripsStore';
import { useChecklistStore } from '../checklistStore';
import { useEnsureTemplatesLoaded, useOwner, useOwnerChecklist } from '../hooks';
import { groupTasksBySection, tripOwner } from '../model';
import { preparationProgress } from '../readiness';
import { isOldPackingSection } from '../sectionExtrasRepository';
import { usePackingStore, useTripPacking } from '../../packing/packingStore';
import { buildStarterSection } from '../starter';
import { useTemplatesStore } from '../templatesStore';
import { SectionsPanel } from './SectionsPanel';

/**
 * One trip on the Checklist tab: compact by default (readiness, progress, counts); expanded,
 * its sections with their real progress plus the checklist tools. The figures come from the
 * same loaded checklist and the same calculation as the trip dashboard.
 */
function TripChecklistCard({ trip, expanded, onToggle }: { trip: TripSummary; expanded: boolean; onToggle: () => void }) {
  const today = useToday();
  const owner = useOwner('trip', trip.id);
  const checklist = useOwnerChecklist(owner);
  const grouped = groupTasksBySection(checklist.tasks);
  const packing = useTripPacking(trip.id);
  const progress = preparationProgress(checklist.tasks, packing.entries);
  // Old Packing / Clothing sections stay listed only while they still have tasks.
  const sections = checklist.sections.filter((section) => !isOldPackingSection(section) || (grouped.get(section.id)?.length ?? 0) > 0);
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [toolError, setToolError] = useState<string | null>(null);
  const ready = checklist.status === 'ready';
  const needsVehicle = TRANSPORT_MODE_META[trip.transportMode].needsVehicleReadiness && ready && !checklist.sections.some((section) => section.kind === 'vehicle');

  return (
    <Card padding="none" testID={`checklist-trip-${trip.id}`}>
      <View style={styles.cardHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`${trip.name}, ${progress.percent}% prepared, ${progress.done} of ${progress.total} tasks done${progress.essentialsOpen > 0 ? `, ${progress.essentialsOpen} essential open` : ''}. ${expanded ? 'Hide' : 'Show'} sections`}
          onPress={onToggle}
          style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
          testID={`checklist-trip-toggle-${trip.id}`}
        >
          <View style={styles.titleRow}>
            <View style={styles.flex}>
              <AppText variant="title" numberOfLines={1}>
                {trip.name}
              </AppText>
              <AppText variant="caption" tone="textMuted" numberOfLines={1}>
                {formatDateRange(trip.startDate, trip.endDate)} · {describeTripTiming(trip, today)}
              </AppText>
            </View>
            <AppText variant="h3" tone={progress.percent === 100 ? 'accent' : 'textPrimary'} testID={`checklist-trip-percent-${trip.id}`}>
              {ready ? `${progress.percent}%` : '…'}
            </AppText>
            <Icon name={expanded ? 'chevron-up' : 'chevron-down'} tone="textMuted" />
          </View>
          <ProgressBar value={progress.percent / 100} height={4} />
          <View style={styles.metaRow}>
            <AppText variant="caption" tone="textSecondary" style={styles.flex} testID={`checklist-trip-count-${trip.id}`}>
              {ready ? (progress.total === 0 ? 'Nothing to prepare yet' : `${progress.done}/${progress.total} done`) : 'Loading…'}
            </AppText>
            {progress.essentialsOpen > 0 ? (
              <View style={styles.essential} testID={`checklist-trip-essentials-${trip.id}`}>
                <Icon name="alert-decagram" size={14} color={colors.danger} />
                <AppText variant="caption" tone="danger">
                  {progress.essentialsOpen} essential open
                </AppText>
              </View>
            ) : null}
            <AppText variant="captionStrong" tone="info">
              {expanded ? 'Hide sections' : 'Show sections'}
            </AppText>
          </View>
        </Pressable>
        <IconButton icon="open-in-new" size="sm" variant="plain" accessibilityLabel={`Open the ${trip.name} dashboard`} onPress={() => router.push({ pathname: '/trips/[tripId]', params: { tripId: trip.id } })} testID={`checklist-open-trip-${trip.id}`} />
      </View>

      {expanded ? (
        <View style={styles.expanded} testID={`checklist-trip-sections-${trip.id}`}>
          {checklist.status === 'error' ? (
            <AppText variant="caption" tone="danger" style={styles.message}>
              {checklist.error}
            </AppText>
          ) : !ready ? (
            <AppText variant="caption" tone="textMuted" style={styles.message}>
              Loading…
            </AppText>
          ) : (
            [
              <Pressable
                key="packing"
                accessibilityRole="button"
                accessibilityLabel={`${trip.name}, Packing: ${progress.packing.done} of ${progress.packing.total} packed`}
                onPress={() => router.push({ pathname: '/trips/[tripId]/packing', params: { tripId: trip.id } })}
                style={({ pressed }) => [styles.sectionRow, pressed && styles.pressed]}
                testID="checklist-packing-row"
              >
                <Icon name="bag-suitcase-outline" color={colors.accent} size={18} />
                <AppText variant="body" style={styles.sectionTitle} numberOfLines={1}>
                  Packing
                </AppText>
                <View style={styles.bar}>
                  <ProgressBar value={progress.packing.total ? progress.packing.done / progress.packing.total : 0} height={4} />
                </View>
                <AppText variant="caption" tone="textMuted" style={styles.count}>
                  {progress.packing.done}/{progress.packing.total}
                </AppText>
                <Icon name="chevron-right" size={18} tone="textMuted" />
              </Pressable>,
            ]
          )}
          {ready && owner ? <SectionsPanel tripId={trip.id} owner={owner} sections={sections} allSectionIds={checklist.sections.map((x) => x.id)} grouped={grouped} /> : null}

          {needsVehicle && owner ? (
            <View style={styles.message}>
              <Notice
                tone="warning"
                icon="car-wrench"
                title="Driving on this trip?"
                message="There is no vehicle readiness section yet. Add the recommended vehicle checks."
                action={{
                  label: 'Add vehicle checks',
                  icon: 'plus',
                  loading: addingVehicle,
                  onPress: () => {
                    setAddingVehicle(true);
                    setToolError(null);
                    useChecklistStore
                      .getState()
                      .applyPlan(owner, buildStarterSection('vehicle', trip))
                      .catch((e: unknown) => setToolError(toErrorMessage(e, 'Could not add vehicle checks.')))
                      .finally(() => setAddingVehicle(false));
                  },
                }}
                testID="vehicle-suggestion"
              />
            </View>
          ) : null}
          {toolError ? <AppText variant="caption" tone="danger" style={styles.message}>{toolError}</AppText> : null}

          <View style={styles.tools}>
            <Button label="Add from template" icon="playlist-plus" variant="ghost" size="sm" onPress={() => router.push({ pathname: '/trips/[tripId]/templates', params: { tripId: trip.id } })} testID="apply-templates" />
            <Button
              label="Save as template"
              icon="content-save-all-outline"
              variant="ghost"
              size="sm"
              disabled={checklist.tasks.length === 0}
              onPress={() => router.push({ pathname: '/trips/[tripId]/save-template', params: { tripId: trip.id } })}
              testID="save-as-template"
            />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

function TripsTab({ expandedId, setExpandedId, focusTripId }: { expandedId: string | null; setExpandedId: (id: string | null) => void; focusTripId: string | null }) {
  const today = useToday();
  const status = useTripsStore((state) => state.status);
  const error = useTripsStore((state) => state.error);
  const load = useTripsStore((state) => state.load);
  const allTrips = useTripsStore((state) => state.trips);
  const current = useCurrentTrips(today);
  // A trip opened from its dashboard is listed even when it is not upcoming (e.g. ended).
  const focused = focusTripId && !current.some((t) => t.id === focusTripId) ? (allTrips.find((t) => t.id === focusTripId) ?? null) : null;
  const trips = focused ? [focused, ...current] : current;
  const loadChecklist = useChecklistStore((state) => state.load);

  const ids = trips.map((trip) => trip.id).join(',');
  useEffect(() => {
    for (const id of ids.split(',')) {
      if (!id) continue;
      void loadChecklist(tripOwner(id));
      void usePackingStore.getState().load(id);
    }
  }, [ids, loadChecklist]);

  if (status === 'error') {
    return <ErrorState message={error ?? 'Could not load your trips.'} onRetry={() => void load()} />;
  }
  if (status !== 'ready') return <LoadingState label="Loading checklists…" />;
  if (trips.length === 0) {
    return (
      <EmptyState
        icon="clipboard-check-outline"
        title="No upcoming trips"
        message="Checklists appear here for active trips that are upcoming or in progress."
        action={{ label: 'Plan a trip', icon: 'plus', onPress: () => router.push('/trips/new') }}
      />
    );
  }
  return (
    <View style={styles.list} testID="checklist-trips">
      <AppText variant="caption" tone="textMuted">
        Tap a trip to see its sections. <Icon name="alert-decagram" size={12} color={colors.danger} /> marks open essential tasks.
      </AppText>
      {trips.map((trip) => (
        <TripChecklistCard key={trip.id} trip={trip} expanded={expandedId === trip.id} onToggle={() => setExpandedId(expandedId === trip.id ? null : trip.id)} />
      ))}
    </View>
  );
}

function TemplatesTab() {
  useEnsureTemplatesLoaded();
  const templates = useTemplatesStore((state) => state.templates);
  const status = useTemplatesStore((state) => state.status);
  const error = useTemplatesStore((state) => state.error);
  const load = useTemplatesStore((state) => state.load);
  const create = () => router.push('/templates/new');

  if (status === 'error') {
    return <ErrorState message={error ?? 'Could not load your templates.'} onRetry={() => void load()} />;
  }
  if (status !== 'ready') return <LoadingState label="Loading templates…" />;

  return (
    <View style={styles.list}>
      <View style={styles.templatesHeader}>
        <AppText variant="caption" tone="textMuted" style={styles.flex}>
          Reusable checklists you can add to any trip. Each trip keeps its own copy and its own ticks.
        </AppText>
        <Button label="New" icon="plus" size="sm" onPress={create} testID="templates-new" />
      </View>
      {templates.length === 0 ? (
        <EmptyState
          icon="file-document-multiple-outline"
          title="No templates yet"
          message="Build a checklist once — like a trek kit or work-trip essentials — and reuse it on every trip. You can also save any trip's checklist as a template from its dashboard."
          action={{ label: 'Create a template', icon: 'plus', onPress: create }}
          testID="templates-empty"
        />
      ) : (
        templates.map((template) => (
          <Card
            key={template.id}
            onPress={() => router.push({ pathname: '/templates/[templateId]', params: { templateId: template.id } })}
            accessibilityLabel={`${template.name}, ${template.taskCount} tasks`}
            accessibilityHint="Opens the template"
            testID={`template-card-${template.id}`}
          >
            <View style={styles.templateRow}>
              <View style={styles.templateIcon}>
                <Icon name="file-document-multiple-outline" tone="info" />
              </View>
              <View style={styles.flex}>
                <AppText variant="title" numberOfLines={1}>
                  {template.name}
                </AppText>
                {template.description ? (
                  <AppText variant="caption" tone="textSecondary" numberOfLines={2}>
                    {template.description}
                  </AppText>
                ) : null}
                <View style={styles.tags}>
                  <Tag label={`${template.taskCount} tasks`} icon="checkbox-marked-outline" color={colors.info} />
                  <Tag label={`${template.sectionCount} sections`} icon="format-list-group" />
                </View>
                <AppText variant="caption" tone="textMuted">
                  Edited {formatDate(template.updatedAt.slice(0, 10), { withYear: true })}
                </AppText>
              </View>
              <Icon name="chevron-right" tone="textMuted" />
            </View>
          </Card>
        ))
      )}
    </View>
  );
}

type Tab = 'trips' | 'templates';

export function ChecklistsOverviewScreen() {
  useEnsureTripsLoaded();
  const params = useLocalSearchParams<{ trip?: string }>();
  const focusTripId = typeof params.trip === 'string' && params.trip ? params.trip : null;
  const [tab, setTab] = useState<Tab>('trips');
  // Which trip is open: one at a time, kept while this screen stays mounted (not stored).
  const [expandedId, setExpandedId] = useState<string | null>(focusTripId);
  // Opened again for another trip (e.g. from a different dashboard): show and expand that trip.
  const [seenFocus, setSeenFocus] = useState(focusTripId);
  if (focusTripId !== seenFocus) {
    setSeenFocus(focusTripId);
    if (focusTripId) {
      setTab('trips');
      setExpandedId(focusTripId);
    }
  }
  const loadTrips = useTripsStore((state) => state.load);
  const loadTemplates = useTemplatesStore((state) => state.load);

  return (
    <Screen
      testID="checklists-screen"
      onRefresh={() => void (tab === 'trips' ? loadTrips() : loadTemplates())}
    >
      <ScreenHeader eyebrow="Readiness" title="Checklists" />
      <SegmentedControl<Tab>
        accessibilityLabel="Checklists view"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'trips', label: 'Upcoming trips' },
          { value: 'templates', label: 'Templates' },
        ]}
      />
      {tab === 'trips' ? <TripsTab expandedId={expandedId} setExpandedId={setExpandedId} focusTripId={focusTripId} /> : <TemplatesTab />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.lg,
  },
  flex: {
    flex: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    paddingRight: spacing.xs,
  },
  toggle: {
    flex: 1,
    gap: spacing.sm,
    padding: spacing.lg,
    minHeight: 48,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  essential: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  expanded: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tools: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    padding: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  message: {
    padding: spacing.lg,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 48,
  },
  pressed: {
    backgroundColor: colors.surfaceRaised,
  },
  sectionTitle: {
    flex: 1,
  },
  bar: {
    width: 56,
  },
  count: {
    minWidth: 32,
    textAlign: 'right',
  },
  templatesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  templateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  templateIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.infoSoft,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginVertical: spacing.xs,
  },
});
