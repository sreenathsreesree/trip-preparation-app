import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Collapsible, Icon, IconButton, Notice, OptionTile, TextField, ToggleRow } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { successFeedback } from '@/lib/haptics';
import { colors, spacing } from '@/theme';

import {
  ALERT_KIND_META,
  ALERT_KINDS,
  ALERT_STALE_DAYS,
  alertAgeDays,
  cleanTags,
  COMPANION_LIMITS,
  PRESET_TAGS,
  type AlertKind,
  type NodeAlert,
} from '../companion';
import { PLANNER_LIMITS, validateNodeName } from '../model';
import { usePlannerStore } from '../plannerStore';
import { DestinationWeather } from '../../weather/components/DestinationWeather';
import { useDetailAction, type DetailContext } from './shared';

const today = () => new Date().toISOString().slice(0, 10);

/** Name and the user's own notes (kept from the old place page; same test IDs). */
function NameForm({ ctx }: { ctx: DetailContext }) {
  const { tripId, node } = ctx;
  const [name, setName] = useState(node.name);
  const [notes, setNotes] = useState(node.notes);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const dirty = name.trim() !== node.name || notes.trim() !== node.notes;
  const nameError = validateNodeName(name);

  async function save() {
    if (nameError) return;
    setSaving(true);
    setMessage(null);
    try {
      await usePlannerStore.getState().updateNode(tripId, node.id, { name, notes });
      successFeedback();
      setMessage({ tone: 'success', text: 'Saved.' });
    } catch (err) {
      setMessage({ tone: 'danger', text: toErrorMessage(err, 'Could not save.') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.group}>
      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        error={nameError ?? undefined}
        maxLength={PLANNER_LIMITS.nameMax}
        helper={node.parentId ? undefined : 'Shown as one of this trip’s destinations'}
        testID="plan-place-name"
      />
      <TextField
        label="Quick notes"
        placeholder="Timings, tickets, ideas…"
        value={notes}
        onChangeText={setNotes}
        maxLength={PLANNER_LIMITS.notesMax}
        multiline
        testID="plan-place-notes"
      />
      {dirty ? (
        <Button label="Save changes" icon="content-save-outline" onPress={() => void save()} loading={saving} disabled={!!nameError} testID="plan-place-save" />
      ) : null}
      {message ? <Notice tone={message.tone} title={message.text} /> : null}
    </View>
  );
}

/** The user's own description and practical facts. Nothing is filled in automatically. */
function FactsForm({ ctx }: { ctx: DetailContext }) {
  const { tripId, node, profile } = ctx;
  const { act, busy, error } = useDetailAction(tripId, node.id);
  const [facts, setFacts] = useState({ about: profile.about, bestSeason: profile.bestSeason, entryFee: profile.entryFee, travelInfo: profile.travelInfo });
  const [saved, setSaved] = useState(false);
  const dirty =
    facts.about.trim() !== profile.about ||
    facts.bestSeason.trim() !== profile.bestSeason ||
    facts.entryFee.trim() !== profile.entryFee ||
    facts.travelInfo.trim() !== profile.travelInfo;
  const edit = (patch: Partial<typeof facts>) => {
    setSaved(false);
    setFacts((f) => ({ ...f, ...patch }));
  };

  return (
    <View testID="detail-facts">
      <View style={styles.group}>
        <AppText variant="caption" tone="textMuted">
          Your own notes from official sites, guides or friends — nothing here is filled in for you.
        </AppText>
        <TextField label="Description" placeholder="What makes it worth visiting" value={facts.about} onChangeText={(about) => edit({ about })} maxLength={COMPANION_LIMITS.textMax} multiline testID="detail-about" />
        <TextField label="Best season" placeholder="e.g. September to March" value={facts.bestSeason} onChangeText={(bestSeason) => edit({ bestSeason })} maxLength={COMPANION_LIMITS.shortMax} testID="detail-season" />
        <TextField label="Entry fee" placeholder="e.g. ₹200 per adult (checked Nov 2026)" value={facts.entryFee} onChangeText={(entryFee) => edit({ entryFee })} maxLength={COMPANION_LIMITS.shortMax} testID="detail-fee" />
        <TextField label="Getting there" placeholder="Road, parking, last bus…" value={facts.travelInfo} onChangeText={(travelInfo) => edit({ travelInfo })} maxLength={COMPANION_LIMITS.textMax} multiline testID="detail-travel" />
        {dirty ? (
          <Button
            label="Save details"
            icon="content-save-outline"
            loading={busy}
            onPress={() => void act((c) => c.updateProfile(node.id, facts)).then((ok) => setSaved(ok))}
            testID="detail-facts-save"
          />
        ) : null}
        {saved && !dirty ? <Notice tone="success" title="Details saved." /> : null}
        {error ? <Notice tone="danger" title={error} /> : null}
      </View>
    </View>
  );
}

function TagsEditor({ ctx }: { ctx: DetailContext }) {
  const { tripId, node, profile } = ctx;
  const { act, error } = useDetailAction(tripId, node.id);
  const [custom, setCustom] = useState('');
  const has = (tag: string) => profile.tags.some((t) => t.toLocaleLowerCase() === tag.toLocaleLowerCase());
  const save = (tags: string[]) => act((c) => c.updateProfile(node.id, { tags: cleanTags(tags) }));
  const custom_ = profile.tags.filter((t) => !(PRESET_TAGS as readonly string[]).includes(t));

  return (
    <View style={styles.group} testID="detail-tags">
      <View style={styles.chips}>
        {[...PRESET_TAGS, ...custom_].map((tag) => (
          <OptionTile
            key={tag}
            layout="chip"
            role="button"
            label={tag}
            icon={has(tag) ? 'tag' : 'tag-outline'}
            selected={has(tag)}
            onPress={() => void save(has(tag) ? profile.tags.filter((t) => t !== tag) : [...profile.tags, tag])}
            testID={`detail-tag-${tag}`}
          />
        ))}
      </View>
      <View style={styles.inline}>
        <View style={styles.flex}>
          <TextField label="Your own tag" placeholder="e.g. Rainy day" value={custom} onChangeText={setCustom} maxLength={COMPANION_LIMITS.tagMax} testID="detail-tag-input" />
        </View>
        <Button
          label="Add"
          size="sm"
          variant="secondary"
          disabled={!custom.trim() || profile.tags.length >= COMPANION_LIMITS.tagsMax}
          onPress={() => void save([...profile.tags, custom]).then((ok) => ok && setCustom(''))}
          style={styles.addButton}
          testID="detail-tag-add"
        />
      </View>
      {error ? <Notice tone="danger" title={error} /> : null}
    </View>
  );
}

function AlertCard({ alert, ctx }: { alert: NodeAlert; ctx: DetailContext }) {
  const { act } = useDetailAction(ctx.tripId, ctx.node.id);
  const meta = ALERT_KIND_META[alert.kind];
  const age = alertAgeDays(alert, new Date());
  const stale = age > ALERT_STALE_DAYS;
  const checked = (alert.observedAt ?? alert.createdAt).slice(0, 10);
  return (
    <Card padding="md" testID={`detail-alert-${alert.title}`}>
      <View style={styles.alert}>
      <View style={styles.inline}>
        <Icon name={meta.icon} size={20} color={alert.confirmed ? colors.warning : colors.info} />
        <View style={styles.flex}>
          <AppText variant="bodyStrong">{alert.title}</AppText>
          <AppText variant="caption" tone="textMuted">
            {meta.label} · {alert.confirmed ? 'Confirmed' : 'For information'}
          </AppText>
        </View>
        <IconButton icon="delete-outline" size="sm" variant="plain" accessibilityLabel={`Delete notice ${alert.title}`} onPress={() => void act((c) => c.removeAlert(alert.id))} testID={`detail-alert-delete-${alert.title}`} />
      </View>
      {alert.body ? <AppText variant="body">{alert.body}</AppText> : null}
      <AppText variant="caption" tone={stale ? 'warning' : 'textMuted'}>
        Source: {alert.source} · checked {checked}
        {stale ? ' · may be out of date, check again' : ''}
      </AppText>
      {alert.sourceUrl ? (
        <Button label="Open source" icon="open-in-new" variant="ghost" size="sm" onPress={() => void Linking.openURL(alert.sourceUrl as string)} style={styles.left} />
      ) : null}
      </View>
    </Card>
  );
}

function AlertForm({ ctx, onDone }: { ctx: DetailContext; onDone: () => void }) {
  const { act, busy, error } = useDetailAction(ctx.tripId, ctx.node.id);
  const [kind, setKind] = useState<AlertKind>('info');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [source, setSource] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [observedAt, setObservedAt] = useState(today());
  const [confirmed, setConfirmed] = useState(false);
  return (
    <View style={styles.group} testID="detail-alert-form">
      <View style={styles.chips}>
        {ALERT_KINDS.map((k) => (
          <OptionTile key={k} layout="chip" label={ALERT_KIND_META[k].label} icon={ALERT_KIND_META[k].icon} selected={kind === k} onPress={() => setKind(k)} testID={`detail-alert-kind-${k}`} />
        ))}
      </View>
      <TextField label="Notice" placeholder="e.g. Ghat road closed for repairs" value={title} onChangeText={setTitle} maxLength={COMPANION_LIMITS.titleMax} testID="detail-alert-title" />
      <TextField label="Details (optional)" value={body} onChangeText={setBody} maxLength={COMPANION_LIMITS.textMax} multiline />
      <TextField label="Source" placeholder="e.g. District collector notice" value={source} onChangeText={setSource} maxLength={COMPANION_LIMITS.shortMax} testID="detail-alert-source" />
      <TextField label="Source link (optional)" placeholder="https://" value={sourceUrl} onChangeText={setSourceUrl} autoCapitalize="none" autoCorrect={false} />
      <TextField label="Checked on" placeholder="YYYY-MM-DD" value={observedAt} onChangeText={setObservedAt} maxLength={10} testID="detail-alert-date" />
      <ToggleRow label="Confirmed by an official source" value={confirmed} onChange={setConfirmed} />
      <View style={styles.inline}>
        <Button
          label="Save notice"
          icon="content-save-outline"
          size="sm"
          loading={busy}
          disabled={!title.trim() || !source.trim()}
          onPress={() =>
            void act((c) => c.addAlert(ctx.node.id, { kind, title, body, source, sourceUrl, confirmed, observedAt: observedAt.trim() || null })).then(
              (ok) => ok && onDone(),
            )
          }
          testID="detail-alert-save"
        />
        <Button label="Cancel" variant="ghost" size="sm" onPress={onDone} />
      </View>
      {error ? <Notice tone="danger" title={error} /> : null}
    </View>
  );
}

function Alerts({ ctx }: { ctx: DetailContext }) {
  const [adding, setAdding] = useState(false);
  const alerts = (ctx.details?.alerts ?? []).filter((a) => a.status === 'saved');
  return (
    <View style={styles.group} testID="detail-alerts">
      {!adding ? <Button label="Add notice" icon="plus" variant="ghost" size="sm" onPress={() => setAdding(true)} style={styles.left} testID="detail-alert-add" /> : null}
      <AppText variant="caption" tone="textMuted">
        Live alerts (road closures, weather warnings) aren’t connected. Save notices you’ve read, with where and when you saw them.
      </AppText>
      {adding ? <AlertForm ctx={ctx} onDone={() => setAdding(false)} /> : null}
      {alerts.map((alert) => (
        <AlertCard key={alert.id} alert={alert} ctx={ctx} />
      ))}
    </View>
  );
}

/** What this page keeps on the device (works offline) and what needs a connection. */
function OfflinePack({ ctx }: { ctx: DetailContext }) {
  const d = ctx.details;
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const stored = [
    ctx.node.place?.location ? 'location' : null,
    d ? count(d.tasks.length, 'task', 'tasks') : null,
    d ? count(d.notes.length, 'note', 'notes') : null,
    d ? count(d.alerts.filter((a) => a.status === 'saved').length, 'notice', 'notices') : null,
    d?.memory ? 'memories' : null,
    ctx.profile.coverImageUri ? 'cover photo' : null,
  ].filter((v): v is string => v !== null);
  return (
    <View testID="detail-offline">
      <AppText variant="body" style={styles.offlineText}>
        Saved on this device: {stored.join(', ')}.
      </AppText>
      <AppText variant="caption" tone="textMuted">
        Recommendations, place search and opening Maps need a connection.
      </AppText>
    </View>
  );
}

const snippet = (text: string, max = 70) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/**
 * The destination's own information, in sections that open on tap: notes,
 * description and facts, tags, weather and planned day, saved notices, and
 * what is kept offline. Nothing is removed — only folded away.
 */
export function OverviewTab({ ctx }: { ctx: DetailContext }) {
  const { node, profile, details } = ctx;
  const notices = (details?.alerts ?? []).filter((a) => a.status === 'saved').length;
  const facts = [profile.bestSeason && `Best: ${profile.bestSeason}`, profile.entryFee && `Entry: ${profile.entryFee}`].filter(Boolean).join(' · ');
  return (
    <View style={styles.root}>
      {profile.about ? (
        <AppText variant="body" testID="detail-about-text">
          {profile.about}
        </AppText>
      ) : null}
      <Collapsible title="Name & quick notes" icon="note-text-outline" summary={node.notes ? snippet(node.notes) : 'No notes yet'} testID="detail-section-notes">
        <NameForm key={ctx.node.updatedAt} ctx={ctx} />
      </Collapsible>
      <Collapsible title="Description & facts" icon="information-outline" summary={facts || (profile.about ? snippet(profile.about) : 'Season, entry fee, getting there')} testID="detail-section-about">
        <FactsForm ctx={ctx} />
      </Collapsible>
      <Collapsible title="Tags" icon="tag-outline" summary={profile.tags.length ? profile.tags.join(', ') : 'No tags yet'} testID="detail-section-tags">
        <TagsEditor ctx={ctx} />
      </Collapsible>
      <Collapsible title="Weather & planned day" icon="weather-partly-cloudy" summary="Forecast for this place and the day you plan to be here" testID="detail-section-weather">
        <DestinationWeather ctx={ctx} />
      </Collapsible>
      <Collapsible title="Alerts & notices" icon="alert-outline" summary={notices ? `${notices} saved ${notices === 1 ? 'notice' : 'notices'}` : 'None saved'} testID="detail-section-alerts">
        <Alerts ctx={ctx} />
      </Collapsible>
      <Collapsible title="Available offline" icon="cloud-off-outline" summary="What this page keeps on your device" testID="detail-section-offline">
        <OfflinePack ctx={ctx} />
      </Collapsible>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.md,
  },
  group: {
    gap: spacing.md,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  offlineText: {
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  alert: {
    gap: spacing.sm,
  },
  addButton: {
    marginTop: spacing.lg,
  },
  left: {
    alignSelf: 'flex-start',
  },
});
