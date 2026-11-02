import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  Button,
  Chip,
  Cover,
  EmptyState,
  Icon,
  IconButton,
  MaterialCard,
  MaterialRow,
  PlaylistPicker,
  ProgressBar,
  SegmentedProgress,
  Sheet,
  Touchable,
} from '@/components';
import type { Material, ReviewGrade } from '@/domain/types';
import { isReviewDue, prerequisiteStatus, scheduleReview, similarMaterials } from '@/engine';
import { useNow } from '@/hooks';
import { progressOf, useLibrary } from '@/store';
import {
  GUTTER,
  KIND_LABEL,
  alpha,
  color,
  daysAgo,
  formatMinutes,
  formatPercent,
  haptic,
  radius,
  space,
  type,
} from '@/theme';

const GRADES: { grade: ReviewGrade; label: string }[] = [
  { grade: 'again', label: 'Again' },
  { grade: 'hard', label: 'Hard' },
  { grade: 'good', label: 'Good' },
  { grade: 'easy', label: 'Easy' },
];

export default function MaterialScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const { state, actions } = useLibrary();
  const now = useNow();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [reviewEarly, setReviewEarly] = useState(false);

  const material = state.materials[id];
  const progress = progressOf(state, id);
  const similar = useMemo(
    () => (material ? similarMaterials(state, id, 8) : []),
    // Similarity depends only on content, not on progress — skip recomputing on every tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.materials, state.categories, id],
  );

  // Viewing something you're mid-way through brings it back to the Now Studying bar.
  useEffect(() => {
    if (progressOf(state, id).status === 'in_progress') actions.open(id);
    // Run once per material, not on every state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!material) {
    return (
      <View style={styles.fill}>
        <EmptyState icon="alert-circle-outline" title="Not in your library" message="This material may have been removed." actionLabel="Go home" onAction={() => router.replace('/')} />
      </View>
    );
  }

  const category = state.categories[material.categoryId];
  const tint = category?.color ?? color.accent;
  const prereq = prerequisiteStatus(state, id);
  const prerequisites = material.prerequisites.map((p) => state.materials[p]).filter((m): m is Material => !!m);
  const unlocks = Object.values(state.materials).filter((m) => m.prerequisites.includes(id));
  const inPlaylists = Object.values(state.playlists).filter((p) => p.materialIds.includes(id));
  const link = material.url ?? (material.doi ? `https://doi.org/${material.doi}` : undefined);
  const due = isReviewDue(progress, now);
  const remaining = material.minutes * (1 - progress.percent);
  const status = progress.status;

  const openRow = (m: Material) => router.push(`/material/${m.id}`);

  return (
    <View style={styles.fill}>
      <ScrollView contentContainerStyle={styles.content}>
        <LinearGradient colors={[alpha(tint, 0.5), color.bg]} style={styles.backdrop} pointerEvents="none" />

        <View style={styles.hero}>
          <View style={styles.coverShadow}>
            <Cover material={material} category={category} size={212} radius={8} />
          </View>
        </View>

        <View style={styles.block}>
          <Text style={type.title} accessibilityRole="header">
            {material.title}
          </Text>
          <Text style={[type.bodyStrong, styles.authors]}>{material.authors.join(', ')}</Text>
          <Text style={type.caption}>
            {[material.venue, material.year, KIND_LABEL[material.kind], formatMinutes(material.minutes)].filter(Boolean).join(' · ')}
          </Text>
          <View style={styles.metaRow}>
            <Difficulty level={material.difficulty} tint={tint} />
            {category && (
              <Touchable onPress={() => router.push(`/category/${category.id}`)} accessibilityRole="link" accessibilityLabel={`Category ${category.name}`}>
                <Text style={[type.captionStrong, { color: tint }]}>{category.name}</Text>
              </Touchable>
            )}
          </View>
        </View>

        <View style={[styles.block, styles.actions]}>
          {status !== 'completed' && (
            <Button
              label={status === 'in_progress' ? 'Mark complete' : 'Start'}
              icon={status === 'in_progress' ? 'checkmark' : 'play'}
              onPress={() => {
                if (status === 'in_progress') {
                  actions.complete(id);
                  haptic.success();
                } else {
                  actions.start(id);
                  haptic.impact();
                }
              }}
              style={styles.flex}
            />
          )}
          {status === 'completed' && (
            <View style={[styles.flex, styles.doneBadge]}>
              <Icon name="checkmark-circle" size={20} color={color.accent} />
              <Text style={[type.bodyStrong, { color: color.accent }]}>Completed {daysAgo(progress.completedAt, now)}</Text>
            </View>
          )}
          <IconButton icon="albums-outline" label="Add to playlist" onPress={() => setPickerOpen(true)} filled />
          {link && <IconButton icon="open-outline" label="Open source" onPress={() => Linking.openURL(link).catch(() => undefined)} filled />}
          <IconButton icon="ellipsis-horizontal" label="More options" onPress={() => setMoreOpen(true)} filled />
        </View>

        {prereq.missing.length > 0 && status !== 'completed' && (
          <View style={[styles.block, styles.notice]}>
            <Icon name="git-merge-outline" size={18} color={color.warning} />
            <Text style={[type.caption, styles.noticeText]}>
              Builds on {prereq.missing.length} {prereq.missing.length === 1 ? 'material' : 'materials'} you haven’t finished — see Prerequisites below. You can still start now.
            </Text>
          </View>
        )}

        {(status === 'in_progress' || status === 'completed') && (
          <View style={[styles.block, styles.card]}>
            <View style={styles.cardHead}>
              <Text style={type.heading}>Progress</Text>
              <Text style={type.caption}>
                {formatPercent(progress.percent)}
                {remaining > 0 ? ` · ${formatMinutes(remaining)} left` : ''} · {progress.sessions} {progress.sessions === 1 ? 'session' : 'sessions'}
              </Text>
            </View>
            <SegmentedProgress value={progress.percent} onChange={(v) => actions.setPercent(id, v)} tint={tint} />
          </View>
        )}

        {status === 'completed' && (
          <View style={[styles.block, styles.card]}>
            {due || reviewEarly ? (
              <>
                <Text style={type.heading}>How well does it stick?</Text>
                <Text style={type.caption}>Recall the key ideas without looking, then grade yourself honestly.</Text>
                <View style={styles.grades}>
                  {GRADES.map(({ grade, label }) => {
                    const next = scheduleReview(progress.review, grade, now);
                    return (
                      <Touchable
                        key={grade}
                        feedback="scale"
                        onPress={() => {
                          actions.review(id, grade);
                          setReviewEarly(false);
                          haptic.success();
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`${label}, next review in ${next.intervalDays} days`}
                        style={[styles.grade, grade === 'good' && { backgroundColor: alpha(tint, 0.25), borderColor: tint }]}
                      >
                        <Text style={type.bodyStrong}>{label}</Text>
                        <Text style={type.caption}>{next.intervalDays} d</Text>
                      </Touchable>
                    );
                  })}
                </View>
              </>
            ) : (
              <View style={styles.cardHead}>
                <View style={styles.flex}>
                  <Text style={type.heading}>Spaced review</Text>
                  <Text style={type.caption}>
                    Next review {progress.review ? dueIn(progress.review.dueAt, now) : 'not scheduled'}
                  </Text>
                </View>
                <Button label="Review early" variant="secondary" size="sm" onPress={() => setReviewEarly(true)} />
              </View>
            )}
            <View style={styles.divider} />
            <View style={styles.cardHead}>
              <Text style={type.heading}>Your rating</Text>
              <View style={styles.stars}>
                {([1, 2, 3, 4, 5] as const).map((n) => (
                  <IconButton
                    key={n}
                    icon={progress.rating && n <= progress.rating ? 'star' : 'star-outline'}
                    label={`Rate ${n} of 5`}
                    size={20}
                    tint={progress.rating && n <= progress.rating ? color.warning : color.textFaint}
                    onPress={() => {
                      actions.rate(id, n);
                      haptic.tap();
                    }}
                  />
                ))}
              </View>
            </View>
          </View>
        )}

        <View style={styles.block}>
          <Text style={[type.heading, styles.sectionTitle]}>About</Text>
          <Text style={[type.body, styles.abstract]}>{material.abstract}</Text>
          {material.tags.length > 0 && (
            <View style={styles.tags}>
              {material.tags.map((t) => (
                <Chip
                  key={t}
                  label={`#${t}`}
                  onPress={() => router.push({ pathname: '/search', params: { q: /\s/.test(t) ? `"${t}"` : `tag:${t}` } })}
                />
              ))}
            </View>
          )}
        </View>

        {prerequisites.length > 0 && (
          <Section title="Prerequisites" subtitle={`${prereq.completed} of ${prereq.total} complete`}>
            <ProgressBar value={prereq.total ? prereq.completed / prereq.total : 1} tint={tint} style={styles.prereqBar} />
            {prerequisites.map((m) => (
              <MaterialRow key={m.id} material={m} category={state.categories[m.categoryId]} progress={progressOf(state, m.id)} onPress={() => openRow(m)} />
            ))}
          </Section>
        )}

        {unlocks.length > 0 && (
          <Section title="Opens the way to">
            {unlocks.map((m) => (
              <MaterialRow key={m.id} material={m} category={state.categories[m.categoryId]} progress={progressOf(state, m.id)} onPress={() => openRow(m)} />
            ))}
          </Section>
        )}

        {inPlaylists.length > 0 && (
          <View style={styles.block}>
            <Text style={[type.heading, styles.sectionTitle]}>In your playlists</Text>
            <View style={styles.tags}>
              {inPlaylists.map((p) => (
                <Chip key={p.id} label={p.name} icon="albums-outline" onPress={() => router.push(`/playlist/${p.id}`)} />
              ))}
            </View>
          </View>
        )}

        {similar.length > 0 && (
          <View style={styles.section}>
            <Text style={[type.heading, styles.sectionTitle, styles.gutter]}>More like this</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
              {similar.map(({ materialId }) => {
                const m = state.materials[materialId];
                return m ? (
                  <MaterialCard key={m.id} material={m} category={state.categories[m.categoryId]} progress={progressOf(state, m.id)} size={128} onPress={() => openRow(m)} />
                ) : null;
              })}
            </ScrollView>
          </View>
        )}
      </ScrollView>

      <PlaylistPicker materialId={id} visible={pickerOpen} onClose={() => setPickerOpen(false)} />

      <Sheet
        visible={moreOpen}
        onClose={() => {
          setMoreOpen(false);
          setConfirmRemove(false);
        }}
        title={confirmRemove ? 'Remove from library?' : material.title}
      >
        <View style={styles.sheetBody}>
          {confirmRemove ? (
            <>
              <Text style={type.caption}>
                This deletes the material, its progress and its place in every playlist. It can’t be undone.
              </Text>
              <Button
                label="Remove permanently"
                variant="danger"
                icon="trash-outline"
                onPress={() => {
                  setMoreOpen(false);
                  router.back();
                  actions.removeMaterial(id);
                }}
              />
              <Button label="Keep it" variant="secondary" onPress={() => setConfirmRemove(false)} />
            </>
          ) : (
            <>
              {status !== 'skipped' && status !== 'completed' && (
                <Button label="Skip for now" variant="secondary" icon="play-skip-forward-outline" onPress={() => { actions.skip(id); setMoreOpen(false); }} />
              )}
              {status !== 'queued' && (
                <Button label="Reset progress" variant="secondary" icon="refresh-outline" onPress={() => { actions.reset(id); setMoreOpen(false); }} />
              )}
              <Button label="Remove from library" variant="danger" icon="trash-outline" onPress={() => setConfirmRemove(true)} />
            </>
          )}
        </View>
      </Sheet>
    </View>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={[styles.gutter, styles.sectionHead]}>
        <Text style={type.heading}>{title}</Text>
        {subtitle ? <Text style={type.caption}>{subtitle}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function Difficulty({ level, tint }: { level: number; tint: string }) {
  return (
    <View style={styles.dots} accessible accessibilityLabel={`Difficulty ${level} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <View key={n} style={[styles.dot, { backgroundColor: n <= level ? tint : color.pressed }]} />
      ))}
    </View>
  );
}

function dueIn(iso: string, now: Date): string {
  const days = Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000);
  if (days <= 0) return 'is due now';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  content: { paddingBottom: space.huge, maxWidth: 760, width: '100%', alignSelf: 'center' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, height: 380 },
  hero: { alignItems: 'center', paddingTop: space.lg, paddingBottom: space.xxl },
  coverShadow: {
    borderRadius: radius.md,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  block: { paddingHorizontal: GUTTER, marginBottom: space.xl },
  authors: { marginTop: space.sm, marginBottom: space.xs },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  doneBadge: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 46 },
  notice: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    marginHorizontal: GUTTER,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(227, 180, 81, 0.1)',
  },
  noticeText: { flex: 1, color: color.text },
  card: {
    marginHorizontal: GUTTER,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    gap: space.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap' },
  grades: { flexDirection: 'row', gap: space.sm },
  grade: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: color.elevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
    gap: 2,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: color.hairline },
  stars: { flexDirection: 'row' },
  sectionTitle: { marginBottom: space.md },
  abstract: { color: color.textMuted },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg },
  section: { marginBottom: space.xxl },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: space.sm },
  gutter: { paddingHorizontal: GUTTER },
  prereqBar: { marginHorizontal: GUTTER, marginBottom: space.sm },
  shelf: { paddingHorizontal: GUTTER, gap: space.md },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  sheetBody: { paddingHorizontal: GUTTER, gap: space.md, paddingTop: space.sm },
});
