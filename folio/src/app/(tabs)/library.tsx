import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip, EmptyState, Icon, IconButton, MaterialRow, PlaylistCover, Touchable } from '@/components';
import type { Material, Playlist } from '@/domain/types';
import { useNow } from '@/hooks';
import {
  completed,
  inProgress,
  libraryStats,
  playlistMaterials,
  playlistStats,
  progressOf,
  sortedPlaylists,
  useLibrary,
} from '@/store';
import { GUTTER, color, formatMinutes, formatPercent, radius, space, type } from '@/theme';

type LibraryView = 'playlists' | 'all' | 'in_progress' | 'completed';

const VIEWS: { key: LibraryView; label: string }[] = [
  { key: 'playlists', label: 'Playlists' },
  { key: 'all', label: 'All materials' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'completed', label: 'Completed' },
];

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const { state } = useLibrary();
  const now = useNow();
  const [view, setView] = useState<LibraryView>('playlists');
  const stats = libraryStats(state, now);

  const materials: Material[] = useMemo(() => {
    if (view === 'in_progress') return inProgress(state);
    if (view === 'completed') return completed(state);
    return Object.values(state.materials).sort((a, b) => a.title.localeCompare(b.title));
  }, [state, view]);

  const header = (
    <View>
      <View style={styles.titleRow}>
        <Text style={[type.display, styles.flex]} accessibilityRole="header">
          Your Library
        </Text>
        <IconButton icon="add" label="Add material" onPress={() => router.push('/new-material')} filled />
      </View>
      <View style={styles.stats}>
        <Stat value={String(stats.materials)} label="materials" />
        <Stat value={String(stats.completed)} label="completed" />
        <Stat value={formatMinutes(stats.minutesStudied)} label="studied" />
        <Stat value={String(stats.streakDays)} label="day streak" />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {VIEWS.map((v) => (
          <Chip key={v.key} label={v.label} selected={view === v.key} onPress={() => setView(v.key)} />
        ))}
      </ScrollView>
    </View>
  );

  return (
    <View style={[styles.fill, { paddingTop: insets.top + space.sm }]}>
      {view === 'playlists' ? (
        <FlatList
          data={sortedPlaylists(state)}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <>
              {header}
              <Touchable
                onPress={() => router.push('/new-playlist')}
                accessibilityRole="button"
                accessibilityLabel="Create playlist"
                style={styles.row}
              >
                <View style={styles.newTile}>
                  <Icon name="add" size={28} color={color.text} />
                </View>
                <Text style={type.bodyStrong}>Create playlist</Text>
              </Touchable>
            </>
          }
          renderItem={({ item }) => <PlaylistRow playlist={item} />}
        />
      ) : (
        <FlatList
          data={materials}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <EmptyState
              icon={view === 'completed' ? 'trophy-outline' : 'book-outline'}
              title={view === 'completed' ? 'Nothing completed yet' : 'Nothing in progress'}
              message="Start something from Home — your Up Next pick is waiting."
            />
          }
          renderItem={({ item }) => (
            <MaterialRow
              material={item}
              category={state.categories[item.categoryId]}
              progress={progressOf(state, item.id)}
              onPress={() => router.push(`/material/${item.id}`)}
            />
          )}
        />
      )}
    </View>
  );
}

function PlaylistRow({ playlist }: { playlist: Playlist }) {
  const { state } = useLibrary();
  const s = playlistStats(state, playlist.id);
  return (
    <Touchable
      onPress={() => router.push(`/playlist/${playlist.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Playlist ${playlist.name}, ${s.count} items, ${formatPercent(s.percent)} complete`}
      style={styles.row}
    >
      <PlaylistCover materials={playlistMaterials(state, playlist.id)} categories={state.categories} size={60} radius={4} />
      <View style={styles.flex}>
        <Text style={type.bodyStrong} numberOfLines={1}>
          {playlist.name}
        </Text>
        <View style={styles.subRow}>
          {playlist.pinned && <Icon name="pin" size={12} color={color.accent} />}
          <Text style={type.caption} numberOfLines={1}>
            Playlist · {s.count} items · {formatPercent(s.percent)} done
          </Text>
        </View>
      </View>
    </Touchable>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={type.heading} numberOfLines={1}>
        {value}
      </Text>
      <Text style={type.caption} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1, minWidth: 0 },
  list: { paddingBottom: space.huge, maxWidth: 760, width: '100%', alignSelf: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: GUTTER, paddingTop: space.md, gap: space.sm },
  stats: {
    flexDirection: 'row',
    marginHorizontal: GUTTER,
    marginTop: space.lg,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.surface,
  },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  chips: { paddingHorizontal: GUTTER, paddingVertical: space.lg, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: GUTTER, paddingVertical: space.sm },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  newTile: {
    width: 60,
    height: 60,
    borderRadius: radius.sm,
    backgroundColor: color.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
