import { it } from 'vitest';
import { buildSearchIndex, search } from './index';
import { material } from '../engine/testing';

function rng(seed: number) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; }
it('perf', () => {
  const r = rng(42);
  const syll = ['fer','men','ta','tion','ko','ji','kel','ler','mi','so','zy','mo','lac','to','ba','cil','lus','yeast','sour','dough','bre','wing','ac','id'];
  const word = () => Array.from({ length: 2 + Math.floor(r() * 3) }, () => syll[Math.floor(r() * syll.length)]).join('');
  const vocab = Array.from({ length: 3000 }, word);
  const pick = () => vocab[Math.floor(r() * vocab.length)]!;
  const words = (n: number) => Array.from({ length: n }, pick).join(' ');
  const docs = Array.from({ length: 5000 }, (_, i) => material(`m${i}`, { title: words(5), abstract: words(50), tags: [pick(), pick()], authors: [words(2)], year: 1990 + (i % 35) }));
  let t = performance.now();
  const index = buildSearchIndex(docs);
  console.log('build ms', (performance.now() - t).toFixed(1), 'vocab', (index as any).vocabulary.length);
  for (const q of ['fermentaton', 'fermentation koji', 'ke', 'kel', 'fermentaton sourdough kel', 'author:ko tag:fer mi', '"fermen tation"', 'zymolacto bacillusac']) {
    search(index, q);
    t = performance.now();
    const n = 5;
    let hits = 0;
    for (let i = 0; i < n; i++) hits = search(index, q).length;
    console.log(JSON.stringify(q), ((performance.now() - t) / n).toFixed(2), 'ms', hits);
  }
});
