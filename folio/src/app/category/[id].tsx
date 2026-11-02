import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { EmptyState, Icon, MaterialRow } from '@/components';
import type { Material } from '@/domain/types';
import { useRecommendations } from '@/hooks';
import { materialsInCategory, progressOf, useLibrary } from '@/store';
import { GUTTER, alpha, color, mix, space, type } from '@/theme';

/** A category in recommended order: your next steps first, finished work after. */
export default function CategoryScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const { state } = useLibrary();
  const recs = useRecommendations({ categoryId: id, limit: 200, includeReviews: false });
  const category = state.categories[id];

  const ordered = useMemo(() => {
    const ranked = recs.map((r) => state.materials[r.materialId]).filter((m): m is Material => !!m);
    const seen = new Set(ranked.map((m) => m.id));
    return [...ranked, ...materialsInCategory(state, id).filter((m) => !seen.has(m.id))];
  }, [recs, state, id]);

  if (!category) {
    return (
      <View style={styles.fill}>
        <EmptyState icon="grid-outline" title="Category not found" actionLabel="Go home" onAction={() => router.replace('/')} />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ headerStyle: { backgroundColor: mix(category.color, color.bg, 0.55) } }} />
      <FlatList
        data={ordered}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            <LinearGradient colors={[alpha(category.color, 0.55), color.bg]} style={styles.backdrop} pointerEvents="none" />
            <View style={styles.header}>
              <View style={[styles.badge, { backgroundColor: alpha(category.color, 0.3) }]}>
                <Icon name={category.icon} size={30} color={color.text} />
              </View>
              <Text style={type.display} accessibilityRole="header">
                {category.name}
              </Text>
              <Text style={type.caption}>{category.description}</Text>
              <Text style={[type.micro, styles.order]}>In your recommended order · {ordered.length} materials</Text>
            </View>
          </View>
        }
        ListEmptyComponent={<EmptyState icon="leaf-outline" title="Nothing here yet" />}
        renderItem={({ item, index }) => (
          <MaterialRow
            material={item}
            category={category}
            progress={progressOf(state, item.id)}
            index={index + 1}
            onPress={() => router.push(`/material/${item.id}`)}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  list: { paddingBottom: space.huge, maxWidth: 760, width: '100%', alignSelf: 'center' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, height: 300 },
  header: { paddingHorizontal: GUTTER, paddingTop: space.xl, paddingBottom: space.xl, gap: space.sm },
  badge: { width: 56, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  order: { marginTop: space.md },
});
