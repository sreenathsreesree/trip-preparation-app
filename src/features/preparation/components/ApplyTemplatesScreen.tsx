import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { goBackOrHome, ScreenHeader } from '@/components/layout/ScreenHeader';
import { Screen } from '@/components/layout/Screen';
import { Button, EmptyState, ErrorState, LoadingState, Notice } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { successFeedback } from '@/lib/haptics';
import { spacing } from '@/theme';

import { useTrip } from '../../trips/hooks';
import { useChecklistStore, type ApplyResult } from '../checklistStore';
import { useEnsureTemplatesLoaded } from '../hooks';
import { useTemplatesStore } from '../templatesStore';
import { TemplatePicker } from './TemplatePicker';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function ApplyTemplatesScreen({ tripId }: { tripId: string | undefined }) {
  useEnsureTemplatesLoaded();
  const { trip } = useTrip(tripId);
  const templates = useTemplatesStore((state) => state.templates);
  const status = useTemplatesStore((state) => state.status);
  const loadError = useTemplatesStore((state) => state.error);
  const reload = useTemplatesStore((state) => state.load);
  const [selected, setSelected] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    if (!tripId || selected.length === 0) return;
    setApplying(true);
    setError(null);
    try {
      const outcome = await useChecklistStore.getState().applyTemplates(tripId, selected);
      successFeedback();
      setResult(outcome);
      setSelected([]);
    } catch (err) {
      setError(toErrorMessage(err, 'Could not add tasks from the templates.'));
    } finally {
      setApplying(false);
    }
  }

  return (
    <Screen
      testID="apply-templates-screen"
      footer={
        templates.length > 0 ? (
          <View style={styles.footer}>
            <Button label={result ? 'Back to trip' : 'Cancel'} variant="secondary" onPress={goBackOrHome} />
            <Button
              label={selected.length > 1 ? `Add from ${selected.length} templates` : 'Add tasks'}
              icon="playlist-plus"
              onPress={() => void apply()}
              disabled={selected.length === 0}
              loading={applying}
              style={styles.primary}
              testID="apply-templates-confirm"
            />
          </View>
        ) : undefined
      }
    >
      <ScreenHeader
        showBack
        backIcon="close"
        eyebrow={trip?.name}
        title="Add from template"
        subtitle="Copies tasks into this trip. Nothing already on the trip is changed, removed or unticked."
      />

      {result ? (
        <Notice
          tone="success"
          title={result.added > 0 ? `Added ${plural(result.added, 'task')}` : 'Nothing new to add'}
          message={[
            result.sectionsAdded > 0 ? `${plural(result.sectionsAdded, 'new section')} created.` : '',
            result.skipped > 0
              ? `${plural(result.skipped, 'task')} already on this trip ${result.skipped === 1 ? 'was' : 'were'} skipped.`
              : '',
          ]
            .filter(Boolean)
            .join(' ')}
          testID="apply-result"
        />
      ) : null}
      {error ? <Notice tone="danger" title="Not added" message={error} /> : null}

      {status === 'error' ? (
        <ErrorState message={loadError ?? 'Could not load templates.'} onRetry={() => void reload()} />
      ) : status !== 'ready' ? (
        <LoadingState label="Loading templates…" />
      ) : templates.length === 0 ? (
        <EmptyState
          icon="file-document-multiple-outline"
          title="No templates yet"
          message="Create a reusable checklist, or save this trip's checklist as one from its dashboard."
          action={{ label: 'Create a template', icon: 'plus', onPress: () => router.push('/templates/new') }}
        />
      ) : (
        <TemplatePicker
          templates={templates}
          selectedIds={selected}
          onToggle={(id) =>
            setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  primary: {
    flex: 1,
  },
});
