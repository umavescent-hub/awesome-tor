import { StyleSheet, View } from 'react-native';

import { color, haptic, space } from '@/theme';
import { Touchable } from './Touchable';

const SEGMENTS = 10;

interface Props {
  value: number;
  onChange: (value: number) => void;
  tint?: string;
}

/** Ten tappable segments (10% each). Works with touch, mouse, and screen-reader adjust gestures. */
export function SegmentedProgress({ value, onChange, tint = color.accent }: Props) {
  const filled = Math.round(Math.min(1, Math.max(0, value)) * SEGMENTS);
  const set = (n: number) => {
    const next = Math.min(SEGMENTS, Math.max(0, n));
    if (next === filled) return;
    haptic.tap();
    onChange(next / SEGMENTS);
  };

  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Progress"
      accessibilityValue={{ min: 0, max: 100, now: filled * 10, text: `${filled * 10}%` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => set(filled + (e.nativeEvent.actionName === 'increment' ? 1 : -1))}
    >
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <Touchable
          key={i}
          feedback="none"
          onPress={() => set(i + 1 === filled ? i : i + 1)}
          accessibilityLabel={`Set progress to ${(i + 1) * 10}%`}
          style={styles.hit}
        >
          <View style={[styles.segment, { backgroundColor: i < filled ? tint : color.pressed }]} />
        </Touchable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.xs },
  hit: { flex: 1, paddingVertical: space.sm },
  segment: { height: 8, borderRadius: 4 },
});
