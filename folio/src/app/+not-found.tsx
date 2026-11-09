import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components';
import { color } from '@/theme';

export default function NotFound() {
  return (
    <View style={styles.fill}>
      <EmptyState
        icon="compass-outline"
        title="Nothing at this address"
        actionLabel="Go home"
        onAction={() => router.replace('/')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg, justifyContent: 'center' },
});
