import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/** Fire-and-forget haptics; silent on web and on devices without a taptic engine. */
export const haptic = {
  tap(): void {
    if (Platform.OS === 'web') return;
    Haptics.selectionAsync().catch(() => undefined);
  },
  success(): void {
    if (Platform.OS === 'web') return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  },
  impact(): void {
    if (Platform.OS === 'web') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  },
};
