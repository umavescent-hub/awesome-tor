# Folio — research playlists

A mobile app (iOS, Android, web) for organising research the way a music app organises listening: playlists, categories, live search, a "Now studying" bar — and an **Up Next** engine that ranks what to study next and tells you why.

Built with Expo SDK 58 · React Native 0.88 · React 19 · TypeScript (strict) · Expo Router.

## Run it

```bash
cd folio
npm install
npx expo start          # scan the QR code with Expo Go (iOS / Android)
npm run web             # or open it in a browser
```

| Script | What it does |
| --- | --- |
| `npm start` | Expo dev server (Expo Go, simulators, web) |
| `npm run web` | Dev server in the browser |
| `npm run export:web` | Static web build into `dist/` |
| `npm test` | Unit tests (Vitest) for the engine, search, store and seed |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check` | Typecheck + tests |

## What's inside

| Screen | |
| --- | --- |
| **Home** | Quick-access playlist grid, the Up Next hero with its reasons, Continue studying, Due for review, Your path, and a shelf per category ranked for you |
| **Search** | As-you-type, typo-tolerant search with filter chips and researcher operators |
| **Library** | Playlists (pinned first), all / in progress / completed materials, study stats and streak |
| **Material** | Progress in 10% steps, mark complete, spaced review (Again / Hard / Good / Easy with next-interval preview), rating, tags, prerequisites, what it unlocks, "More like this" |
| **Playlist** | Play next (sequence-aware), reorder, add / remove, pin, rename, delete |
| **Category** | Every item in your recommended order |
| **Add material / New playlist / Settings** | Forms with validation; daily study budget; a plain-language "How Up Next decides" |

### Search syntax

| Query | Meaning |
| --- | --- |
| `fermentaton` | Typos are forgiven (matches *fermentation*) |
| `kel` | Prefix match while you type (matches *Keller*) |
| `author:keller` | Author field only |
| `tag:koji` | Tag field only |
| `kind:paper` | Papers only (`book`, `lecture`, `podcast`, …) |
| `year:2011` · `year:2000..2015` · `year:>2010` | Year filters |
| `"food pairing"` | Exact phrase |
| `fermentation -kimchi` | Exclude a term |

Ranking is BM25F with field boosts (title > tags > authors > venue/abstract), prefix and Damerau–Levenshtein typo tolerance, and a coverage penalty for partial matches.

## How Up Next decides

`src/engine` is pure TypeScript: deterministic, no network, unit-tested. Each unfinished item is scored on:

| Signal | Idea |
| --- | --- |
| Momentum | In-progress work comes first, decaying if left untouched |
| Readiness | Prerequisites done → ready; missing → soft penalty; just finished the last one → "Unlocked" |
| Taste | TF-IDF profile of what you finished and rated, weighted by recency; cosine similarity to each candidate |
| Foundations | Items many queued materials depend on are favoured early |
| Stretch | Difficulty pitched half a step above what you've recently completed |
| Time | Remaining minutes against your daily budget |
| Sequence | Inside a playlist, your chosen order |
| Variety | MMR diversity re-ranking so the queue doesn't collapse into one topic |
| Review | Completed work returns on an SM-2 spaced-repetition schedule, in its own capped lane |

Every recommendation carries human-readable reasons ("Unlocked — you finished “The Art of Fermentation”"). It is a ranking you can see into and steer with your ratings and choices. It cannot know for certain what you should study next.

## Architecture

```
src/
  app/          Expo Router screens (tabs + stack + modals)
  components/   Design-system components (generative covers, rows, sheets, …)
  domain/       Types and the shared text normaliser
  engine/       Recommendation engine, similarity, SM-2 review, prerequisite graph
  search/       In-memory search index, query parser, autocomplete
  store/        Reducer, selectors, persistence (AsyncStorage), provider
  data/         First-launch sample library
  theme/        Tokens, formatting, haptics
```

State is a single serialisable `LibraryState`, updated by a pure reducer and persisted on the device (debounced, flushed when the app goes to the background). Nothing leaves the phone.

## Sample library

On first launch Folio opens with a culinary research library: food science, fermentation, flavor and perception, technique, Indigenous foodways, hospitality and culinary history. Every entry is a real, published work. Replace it with your own from **Settings → Reset**, or just start adding.
