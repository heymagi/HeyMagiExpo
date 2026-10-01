/**
 * Card registry.
 *
 * MAGI's tool calls come back as cards and this maps each kind to what the user sees. The
 * app has one screen, so this is where the whole feature surface lives — check-ins,
 * challenges, patterns, GP summaries, support resources — all of it inline in the
 * conversation rather than behind navigation.
 *
 * Every card carries `accessibleSummary` from the server, which is what a screen reader reads
 * instead of trying to make sense of the visual arrangement.
 */

import { useState } from 'react';
import { View, Linking, Pressable } from 'react-native';
import {
  CircleCheck,
  NotebookPen,
  Sparkles,
  CalendarHeart,
  Brain,
  FileText,
  UserCog,
  LifeBuoy,
  ShieldCheck,
  Trash2,
  BarChart3,
  Phone,
  MessageSquare,
} from 'lucide-react-native';
import { Card } from '@/components/ui/Card';
import { AppText } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { useTheme } from '@/theme';
import type { MagiCard } from '@/supabase/functions/_shared/types.ts';
import type { CrisisResource } from '@/supabase/functions/_shared/crisis-resources.ts';

export interface CardHostProps {
  card: MagiCard;
  onResolve: (
    card: MagiCard,
    decision: 'accept' | 'reject',
    editedInput?: Record<string, unknown>,
  ) => void;
  /** Disables the buttons while a turn is in flight. */
  busy?: boolean;
}

const OVERALL_WORDS: Record<string, string> = {
  rough: 'a rough one',
  low: 'low',
  ok: 'okay',
  good: 'good',
  bright: 'bright',
};

export function MagiCardView({ card, onResolve, busy }: CardHostProps) {
  switch (card.kind) {
    case 'check_in_logged':
      return <CheckInCard card={card} />;
    case 'note_saved':
      return <NoteCard card={card} />;
    case 'cycle_logged':
      return <CycleCard card={card} />;
    case 'challenge':
      return <ChallengeCard card={card} />;
    case 'challenge_updated':
      return <ChallengeUpdatedCard card={card} />;
    case 'memory_saved':
      return <MemoryCard card={card} />;
    case 'memory_removed':
      return <MemoryRemovedCard card={card} />;
    case 'history':
      return <HistoryCard card={card} />;
    case 'insight_proposal':
      return <InsightCard card={card} onResolve={onResolve} busy={busy} />;
    case 'summary_proposal':
      return <SummaryCard card={card} onResolve={onResolve} busy={busy} />;
    case 'profile_proposal':
      return <ProfileCard card={card} onResolve={onResolve} busy={busy} />;
    case 'support_resources':
      return <ResourcesCard card={card} />;
    case 'safety_plan':
      return <SafetyPlanCard card={card} />;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * Confirmations — things that already happened
 * ------------------------------------------------------------------ */

function CardHeader({ icon, text, color }: { icon: React.ReactNode; text: string; color: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xs }}>
      {icon}
      <AppText role="bodySmall" weight="semibold" color={color}>
        {text}
      </AppText>
    </View>
  );
}

function CheckInCard({ card }: { card: MagiCard }) {
  const t = useTheme();
  const a = t.accent.sage;
  const overall = String(card.data.overall ?? '');
  const note = card.data.note ? String(card.data.note) : null;
  const signals = Number(card.data.signal_count ?? 0);

  return (
    <Card accent="sage" accessibleSummary={card.accessibleSummary}>
      <CardHeader
        icon={<CircleCheck size={18} color={a.onWash} aria-hidden />}
        text={`Today: ${OVERALL_WORDS[overall] ?? overall}`}
        color={a.onWash}
      />
      {note ? (
        <AppText role="bodySmall" color={a.onWash} style={{ opacity: 0.9 }}>
          “{note}”
        </AppText>
      ) : null}
      {signals > 0 ? (
        <AppText role="caption" color={a.onWash} style={{ opacity: 0.8 }}>
          {signals} {signals === 1 ? 'thing' : 'things'} tracked alongside it
        </AppText>
      ) : null}
    </Card>
  );
}

