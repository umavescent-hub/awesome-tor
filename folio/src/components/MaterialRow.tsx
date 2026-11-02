import { memo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Category, Material, Progress } from '@/domain/types';
import { GUTTER, color, formatMinutes, formatPercent, materialByline, space, type } from '@/theme';
import { Cover } from './Cover';
import { Icon } from './Icon';
import { ProgressBar } from './ProgressBar';
import { Touchable } from './Touchable';

interface Props {
  material: Material;
  category?: Category;
  progress: Progress;
  onPress: () => void;
  onLongPress?: () => void;
  /** 1-based position, shown for ordered lists such as playlists. */
  index?: number;
  /** Replaces the default status/meta column. */
  trailing?: ReactNode;
}

export const MaterialRow = memo(function MaterialRow({
  material,
  category,
  progress,
  onPress,
  onLongPress,
  index,
  trailing,
}: Props) {
  const done = progress.status === 'completed';
  const skipped = progress.status === 'skipped';
  const active = progress.status === 'in_progress';

  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${material.title}, ${materialByline(material)}${done ? ', completed' : active ? `, ${formatPercent(progress.percent)} done` : ''}`}
      style={styles.row}
    >
      {index !== undefined && (
        <Text style={[type.captionStrong, styles.index, done && { color: color.accent }]}>{index}</Text>
      )}
      <Cover material={material} category={category} size={52} radius={4} />
      <View style={styles.body}>
        <Text style={[type.bodyStrong, skipped && styles.faded]} numberOfLines={1}>
          {material.title}
        </Text>
        <Text style={type.caption} numberOfLines={1}>
          {materialByline(material)}
        </Text>
        {active && <ProgressBar value={progress.percent} style={styles.bar} />}
      </View>
      {trailing ?? (
        <View style={styles.meta}>
          {done ? (
            <Icon name="checkmark-circle" size={20} color={color.accent} />
          ) : active ? (
            <Text style={[type.captionStrong, { color: color.accent }]}>{formatPercent(progress.percent)}</Text>
          ) : skipped ? (
            <Text style={[type.caption, styles.faded]}>Skipped</Text>
          ) : (
            <Text style={type.caption}>{formatMinutes(material.minutes)}</Text>
          )}
        </View>
      )}
    </Touchable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: GUTTER,
    paddingVertical: space.sm,
    minHeight: 68,
  },
  index: { width: 20, textAlign: 'center', color: color.textFaint },
  body: { flex: 1, gap: 2, minWidth: 0 },
  bar: { marginTop: space.xs, maxWidth: 160 },
  meta: { alignItems: 'flex-end', minWidth: 44 },
  faded: { color: color.textFaint },
});
