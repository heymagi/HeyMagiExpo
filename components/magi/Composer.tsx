/**
 * The composer.
 *
 * Two ways in, because the research finding is that typing is sometimes impossible:
 *   · the quick row — five one-tap answers that produce a real check-in in one gesture
 *   · the text field — for everything else
 *
 * The quick row is not a mood tracker. Tapping it sends a short sentence to MAGI as though
 * the user had typed it, so the conversation stays the single path and she gets a reply
 * rather than a silent database write.
 */

import { useState } from 'react';
import { View, TextInput, Pressable, Platform } from 'react-native';
import { ArrowUp } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { AppText } from '@/components/ui/Text';
import { Chip } from '@/components/ui/Chip';
import { useTheme } from '@/theme';

/** The wording matters: these are things a person would actually say. */
const QUICK = [
  { key: 'rough', label: 'Rough', says: "Today's been rough.", accent: 'rose' as const },
  { key: 'low', label: 'Low', says: "I'm feeling low.", accent: 'amber' as const },
  { key: 'ok', label: 'Okay', says: "I'm okay.", accent: 'yellow' as const },
  { key: 'good', label: 'Good', says: "I'm having a good day.", accent: 'sage' as const },
  { key: 'flat', label: 'Can’t say', says: "I can't put it into words right now.", accent: 'pink' as const },
];

export interface ComposerProps {
  onSend: (message: string) => void;
  busy: boolean;
  /** Hides the quick row while MAGI is in quiet mode — one thing at a time in distress. */
  quiet: boolean;
  disabled?: boolean;
}

export function Composer({ onSend, busy, quiet, disabled }: ComposerProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const body = t.type('body');

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy || disabled) return;
    if (t.haptics !== 'off') Haptics.selectionAsync().catch(() => undefined);
    onSend(trimmed);
    setValue('');
  };

  return (
    <View
      style={{
        paddingHorizontal: t.space.lg,
        paddingTop: t.space.sm,
        paddingBottom: insets.bottom + t.space.sm,
        gap: t.space.sm,
        backgroundColor: t.canvas,
        borderTopWidth: 1,
        borderTopColor: t.line,
      }}
    >
      {!quiet ? (
        <View
          accessibilityRole="none"
          accessibilityLabel="Quick answers"
          style={{ flexDirection: 'row', gap: t.space.xs, flexWrap: 'wrap' }}
        >
          {QUICK.map((q) => (
            <Chip
              key={q.key}
              label={q.label}
              accent={q.accent}
              disabled={busy || disabled}
              accessibilityHint={`Tells MAGI: ${q.says}`}
              onPress={() => submit(q.says)}
            />
          ))}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: t.space.xs }}>
        <TextInput
          allowFontScaling
          accessibilityLabel="Message MAGI"
          accessibilityHint="Type whatever you want to say. There is no right way to do this."
          placeholder={quiet ? 'Whatever you can manage…' : 'Tell MAGI anything…'}
          placeholderTextColor={t.inkSubtle}
          value={value}
          onChangeText={setValue}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          multiline
          editable={!disabled}
          // Enter sends on web; on mobile the return key inserts a newline, because
          // accidentally sending a half-formed thought is worse than an extra tap.
          onSubmitEditing={Platform.OS === 'web' ? () => submit(value) : undefined}
          blurOnSubmit={false}
          style={{
            flex: 1,
            minHeight: t.touch.min,
            maxHeight: 160,
            borderWidth: focused ? 2 : 1.5,
            borderColor: focused ? t.focusRing : t.lineStrong,
            borderRadius: t.radius.lg,
            paddingHorizontal: t.space.sm,
            paddingTop: t.space.xs,
            paddingBottom: t.space.xs,
            backgroundColor: t.surface,
            color: t.ink,
            fontSize: body.fontSize,
            lineHeight: body.lineHeight,
            fontFamily: t.fontFamilyFor(),
          }}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: !value.trim() || busy || Boolean(disabled), busy }}
          disabled={!value.trim() || busy || disabled}
          onPress={() => submit(value)}
          style={{
            width: t.touch.min,
            height: t.touch.min,
            borderRadius: t.radius.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: t.accent.green.solid,
            opacity: !value.trim() || busy || disabled ? 0.4 : 1,
          }}
        >
          <ArrowUp size={22} color={t.accent.green.onSolid} strokeWidth={2.5} aria-hidden />
        </Pressable>
      </View>

      {quiet ? (
        <AppText role="caption" tone="muted">
          No suggestions while things are hard. Just talk.
        </AppText>
      ) : null}
    </View>
  );
}