function NoteCard({ card }: { card: MagiCard }) {
  const t = useTheme();
  const a = t.accent.pink;
  return (
    <Card accent="pink" accessibleSummary={card.accessibleSummary}>
      <CardHeader
        icon={<NotebookPen size={18} color={a.onWash} aria-hidden />}
        text="Kept, in your words"
        color={a.onWash}
      />
      <AppText role="bodySmall" color={a.onWash} style={{ opacity: 0.9 }}>
        “{String(card.data.excerpt ?? '')}”
      </AppText>
    </Card>
  );
}

function CycleCard({ card }: { card: MagiCard }) {
  const t = useTheme();
  const a = t.accent.rose;
  const kind = String(card.data.kind ?? '').replace(/_/g, ' ');
  return (
    <Card accent="rose" accessibleSummary={card.accessibleSummary}>
      <CardHeader
        icon={<CalendarHeart size={18} color={a.onWash} aria-hidden />}
        text={`${kind} · ${String(card.data.local_date ?? '')}`}
        color={a.onWash}
      />
    </Card>
  );
}

function MemoryCard({ card }: { card: MagiCard }) {
  const t = useTheme();
  const a = t.accent.green;
  const unconfirmed = card.data.provenance !== 'stated';
  return (
    <Card accent="green" accessibleSummary={card.accessibleSummary}>
      <CardHeader
        icon={<Brain size={18} color={a.onWash} aria-hidden />}
        text={unconfirmed ? 'MAGI thinks' : 'MAGI knows'}
        color={a.onWash}
      />
      <AppText role="bodySmall" color={a.onWash}>
        {String(card.data.value ?? '')}
      </AppText>
      {unconfirmed ? (
        <AppText role="caption" color={a.onWash} style={{ opacity: 0.8 }}>
          Not confirmed — tell her if this is wrong and it goes.
        </AppText>
      ) : null}
    </Card>
  );
}

function MemoryRemovedCard({ card }: { card: MagiCard }) {
  const t = useTheme();
  return (
    <Card accessibleSummary={card.accessibleSummary}>
      <CardHeader
        icon={<Trash2 size={18} color={t.inkMuted} aria-hidden />}
        text="Forgotten"
        color={t.inkMuted}
      />
    </Card>
  );
}

