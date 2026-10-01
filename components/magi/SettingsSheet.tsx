/**
 * Settings — the only surface in the app other than the conversation itself.
 *
 * Ordered by how urgently someone might need it, not by convention. Accessibility comes
 * first, because a person who cannot read the screen cannot reach anything further down;
 * support and safety come next; account administration is last.
 *
 * The "what MAGI knows" section is doing real work, not box-ticking. Every memory she holds
 * is listed, and each one can be deleted on the spot. That is a UK GDPR right, and it is also
 * the mechanism that makes a companion who remembers things tolerable rather than unnerving.
 */

import { useCallback, useEffect, useState } from 'react';
import { View, Pressable, Switch, Linking, Alert } from 'react-native';
import {
  Type,
  Contrast,
  Waves,
  Hand,
  LifeBuoy,
  Brain,
  ShieldCheck,
  LogOut,
  Download,
  Trash2,
  UserPlus,
} from 'lucide-react-native';
import { Sheet } from '@/components/ui/Sheet';
import { AppText } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { useTheme, usePreferences } from '@/theme';
import {
  TEXT_SIZE_LABELS,
  LINE_SPACING_LABELS,
  FONT_LABELS,
  type TextSize,
  type LineSpacing,
  type FontChoice,
} from '@/theme/typography';
import { HAPTIC_LABELS, type HapticLevel } from '@/theme/motion';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { resourcesForAge } from '@/supabase/functions/_shared/crisis-resources.ts';
import { ResourceRow } from './cards';

export interface SettingsSheetProps {
  visible: boolean;
  onClose: () => void;
}

interface MemoryRow {
  id: string;
  kind: string;
  value: string;
  provenance: string;
  state: string;
}

