import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppText } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/theme';

export default function NotFound() {
  const t = useTheme();
  const router = useRouter();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.canvas,
        alignItems: 'center',
        justifyContent: 'center',
        gap: t.space.md,
        padding: t.space.xl,
      }}
    >
      <AppText role="heading" weight="bold" align="center" headingLevel={1}>
        There’s nothing here
      </AppText>
      <AppText role="body" tone="muted" align="center">
        MAGI only has the one screen, so this is almost certainly a mistake on our side.
      </AppText>
      <Button label="Back to MAGI" variant="primary" onPress={() => router.replace('/')} />
    </View>
  );
}
