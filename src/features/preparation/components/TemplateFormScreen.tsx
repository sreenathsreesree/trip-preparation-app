import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { goBackOrHome, ScreenHeader } from '@/components/layout/ScreenHeader';
import { Screen } from '@/components/layout/Screen';
import { Button, EmptyState, LoadingState, Notice, TextField } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { successFeedback } from '@/lib/haptics';
import { spacing } from '@/theme';

import { useTrip } from '../../trips/hooks';
import { useEnsureTemplatesLoaded } from '../hooks';
import { CHECKLIST_LIMITS } from '../model';
import { validateTemplateInput, type TemplateInput, type TemplateSummary } from '../templateRepository';
import { useTemplatesStore } from '../templatesStore';

type Mode =
  | { kind: 'create' }
  | { kind: 'edit'; templateId: string | undefined }
  | { kind: 'fromTrip'; tripId: string | undefined };

function Form({
  mode,
  initial,
  context,
}: {
  mode: Mode;
  initial: TemplateInput;
  context?: string;
}) {
  const store = useTemplatesStore.getState;
  const [input, setInput] = useState(initial);
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = validateTemplateInput(input);

  const copy = {
    create: { eyebrow: 'New template', title: 'Create a checklist template', cta: 'Create template' },
    edit: { eyebrow: 'Template', title: 'Edit details', cta: 'Save changes' },
    fromTrip: { eyebrow: context ?? 'Trip', title: 'Save as template', cta: 'Save template' },
  }[mode.kind];

  async function save() {
    setRevealed(true);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    setError(null);
    try {
      let saved: TemplateSummary;
      if (mode.kind === 'edit' && mode.templateId) {
        saved = await store().update(mode.templateId, input);
        successFeedback();
        goBackOrHome();
        return;
      } else if (mode.kind === 'fromTrip' && mode.tripId) {
        saved = await store().createFromTrip(mode.tripId, input);
      } else {
        saved = await store().create(input);
      }
      successFeedback();
      router.replace({ pathname: '/templates/[templateId]', params: { templateId: saved.id } });
    } catch (err) {
      setError(toErrorMessage(err, 'Could not save the template.'));
      setSaving(false);
    }
  }

  return (
    <Screen
      testID="template-form"
      footer={
        <View style={styles.footer}>
          <Button label="Cancel" variant="secondary" onPress={goBackOrHome} disabled={saving} />
          <Button
            label={copy.cta}
            icon="content-save-outline"
            onPress={() => void save()}
            loading={saving}
            style={styles.primary}
            testID="template-save"
          />
        </View>
      }
    >
      <ScreenHeader showBack backIcon="close" eyebrow={copy.eyebrow} title={copy.title} />
      {mode.kind === 'fromTrip' ? (
        <Notice
          tone="info"
          title="Copies this trip's sections and tasks"
          message="Titles, descriptions, notes and priorities are saved; ticks are not. Later changes to either the trip or the template stay separate."
        />
      ) : null}
      <TextField
        label="Template name"
        placeholder="e.g. Himalayan trek kit"
        value={input.name}
        onChangeText={(name) => setInput((current) => ({ ...current, name }))}
        error={revealed ? errors.name : undefined}
        maxLength={CHECKLIST_LIMITS.templateNameMax}
        showCount
        autoCapitalize="sentences"
        testID="template-name-input"
      />
      <TextField
        label="Description (optional)"
        placeholder="When should you use this checklist?"
        value={input.description}
        onChangeText={(description) => setInput((current) => ({ ...current, description }))}
        error={revealed ? errors.description : undefined}
        maxLength={CHECKLIST_LIMITS.templateDescriptionMax}
        multiline
        testID="template-description-input"
      />
      {error ? <Notice tone="danger" title="Not saved" message={error} /> : null}
    </Screen>
  );
}

export function NewTemplateScreen() {
  return <Form mode={{ kind: 'create' }} initial={{ name: '', description: '' }} />;
}

export function EditTemplateScreen({ templateId }: { templateId: string | undefined }) {
  useEnsureTemplatesLoaded();
  const status = useTemplatesStore((state) => state.status);
  const template = useTemplatesStore((state) => state.templates.find((t) => t.id === templateId));
  if (template) {
    return (
      <Form
        mode={{ kind: 'edit', templateId }}
        initial={{ name: template.name, description: template.description }}
      />
    );
  }
  return (
    <Screen bottomInset>
      <ScreenHeader showBack backIcon="close" title="Edit template" />
      {status === 'ready' ? (
        <EmptyState icon="file-question-outline" title="Template not found" message="It may have been deleted." />
      ) : (
        <LoadingState label="Loading template…" />
      )}
    </Screen>
  );
}

export function SaveTripAsTemplateScreen({ tripId }: { tripId: string | undefined }) {
  const { trip, status } = useTrip(tripId);
  if (trip) {
    return (
      <Form
        mode={{ kind: 'fromTrip', tripId }}
        initial={{ name: `${trip.name} checklist`.slice(0, CHECKLIST_LIMITS.templateNameMax), description: '' }}
        context={trip.name}
      />
    );
  }
  return (
    <Screen bottomInset>
      <ScreenHeader showBack backIcon="close" title="Save as template" />
      {status === 'ready' ? (
        <EmptyState icon="map-marker-question-outline" title="Trip not found" message="It may have been deleted." />
      ) : (
        <LoadingState label="Loading trip…" />
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
