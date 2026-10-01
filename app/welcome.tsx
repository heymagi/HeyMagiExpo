/**
 * Welcome.
 *
 * Deliberately sparse. A landing screen full of feature claims is asking someone to evaluate
 * a product; this asks them to do one thing.
 */

import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MagiOrb } from '@/components/magi/MagiOrb';
import { BrandGradient } from '@/components/magi/BrandGradient';
import { AppText } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/theme';

export default function Welcome() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.canvas,
        paddingHorizontal: t.space.xl,
        paddingTop: insets.top + t.space.xxl,
        paddingBottom: insets.bottom + t.space.xl,
        alignItems: 'center',
      }}
    >
      <BrandGradient variant="sunset" />

      {/* Centred in the space that is left rather than pushed to the top by
          space-between, which on a tall phone left a large dead gap mid-screen. */}
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: t.space.lg,
          maxWidth: 380,
        }}
      >
        <MagiOrb state="idle" size={180} label="MAGI" />
        <AppText role="display" weight="bold" align="center" headingLevel={1}>
          MAGI
        </AppText>
        <AppText role="body" tone="muted" align="center">
          Wellbeing that works the way your mind and body actually do. No shame, no streaks,
          nothing to keep up with.
        </AppText>
      </View>

      <View style={{ alignSelf: 'stretch', gap: t.space.sm, maxWidth: 420, width: '100%' }}>
        <Button
          label="Create an account"
          variant="primary"
          fullWidth
          onPress={() => router.push('/sign-up')}
        />
        <Button
          label="I already have one"
          variant="secondary"
          fullWidth
          onPress={() => router.push('/sign-in')}
        />
        <AppText role="caption" tone="subtle" align="center">
          MAGI is a support tool, not therapy or medical care.
        </AppText>
      </View>
    </View>
  );
}
