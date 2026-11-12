import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Icon, IconButton, Notice, OptionTile, TextField } from '@/components/ui';
import { colors, spacing } from '@/theme';

import { formatDistance } from '../../places/discovery';
import { distanceMeters } from '../arrival';
import {
  BEST_TIME_LABELS,
  BEST_TIMES,
  COMPANION_LIMITS,
  formatMinutes,
  NOTE_KIND_META,
  NOTE_KINDS,
  visitLength,
  type NodeNote,
  type NoteKind,
} from '../companion';
import { dayLengthMinutes, sunTimes } from '../sun';
import { useDetailAction, type DetailContext } from './shared';

const DURATIONS = [30, 60, 120, 180, 240, 480] as const;
const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
/** The phone's UTC offset on that day, e.g. "UTC+5:30". */
function utcOffset(d: Date): string {
  const minutes = -d.getTimezoneOffset();
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  return `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, '0')}` : ''}`;
}

function RouteContext({ ctx }: { ctx: DetailContext }) {
  const { plan, node } = ctx;
  const index = plan.route.findIndex((s) => s.nodeId === node.id);
  if (index < 0) {
    return (
      <AppText variant="caption" tone="textMuted" testID="detail-plan-route">
        Not on the route. Add it to see the stop before it and how far apart they are.
      </AppText>
    );
  }
  const previous = index > 0 ? plan.nodes.find((n) => n.id === plan.route[index - 1]?.nodeId) : null;
  const here = node.place?.location;
  const there = previous?.place?.location;
  return (
    <View style={styles.group} testID="detail-plan-route">
      <AppText variant="bodyStrong">
        Stop {index + 1} of {plan.route.length}
      </AppText>
      {previous ? (
        <AppText variant="body">
          After {previous.name}
          {here && there ? ` · about ${formatDistance(distanceMeters(there, here))} in a straight line` : ''}
        </AppText>
      ) : (
        <AppText variant="body">First stop of the route</AppText>
      )}
      {previous && !(here && there) ? (
        <AppText variant="caption" tone="textMuted">
          Choose a location for both places to see the distance.
        </AppText>
      ) : null}
      {previous && here && there ? (
        <AppText variant="caption" tone="textMuted">
          Road distance and drive time need live directions, which aren’t connected. Open Navigation for directions.
        </AppText>
      ) : null}
    </View>
  );
}

function SunCard({ ctx, startDate }: { ctx: DetailContext; startDate: string | null }) {
  const location = ctx.node.place?.location;
  if (!location) {
    return (
      <AppText variant="caption" tone="textMuted" testID="detail-sun">
        Choose a location to see sunrise and sunset.
      </AppText>
    );
  }
  const todayIso = new Date().toISOString().slice(0, 10);
  const useTrip = startDate !== null && startDate >= todayIso;
  const day = new Date(`${useTrip ? startDate : todayIso}T12:00:00`);
  const sun = sunTimes(day, location);
  const length = dayLengthMinutes(sun);
  return (
    <View style={styles.group} testID="detail-sun">
      <AppText variant="caption" tone="textMuted">
        {useTrip ? `On your first trip day (${startDate})` : 'Today'} · your phone’s time ({utcOffset(day)})
      </AppText>
      {sun.kind === 'normal' ? (
        <View style={styles.sunRow}>
          <View style={styles.sun}>
            <Icon name="weather-sunset-up" size={22} color={colors.warning} />
            <AppText variant="bodyStrong">{time(sun.sunrise)}</AppText>
          </View>
          <View style={styles.sun}>
            <Icon name="weather-sunset-down" size={22} color={colors.warning} />
            <AppText variant="bodyStrong">{time(sun.sunset)}</AppText>
          </View>
          {length !== null ? (
            <AppText variant="caption" tone="textMuted">
              {formatMinutes(length)} of daylight
            </AppText>
          ) : null}
        </View>
      ) : (
        <AppText variant="body">{sun.kind === 'polar-day' ? 'The sun doesn’t set that day.' : 'The sun doesn’t rise that day.'}</AppText>
      )}
      <AppText variant="caption" tone="textMuted">
        Calculated on this device. Hills and valleys can make it a little later or earlier.
      </AppText>
    </View>
  );
}

function Timing({ ctx }: { ctx: DetailContext }) {
  const { profile, node } = ctx;
  const { act, error } = useDetailAction(ctx.tripId, node.id);
  const [custom, setCustom] = useState('');
  const length = visitLength(profile.visitMinutes);
  const customMinutes = Number(custom);
  return (
    <View style={styles.group} testID="detail-timing">
      <AppText variant="label" tone="textSecondary">
        Time to spend here
      </AppText>
      <AppText variant="body" testID="detail-visit-length">
        {profile.visitMinutes ? `${formatMinutes(profile.visitMinutes)}${length ? ` · ${length.label}` : ''}` : 'Not planned yet'}
      </AppText>
      <View style={styles.chips}>
        {DURATIONS.map((m) => (
          <OptionTile
            key={m}
            layout="chip"
            label={formatMinutes(m)}
            icon="clock-outline"
            selected={profile.visitMinutes === m}
            onPress={() => void act((c) => c.updateProfile(node.id, { visitMinutes: profile.visitMinutes === m ? null : m }))}
            testID={`detail-duration-${m}`}
          />
        ))}
      </View>
      <View style={styles.inline}>
        <View style={styles.flex}>
          <TextField label="Or minutes" placeholder="e.g. 45" value={custom} onChangeText={setCustom} keyboardType="number-pad" maxLength={5} testID="detail-duration-input" />
        </View>
        <Button
          label="Set"
          size="sm"
          variant="secondary"
          disabled={!Number.isInteger(customMinutes) || customMinutes <= 0 || customMinutes > COMPANION_LIMITS.visitMinutesMax}
          onPress={() => void act((c) => c.updateProfile(node.id, { visitMinutes: customMinutes })).then((ok) => ok && setCustom(''))}
          style={styles.setButton}
          testID="detail-duration-set"
        />
      </View>
      <AppText variant="label" tone="textSecondary">
        Best time to go
      </AppText>
      <View style={styles.chips}>
        {BEST_TIMES.map((t) => (
          <OptionTile
            key={t}
            layout="chip"
            label={BEST_TIME_LABELS[t]}
            icon="weather-sunny"
            selected={profile.bestTime === t}
            onPress={() => void act((c) => c.updateProfile(node.id, { bestTime: profile.bestTime === t ? null : t }))}
            testID={`detail-best-${t}`}
          />
        ))}
      </View>
      {error ? <Notice tone="danger" title={error} /> : null}
    </View>
  );
}

function NoteRow({ note, ctx }: { note: NodeNote; ctx: DetailContext }) {
  const { act } = useDetailAction(ctx.tripId, ctx.node.id);
  return (
    <View style={styles.note} testID={`detail-note-${note.kind}`}>
      <AppText variant="body" style={styles.flex}>
        {note.body}
      </AppText>
      <IconButton icon="delete-outline" size="sm" variant="plain" tone="textMuted" accessibilityLabel="Delete note" onPress={() => void act((c) => c.removeNote(note.id))} />
    </View>
  );
}

function Notes({ ctx }: { ctx: DetailContext }) {
  const { act, busy, error } = useDetailAction(ctx.tripId, ctx.node.id);
  const [kind, setKind] = useState<NoteKind>('why');
  const [body, setBody] = useState('');
  const notes = ctx.details?.notes ?? [];
  return (
    <View style={styles.group} testID="detail-notes">
      <AppText variant="title">Notes</AppText>
      {NOTE_KINDS.map((k) => {
        const list = notes.filter((n) => n.kind === k);
        if (list.length === 0) return null;
        return (
          <Card key={k} padding="md">
            <View style={styles.group}>
              <View style={styles.inline}>
                <Icon name={NOTE_KIND_META[k].icon} size={18} color={colors.accent} />
                <AppText variant="label" tone="textSecondary">
                  {NOTE_KIND_META[k].label}
                </AppText>
              </View>
              {list.map((note) => (
                <NoteRow key={note.id} note={note} ctx={ctx} />
              ))}
            </View>
          </Card>
        );
      })}
      <View style={styles.chips}>
        {NOTE_KINDS.map((k) => (
          <OptionTile key={k} layout="chip" label={NOTE_KIND_META[k].label} icon={NOTE_KIND_META[k].icon} selected={kind === k} onPress={() => setKind(k)} testID={`detail-note-kind-${k}`} />
        ))}
      </View>
      <TextField label={NOTE_KIND_META[kind].label} value={body} onChangeText={setBody} maxLength={COMPANION_LIMITS.textMax} multiline testID="detail-note-input" />
      <Button
        label="Add note"
        icon="plus"
        size="sm"
        loading={busy}
        disabled={!body.trim()}
        onPress={() => void act((c) => c.addNote(ctx.node.id, { kind, body })).then((ok) => ok && setBody(''))}
        style={styles.left}
        testID="detail-note-add"
      />
      {error ? <Notice tone="danger" title={error} /> : null}
    </View>
  );
}

export function PlanTab({ ctx, startDate }: { ctx: DetailContext; startDate: string | null }) {
  return (
    <View style={styles.root} testID="detail-plan">
      <Card>
        <RouteContext ctx={ctx} />
      </Card>
      <Timing ctx={ctx} />
      <Card>
        <SunCard ctx={ctx} startDate={startDate} />
      </Card>
      <Notes ctx={ctx} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.xl,
  },
  group: {
    gap: spacing.sm,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  left: {
    alignSelf: 'flex-start',
  },
  setButton: {
    marginTop: spacing.lg,
  },
  sunRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.lg,
  },
  sun: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
});
