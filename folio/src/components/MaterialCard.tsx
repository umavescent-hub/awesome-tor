import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Category, Material, Progress } from '@/domain/types';
import { formatAuthors, space, type } from '@/theme';
import { Cover } from './Cover';
import { ProgressBar } from './ProgressBar';
import { Touchable } from './Touchable';

interface Props {
  material: Material;
  category?: Category;
  progress?: Progress;
  onPress: () => void;
  size?: number;
  /** Optional line under the title, e.g. a recommendation reason. */
  caption?: string;
}

/** Shelf tile: square cover, two-line title, author line. */
export const MaterialCard = memo(function MaterialCard({ material, category, progress, onPress, size = 148, caption }: Props) {
  const active = progress?.status === 'in_progress';
  return (
    <Touchable
      feedback="scale"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${material.title} by ${formatAuthors(material.authors)}`}
      style={{ width: size }}
    >
      <Cover material={material} category={category} size={size} radius={8} />
      {active && progress && <ProgressBar value={progress.percent} style={styles.bar} />}
      <View style={styles.text}>
        <Text style={type.bodyStrong} numberOfLines={2}>
          {material.title}
        </Text>
        <Text style={type.caption} numberOfLines={1}>
          {caption ?? `${formatAuthors(material.authors)} · ${material.year}`}
        </Text>
      </View>
    </Touchable>
  );
});

const styles = StyleSheet.create({
  bar: { marginTop: space.sm },
  text: { marginTop: space.sm, gap: 2 },
});
