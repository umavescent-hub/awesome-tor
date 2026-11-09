import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  IconButton,
  MaterialCard,
  MaterialRow,
  PlaylistCover,
  Screen,
  SectionHeader,
  Touchable,
  UpNextCard,
} from '@/components';
import type { ID } from '@/domain/types';
import { useNow, useRecommendations } from '@/hooks';
import {
  inProgress,
  libraryStats,
  playlistMaterials,
  progressOf,
  sortedCategories,
  sortedPlaylists,
  useLibrary,
} from '@/store';
import { GUTTER, color, formatMinutes, greeting, haptic, radius, space, type } from '@/theme';

export default function HomeScreen() {
  const { state, actions } = useLibrary();
  const now = useNow();
  const recs = useRecommendations({ limit: 8 });
  const stats = libraryStats(state, now);
  const continuing = inProgress(state);
  // An even count keeps the two-column quick grid tidy.
  const playlists = sortedPlaylists(state).slice(0, 6);
  const quick = playlists.length > 1 ? playlists.slice(0, playlists.length - (playlists.length % 2)) : playlists;
  const [skipped, setSkipped] = useState<ID | null>(null);

  useEffect(() => {
    if (!skipped) return;
    const t = setTimeout(() => setSkipped(null), 5000);
    return () => clearTimeout(t);
  }, [skipped]);

  const hero = recs[0];
  const heroMaterial = hero && state.materials[hero.materialId];
  const queue = recs.slice(1).filter((r) => r.lane === 'study');
  const reviews = recs.filter((r, i) => i > 0 && r.lane === 'review');
  const open = (id: ID) => router.push(`/material/${id}`);

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={type.display} accessibilityRole="header">
            {greeting(now)}, {state.settings.displayName}
          </Text>
          <Text style={type.caption}>
            {stats.streakDays > 0 ? `${stats.streakDays}-day streak · ` : ''}
            {formatMinutes(stats.minutesStudied)} studied · {stats.completed} of {stats.materials} complete
          </Text>
        </View>
        <IconButton icon="add" label="Add material" onPress={() => router.push('/new-material')} filled />
        <IconButton icon="settings-outline" label="Settings" onPress={() => router.push('/settings')} filled />
      </View>

      {quick.length > 0 && (
        <View style={styles.quickGrid}>
          {quick.map((p) => (
            <Touchable
              key={p.id}
              onPress={() => router.push(`/playlist/${p.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`Playlist ${p.name}`}
              style={styles.quickTile}
            >
              <PlaylistCover
                materials={playlistMaterials(state, p.id)}
                categories={state.categories}
                size={52}
                radius={0}
              />
              <Text style={[type.captionStrong, styles.quickLabel]} numberOfLines={2}>
                {p.name}
              </Text>
            </Touchable>
          ))}
        </View>
      )}

      {hero && heroMaterial ? (
        <View style={[styles.section, styles.gutter]}>
          <UpNextCard
            recommendation={hero}
            material={heroMaterial}
            category={state.categories[heroMaterial.categoryId]}
            progress={progressOf(state, heroMaterial.id)}
            onOpen={() => open(heroMaterial.id)}
            onPrimary={() => {
              haptic.impact();
              if (hero.lane === 'study') actions.start(heroMaterial.id);
              open(heroMaterial.id);
            }}
            onSkip={
              hero.lane === 'study' && progressOf(state, heroMaterial.id).status === 'queued'
                ? () => {
                    haptic.tap();
                    actions.skip(heroMaterial.id);
                    setSkipped(heroMaterial.id);
                  }
                : undefined
            }
          />
          {skipped && state.materials[skipped] && (
            <View style={styles.undo} accessibilityLiveRegion="polite">
              <Text style={[type.caption, styles.undoText]} numberOfLines={1}>
                Skipped “{state.materials[skipped]?.title}”
              </Text>
              <Touchable
                onPress={() => {
                  actions.reset(skipped);
                  setSkipped(null);
                }}
                accessibilityRole="button"
                accessibilityLabel="Undo skip"
              >
                <Text style={[type.captionStrong, { color: color.accent }]}>Undo</Text>
              </Touchable>
            </View>
          )}
        </View>
      ) : (
        <View style={[styles.section, styles.caughtUp]}>
          <Text style={type.heading}>You’re all caught up</Text>
          <Text style={type.caption}>Add new material and Folio will slot it into your path.</Text>
        </View>
      )}

      {continuing.length > 0 && (
        <View style={styles.section}>
          <SectionHeader title="Continue studying" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
            {continuing.map((m) => (
              <MaterialCard
                key={m.id}
                material={m}
                category={state.categories[m.categoryId]}
                progress={progressOf(state, m.id)}
                onPress={() => open(m.id)}
              />
            ))}
          </ScrollView>
        </View>
      )}

      {reviews.length > 0 && (
        <View style={styles.section}>
          <SectionHeader title="Due for review" subtitle="Spaced repetition keeps it yours" />
          {reviews.map((r) => {
            const m = state.materials[r.materialId];
            return m ? (
              <MaterialRow
                key={m.id}
                material={m}
                category={state.categories[m.categoryId]}
                progress={progressOf(state, m.id)}
                onPress={() => open(m.id)}
              />
            ) : null;
          })}
        </View>
      )}

      {queue.length > 0 && (
        <View style={styles.section}>
          <SectionHeader title="Your path" subtitle="Ranked by what you’ve read, what’s unlocked and your daily time" />
          {queue.map((r) => {
            const m = state.materials[r.materialId];
            if (!m) return null;
            return (
              <View key={m.id}>
                <MaterialRow
                  material={m}
                  category={state.categories[m.categoryId]}
                  progress={progressOf(state, m.id)}
                  onPress={() => open(m.id)}
                />
                {r.reasons[0] && (
                  <Text style={[type.caption, styles.why]} numberOfLines={1}>
                    {r.reasons[0].text}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      )}

      {sortedCategories(state).map((c) => (
        <CategoryShelf key={c.id} categoryId={c.id} />
      ))}
    </Screen>
  );
}

function CategoryShelf({ categoryId }: { categoryId: ID }) {
  const { state } = useLibrary();
  const recs = useRecommendations({ categoryId, limit: 8, includeReviews: false });
  const category = state.categories[categoryId];
  if (!category || recs.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHeader
        title={category.name}
        subtitle={category.description}
        actionLabel="See all"
        onAction={() => router.push(`/category/${categoryId}`)}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
        {recs.map((r) => {
          const m = state.materials[r.materialId];
          return m ? (
            <MaterialCard
              key={m.id}
              material={m}
              category={category}
              progress={progressOf(state, m.id)}
              onPress={() => router.push(`/material/${m.id}`)}
            />
          ) : null;
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: GUTTER,
    paddingTop: space.md,
    paddingBottom: space.lg,
  },
  headerText: { flex: 1, gap: space.xs },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: GUTTER,
    gap: space.sm,
    marginBottom: space.xxl,
  },
  quickTile: {
    flexBasis: '48%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: color.elevated,
    borderRadius: radius.sm,
    overflow: 'hidden',
    paddingRight: space.sm,
  },
  quickLabel: { flex: 1, color: color.text },
  section: { marginBottom: space.xxxl },
  gutter: { paddingHorizontal: GUTTER },
  shelf: { paddingHorizontal: GUTTER, gap: space.md },
  why: { paddingLeft: GUTTER + 52 + space.md, paddingRight: GUTTER, marginTop: -space.xs, marginBottom: space.xs },
  undo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    marginTop: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: color.elevated,
  },
  undoText: { flex: 1, color: color.text },
  caughtUp: { paddingHorizontal: GUTTER, gap: space.xs },
});
