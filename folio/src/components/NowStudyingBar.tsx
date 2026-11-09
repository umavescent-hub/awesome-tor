import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { inProgress, progressOf, useLibrary } from '@/store';
import { alpha, color, formatPercent, materialByline, radius, shade, space, type } from '@/theme';
import { Cover } from './Cover';
import { Icon } from './Icon';
import { ProgressBar } from './ProgressBar';
import { Touchable } from './Touchable';

/** Persistent mini bar above the tabs: whatever you were last studying, one tap away. */
export function NowStudyingBar() {
  const { state } = useLibrary();
  const current = inProgress(state)[0];
  if (!current) return null;

  const category = state.categories[current.categoryId];
  const progress = progressOf(state, current.id);
  const tint = category?.color ?? color.accent;

  return (
    <View style={styles.outer}>
      <Touchable
        onPress={() => router.push(`/material/${current.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`Now studying ${current.title}, ${formatPercent(progress.percent)} done. Resume.`}
        style={[styles.bar, { backgroundColor: shade(tint, 0.62) }]}
      >
        <Cover material={current} category={category} size={40} radius={4} />
        <View style={styles.text}>
          <Text style={type.bodyStrong} numberOfLines={1}>
            {current.title}
          </Text>
          <Text style={[type.caption, styles.sub]} numberOfLines={1}>
            {materialByline(current)} · {formatPercent(progress.percent)}
          </Text>
        </View>
        <View style={styles.play}>
          <Icon name="play" size={22} color={color.text} />
        </View>
        <ProgressBar
          value={progress.percent}
          height={2}
          tint={color.text}
          track={alpha('#FFFFFF', 0.18)}
          style={styles.progress}
        />
      </Touchable>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { paddingHorizontal: space.sm, paddingBottom: space.xs },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  text: { flex: 1, minWidth: 0 },
  sub: { color: color.text, opacity: 0.75 },
  play: { width: 40, alignItems: 'center' },
  progress: { position: 'absolute', left: space.sm, right: space.sm, bottom: 0 },
});
