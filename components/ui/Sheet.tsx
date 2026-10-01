/**
 * Bottom sheet.
 *
 * Rules it enforces, all of them WCAG requirements that are easy to miss in React Native:
 *   · the scrim is a real button, so the sheet is dismissible without a gesture (2.5.1)
 *   · `accessibilityViewIsModal` stops VoiceOver wandering into the content behind it
 *   · focus is sent into the sheet on open and the close control is reachable first
 *   · the entry animation is skipped entirely when motion is reduced, rather than shortened
 */

import { useEffect, useRef, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  View,
  ScrollView,
  Platform,
  findNodeHandle,
  AccessibilityInfo,
  useWindowDimensions,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { AppText } from './Text';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Fraction of screen height the sheet may occupy. */
  maxHeightRatio?: number;
}

export function Sheet({ visible, onClose, title, children, maxHeightRatio = 0.9 }: SheetProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const headingRef = useRef<View>(null);
  const closeRef = useRef<View>(null);
  const progress = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    if (!t.motion.enabled) {
      progress.value = visible ? 1 : 0;
      return;
    }
    // Indexed rather than spread: a union of two tuples is not a valid spread argument.
    const curve = visible ? t.motion.easing.enter : t.motion.easing.exit;
    progress.value = withTiming(visible ? 1 : 0, {
      duration: visible ? t.motion.duration.base : t.motion.duration.fast,
      easing: Easing.bezier(curve[0], curve[1], curve[2], curve[3]),
    });
  }, [visible, t.motion.enabled]);

  /**
   * Move focus into the sheet on open, so a screen reader or keyboard user is not left
   * behind the modal.
   *
   * The two platforms need different mechanisms and there is no shared one:
   * `findNodeHandle` throws outright on web ("not supported on web"), and
   * `setAccessibilityFocus` is a native-only API. On web the close control is focused
   * instead, because it is a real focusable element and it is the one thing a user who
   * has landed somewhere unexpected always wants.
   */
  useEffect(() => {
    if (!visible) return;
    // A frame for the modal to mount before focus is moved.
    const timer = setTimeout(() => {
      if (Platform.OS === 'web') {
        const node = closeRef.current as unknown as { focus?: () => void } | null;
        try {
          node?.focus?.();
        } catch {
          // Focus is a nicety here; never let it break opening the sheet.
        }
        return;
      }
      const handle = findNodeHandle(headingRef.current);
      if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
    }, 120);
    return () => clearTimeout(timer);
  }, [visible]);

  const sheetStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 24 }],
  }));

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Close ${title}`}
          onPress={onClose}
          style={{ ...StyleSheetAbsolute, backgroundColor: t.scrim }}
        />
        <Animated.View
          accessibilityViewIsModal
          style={[
            {
              backgroundColor: t.canvas,
              borderTopLeftRadius: t.radius.xl,
              borderTopRightRadius: t.radius.xl,
              paddingTop: t.space.md,
              paddingBottom: insets.bottom + t.space.lg,
              maxHeight: height * maxHeightRatio,
              borderTopWidth: 1,
              borderColor: t.line,
            },
            t.shadow('modal'),
            sheetStyle,
          ]}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: t.space.lg,
              paddingBottom: t.space.sm,
            }}
          >
            {/* Focusable so assistive focus can be moved here on open, but NOT a heading
                itself — the AppText below is the heading. Marking both produced a nested
                <h1> on web and a doubled announcement. */}
            <View ref={headingRef} accessible accessibilityLabel={title}>
              <AppText role="heading" weight="bold" headingLevel={1}>
                {title}
              </AppText>
            </View>
            <Pressable
              ref={closeRef}
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={{
                minWidth: t.touch.min,
                minHeight: t.touch.min,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: t.radius.pill,
                backgroundColor: t.surfaceSunken,
              }}
            >
              <X size={22} color={t.ink} aria-hidden />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: t.space.lg,
              paddingBottom: t.space.xl,
              gap: t.space.md,
            }}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const StyleSheetAbsolute = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};
