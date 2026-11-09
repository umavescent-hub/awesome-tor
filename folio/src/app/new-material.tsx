import { router } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Chip, SearchField, TextField } from '@/components';
import { MATERIAL_KINDS, type Difficulty, type ID, type MaterialKind } from '@/domain/types';
import { search } from '@/search';
import { sortedCategories, useLibrary } from '@/store';
import { GUTTER, KIND_ICON, KIND_LABEL, color, haptic, space, type } from '@/theme';

const DIFFICULTY: { level: Difficulty; label: string }[] = [
  { level: 1, label: 'Intro' },
  { level: 2, label: 'Easy' },
  { level: 3, label: 'Core' },
  { level: 4, label: 'Hard' },
  { level: 5, label: 'Frontier' },
];

/** Comma- or semicolon-separated list → trimmed, de-duplicated entries. */
const splitList = (raw: string) => [
  ...new Set(
    raw
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];

export default function NewMaterialScreen() {
  const { state, actions, searchIndex } = useLibrary();
  const categories = sortedCategories(state);
  const thisYear = new Date().getFullYear();

  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [year, setYear] = useState(String(thisYear));
  const [kind, setKind] = useState<MaterialKind>('paper');
  const [categoryId, setCategoryId] = useState<ID>(categories[0]?.id ?? '');
  const [minutes, setMinutes] = useState('60');
  const [difficulty, setDifficulty] = useState<Difficulty>(3);
  const [tags, setTags] = useState('');
  const [url, setUrl] = useState('');
  const [abstract, setAbstract] = useState('');
  const [prereqQuery, setPrereqQuery] = useState('');
  const [prerequisites, setPrerequisites] = useState<ID[]>([]);
  const [submitted, setSubmitted] = useState(false);

  const yearNum = Number.parseInt(year, 10);
  const minutesNum = Number.parseInt(minutes, 10);
  const errors = {
    title: title.trim() ? undefined : 'A title is required',
    authors: splitList(authors).length ? undefined : 'Add at least one author',
    year: yearNum >= 1000 && yearNum <= thisYear + 1 ? undefined : `Enter a year up to ${thisYear + 1}`,
    minutes: minutesNum > 0 && minutesNum <= 10_000 ? undefined : 'Estimated minutes, e.g. 90',
    category: categoryId ? undefined : 'Pick a category',
  };
  const valid = Object.values(errors).every((e) => !e);
  const show = (e: string | undefined) => (submitted ? e : undefined);

  const prereqHits = useMemo(
    () =>
      prereqQuery.trim()
        ? search(searchIndex, prereqQuery, { limit: 6 }).filter((h) => !prerequisites.includes(h.materialId))
        : [],
    [prereqQuery, searchIndex, prerequisites],
  );

  const save = () => {
    setSubmitted(true);
    if (!valid) return;
    const id = actions.addMaterial({
      title: title.trim(),
      authors: splitList(authors),
      year: yearNum,
      kind,
      categoryId,
      minutes: minutesNum,
      difficulty,
      tags: splitList(tags).map((t) => t.toLowerCase()),
      url: url.trim() || undefined,
      abstract: abstract.trim(),
      prerequisites,
    });
    haptic.success();
    router.replace(`/material/${id}`);
  };

  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <TextField
        label="Title"
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Traditional Maize Processing Techniques in the New World"
        error={show(errors.title)}
        autoFocus
      />
      <TextField
        label="Authors"
        value={authors}
        onChangeText={setAuthors}
        placeholder="Comma-separated"
        error={show(errors.authors)}
        hint="Separate multiple authors with commas"
      />

      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField
            label="Year"
            value={year}
            onChangeText={setYear}
            keyboardType="number-pad"
            maxLength={4}
            error={show(errors.year)}
          />
        </View>
        <View style={styles.flex}>
          <TextField
            label="Minutes to finish"
            value={minutes}
            onChangeText={setMinutes}
            keyboardType="number-pad"
            maxLength={5}
            error={show(errors.minutes)}
          />
        </View>
      </View>

      <Group label="Kind">
        {MATERIAL_KINDS.map((k) => (
          <Chip key={k} label={KIND_LABEL[k]} icon={KIND_ICON[k]} selected={kind === k} onPress={() => setKind(k)} />
        ))}
      </Group>

      <Group label="Category" error={show(errors.category)}>
        {categories.map((c) => (
          <Chip
            key={c.id}
            label={c.name}
            selected={categoryId === c.id}
            tint={c.color}
            onPress={() => setCategoryId(c.id)}
          />
        ))}
      </Group>

      <Group label="Difficulty">
        {DIFFICULTY.map((d) => (
          <Chip
            key={d.level}
            label={`${d.level} · ${d.label}`}
            selected={difficulty === d.level}
            onPress={() => setDifficulty(d.level)}
          />
        ))}
      </Group>

      <TextField
        label="Tags"
        value={tags}
        onChangeText={setTags}
        placeholder="nixtamalization, maize, chemistry"
        autoCapitalize="none"
        hint="Tags power search and the taste profile"
      />
      <TextField
        label="Link"
        value={url}
        onChangeText={setUrl}
        placeholder="https://…"
        autoCapitalize="none"
        keyboardType="url"
      />
      <TextField
        label="Notes / abstract"
        value={abstract}
        onChangeText={setAbstract}
        multiline
        placeholder="What is it about? Why does it matter to you?"
      />

      <View style={styles.group}>
        <Text style={type.micro}>Builds on (prerequisites)</Text>
        {prerequisites.length > 0 && (
          <View style={styles.chips}>
            {prerequisites.map((pid) => (
              <Chip
                key={pid}
                label={state.materials[pid]?.title ?? pid}
                icon="close"
                selected
                onPress={() => setPrerequisites((p) => p.filter((x) => x !== pid))}
              />
            ))}
          </View>
        )}
        <SearchField value={prereqQuery} onChangeText={setPrereqQuery} placeholder="Find material this builds on" />
        {prereqHits.length > 0 && (
          <View style={styles.chips}>
            {prereqHits.map((h) => (
              <Chip
                key={h.materialId}
                label={state.materials[h.materialId]?.title ?? h.materialId}
                icon="add"
                onPress={() => {
                  setPrerequisites((p) => [...p, h.materialId]);
                  setPrereqQuery('');
                }}
              />
            ))}
          </View>
        )}
      </View>

      <Button label="Add to library" icon="checkmark" onPress={save} />
      {submitted && !valid && <Text style={[type.caption, styles.error]}>Fix the highlighted fields above.</Text>}
    </ScrollView>
  );
}

function Group({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={type.micro}>{label}</Text>
      <View style={styles.chips}>{children}</View>
      {error ? <Text style={[type.caption, styles.error]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  content: {
    padding: GUTTER,
    gap: space.xl,
    paddingBottom: space.huge,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  row: { flexDirection: 'row', gap: space.md },
  flex: { flex: 1 },
  group: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  error: { color: color.danger },
});
