import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { color, hitSlop } from '@/theme';
import { Icon, type IconName } from './Icon';
import { Touchable } from './Touchable';

interface Props {
  icon: IconName;
  label: string;
  onPress: () => void;
  size?: number;
  tint?: string;
  filled?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({ icon, label, onPress, size = 22, tint = color.text, filled, disabled, style }: Props) {
  const box = size + 18;
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={[
        styles.base,
        { width: box, height: box, borderRadius: box / 2 },
        filled && styles.filled,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Icon name={icon} size={size} color={tint} />
    </Touchable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  filled: { backgroundColor: color.elevated },
  disabled: { opacity: 0.35 },
});
