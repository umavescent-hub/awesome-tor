import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GUTTER, color, motion, radius, space, type } from '@/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/** Bottom sheet: fading scrim, content slides up. Tap the scrim or press back to dismiss. */
export function Sheet({ visible, onClose, title, children }: Props) {
  const insets = useSafeAreaInsets();
  const offset = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) return;
    offset.setValue(1);
    Animated.timing(offset, {
      toValue: 0,
      duration: motion.base,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [visible, offset]);

  const translateY = offset.interpolate({ inputRange: [0, 1], outputRange: [0, 480] });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <Animated.View
          style={[styles.sheet, { paddingBottom: insets.bottom + space.lg, transform: [{ translateY }] }]}
          accessibilityViewIsModal
        >
          <View style={styles.grabber} />
          <Text style={[type.heading, styles.title]} accessibilityRole="header">
            {title}
          </Text>
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: color.scrim },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: space.sm,
    maxHeight: '82%',
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.border,
    marginBottom: space.md,
  },
  title: { paddingHorizontal: GUTTER, marginBottom: space.sm },
});
