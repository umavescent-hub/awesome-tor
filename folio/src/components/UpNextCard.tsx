import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import type { Category, Material, Progress, Recommendation } from '@/domain/types';
import { alpha, color, formatMinutes, formatPercent, materialByline, radius, space, type } from '@/theme';
import { Button } from './Button';
import { Cover } from './Cover';
import { IconButton } from './IconButton';
import { ReasonList } from './ReasonList';
import { Touchable } from './Touchable';

interface Props {
  recommendation: Recommendation;
  material: Material;
  category?: Category;
  progress: Progress;
  /** Eyebrow text. Default "Up next". */
  eyebrow?: string;
  onOpen: () => void;
  onPrimary: () => void;
  onSkip?: () => void;
}

export function primaryLabel(rec: Recommendation, progress: Progress): string {
  if (rec.lane === 'review') return 'Review now';
  if (progress.status === 'in_progress') return `Resume · ${formatPercent(progress.percent)}`;
  return 'Start';
}

/** The hero: the single best next move, with the reasons behind it. */
export function UpNextCard({ recommendation, material, category, progress, eyebrow = 'Up next', onOpen, onPrimary, onSkip }: Props) {
  const tint = category?.color ?? color.accent;
  const remaining = material.minutes * (1 - (progress.status === 'in_progress' ? progress.percent : 0));
  return (
    <LinearGradient colors={[alpha(tint, 0.38), alpha(tint, 0.08)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
      <Touchable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Open ${material.title}`} style={styles.top}>
        <Cover material={material} category={category} size={104} radius={8} />
        <View style={styles.titles}>
          <Text style={type.micro}>{recommendation.lane === 'review' ? 'Review due' : eyebrow}</Text>
          <Text style={type.heading} numberOfLines={3}>
            {material.title}
          </Text>
          <Text style={type.caption} numberOfLines={1}>
            {materialByline(material)}
          </Text>
          <Text style={type.caption}>
            {formatMinutes(remaining)} {progress.status === 'in_progress' ? 'left' : ''}
            {category ? ` · ${category.name}` : ''}
          </Text>
        </View>
      </Touchable>

      <ReasonList reasons={recommendation.reasons} tint={tint} />

      <View style={styles.actions}>
        <Button
          label={primaryLabel(recommendation, progress)}
          icon={recommendation.lane === 'review' ? 'refresh' : 'play'}
          onPress={onPrimary}
          style={styles.primary}
        />
        {onSkip && <IconButton icon="play-skip-forward" label="Skip — not now" onPress={onSkip} filled tint={color.textMuted} />}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairline,
  },
  top: { flexDirection: 'row', gap: space.lg },
  titles: { flex: 1, gap: space.xs, minWidth: 0 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  primary: { flex: 1 },
});
