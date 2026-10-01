/**
 * The screen.
 *
 * One conversation, one composer, one floating settings button. Every feature the product has
 * arrives as a card inside the conversation, because MAGI is the interface — there is nowhere
 * else for a feature to live and nothing to navigate to.
 *
 * The orb sits above the first message and scrolls away with the content. It is company, not
 * a header: pinning it would cost a third of a small screen for decoration.
 */

import { useState } from 'react';
import { View, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Settings2 } from 'lucide-react-native';

import { MagiOrb } from '@/components/magi/MagiOrb';
import { BrandGradient } from '@/components/magi/BrandGradient';
import { Conversation } from '@/components/magi/Conversation';
import { Composer } from '@/components/magi/Composer';
import { SupportPanel } from '@/components/magi/SupportPanel';
import { SettingsSheet } from '@/components/magi/SettingsSheet';
import { AppText } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useMagi } from '@/contexts/MagiContext';
import { atLeast } from '@/supabase/functions/_shared/risk.ts';

export default function MagiScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { account } = useAuth();
  const {
    turns,
    busy,
    restoring,
    riskTier,
    supportPinned,
    resources,
    quietMode,
    error,
    send,
    resolveProposal,
    retryLast,
    dismissSupport,
    clearError,
  } = useMagi();

  const [settingsOpen, setSettingsOpen] = useState(false);

  const orbState = busy ? 'thinking' : quietMode ? 'quiet' : 'idle';

  return (
    <View style={{ flex: 1, backgroundColor: t.canvas }}>
      {/* Anchored at the top, behind the orb, so it never sits under the composer or the
          support panel where text needs the measured mint ground. */}
      <BrandGradient variant="halo" />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Conversation
          turns={turns}
          busy={busy}
          onResolve={resolveProposal}
          onRetry={retryLast}
          header={
            <View
              style={{
                alignItems: 'center',
                paddingTop: insets.top + t.space.xl,
                paddingBottom: t.space.md,
                gap: t.space.sm,
              }}
            >
              <MagiOrb state={orbState} />
              {turns.length === 0 && !restoring ? <Opening /> : null}
            </View>
          }
        />

        {error ? (
          <View
            accessibilityLiveRegion="assertive"
            style={{
              marginHorizontal: t.space.lg,
              marginBottom: t.space.xs,
              padding: t.space.sm,
              borderRadius: t.radius.md,
              backgroundColor: t.role.caution.wash,
              borderWidth: 1,
              borderColor: t.role.caution.edge,
              flexDirection: 'row',
              alignItems: 'center',
              gap: t.space.sm,
            }}
          >
            <AppText role="bodySmall" color={t.role.caution.onWash} style={{ flex: 1 }}>
              {error}
            </AppText>
            <Button label="Dismiss" variant="quiet" onPress={clearError} />
          </View>
        ) : null}

        {supportPinned && resources.length ? (
          <SupportPanel
            resources={resources}
            onClose={dismissSupport}
            urgent={atLeast(riskTier, 'imminent')}
          />
        ) : null}

        <Composer onSend={send} busy={busy} quiet={quietMode} disabled={restoring} />
      </KeyboardAvoidingView>

      {/* The floating settings button. Deliberately not a bottom tab: a tab bar implies
          somewhere else to be, and there isn't anywhere else. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Settings"
        accessibilityHint="Text size, contrast, what MAGI knows about you, and support options"
        onPress={() => setSettingsOpen(true)}
        style={{
          position: 'absolute',
          top: insets.top + t.space.xs,
          right: t.space.md,
          width: t.touch.min,
          height: t.touch.min,
          borderRadius: t.radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: t.surface,
          borderWidth: 1,
          borderColor: t.line,
          ...t.shadow('floating'),
        }}
      >
        <Settings2 size={20} color={t.ink} aria-hidden />
      </Pressable>

      <SettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </View>
  );
}

/**
 * The empty state. No prompts, no suggested questions, no "try asking me about…". Just a
 * door left open — a list of things she could say would be one more thing to read and
 * evaluate at the moment she has least capacity for it.
 */
function Opening() {
  const t = useTheme();
  const { account } = useAuth();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Morning' : hour < 18 ? 'Hello' : 'Evening';

  return (
    <View style={{ alignItems: 'center', gap: t.space.xs, maxWidth: 320 }}>
      <AppText role="title" weight="bold" align="center" headingLevel={1}>
        {greeting}
      </AppText>
      <AppText role="body" tone="muted" align="center">
        {account?.isMinor
          ? "I'm MAGI. Tell me how today's going — or don't, and just say what's on your mind."
          : "I'm MAGI. Say as much or as little as you like. There's no wrong way to start."}
      </AppText>
    </View>
  );
}
