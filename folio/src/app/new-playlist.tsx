import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { Button, TextField } from '@/components';
import { useLibrary } from '@/store';
import { GUTTER, color, haptic, space } from '@/theme';

export default function NewPlaylistScreen() {
  const { actions } = useLibrary();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const create = () => {
    if (!name.trim()) return;
    const id = actions.createPlaylist({ name: name.trim(), description: description.trim() });
    haptic.success();
    router.replace(`/playlist/${id}`);
  };

  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <TextField label="Name" placeholder="e.g. Nixtamal & the chemistry of corn" value={name} onChangeText={setName} autoFocus maxLength={80} onSubmitEditing={create} returnKeyType="next" />
      <TextField label="Description" placeholder="What is this path for?" value={description} onChangeText={setDescription} multiline maxLength={280} />
      <Button label="Create playlist" icon="add" onPress={create} disabled={!name.trim()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  content: { padding: GUTTER, gap: space.xl, maxWidth: 640, width: '100%', alignSelf: 'center' },
});
