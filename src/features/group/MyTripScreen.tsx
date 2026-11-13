import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { AppText, Button, Card, IconButton, Notice, OptionTile, TextField } from '@/components/ui';
import { getRepositories } from '@/db/repositories';
import { formatDate } from '@/lib/dates';
import { toErrorMessage } from '@/lib/errors';
import { spacing } from '@/theme';

import { PRIVATE_DOC_TYPES, type MyDocument, type PrivateDocType } from './myDocumentsRepository';

const LABELS: Record<PrivateDocType, string> = { passport: 'Passport', id: 'ID card', visa: 'Visa', insurance: 'Insurance', medical: 'Medical', ticket: 'My ticket', booking: 'My booking', other: 'Other' };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * My Trip: this person's own preparation — private documents, and links to
 * their packing, checklist, journal and personal expenses. Nothing here is
 * part of the Group Trip; other members (even the owner) never see it.
 */
export function MyTripScreen({ tripId }: { tripId: string }) {
  const [docs, setDocs] = useState<MyDocument[]>([]);
  const [form, setForm] = useState<{ title: string; type: PrivateDocType; date: string; reference: string; expiry: string }>({ title: '', type: 'passport', date: '', reference: '', expiry: '' });
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const { myDocuments } = await getRepositories();
    setDocs(await myDocuments.list(tripId));
  }, [tripId]);
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const add = async () => {
    setError(null);
    try {
      if ((form.date && !DATE.test(form.date)) || (form.expiry && !DATE.test(form.expiry))) throw new Error('Dates use the format YYYY-MM-DD.');
      const { myDocuments } = await getRepositories();
      await myDocuments.save(tripId, { title: form.title, type: form.type, date: form.date || null, reference: form.reference, link: '', expiry: form.expiry || null, placeName: '', notes: '' });
      setForm({ title: '', type: 'passport', date: '', reference: '', expiry: '' });
      await reload();
    } catch (e) {
      setError(toErrorMessage(e, 'Not saved.'));
    }
  };

  const links: { label: string; icon: 'bag-suitcase-outline' | 'clipboard-check-outline' | 'notebook-outline' | 'wallet-outline'; go: () => void; testID: string }[] = [
    { label: 'My packing (clothing, toiletries, medicines)', icon: 'bag-suitcase-outline', go: () => router.push({ pathname: '/trips/[tripId]/packing', params: { tripId } }), testID: 'mytrip-packing' },
    { label: 'My checklist and reminders', icon: 'clipboard-check-outline', go: () => router.push({ pathname: '/trips/[tripId]/sections', params: { tripId } }), testID: 'mytrip-checklist' },
    { label: 'My journal and memories', icon: 'notebook-outline', go: () => router.push({ pathname: '/trips/[tripId]/journal', params: { tripId } }), testID: 'mytrip-journal' },
    { label: 'My expenses (personal stay private)', icon: 'wallet-outline', go: () => router.push({ pathname: '/calculator/[tripId]', params: { tripId } }), testID: 'mytrip-expenses' },
  ];

  return (
    <Screen testID="my-trip-screen">
      <ScreenHeader showBack eyebrow="My Trip · private" title="Your own preparation" subtitle="Only you see this, whatever your role in a shared trip." />
      {links.map((l) => (
        <Button key={l.testID} label={l.label} icon={l.icon} variant="secondary" onPress={l.go} fullWidth testID={l.testID} />
      ))}
      <AppText variant="h3">Private documents</AppText>
      {error ? <Notice tone="danger" title={error} /> : null}
      {docs.map((d) => (
        <Card key={d.id} testID={`mydoc-${d.title}`}>
          <View style={styles.row}>
            <View style={styles.flex}>
              <AppText variant="bodyStrong">{d.title}</AppText>
              <AppText variant="caption" tone="textMuted">
                {[LABELS[d.type], d.reference ? `No. ${d.reference}` : '', d.date ? formatDate(d.date) : '', d.expiry ? `Expires ${formatDate(d.expiry)}` : ''].filter(Boolean).join(' · ')}
              </AppText>
            </View>
            <IconButton
              icon="close"
              size="sm"
              variant="plain"
              accessibilityLabel={`Remove ${d.title}`}
              onPress={() =>
                void getRepositories()
                  .then(({ myDocuments }) => myDocuments.remove(d.id))
                  .then(reload)
              }
            />
          </View>
        </Card>
      ))}
      <Card>
        <View style={styles.group}>
          <TextField label="Document (e.g. my passport)" value={form.title} onChangeText={(title) => setForm((f) => ({ ...f, title }))} maxLength={120} testID="mydoc-title" />
          <View style={styles.chips}>
            {PRIVATE_DOC_TYPES.map((t) => (
              <OptionTile key={t} layout="chip" icon="lock-outline" label={LABELS[t]} selected={form.type === t} onPress={() => setForm((f) => ({ ...f, type: t }))} testID={`mydoc-type-${t}`} />
            ))}
          </View>
          <TextField label="Number / reference" value={form.reference} onChangeText={(reference) => setForm((f) => ({ ...f, reference }))} maxLength={80} testID="mydoc-ref" />
          <TextField label="Date (YYYY-MM-DD, optional)" value={form.date} onChangeText={(date) => setForm((f) => ({ ...f, date }))} />
          <TextField label="Expiry (YYYY-MM-DD, optional)" value={form.expiry} onChangeText={(expiry) => setForm((f) => ({ ...f, expiry }))} testID="mydoc-expiry" />
          <Button label="Save privately" icon="lock-outline" size="sm" disabled={!form.title.trim()} onPress={() => void add()} testID="mydoc-add" />
          <AppText variant="caption" tone="textMuted">
            Kept on this phone only. Not shared with the group and not uploaded.
          </AppText>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
