import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  Button,
  EmptyState,
  Icon,
  IconButton,
  MaterialRow,
  PlaylistCover,
  ProgressBar,
  SearchField,
  Sheet,
  TextField,
  Touchable,
} from '@/components';
import type { Material } from '@/domain/types';
import { useRecommendations } from '@/hooks';
import { search } from '@/search';
import { playlistMaterials, playlistStats, progressOf, useLibrary } from '@/store';
import {
  GUTTER,
  alpha,
  color,
  formatMinutes,
  formatPercent,
  haptic,
  materialByline,
  mix,
  radius,
  space,
  type,
} from '@/theme';

type SheetKind = 'add' | 'edit' | 'delete' | null;

export default function PlaylistScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const { state, actions, searchIndex } = useLibrary();
  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [next] = useRecommendations({ playlistId: id, limit: 1, includeReviews: false });

  const playlist = state.playlists[id];
  const items = playlistMaterials(state, id);

  const addable = useMemo(() => {
    if (!playlist) return [];
    const inList = new Set(playlist.materialIds);
    const pool = query.trim()
      ? search(searchIndex, query, { limit: 40 }).map((h) => state.materials[h.materialId])
      : Object.values(state.materials).sort((a, b) => a.title.localeCompare(b.title));
    return pool.filter((m): m is Material => !!m && !inList.has(m.id));
  }, [playlist, query, searchIndex, state.materials]);

  if (!playlist) {
    return (
      <View style={styles.fill}>
        <EmptyState
          icon="albums-outline"
          title="Playlist not found"
          actionLabel="Go to library"
          onAction={() => router.replace('/library')}
        />
      </View>
    );
  }

  const stats = playlistStats(state, id);
  const nextMaterial = next ? state.materials[next.materialId] : undefined;
  const tint = nextMaterial ? (state.categories[nextMaterial.categoryId]?.color ?? color.accent) : color.accent;

  const playNext = () => {
    if (!nextMaterial) return;
    haptic.impact();
    actions.start(nextMaterial.id);
    router.push(`/material/${nextMaterial.id}`);
  };

  const openEdit = () => {
    setName(playlist.name);
    setDescription(playlist.description);
    setSheet('edit');
  };

  const header = (
    <View>
      <LinearGradient colors={[alpha(tint, 0.45), color.bg]} style={styles.backdrop} pointerEvents="none" />
      <View style={styles.hero}>
        <PlaylistCover materials={items} categories={state.categories} size={196} radius={8} />
      </View>
      <View style={styles.block}>
        <Text style={type.display} accessibilityRole="header">
          {playlist.name}
        </Text>
        {playlist.description ? <Text style={[type.caption, styles.description]}>{playlist.description}</Text> : null}
        <Text style={type.captionStrong}>
          {stats.count} items · {formatMinutes(stats.totalMinutes)} · {formatPercent(stats.percent)} complete
        </Text>
        <ProgressBar value={stats.percent} style={styles.progress} />
      </View>

      <View style={[styles.block, styles.controls]}>
        <IconButton
          icon={playlist.pinned ? 'pin' : 'pin-outline'}
          label={playlist.pinned ? 'Unpin playlist' : 'Pin playlist'}
          tint={playlist.pinned ? color.accent : color.textMuted}
          onPress={() => {
            haptic.tap();
            actions.updatePlaylist(id, { pinned: !playlist.pinned });
          }}
        />
        <IconButton
          icon="add-circle-outline"
          label="Add materials"
          tint={color.textMuted}
          onPress={() => setSheet('add')}
        />
        <IconButton
          icon={editing ? 'checkmark-done' : 'swap-vertical'}
          label={editing ? 'Done reordering' : 'Reorder'}
          tint={editing ? color.accent : color.textMuted}
          onPress={() => setEditing((e) => !e)}
        />
        <IconButton icon="ellipsis-horizontal" label="Edit details" tint={color.textMuted} onPress={openEdit} />
        <View style={styles.flex} />
        <Touchable
          feedback="scale"
          onPress={playNext}
          disabled={!nextMaterial}
          accessibilityRole="button"
          accessibilityLabel={nextMaterial ? `Play next: ${nextMaterial.title}` : 'Playlist complete'}
          style={[styles.play, !nextMaterial && styles.playDisabled]}
        >
          <Icon name={nextMaterial ? 'play' : 'checkmark'} size={26} color={color.accentInk} />
        </Touchable>
      </View>

      {nextMaterial && next && (
        <Touchable
          onPress={() => router.push(`/material/${nextMaterial.id}`)}
          accessibilityRole="button"
          accessibilityLabel={`Up next: ${nextMaterial.title}`}
          style={[styles.block, styles.nextCard]}
        >
          <Text style={type.micro}>Up next here</Text>
          <Text style={type.bodyStrong} numberOfLines={1}>
            {nextMaterial.title}
          </Text>
          {next.reasons[0] && (
            <Text style={type.caption} numberOfLines={2}>
              {next.reasons[0].text}
            </Text>
          )}
        </Touchable>
      )}
    </View>
  );

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ headerStyle: { backgroundColor: mix(tint, color.bg, 0.45) } }} />
      <FlatList
        data={items}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState
            icon="albums-outline"
            title="An empty shelf"
            message="Add papers, books and lectures — Folio will sequence them for you."
            actionLabel="Add materials"
            onAction={() => setSheet('add')}
          />
        }
        renderItem={({ item, index }) => (
          <MaterialRow
            material={item}
            category={state.categories[item.categoryId]}
            progress={progressOf(state, item.id)}
            index={index + 1}
            onPress={() => router.push(`/material/${item.id}`)}
            trailing={
              editing ? (
                <View style={styles.reorder}>
                  <IconButton
                    icon="chevron-up"
                    label={`Move ${item.title} up`}
                    size={18}
                    disabled={index === 0}
                    onPress={() => actions.movePlaylistItem(id, index, index - 1)}
                  />
                  <IconButton
                    icon="chevron-down"
                    label={`Move ${item.title} down`}
                    size={18}
                    disabled={index === items.length - 1}
                    onPress={() => actions.movePlaylistItem(id, index, index + 1)}
                  />
                  <IconButton
                    icon="remove-circle-outline"
                    label={`Remove ${item.title} from playlist`}
                    size={18}
                    tint={color.danger}
                    onPress={() => actions.removeFromPlaylist(id, item.id)}
                  />
                </View>
              ) : undefined
            }
          />
        )}
      />

      <Sheet visible={sheet === 'add'} onClose={() => setSheet(null)} title={`Add to ${playlist.name}`}>
        <View style={styles.sheetSearch}>
          <SearchField value={query} onChangeText={setQuery} placeholder="Search your library" />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetList}>
          {addable.length === 0 ? (
            <Text style={[type.caption, styles.sheetEmpty]}>Everything matching is already here.</Text>
          ) : (
            addable.map((m) => (
              <Touchable
                key={m.id}
                onPress={() => {
                  haptic.tap();
                  actions.addToPlaylist(id, m.id);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Add ${m.title}`}
                style={styles.addRow}
              >
                <View style={styles.flex}>
                  <Text style={type.bodyStrong} numberOfLines={1}>
                    {m.title}
                  </Text>
                  <Text style={type.caption} numberOfLines={1}>
                    {materialByline(m)}
                  </Text>
                </View>
                <Icon name="add-circle" size={24} color={color.accent} />
              </Touchable>
            ))
          )}
        </ScrollView>
      </Sheet>

      <Sheet visible={sheet === 'edit'} onClose={() => setSheet(null)} title="Edit playlist">
        <View style={styles.sheetBody}>
          <TextField label="Name" value={name} onChangeText={setName} maxLength={80} />
          <TextField label="Description" value={description} onChangeText={setDescription} multiline maxLength={280} />
          <Button
            label="Save"
            disabled={!name.trim()}
            onPress={() => {
              actions.updatePlaylist(id, { name: name.trim(), description: description.trim() });
              setSheet(null);
            }}
          />
          <Button label="Delete playlist" variant="danger" icon="trash-outline" onPress={() => setSheet('delete')} />
        </View>
      </Sheet>

      <Sheet visible={sheet === 'delete'} onClose={() => setSheet(null)} title={`Delete “${playlist.name}”?`}>
        <View style={styles.sheetBody}>
          <Text style={type.caption}>The playlist goes; the materials in it stay in your library.</Text>
          <Button
            label="Delete playlist"
            variant="danger"
            icon="trash-outline"
            onPress={() => {
              setSheet(null);
              router.back();
              actions.deletePlaylist(id);
            }}
          />
          <Button label="Cancel" variant="secondary" onPress={() => setSheet(null)} />
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  list: { paddingBottom: space.huge, maxWidth: 760, width: '100%', alignSelf: 'center' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, height: 360 },
  hero: { alignItems: 'center', paddingTop: space.lg, paddingBottom: space.xxl },
  block: { paddingHorizontal: GUTTER, marginBottom: space.lg },
  description: { marginTop: space.xs, marginBottom: space.sm },
  progress: { marginTop: space.md },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  play: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playDisabled: { backgroundColor: color.pressed },
  nextCard: {
    marginHorizontal: GUTTER,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    gap: 2,
  },
  reorder: { flexDirection: 'row', alignItems: 'center' },
  sheetSearch: { paddingHorizontal: GUTTER, paddingBottom: space.sm },
  sheetList: { paddingHorizontal: GUTTER, paddingBottom: space.lg },
  sheetEmpty: { paddingVertical: space.xl, textAlign: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  sheetBody: { paddingHorizontal: GUTTER, gap: space.md, paddingTop: space.sm },
});
