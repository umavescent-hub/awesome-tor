import { useMemo } from 'react';

import type { ID, Recommendation } from '@/domain/types';
import { recommend } from '@/engine';
import { useLibrary } from '@/store';
import { useNow } from './useNow';

interface Options {
  limit?: number;
  playlistId?: ID;
  categoryId?: ID;
  includeReviews?: boolean;
}

/** Memoised engine call; recomputes when the library or the clock changes. */
export function useRecommendations({ limit = 10, playlistId, categoryId, includeReviews = true }: Options = {}): Recommendation[] {
  const { state } = useLibrary();
  const now = useNow();
  return useMemo(
    () => recommend(state, { now, limit, playlistId, categoryId, includeReviews }),
    [state, now, limit, playlistId, categoryId, includeReviews],
  );
}
