import type { IconName } from '@/components/Icon';
import type { Material, MaterialKind } from '@/domain/types';

export const KIND_LABEL: Record<MaterialKind, string> = {
  paper: 'Paper',
  book: 'Book',
  chapter: 'Chapter',
  article: 'Article',
  lecture: 'Lecture',
  video: 'Video',
  podcast: 'Podcast',
  dataset: 'Dataset',
};

/** Ionicons glyph per kind. */
export const KIND_ICON: Record<MaterialKind, IconName> = {
  paper: 'document-text-outline',
  book: 'book-outline',
  chapter: 'bookmark-outline',
  article: 'newspaper-outline',
  lecture: 'school-outline',
  video: 'play-circle-outline',
  podcast: 'mic-outline',
  dataset: 'server-outline',
};

/** 45 → "45 min", 90 → "1 h 30", 600 → "10 h". */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${String(rest).padStart(2, '0')}`;
}

/** "McGee", "Redzepi & Zilber", "Ahn et al." */
export function formatAuthors(authors: string[]): string {
  const surname = (name: string) => name.trim().split(/\s+/).pop() ?? name;
  if (authors.length === 0) return 'Unknown author';
  if (authors.length === 1) return authors[0] ?? '';
  if (authors.length === 2) return `${surname(authors[0] ?? '')} & ${surname(authors[1] ?? '')}`;
  return `${surname(authors[0] ?? '')} et al.`;
}

export function materialByline(m: Material): string {
  return `${formatAuthors(m.authors)} · ${m.year} · ${KIND_LABEL[m.kind]}`;
}

export function formatPercent(p: number): string {
  return `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`;
}

/** Relative day phrase for an ISO date in the past: "today", "yesterday", "5 days ago". */
export function daysAgo(iso: string | undefined, now: Date): string | undefined {
  if (!iso) return undefined;
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (Number.isNaN(days)) return undefined;
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months <= 1 ? 'a month ago' : `${months} months ago`;
}

export function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 5) return 'Late night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Mix a hex colour toward black (amount 0..1). */
export function shade(hex: string, amount: number): string {
  const n = hex.replace('#', '');
  const full = n.length === 3 ? n.split('').map((c) => c + c).join('') : n;
  const v = Number.parseInt(full, 16);
  if (Number.isNaN(v) || full.length !== 6) return hex;
  const k = 1 - Math.min(1, Math.max(0, amount));
  const r = Math.round(((v >> 16) & 255) * k);
  const g = Math.round(((v >> 8) & 255) * k);
  const b = Math.round((v & 255) * k);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Hex + alpha → rgba(). */
export function alpha(hex: string, a: number): string {
  const n = hex.replace('#', '');
  const v = Number.parseInt(n.length === 3 ? n.split('').map((c) => c + c).join('') : n, 16);
  if (Number.isNaN(v)) return hex;
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
}

/** Stable 32-bit FNV-1a hash — drives deterministic cover art. */
export function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
