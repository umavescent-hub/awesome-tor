import { StyleSheet, Text, View } from 'react-native';

import { color, space, type } from '@/theme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';

interface Props {
  icon: IconName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, message, actionLabel, onAction }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.badge}>
        <Icon name={icon} size={28} color={color.textMuted} />
      </View>
      <Text style={[type.heading, styles.center]}>{title}</Text>
      {message ? <Text style={[type.caption, styles.center]}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} variant="secondary" size="sm" style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: space.huge, paddingHorizontal: space.xxxl, gap: space.sm },
  badge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: color.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  center: { textAlign: 'center' },
  action: { marginTop: space.md },
});
