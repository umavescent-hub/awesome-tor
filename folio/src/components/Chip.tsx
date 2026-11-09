import { StyleSheet, Text } from 'react-native';

import { color, radius, space, type } from '@/theme';
import { Icon, type IconName } from './Icon';
import { Touchable } from './Touchable';

interface Props {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  /** Optional accent for the selected state (e.g. a category colour). */
  tint?: string;
}

export function Chip({ label, selected, onPress, icon, tint = color.accent }: Props) {
  const fg = selected ? color.accentInk : color.text;
  return (
    <Touchable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={label}
      style={[styles.base, selected ? { backgroundColor: tint, borderColor: tint } : styles.idle]}
    >
      {icon && <Icon name={icon} size={14} color={fg} />}
      <Text style={[type.captionStrong, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: 32,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  idle: { backgroundColor: color.elevated, borderColor: color.border },
});
