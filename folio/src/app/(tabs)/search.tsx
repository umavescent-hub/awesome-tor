import { router, useLocalSearchParams } from 'expo-router';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip, EmptyState, Icon, MaterialRow, SearchField, Touchable } from '@/components';
import { MATERIAL_KINDS, type MaterialKind, type ProgressStatus, type SearchFilters } from '@/domain/types';
import { search, suggestTerms } from '@/search';
import { progressOf, sortedCategories, useLibrary } from '@/store';
import { GUTTER, KIND_LABEL, alpha, color, radius, shade, space, type } from '@/theme';

const STATUS_FILTERS: { status: ProgressStatus; label: string }[] = [
  { status: 'queued', label: 'Not started' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'completed', label: 'Completed' },
];

const TIPS = ['author:keller', 'tag:koji', 'kind:paper', 'year:2000..2015', '"food pairing"', 'fermentation -kimchi'];

const toggle = <T,>(list: T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ q?: string }>();
  const { state, searchIndex } = useLibrary();
  const [query, setQuery] = useState(params.q ?? '');
  const [kinds, setKinds] = useState<MaterialKind[]>([]);
  const [statuses, setStatuses] = useState<ProgressStatus[]>([]);
  const deferred = useDeferredValue(query);

  // Deep links such as /search?q=tag:koji replace the current query.
  useEffect(() => {
    if (params.q !== undefined) setQuery(params.q);
  }, [params.q]);

  const presentKinds = useMemo(() => {
    const present = new Set(Object.values(state.materials).map((m) => m.kind));
    return MATERIAL_KINDS.filter((k) => present.has(k));
  }, [state.materials]);

  const filters: SearchFilters = useMemo(
    () => ({ kinds: kinds.length ? kinds : undefined, statuses: statuses.length ? statuses : undefined }),
    [kinds, statuses],
  );
  const filtering = kinds.length > 0 || statuses.length > 0;
  const active = deferred.trim().length > 0 || filtering;

  const hits = useMemo(
    () => (active ? search(searchIndex, deferred, { filters, progress: state.progress, limit: 60 }) : []),
    [active, searchIndex, deferred, filters, state.progress],
  );
  const fuzzy = useMemo(() => [...new Set(hits.flatMap((h) => h.fuzzyTerms))], [hits]);
  const suggestions = useMemo(
    () => (deferred.trim() && hits.length < 3 ? suggestTerms(searchIndex, deferred, 5) : []),
    [searchIndex, deferred, hits.length],
  );

  return (
    <View style={[styles.fill, { paddingTop: insets.top + space.sm }]}>
      <View style={styles.top}>
        <Text style={type.display} accessibilityRole="header">
          Search
        </Text>
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="Titles, authors, topics, tags…"
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {STATUS_FILTERS.map((f) => (
          <Chip
            key={f.status}
            label={f.label}
            selected={statuses.includes(f.status)}
            onPress={() => setStatuses((s) => toggle(s, f.status))}
          />
        ))}
        <View style={styles.divider} />
        {presentKinds.map((k) => (
          <Chip key={k} label={KIND_LABEL[k]} selected={kinds.includes(k)} onPress={() => setKinds((s) => toggle(s, k))} />
        ))}
      </ScrollView>

      {active ? (
        <FlatList
          data={hits}
          keyExtractor={(h) => h.materialId}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.results}
          ListHeaderComponent={
            <View style={styles.meta}>
              <Text style={type.caption} accessibilityLiveRegion="polite">
                {hits.length === 0 ? 'No matches' : `${hits.length} result${hits.length === 1 ? '' : 's'}`}
                {fuzzy.length > 0 ? ` · including close matches for “${fuzzy.join('”, “')}”` : ''}
              </Text>
              {suggestions.length > 0 && (
                <View style={styles.suggestRow}>
                  {suggestions.map((s) => (
                    <Chip key={s} label={s} icon="arrow-forward" onPress={() => setQuery(completeLastWord(query, s))} />
                  ))}
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="search-outline"
              title="Nothing found"
              message="Try fewer words, an author’s surname, or clear the filters."
              actionLabel={filtering ? 'Clear filters' : undefined}
              onAction={
                filtering
                  ? () => {
                      setKinds([]);
                      setStatuses([]);
                    }
                  : undefined
              }
            />
          }
          renderItem={({ item }) => {
            const m = state.materials[item.materialId];
            return m ? (
              <MaterialRow
                material={m}
                category={state.categories[m.categoryId]}
                progress={progressOf(state, m.id)}
                onPress={() => router.push(`/material/${m.id}`)}
              />
            ) : null;
          }}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.browse} keyboardShouldPersistTaps="handled">
          <Text style={[type.heading, styles.browseTitle]}>Browse categories</Text>
          <View style={styles.grid}>
            {sortedCategories(state).map((c) => (
              <Touchable
                key={c.id}
                feedback="scale"
                onPress={() => router.push(`/category/${c.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`Category ${c.name}`}
                style={[styles.tile, { backgroundColor: shade(c.color, 0.25) }]}
              >
                <Text style={[type.heading, styles.tileText]} numberOfLines={2}>
                  {c.name}
                </Text>
                <View style={[styles.tileIcon, { backgroundColor: alpha('#000000', 0.18) }]}>
                  <Icon name={c.icon} size={30} color="rgba(255,255,255,0.92)" />
                </View>
              </Touchable>
            ))}
          </View>
          <Text style={[type.heading, styles.browseTitle]}>Search like a researcher</Text>
          <View style={styles.tips}>
            {TIPS.map((t) => (
              <Chip key={t} label={t} icon="flash-outline" onPress={() => setQuery(t)} />
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

/** Replace the partial last word of `query` with `term`. */
function completeLastWord(query: string, term: string): string {
  const parts = query.trimEnd().split(/\s+/);
  parts[parts.length - 1] = term;
  return `${parts.join(' ')} `;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  top: { paddingHorizontal: GUTTER, gap: space.md, paddingTop: space.md, maxWidth: 760, width: '100%', alignSelf: 'center' },
  chips: { paddingHorizontal: GUTTER, paddingVertical: space.md, gap: space.sm, alignItems: 'center' },
  divider: { width: StyleSheet.hairlineWidth, height: 20, backgroundColor: color.border, marginHorizontal: space.xs },
  results: { paddingBottom: space.huge, maxWidth: 760, width: '100%', alignSelf: 'center' },
  meta: { paddingHorizontal: GUTTER, paddingBottom: space.sm, gap: space.sm },
  suggestRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  browse: { paddingHorizontal: GUTTER, paddingBottom: space.huge, maxWidth: 760, width: '100%', alignSelf: 'center' },
  browseTitle: { marginTop: space.md, marginBottom: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    height: 96,
    borderRadius: radius.md,
    padding: space.md,
    overflow: 'hidden',
  },
  tileText: { width: '70%' },
  tileIcon: {
    position: 'absolute',
    right: -6,
    bottom: -6,
    width: 64,
    height: 64,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '18deg' }],
  },
  tips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
