import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ID } from '@/domain/types';
import { playlistMaterials, sortedPlaylists, useLibrary } from '@/store';
import { GUTTER, color, haptic, space, type } from '@/theme';
import { Button } from './Button';
import { Icon } from './Icon';
import { PlaylistCover } from './PlaylistCover';
import { Sheet } from './Sheet';
import { TextField } from './TextField';
import { Touchable } from './Touchable';

interface Props {
  materialId: ID;
  visible: boolean;
  onClose: () => void;
}

/** Toggle a material in and out of any playlist, or start a new one with it. */
export function PlaylistPicker({ materialId, visible, onClose }: Props) {
  const { state, actions } = useLibrary();
  const [draft, setDraft] = useState('');
  const playlists = sortedPlaylists(state);

  const create = () => {
    const name = draft.trim();
    if (!name) return;
    actions.createPlaylist({ name, materialIds: [materialId] });
    haptic.success();
    setDraft('');
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Add to playlist">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
        {playlists.map((p) => {
          const member = p.materialIds.includes(materialId);
          return (
            <Touchable
              key={p.id}
              onPress={() => {
                haptic.tap();
                if (member) actions.removeFromPlaylist(p.id, materialId);
                else actions.addToPlaylist(p.id, materialId);
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: member }}
              accessibilityLabel={p.name}
              style={styles.row}
            >
              <PlaylistCover
                materials={playlistMaterials(state, p.id)}
                categories={state.categories}
                size={44}
                radius={4}
              />
              <View style={styles.body}>
                <Text style={type.bodyStrong} numberOfLines={1}>
                  {p.name}
                </Text>
                <Text style={type.caption}>{p.materialIds.length} items</Text>
              </View>
              <Icon
                name={member ? 'checkmark-circle' : 'add-circle-outline'}
                size={24}
                color={member ? color.accent : color.textMuted}
              />
            </Touchable>
          );
        })}
        <View style={styles.create}>
          <TextField
            label="New playlist"
            placeholder="e.g. Koji deep dive"
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={create}
            returnKeyType="done"
          />
          <Button
            label="Create with this item"
            icon="add"
            variant="secondary"
            onPress={create}
            disabled={!draft.trim()}
          />
        </View>
        <Button label="Done" onPress={onClose} />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: GUTTER, gap: space.xs, paddingBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  body: { flex: 1, minWidth: 0 },
  create: { gap: space.md, paddingVertical: space.lg },
});
