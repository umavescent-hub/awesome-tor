import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import type { Category, Material } from '@/domain/types';
import { color } from '@/theme';
import { Cover } from './Cover';
import { Icon } from './Icon';

interface Props {
  materials: Material[];
  categories: Record<string, Category>;
  size: number;
  radius?: number;
}

/** 2×2 mosaic of the first four covers; a single cover below four; an emblem when empty. */
export const PlaylistCover = memo(function PlaylistCover({ materials, categories, size, radius = 6 }: Props) {
  const box = { width: size, height: size, borderRadius: radius };
  if (materials.length === 0) {
    return (
      <LinearGradient colors={[color.accent, '#0F4D46']} style={[styles.center, box]}>
        <Icon name="albums-outline" size={size * 0.36} color="rgba(255,255,255,0.9)" />
      </LinearGradient>
    );
  }
  if (materials.length < 4) {
    const m = materials[0]!;
    return <Cover material={m} category={categories[m.categoryId]} size={size} radius={radius} />;
  }
  const half = size / 2;
  return (
    <View style={[styles.grid, box]}>
      {materials.slice(0, 4).map((m) => (
        <Cover key={m.id} material={m} category={categories[m.categoryId]} size={half} radius={0} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', overflow: 'hidden' },
});
