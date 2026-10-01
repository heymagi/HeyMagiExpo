/**
 * The support panel.
 *
 * Pinned above the composer whenever the risk tier calls for it, and reachable from settings
 * at any time. It is not a modal and does not steal focus: interrupting someone mid-sentence
 * with a dialogue box is how apps make a bad moment worse.
 *
 * It can be closed. A panel that cannot be dismissed becomes something to fight, and the
 * settings sheet always has a permanent route back to it.
 *
 * It shows TWO options, not the whole list. The full list rendered as a wall roughly three
 * screens tall, which buried MAGI's reply and is precisely the sensory load this product
 * exists to avoid — a person mid-crisis needs one number, not a directory. The rest are one
 * tap away, and all of them are always in settings.
 */

/** How many resources are shown before the user asks for more. */
const INITIAL_VISIBLE = 2;

import { useState } from 'react';
import { View, Pressable } from 'react-native';
import { X, LifeBuoy } from 'lucide-react-native';
import { AppText } from '@/components/ui/Text';
import { useTheme } from '@/theme';
import { ResourceRow } from './cards';
import type { CrisisResource } from '@/supabase/functions/_shared/crisis-resources.ts';

export interface SupportPanelProps {
  resources: CrisisResource[];
  onClose: () => void;
  /** True at the top tier, which adds the 999 line and a plainer headline. */
  urgent: boolean;
}

export function SupportPanel({ resources, onClose, urgent }: SupportPanelProps) {
  const t = useTheme();
  const a = t.role.critical;
  const [expanded, setExpanded] = useState(false);
  if (!resources.length) return null;

  const visible = expanded ? resources : resources.slice(0, INITIAL_VISIBLE);
  const hidden = resources.length - visible.length;

  return (
    <View
      accessibilityRole="none"
      accessibilityLabel="Support options"
      accessibilityLiveRegion="polite"
      style={{
        marginHorizontal: t.space.lg,
        marginBottom: t.space.sm,
        padding: t.space.md,
        borderRadius: t.radius.lg,
        backgroundColor: a.wash,
        borderWidth: urgent ? 2 : 1,
        borderColor: urgent ? a.edgeStrong : a.edge,
        gap: t.space.xxs,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xs }}>
        <LifeBuoy size={18} color={a.onWash} aria-hidden />
        <AppText role="subheading" weight="bold" color={a.onWash} headingLevel={2} style={{ flex: 1 }}>
          {urgent ? 'Please talk to someone now' : 'Someone to talk to'}
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Hide support options"
          accessibilityHint="You can always find these again in settings"
          onPress={onClose}
          style={{
            width: t.touch.min,
            height: t.touch.min,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={20} color={a.onWash} aria-hidden />
        </Pressable>
      </View>

      {urgent ? (
        <AppText role="bodySmall" color={a.onWash}>
          If you have already hurt yourself, or you are about to, call 999. You do not have to
          explain it well.
        </AppText>
      ) : null}

      {visible.map((r) => (
        <ResourceRow key={r.id} resource={r} />
      ))}

      {hidden > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Show ${hidden} more support option${hidden === 1 ? '' : 's'}`}
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(true)}
          style={{ minHeight: t.touch.min, justifyContent: 'center' }}
        >
          <AppText role="bodySmall" weight="semibold" color={a.onWash}>
            {hidden} more option{hidden === 1 ? '' : 's'}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}