export function SettingsSheet({ visible, onClose }: SettingsSheetProps) {
  const t = useTheme();
  const { preferences, setPreference, resetPreferences, osReduceMotion } = usePreferences();
  const { account, signOut, user } = useAuth();

  const [memories, setMemories] = useState<MemoryRow[] | null>(null);
  const [showSupport, setShowSupport] = useState(false);

  const loadMemories = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('magi_memory')
      .select('id, kind, value, provenance, state')
      .eq('account_id', user.id)
      .in('state', ['active', 'needs_confirming'])
      .order('kind');
    setMemories((data ?? []) as MemoryRow[]);
  }, [user?.id]);

  useEffect(() => {
    if (visible) void loadMemories();
  }, [visible, loadMemories]);

  const forget = async (id: string) => {
    await supabase
      .from('magi_memory')
      .update({ state: 'retired', retired_at: new Date().toISOString() })
      .eq('id', id);
    setMemories((m) => (m ? m.filter((x) => x.id !== id) : m));
  };

  const requestExport = async () => {
    if (!user) return;
    await supabase.from('data_request').insert({ account_id: user.id, kind: 'export' });
    Alert.alert(
      'Export requested',
      'Everything MAGI holds about you will be prepared and emailed to you. This normally takes a day or two.',
    );
  };

  const requestErasure = () => {
    Alert.alert(
      'Delete everything?',
      'This removes your account, your conversations, and everything MAGI has learned about you. It cannot be undone.',
      [
        { text: 'Keep my account', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: async () => {
            if (!user) return;
            await supabase.from('data_request').insert({ account_id: user.id, kind: 'erasure' });
            await supabase
              .from('account')
              .update({ state: 'deletion_requested', deletion_requested_at: new Date().toISOString() })
              .eq('id', user.id);
            await signOut();
          },
        },
      ],
    );
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Settings">
      {/* ---------------- reading ---------------- */}
      <Section icon={<Type size={18} color={t.inkMuted} aria-hidden />} title="Reading">
        <Label>Text size</Label>
        <ChipRow<TextSize>
          options={Object.keys(TEXT_SIZE_LABELS) as TextSize[]}
          labels={TEXT_SIZE_LABELS}
          value={preferences.textSize}
          onChange={(v) => setPreference('textSize', v)}
          accent="green"
        />
        <Hint>Your device’s own text size setting is applied on top of this.</Hint>

        <Label>Line spacing</Label>
        <ChipRow<LineSpacing>
          options={Object.keys(LINE_SPACING_LABELS) as LineSpacing[]}
          labels={LINE_SPACING_LABELS}
          value={preferences.lineSpacing}
          onChange={(v) => setPreference('lineSpacing', v)}
          accent="sage"
        />

        <Label>Typeface</Label>
        <ChipRow<FontChoice>
          options={Object.keys(FONT_LABELS) as FontChoice[]}
          labels={FONT_LABELS}
          value={preferences.font}
          onChange={(v) => setPreference('font', v)}
          accent="pink"
        />
        <Hint>
          Atkinson Hyperlegible was designed so that letters which normally look alike don’t.
        </Hint>
      </Section>

      {/* ---------------- seeing ---------------- */}
      <Section icon={<Contrast size={18} color={t.inkMuted} aria-hidden />} title="Seeing">
        <Label>Colours</Label>
        <ChipRow
          options={['system', 'light', 'dark'] as const}
          labels={{ system: 'Match device', light: 'Light', dark: 'Dark' }}
          value={preferences.colourScheme}
          onChange={(v) => setPreference('colourScheme', v)}
          accent="amber"
        />

        <Toggle
          label="Stronger contrast"
          hint="Raises every text contrast to the AAA standard. Colour moves into backgrounds and shapes."
          value={preferences.highContrast}
          onChange={(v) => setPreference('highContrast', v)}
        />
        <Toggle
          label="Plain backgrounds"
          hint="Removes the coloured washes and the movement inside the orb."
          value={preferences.plainBackgrounds}
          onChange={(v) => setPreference('plainBackgrounds', v)}
        />
      </Section>

      {/* ---------------- movement and touch ---------------- */}
      <Section icon={<Waves size={18} color={t.inkMuted} aria-hidden />} title="Movement and touch">
        <Toggle
          label="Reduce movement"
          hint={
            osReduceMotion
              ? 'Already on, because your device has reduce motion turned on.'
              : 'Stops the orb breathing and removes all transitions.'
          }
          value={preferences.reduceMotion || osReduceMotion}
          disabled={osReduceMotion}
          onChange={(v) => setPreference('reduceMotion', v)}
        />

        <Label>Buttons</Label>
        <ChipRow
          options={['standard', 'large'] as const}
          labels={{ standard: 'Standard', large: 'Larger' }}
          value={preferences.touchSize}
          onChange={(v) => setPreference('touchSize', v)}
          accent="sage"
        />

        <Label>Vibration</Label>
        <ChipRow<HapticLevel>
          options={Object.keys(HAPTIC_LABELS) as HapticLevel[]}
          labels={HAPTIC_LABELS}
          value={preferences.haptics}
          onChange={(v) => setPreference('haptics', v)}
          accent="yellow"
        />
      </Section>

      {/* ---------------- support ---------------- */}
      <Section icon={<LifeBuoy size={18} color={t.inkMuted} aria-hidden />} title="If you need someone">
        <Hint>These are always here, whether or not MAGI has offered them.</Hint>
        {showSupport ? (
          <View style={{ gap: t.space.xxs }}>
            {resourcesForAge(account?.age ?? null, true).map((r) => (
              <ResourceRow key={r.id} resource={r} />
            ))}
          </View>
        ) : (
          <Button
            label="Show who I can talk to"
            variant="secondary"
            accent="rose"
            onPress={() => setShowSupport(true)}
          />
        )}
      </Section>

      {/* ---------------- what MAGI knows ---------------- */}
      <Section icon={<Brain size={18} color={t.inkMuted} aria-hidden />} title="What MAGI knows about you">
        {memories === null ? (
          <Hint>Loading…</Hint>
        ) : memories.length === 0 ? (
          <Hint>Nothing yet. She learns from what you tell her.</Hint>
        ) : (
          memories.map((m) => (
            <View
              key={m.id}
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: t.space.xs,
                paddingVertical: t.space.xs,
                borderBottomWidth: 1,
                borderBottomColor: t.line,
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <AppText role="bodySmall">{m.value}</AppText>
                <AppText role="caption" tone="subtle">
                  {m.kind === 'boundary' ? 'a boundary you set' : m.kind}
                  {m.provenance !== 'stated' ? ' · she worked this out, not confirmed' : ''}
                </AppText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Make MAGI forget: ${m.value}`}
                onPress={() => forget(m.id)}
                style={{
                  width: t.touch.min,
                  height: t.touch.min,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Trash2 size={18} color={t.role.critical.onWash} aria-hidden />
              </Pressable>
            </View>
          ))
        )}
      </Section>

      {/* ---------------- guardian, for minors only ---------------- */}
      {account?.isMinor ? (
        <Section icon={<UserPlus size={18} color={t.inkMuted} aria-hidden />} title="Your trusted adult">
          <Hint>
            {account.guardianVerified
              ? 'An adult is linked to your account. They are told if MAGI is worried about your safety — never what you talked about.'
              : 'No adult is linked yet.'}
          </Hint>
        </Section>
      ) : null}

      {/* ---------------- your data ---------------- */}
      <Section icon={<ShieldCheck size={18} color={t.inkMuted} aria-hidden />} title="Your data">
        <Button
          label="Send me everything you hold"
          variant="secondary"
          icon={<Download size={16} color={t.accent.green.onWash} aria-hidden />}
          onPress={requestExport}
        />
        <Button
          label="Privacy notice"
          variant="quiet"
          onPress={() => Linking.openURL('https://heymagi.com/privacy').catch(() => undefined)}
        />
        <Button label="Delete my account and data" variant="danger" onPress={requestErasure} />
      </Section>

      {/* ---------------- account ---------------- */}
      <Section icon={<Hand size={18} color={t.inkMuted} aria-hidden />} title="Account">
        <Hint>{user?.email}</Hint>
        <Button
          label="Reset appearance to defaults"
          variant="quiet"
          onPress={resetPreferences}
        />
        <Button
          label="Sign out"
          variant="secondary"
          icon={<LogOut size={16} color={t.accent.green.onWash} aria-hidden />}
          onPress={() => {
            onClose();
            void signOut();
          }}
        />
      </Section>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: t.space.xs, paddingVertical: t.space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xs }}>
        {icon}
        <AppText role="subheading" weight="bold" headingLevel={2}>
          {title}
        </AppText>
      </View>
      {children}
    </View>
  );
}

function Label({ children }: { children: string }) {
  return (
    <AppText role="label" weight="semibold" tone="muted" style={{ marginTop: 8 }}>
      {children}
    </AppText>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <AppText role="caption" tone="muted">
      {children}
    </AppText>
  );
}

function ChipRow<T extends string>({
  options,
  labels,
  value,
  onChange,
  accent,
}: {
  options: readonly T[];
  labels: Record<string, string>;
  value: T;
  onChange: (v: T) => void;
  accent?: 'green' | 'sage' | 'rose' | 'amber' | 'yellow' | 'pink';
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: t.space.xs, flexWrap: 'wrap' }}>
      {options.map((o, i) => (
        <Chip
          key={o}
          label={labels[o] ?? o}
          selected={value === o}
          accent={accent}
          accessibilityHint={`${i + 1} of ${options.length}`}
          onPress={() => onChange(o)}
        />
      ))}
    </View>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.md,
        minHeight: t.touch.min,
        paddingVertical: t.space.xxs,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <AppText role="bodySmall" weight="medium">
          {label}
        </AppText>
        {hint ? <Hint>{hint}</Hint> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityRole="switch"
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: t.lineStrong, true: t.accent.green.solid }}
        thumbColor={t.surface}
      />
    </View>
  );
}
