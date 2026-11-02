import { StyleSheet, Text, View } from 'react-native';

import { GUTTER, color, space, type } from '@/theme';
import { Touchable } from './Touchable';

interface Props {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function SectionHeader({ title, subtitle, actionLabel, onAction }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={type.title} accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={type.caption} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Touchable onPress={onAction} accessibilityRole="button" accessibilityLabel={`${actionLabel}: ${title}`}>
          <Text style={[type.captionStrong, { color: color.textMuted }]}>{actionLabel}</Text>
        </Touchable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: GUTTER,
    marginBottom: space.md,
    gap: space.md,
  },
  text: { flex: 1, gap: space.xxs },
});
