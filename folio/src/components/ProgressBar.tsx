import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { color } from '@/theme';

interface Props {
  value: number;
  height?: number;
  tint?: string;
  track?: string;
  style?: StyleProp<ViewStyle>;
}

export function ProgressBar({ value, height = 3, tint = color.accent, track = color.pressed, style }: Props) {
  const pct = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={[styles.track, { height, borderRadius: height / 2, backgroundColor: track }, style]}
    >
      <View style={{ width: `${pct * 100}%`, height, borderRadius: height / 2, backgroundColor: tint }} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { overflow: 'hidden', alignSelf: 'stretch' },
});
