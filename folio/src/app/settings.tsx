import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Chip, TextField } from '@/components';
import { useLibrary } from '@/store';
import { GUTTER, color, formatMinutes, haptic, radius, space, type } from '@/theme';

const BUDGETS = [15, 30, 45, 60, 90, 120, 180];

const HOW_IT_WORKS: [string, string][] = [
  ['Momentum', 'Anything in progress is pulled forward — finishing beats starting.'],
  [
    'Readiness',
    'Prerequisites matter. Material whose foundations you haven’t covered sinks; completing them “unlocks” what builds on them.',
  ],
  [
    'Taste',
    'What you finish and rate highly shapes a topic profile (recent work counts more). Similar material rises.',
  ],
  ['Foundations', 'Material that many queued items depend on is favoured early.'],
  ['Stretch', 'Difficulty is pitched half a step above what you’ve recently completed.'],
  ['Time', 'Items that fit your daily budget get a lift; long books are never excluded, just paced.'],
  ['Sequence', 'Inside a playlist, your chosen order carries real weight.'],
  ['Variety', 'A diversity pass keeps the queue from collapsing into one topic.'],
  ['Review', 'Finished work returns on a spaced-repetition schedule (SM-2) so it stays with you.'],
];

export default function SettingsScreen() {
  const { state, actions } = useLibrary();
  const [name, setName] = useState(state.settings.displayName);
  const [confirmReset, setConfirmReset] = useState(false);
  const budget = state.settings.dailyMinutes;

  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <TextField
        label="Your name"
        value={name}
        onChangeText={setName}
        onEndEditing={() => actions.updateSettings({ displayName: name })}
        onSubmitEditing={() => actions.updateSettings({ displayName: name })}
        maxLength={40}
        returnKeyType="done"
      />

      <View style={styles.group}>
        <Text style={type.micro}>Daily study time</Text>
        <View style={styles.chips}>
          {BUDGETS.map((m) => (
            <Chip
              key={m}
              label={formatMinutes(m)}
              selected={budget === m}
              onPress={() => {
                haptic.tap();
                actions.updateSettings({ dailyMinutes: m });
              }}
            />
          ))}
        </View>
        <Text style={type.caption}>Up Next favours material you can finish within {formatMinutes(budget)} a day.</Text>
      </View>

      <View style={[styles.group, styles.card]}>
        <Text style={type.heading}>How Up Next decides</Text>
        <Text style={type.caption}>
          Every recommendation is explainable. Folio scores each unfinished item on nine signals and shows you the
          strongest reasons. It ranks; it doesn’t claim to read your mind — your ratings and choices steer it.
        </Text>
        {HOW_IT_WORKS.map(([title, body]) => (
          <View key={title} style={styles.how}>
            <Text style={type.bodyStrong}>{title}</Text>
            <Text style={type.caption}>{body}</Text>
          </View>
        ))}
      </View>

      <View style={styles.group}>
        <Text style={type.micro}>Data</Text>
        <Text style={type.caption}>Your library lives only on this device.</Text>
        {confirmReset ? (
          <View style={styles.group}>
            <Text style={[type.caption, { color: color.text }]}>
              Replace everything with the sample library? Your materials, playlists and progress will be lost.
            </Text>
            <Button
              label="Yes, reset library"
              variant="danger"
              icon="refresh-outline"
              onPress={() => {
                actions.resetLibrary();
                router.back();
              }}
            />
            <Button label="Cancel" variant="secondary" onPress={() => setConfirmReset(false)} />
          </View>
        ) : (
          <Button
            label="Reset to sample library"
            variant="secondary"
            icon="refresh-outline"
            onPress={() => setConfirmReset(true)}
          />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  content: {
    padding: GUTTER,
    gap: space.xxl,
    paddingBottom: space.huge,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  group: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  card: { backgroundColor: color.surface, borderRadius: radius.lg, padding: space.lg },
  how: { gap: 2 },
});