function ChallengeUpdatedCard({ card }: { card: MagiCard }) {
  const t = useTheme();
  const state = String(card.data.state ?? '').replace(/_/g, ' ');
  return (
    <Card accessibleSummary={card.accessibleSummary}>
      <AppText role="caption" tone="muted">
        {state === 'skipped' || state === 'declined' ? 'Left for now' : `Marked ${state}`}
      </AppText>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Challenge
 * ------------------------------------------------------------------ */

function ChallengeCard({ card }: { card: MagiCard }) {
  const t = useTheme();
  const a = t.accent.amber;
  const [showWhy, setShowWhy] = useState(false);
  const why = card.data.offered_because ? String(card.data.offered_because) : null;

  return (
    <Card accent="amber" accessibleSummary={card.accessibleSummary}>
      <CardHeader
        icon={<Sparkles size={18} color={a.onWash} aria-hidden />}
        text={String(card.data.title ?? '')}
        color={a.onWash}
      />
      <AppText role="body" color={a.onWash}>
        {String(card.data.invitation ?? '')}
      </AppText>
      {card.data.detail ? (
        <AppText role="bodySmall" color={a.onWash} style={{ opacity: 0.88 }}>
          {String(card.data.detail)}
        </AppText>
      ) : null}

      {/* No "complete" button. Marking it done happens by telling MAGI, because a button
          creates an obligation, and an unpressed button becomes a reproach. */}
      {why ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showWhy ? 'Hide why MAGI suggested this' : 'Why did MAGI suggest this?'}
          accessibilityState={{ expanded: showWhy }}
          onPress={() => setShowWhy((v) => !v)}
          style={{ minHeight: t.touch.min, justifyContent: 'center' }}
        >
          <AppText role="caption" weight="semibold" color={a.onWash} style={{ opacity: 0.85 }}>
            {showWhy ? 'Hide reason' : 'Why this?'}
          </AppText>
        </Pressable>
      ) : null}
      {showWhy && why ? (
        <AppText role="caption" color={a.onWash} style={{ opacity: 0.85 }}>
          {why}
        </AppText>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * History
 * ------------------------------------------------------------------ */

function HistoryCard({ card }: { card: MagiCard }) {
  const t = useTheme();
  const checkIns = (card.data.checkIns ?? []) as { local_date: string; overall: string | null }[];
  const notes = (card.data.notes ?? []) as unknown[];
  const signals = (card.data.signals ?? []) as { label: string; readings: unknown[] }[];

  return (
    <Card accessibleSummary={card.accessibleSummary}>
      <CardHeader
        icon={<BarChart3 size={18} color={t.inkMuted} aria-hidden />}
        text={`${String(card.data.from ?? '')} to ${String(card.data.to ?? '')}`}
        color={t.inkMuted}
      />
      {checkIns.length === 0 && notes.length === 0 && signals.length === 0 ? (
        <AppText role="bodySmall" tone="muted">
          Nothing logged in that stretch.
        </AppText>
      ) : (
        <>
          {/* A dot per day, coloured by how it was rated. Deliberately not a line chart:
              a trend line invites reading meaning into three points. */}
          {checkIns.length ? (
            <View
              accessible
              accessibilityLabel={`${checkIns.length} days logged`}
              style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: t.space.xxs }}
            >
              {checkIns.map((c) => (
                <View
                  key={c.local_date}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: t.line,
                    backgroundColor: overallColor(c.overall, t),
                  }}
                />
              ))}
            </View>
          ) : null}
          <AppText role="caption" tone="muted">
            {checkIns.length} check-ins · {notes.length} notes ·{' '}
            {signals.reduce((n, s) => n + s.readings.length, 0)} readings
          </AppText>
        </>
      )}
    </Card>
  );
}

function overallColor(overall: string | null, t: ReturnType<typeof useTheme>): string {
  switch (overall) {
    case 'rough':
      return t.accent.rose.graphic;
    case 'low':
      return t.accent.amber.graphic;
    case 'ok':
      return t.accent.yellow.graphic;
    case 'good':
      return t.accent.sage.graphic;
    case 'bright':
      return t.accent.green.graphic;
    default:
      return t.surfaceSunken;
  }
}

/* ------------------------------------------------------------------ *
 * Proposals — nothing is saved until she taps
 * ------------------------------------------------------------------ */

function ProposalActions({
  card,
  onResolve,
  busy,
  editedInput,
}: CardHostProps & { editedInput?: Record<string, unknown> }) {
  const t = useTheme();
  if (!card.proposal) return null;
  return (
    <View style={{ flexDirection: 'row', gap: t.space.xs, flexWrap: 'wrap', marginTop: t.space.xs }}>
      <Button
        label={card.proposal.accept_label}
        variant="primary"
        accent="green"
        disabled={busy}
        onPress={() => onResolve(card, 'accept', editedInput)}
      />
      <Button
        label={card.proposal.reject_label}
        variant="quiet"
        disabled={busy}
        onPress={() => onResolve(card, 'reject')}
      />
    </View>
  );
}

