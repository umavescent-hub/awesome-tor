import { StyleSheet, Text, View } from 'react-native';

import type { Reason, ReasonCode } from '@/domain/types';
import { color, space, type } from '@/theme';
import { Icon, type IconName } from './Icon';

const REASON_ICON: Record<ReasonCode, IconName> = {
  continue: 'play-circle-outline',
  unlocked: 'lock-open-outline',
  prereq_ready: 'git-merge-outline',
  foundation: 'layers-outline',
  affinity: 'sparkles-outline',
  playlist_order: 'list-outline',
  effort_fit: 'time-outline',
  stretch: 'trending-up-outline',
  review_due: 'refresh-outline',
  fresh: 'compass-outline',
};

interface Props {
  reasons: Reason[];
  max?: number;
  tint?: string;
}

/** "Why this?" — the engine's own explanation, never a black box. */
export function ReasonList({ reasons, max = 3, tint = color.accent }: Props) {
  if (reasons.length === 0) return null;
  return (
    <View style={styles.list} accessibilityLabel={`Why: ${reasons.slice(0, max).map((r) => r.text).join('. ')}`}>
      {reasons.slice(0, max).map((r) => (
        <View key={r.code} style={styles.item}>
          <Icon name={REASON_ICON[r.code]} size={15} color={tint} />
          <Text style={[type.caption, styles.text]} numberOfLines={2}>
            {r.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  text: { flex: 1, color: color.text },
});
