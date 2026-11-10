import { router } from 'expo-router';
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
  LoadingState,
  ProgressBar,
  SegmentedControl,
  Tag,
} from '@/components/ui';
import { formatDate, formatDateRange } from '@/lib/dates';
import { colors, spacing } from '@/theme';

import { useCurrentTrips, useEnsureTripsLoaded, useToday } from '../../trips/hooks';
import { describeTripTiming, type TripSummary } from '../../trips/model';
import { useTripsStore } from '../../trips/tripsStore';
import { useChecklistStore } from '../checklistStore';
import { useEnsureTemplatesLoaded, useOwner, useOwnerChecklist } from '../hooks';
import { groupTasksBySection, SECTION_META, tripOwner } from '../model';
import { completionPercent, computeStats, openCount, readinessPercent } from '../readiness';
import { useTemplatesStore } from '../templatesStore';

function TripChecklistCard({ trip }: { trip: TripSummary }) {
  const today = useToday();
  const owner = useOwner('trip', trip.id);
  const checklist = useOwnerChecklist(owner);
  const grouped = groupTasksBySection(checklist.tasks);

  return (
    <Card padding="none" testID={`checklist-trip-${trip.id}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${trip.name} dashboard`}
        onPress={() => router.push({ pathname: '/trips/[tripId]', params: { tripId: trip.id } })}
        style={({ pressed }) => [styles.cardHeader, pressed && styles.pressed]}
      >
        <View style={styles.flex}>
          <AppText variant="h3" numberOfLines={1}>
            {trip.name}
          </AppText>
          <AppText variant="caption" tone="textMuted">
            {formatDateRange(trip.startDate, trip.endDate)} · {describeTripTiming(trip, today)}
          </AppText>
        </View>
        <AppText variant="captionStrong" tone="accent">
          {readinessPercent(trip.readiness)}% ready
        </AppText>
      </Pressable>

      {checklist.status === 'error' ? (
        <AppText variant="caption" tone="danger" style={styles.message}>
          {checklist.error}
        </AppText>
      ) : checklist.status !== 'ready' ? (
        <AppText variant="caption" tone="textMuted" style={styles.message}>
          Loading…
        </AppText>
      ) : (
        checklist.sections.map((section) => {
          const meta = SECTION_META[section.kind];
          const stats = computeStats(grouped.get(section.id) ?? []);
          const essentials = openCount(stats.essential);
          return (
            <Pressable
              key={section.id}
              accessibilityRole="button"
              accessibilityLabel={`${trip.name}, ${section.title}: ${stats.done} of ${stats.total} done${
                essentials > 0 ? `, ${essentials} essential open` : ''
              }`}
              onPress={() =>
                router.push({
                  pathname: '/trips/[tripId]/sections/[sectionId]',
                  params: { tripId: trip.id, sectionId: section.id },
                })
              }
              style={({ pressed }) => [styles.sectionRow, pressed && styles.pressed]}
            >
              <Icon name={meta.icon} color={meta.tint} size={18} />
              <AppText variant="body" style={styles.sectionTitle} numberOfLines={1}>
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
          );
        })
      )}
    </Card>
  );
}

function TripsTab() {
  const today = useToday();
  const status = useTripsStore((state) => state.status);
  const error = useTripsStore((state) => state.error);
  const load = useTripsStore((state) => state.load);
  const trips = useCurrentTrips(today);
  const loadChecklist = useChecklistStore((state) => state.load);

  const ids = trips.map((trip) => trip.id).join(',');
  useEffect(() => {
    for (const id of ids.split(',')) if (id) void loadChecklist(tripOwner(id));
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
    <View style={styles.list}>
      <AppText variant="caption" tone="textMuted">
        <Icon name="alert-decagram" size={12} color={colors.danger} /> marks sections with open essential tasks.
      </AppText>
      {trips.map((trip) => (
        <TripChecklistCard key={trip.id} trip={trip} />
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
  const [tab, setTab] = useState<Tab>('trips');
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
      {tab === 'trips' ? <TripsTab /> : <TemplatesTab />}
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
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