function InsightCard({ card, onResolve, busy }: CardHostProps) {
  const t = useTheme();
  const a = t.accent.yellow;
  const [showEvidence, setShowEvidence] = useState(false);
  const basedOn = card.data.based_on as Record<string, unknown> | undefined;

  return (
    <Card accent="yellow" accessibleSummary={card.accessibleSummary}>
      <CardHeader
        icon={<Brain size={18} color={a.onWash} aria-hidden />}
        text="Something MAGI noticed"
        color={a.onWash}
      />
      <AppText role="body" color={a.onWash}>
        {String(card.data.observation ?? '')}
      </AppText>

      {basedOn && Object.keys(basedOn).length ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showEvidence ? "Hide what this is based on" : 'What is this based on?'}
            accessibilityState={{ expanded: showEvidence }}
            onPress={() => setShowEvidence((v) => !v)}
            style={{ minHeight: t.touch.min, justifyContent: 'center' }}
          >
            <AppText role="caption" weight="semibold" color={a.onWash}>
              {showEvidence ? 'Hide the working' : 'Based on what?'}
            </AppText>
          </Pressable>
          {showEvidence ? (
            <AppText role="caption" color={a.onWash} style={{ opacity: 0.9 }}>
              {Object.entries(basedOn)
                .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${JSON.stringify(v)}`)
                .join('\n')}
            </AppText>
          ) : null}
        </>
      ) : null}

      <ProposalActions card={card} onResolve={onResolve} busy={busy} />
    </Card>
  );
}

function SummaryCard({ card, onResolve, busy }: CardHostProps) {
  const t = useTheme();
  const saved = Boolean(card.data.saved);
  const [draft, setDraft] = useState(String(card.data.draft ?? ''));
  const sources = card.data.sources as Record<string, unknown> | undefined;

  if (saved) {
    return (
      <Card accent="green" accessibleSummary={card.accessibleSummary}>
        <CardHeader
          icon={<FileText size={18} color={t.accent.green.onWash} aria-hidden />}
          text="Summary saved"
          color={t.accent.green.onWash}
        />
      </Card>
    );
  }

  return (
    <Card accessibleSummary={card.accessibleSummary}>
      <CardHeader
        icon={<FileText size={18} color={t.inkMuted} aria-hidden />}
        text={`Draft for ${String(card.data.purpose ?? '').replace(/_/g, ' ')}`}
        color={t.inkMuted}
      />
      <AppText role="caption" tone="muted">
        {String(card.data.period_start ?? '')} to {String(card.data.period_end ?? '')}
        {sources ? ` · built from ${String(sources.check_in_count ?? 0)} check-ins and ${String(sources.note_count ?? 0)} notes` : ''}
      </AppText>

      {/* Editable before it is saved, because the document is hers and MAGI's draft is only
          ever a starting point. */}
      <Field
        label="Your summary"
        help="Change anything. What you save is what you take with you."
        value={draft}
        onChangeText={setDraft}
        multiline
        numberOfLines={10}
        style={{ marginTop: t.space.xs }}
      />

      <ProposalActions
        card={card}
        onResolve={onResolve}
        busy={busy}
        editedInput={{ ...(card.proposal?.input ?? {}), body: draft }}
      />
    </Card>
  );
}

function ProfileCard({ card, onResolve, busy }: CardHostProps) {
  const t = useTheme();
  const saved = Boolean(card.data.saved);
  const changes = (card.data.changes ?? {}) as Record<string, unknown>;

  return (
    <Card accent={saved ? 'green' : 'sage'} accessibleSummary={card.accessibleSummary}>
      <CardHeader
        icon={<UserCog size={18} color={t.accent.sage.onWash} aria-hidden />}
        text={saved ? 'Updated' : 'Have I got this right?'}
        color={t.accent.sage.onWash}
      />
      {Object.entries(changes).map(([key, value]) => (
        <AppText key={key} role="bodySmall" color={t.accent.sage.onWash}>
          <AppText role="bodySmall" weight="semibold" color={t.accent.sage.onWash}>
            {key.replace(/_/g, ' ')}:{' '}
          </AppText>
          {Array.isArray(value) ? value.join(', ') : String(value)}
        </AppText>
      ))}
      {!saved ? <ProposalActions card={card} onResolve={onResolve} busy={busy} /> : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Support
 * ------------------------------------------------------------------ */

export function ResourceRow({ resource }: { resource: CrisisResource }) {
  const t = useTheme();
  const a = t.role.critical;

  return (
    <View style={{ gap: t.space.xxs, paddingVertical: t.space.xs }}>
      <AppText role="bodySmall" weight="semibold" color={a.onWash}>
        {resource.name}
      </AppText>
      <AppText role="caption" color={a.onWash} style={{ opacity: 0.92 }}>
        {resource.description}
      </AppText>
      <View style={{ flexDirection: 'row', gap: t.space.xs, flexWrap: 'wrap' }}>
        {resource.tel ? (
          <Button
            label={`Call ${formatTel(resource.tel)}`}
            variant="secondary"
            accent="rose"
            icon={<Phone size={16} color={a.onWash} aria-hidden />}
            accessibilityHint="Opens your phone app"
            onPress={() => Linking.openURL(`tel:${resource.tel}`).catch(() => undefined)}
          />
        ) : null}
        {resource.sms ? (
          <Button
            label={`Text ${resource.sms}`}
            variant="secondary"
            accent="rose"
            icon={<MessageSquare size={16} color={a.onWash} aria-hidden />}
            accessibilityHint="Opens your messages app"
            onPress={() =>
              Linking.openURL(`sms:${resource.sms}${smsBody(resource)}`).catch(() => undefined)
            }
          />
        ) : null}
      </View>
      <AppText role="caption" color={a.onWash} style={{ opacity: 0.8 }}>
        {resource.hours}
      </AppText>
    </View>
  );
}

/** Shout expects the keyword SHOUT as the message body; without it the service does not start. */
function smsBody(resource: CrisisResource): string {
  return resource.id === 'shout' || resource.id === 'the_mix' ? '?&body=SHOUT' : '';
}

/**
 * UK number grouping, so a number in distress is readable and dictatable.
 * A naive 5+6 split rendered Papyrus as "08000 684141", which is both wrong and hard to
 * read aloud.
 */
function formatTel(tel: string): string {
  const digits = tel.replace(/\D/g, '');
  if (digits === '999' || digits === '111') return digits;
  if (digits === '116123') return '116 123';
  // Freephone and non-geographic: 0800 068 4141, 0808 808 4994, 0300 123 3393.
  if (/^0(800|808|845|300|345|370)/.test(digits) && digits.length === 11) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  // 0800 1111 (Childline) is 8 digits.
  if (digits.startsWith('0800') && digits.length === 8) {
    return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  }
  // Mobile: 07860 039967.
  if (digits.startsWith('07') && digits.length === 11) {
    return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return digits;
}

function ResourcesCard({ card }: { card: MagiCard }) {
  const t = useTheme();
  const a = t.role.critical;
  const resources = (card.data.resources ?? []) as CrisisResource[];
  return (
    <Card accent="rose" accessibleSummary={card.accessibleSummary}>
      <CardHeader
        icon={<LifeBuoy size={18} color={a.onWash} aria-hidden />}
        text="People you can talk to"
        color={a.onWash}
      />
      {resources.map((r) => (
        <ResourceRow key={r.id} resource={r} />
      ))}
    </Card>
  );
}

function SafetyPlanCard({ card }: { card: MagiCard }) {
  const t = useTheme();
  const a = t.accent.green;
  const exists = Boolean(card.data.exists);
  const plan = card.data.plan as Record<string, unknown> | null;

  return (
    <Card accent="green" accessibleSummary={card.accessibleSummary}>
      <CardHeader
        icon={<ShieldCheck size={18} color={a.onWash} aria-hidden />}
        text="Your plan, in your words"
        color={a.onWash}
      />
      {!exists || !plan ? (
        <AppText role="bodySmall" color={a.onWash}>
          You haven’t written one yet. There’s no rush.
        </AppText>
      ) : (
        <>
          {plan.what_helps ? (
            <AppText role="body" color={a.onWash}>
              {String(plan.what_helps)}
            </AppText>
          ) : null}
          {plan.message_to_self ? (
            <AppText role="bodySmall" color={a.onWash} style={{ opacity: 0.92, fontStyle: 'italic' }}>
              “{String(plan.message_to_self)}”
            </AppText>
          ) : null}
        </>
      )}
    </Card>
  );
}
