import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

// 중요한 순간에만 짧은 진동 (소리는 쓰지 않는다: 사람 많은 곳에서 소개팅 앱 사용이 드러나지 않게)
// 웹에서는 아무 일도 하지 않는다
const run = (fn: () => Promise<void>) => {
  if (Platform.OS === 'web') return;
  fn().catch(() => {});
};

export const haptic = {
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  tap: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  warning: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
};
