import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { color, radius, space, type } from '@/theme';
import { Icon, type IconName } from './Icon';
import { Touchable } from './Touchable';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: 'md' | 'sm';
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

const FG: Record<Variant, string> = {
  primary: color.accentInk,
  secondary: color.text,
  ghost: color.text,
  danger: color.danger,
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  disabled,
  loading,
  fullWidth,
  style,
  accessibilityHint,
}: Props) {
  const fg = FG[variant];
  return (
    <Touchable
      feedback="scale"
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      style={[
        styles.base,
        size === 'sm' ? styles.sm : styles.md,
        styles[variant],
        fullWidth && styles.full,
        disabled && styles.disabled,
        style,
      ]}
    >
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator size="small" color={fg} />
        ) : (
          icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} color={fg} />
        )}
        <Text style={[size === 'sm' ? type.captionStrong : type.bodyStrong, { color: fg }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  md: { minHeight: 46, paddingHorizontal: space.xl },
  sm: { minHeight: 34, paddingHorizontal: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  primary: { backgroundColor: color.accent },
  secondary: { backgroundColor: color.elevated, borderWidth: StyleSheet.hairlineWidth, borderColor: color.border },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: 'rgba(226, 85, 63, 0.12)' },
  full: { alignSelf: 'stretch' },
  disabled: { opacity: 0.4 },
});
