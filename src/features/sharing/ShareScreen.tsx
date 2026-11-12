import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { ActionSheet, AppText, Button, Card, Icon, LoadingState, Notice, Tag, type SheetAction } from '@/components/ui';
import { useAuthStore } from '@/features/auth/authStore';
import { isCloudConfigured } from '@/features/auth/supabase';
import { confirmAction } from '@/lib/confirm';
import { colors, spacing } from '@/theme';

import { useTrip } from '../trips/hooks';
import type { TripSummary } from '../trips/model';
import type { SharedMember } from './sharingApi';
import { useSharingStore, useTripSharing } from './sharingStore';

const ROLE_LABEL = { owner: 'Owner', editor: 'Can edit', viewer: 'Can view' } as const;

function WhatIsShared() {
  return (
    <Card testID="share-explainer">
      <View style={styles.group}>
        <AppText variant="title">What members see</AppText>
        {[
          ['check-circle-outline', 'The trip’s name and dates, and who is in it.'],
          ['check-circle-outline', 'Journal entries you switch to “Shared” — text, mood and place only.'],
          ['lock-outline', 'Everything else stays private on your device: your plan, checklists, packing, memories, photos and private entries.'],
          ['google-drive', 'Photos stay in your own Google Drive and are never uploaded to Trip Prep.'],
        ].map(([icon, text]) => (
          <View key={text} style={styles.inline}>
            <Icon name={icon as 'lock-outline'} size={18} color={icon === 'lock-outline' ? colors.warning : colors.accent} />
            <AppText variant="body" tone="textSecondary" style={styles.flex}>
              {text}
            </AppText>
          </View>
        ))}
      </View>
    </Card>
  );
}

function Members({ trip }: { trip: TripSummary }) {
  const sharing = useTripSharing(trip.id);
  const me = useAuthStore((s) => s.user?.id ?? null);
  const [selected, setSelected] = useState<SharedMember | null>(null);
  const isOwner = sharing.space?.role === 'owner';
  const store = useSharingStore.getState();
  const actions: SheetAction[] = selected
    ? [
        ...(selected.role !== 'editor' ? [{ key: 'editor', label: 'Allow editing', icon: 'pencil-outline' as const, onPress: () => void store.setRole(trip.id, selected.userId, 'editor') }] : []),
        ...(selected.role !== 'viewer' ? [{ key: 'viewer', label: 'View only', icon: 'eye-outline' as const, onPress: () => void store.setRole(trip.id, selected.userId, 'viewer') }] : []),
        {
          key: 'transfer',
          label: 'Make owner',
          icon: 'crown-outline',
          description: 'You become an editor',
          onPress: () => void store.transfer(trip.id, selected.userId),
        },
        { key: 'remove', label: 'Remove from trip', icon: 'account-remove-outline', destructive: true, onPress: () => void store.removeMember(trip.id, selected.userId) },
      ]
    : [];
  return (
    <View style={styles.group} testID="share-members">
      <AppText variant="label" tone="textSecondary">
        Members ({sharing.members.length})
      </AppText>
      <Card padding="xs">
        {sharing.members.map((m) => (
          <View key={m.userId} style={styles.member} testID={`share-member-${m.displayName}`}>
            <Icon name={m.role === 'owner' ? 'crown-outline' : 'account-outline'} size={20} color={colors.textSecondary} />
            <AppText variant="bodyStrong" style={styles.flex} numberOfLines={1}>
              {m.displayName || 'Member'}
              {m.userId === me ? ' (you)' : ''}
            </AppText>
            <Tag label={ROLE_LABEL[m.role]} />
            {isOwner && m.userId !== me ? (
              <Button label="Change" variant="ghost" size="sm" onPress={() => setSelected(m)} testID={`share-member-change-${m.displayName}`} />
            ) : null}
          </View>
        ))}
      </Card>
      <ActionSheet visible={selected !== null} title={selected?.displayName || 'Member'} actions={actions} onClose={() => setSelected(null)} testID="share-member-sheet" />
    </View>
  );
}

function Invites({ trip }: { trip: TripSummary }) {
  const sharing = useTripSharing(trip.id);
  const [link, setLink] = useState<{ url: string; role: 'editor' | 'viewer' } | null>(null);
  const [busy, setBusy] = useState(false);
  const make = async (role: 'editor' | 'viewer') => {
    setBusy(true);
    try {
      setLink({ url: await useSharingStore.getState().createInviteLink(trip.id, role), role });
    } catch {
      // The store shows the error.
    } finally {
      setBusy(false);
    }
  };
  const active = (sharing.invites ?? []).filter((i) => !i.revokedAt && i.uses < i.maxUses);
  return (
    <View style={styles.group} testID="share-invites">
      <AppText variant="label" tone="textSecondary">
        Invite people
      </AppText>
      <View style={styles.row}>
        <Button label="Invite to edit" icon="account-plus-outline" size="sm" loading={busy} onPress={() => void make('editor')} testID="share-invite-editor" />
        <Button label="Invite to view" icon="eye-plus-outline" variant="secondary" size="sm" disabled={busy} onPress={() => void make('viewer')} testID="share-invite-viewer" />
      </View>
      {link ? (
        <Card variant="outline" testID="share-invite-link">
          <View style={styles.group}>
            <AppText variant="caption" tone="textMuted">
              Send this link to the people you want to {link.role === 'editor' ? 'edit with you' : 'view the trip'}. It works for 7 days and up to 10 people. Anyone with the link can join, so share it privately.
            </AppText>
            <AppText variant="body" selectable numberOfLines={3}>
              {link.url}
            </AppText>
            <Button
              label="Share link"
              icon="share-variant-outline"
              size="sm"
              onPress={() => void Share.share({ message: `Join my trip “${trip.name}” on Trip Prep: ${link.url}` }).catch(() => undefined)}
              style={styles.left}
            />
          </View>
        </Card>
      ) : null}
      {active.map((i) => (
        <View key={i.id} style={styles.member}>
          <Icon name="link-variant" size={18} color={colors.textMuted} />
          <AppText variant="caption" tone="textSecondary" style={styles.flex}>
            {ROLE_LABEL[i.role]} link · used {i.uses} of {i.maxUses} · until {i.expiresAt.slice(0, 10)}
          </AppText>
          <Button label="Cancel" variant="ghost" size="sm" onPress={() => void useSharingStore.getState().revokeInvite(trip.id, i.id)} />
        </View>
      ))}
    </View>
  );
}

