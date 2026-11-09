import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ScrollViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, space } from '@/theme';

interface Props extends Pick<ScrollViewProps, 'keyboardShouldPersistTaps' | 'refreshControl'> {
  children: ReactNode;
  /** Wrap content in a ScrollView. Default true. */
  scroll?: boolean;
  /** Pad the top safe area (false when a native header is shown). Default true. */
  safeTop?: boolean;
}

export function Screen({ children, scroll = true, safeTop = true, ...scrollProps }: Props) {
  const insets = useSafeAreaInsets();
  const top = safeTop ? insets.top + space.sm : 0;
  if (!scroll) return <View style={[styles.fill, { paddingTop: top }]}>{children}</View>;
  return (
    <ScrollView
      {...scrollProps}
      style={styles.fill}
      contentContainerStyle={[styles.content, { paddingTop: top }]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  content: { paddingBottom: space.huge, maxWidth: 760, width: '100%', alignSelf: 'center' },
});