function ShareTrip({ trip }: { trip: TripSummary }) {
  const sharing = useTripSharing(trip.id);
  const signedIn = useAuthStore((s) => s.status === 'signedIn');
  const [busy, setBusy] = useState(false);
  const space = sharing.space;
  const store = useSharingStore.getState();

  if (!isCloudConfigured()) {
    return <Notice tone="info" icon="cloud-off-outline" title="Sharing isn’t available in this build" message="Trip sharing needs the Trip Prep cloud. Your trip works fully on this device." testID="share-unavailable" />;
  }
  if (!signedIn) {
    return (
      <Notice
        tone="info"
        icon="account-multiple-outline"
        title="Sign in to share trips"
        message="Sharing uses your Google account so members know who you are."
        action={{ label: 'Sign in', icon: 'login', onPress: () => router.push('/auth/sign-in') }}
        testID="share-signin"
      />
    );
  }
  if (!space) {
    return (
      <View style={styles.group}>
        <Button
          label="Share this trip"
          icon="account-multiple-plus-outline"
          loading={busy}
          onPress={() => {
            setBusy(true);
            void store
              .share(trip)
              .catch(() => undefined)
              .finally(() => setBusy(false));
          }}
          fullWidth
          testID="share-start"
        />
        {sharing.error ? <Notice tone="danger" title={sharing.error} testID="share-error" /> : null}
      </View>
    );
  }
  if (space.role === 'removed') {
    return (
      <View style={styles.group}>
        <Notice tone="warning" title="You’re no longer a member of this shared trip" message="Everything already on this device stays here." testID="share-removed" />
        <Button label="Keep as a private trip" variant="secondary" onPress={() => void store.stop(trip.id)} testID="share-forget" />
      </View>
    );
  }

  const stop = async () => {
    const owner = space.role === 'owner';
    const ok = await confirmAction({
      title: owner ? 'Stop sharing this trip?' : 'Leave this shared trip?',
      message: owner
        ? 'The shared trip is deleted for every member. Your own trip, journal and photos stay on this device; your shared entries become private.'
        : 'You lose access to members’ entries. Your trip and journal stay on this device; your shared entries become private.',
      confirmLabel: owner ? 'Stop sharing' : 'Leave',
      destructive: true,
    });
    if (ok) await store.stop(trip.id).catch(() => undefined);
  };

  return (
    <View style={styles.group}>
      <View style={styles.inline}>
        <Tag label={`You: ${ROLE_LABEL[space.role]}`} icon="account-check-outline" color={colors.accent} />
        <AppText variant="caption" tone="textMuted" style={styles.flex} testID="share-status">
          {sharing.syncing ? 'Syncing…' : sharing.waiting > 0 ? `${sharing.waiting} change(s) waiting to send` : space.lastSyncedAt ? `Up to date · ${space.lastSyncedAt.slice(11, 16)}` : 'Not synced yet'}
        </AppText>
        <Button label="Sync" variant="ghost" size="sm" onPress={() => void store.sync(trip.id)} testID="share-sync" />
      </View>
      {sharing.error ? <Notice tone="warning" title={sharing.error} testID="share-error" /> : null}
      <Members trip={trip} />
      {space.role === 'owner' ? <Invites trip={trip} /> : null}
      <Button label={space.role === 'owner' ? 'Stop sharing' : 'Leave trip'} icon="account-multiple-remove-outline" variant="danger" onPress={() => void stop()} testID="share-stop" />
    </View>
  );
}

export function ShareScreen({ tripId }: { tripId: string | undefined }) {
  const { trip } = useTrip(tripId);
  useFocusEffect(
    useCallback(() => {
      if (!tripId) return;
      const store = useSharingStore.getState();
      void store.load(tripId).then(async () => {
        await store.sync(tripId);
        await store.loadInvites(tripId).catch(() => undefined);
      });
    }, [tripId]),
  );
  return (
    <Screen testID="share-screen" bottomInset>
      <ScreenHeader showBack eyebrow={trip?.name} title="Share trip" />
      {trip ? (
        <>
          <WhatIsShared />
          <ShareTrip trip={trip} />
        </>
      ) : (
        <LoadingState label="Loading…" />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: spacing.md,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  left: {
    alignSelf: 'flex-start',
  },
});
