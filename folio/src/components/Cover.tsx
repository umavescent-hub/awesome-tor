import { memo, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import type { Category, Material, MaterialKind } from '@/domain/types';
import { KIND_ICON, color as palette, hash, shade } from '@/theme';
import { Icon } from './Icon';

interface Props {
  material: Pick<Material, 'id' | 'kind'>;
  category?: Pick<Category, 'color'>;
  size: number;
  radius?: number;
}

const INK = 'rgba(255,255,255,0.16)';
const INK_STRONG = 'rgba(255,255,255,0.28)';
const SHADOW = 'rgba(0,0,0,0.22)';

/**
 * Generative cover art: the category hue as a gradient field, with a motif chosen by kind and
 * varied deterministically by the material id — so every item is recognisable at a glance.
 * Books carry the stepped terrace of Pueblo design.
 */
export const Cover = memo(function Cover({ material, category, size, radius = 6 }: Props) {
  const base = category?.color ?? palette.accent;
  const seed = hash(material.id);
  const gradientId = `g-${material.id}`;
  const showGlyph = size >= 64;

  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: radius }]}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={base} />
            <Stop offset="1" stopColor={shade(base, 0.62)} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${gradientId})`} />
        {motif(material.kind, seed)}
      </Svg>
      {showGlyph && (
        <View style={styles.glyph}>
          <Icon name={KIND_ICON[material.kind]} size={Math.round(size * 0.13)} color="rgba(255,255,255,0.85)" />
        </View>
      )}
    </View>
  );
});

/** Pick 0..n-1 from a seed and a salt. */
const pick = (seed: number, salt: number, n: number) => ((seed >>> salt) & 0xffff) % n;

function motif(kind: MaterialKind, seed: number): ReactElement {
  switch (kind) {
    case 'book':
      return <Terraces seed={seed} />;
    case 'chapter':
      return <Strata seed={seed} />;
    case 'paper':
    case 'article':
      return <Lines seed={seed} dense={kind === 'article'} />;
    case 'lecture':
      return <Arcs seed={seed} />;
    case 'video':
      return <Frame seed={seed} />;
    case 'podcast':
      return <Waves seed={seed} />;
    case 'dataset':
      return <Grid seed={seed} />;
  }
}

/** Stepped terraces rising toward a sun — the Pueblo step motif. */
function Terraces({ seed }: { seed: number }) {
  const steps = 3 + pick(seed, 0, 3);
  const w = 100 / steps;
  const rise = 12 + pick(seed, 4, 6);
  const mirrored = pick(seed, 8, 2) === 1;
  let d = 'M0 100';
  for (let i = 0; i < steps; i++) {
    const y = 100 - rise * (i + 1);
    d += ` L${i * w} ${y} L${(i + 1) * w} ${y}`;
  }
  d += ' L100 100 Z';
  const sunX = mirrored ? 26 : 74;
  return (
    <>
      <Circle cx={sunX} cy={24 + pick(seed, 12, 10)} r={9 + pick(seed, 16, 5)} fill={INK_STRONG} />
      <Path d={d} fill={INK} transform={mirrored ? 'translate(100 0) scale(-1 1)' : undefined} />
      <Path d={d} fill={SHADOW} transform={`translate(${mirrored ? 100 : 0} 14) scale(${mirrored ? -1 : 1} 1)`} />
    </>
  );
}

function Strata({ seed }: { seed: number }) {
  const bands = 4 + pick(seed, 0, 3);
  const h = 70 / bands;
  return (
    <>
      {Array.from({ length: bands }, (_, i) => (
        <Rect
          key={i}
          x={10 + ((seed >>> i) % 12)}
          y={18 + i * h}
          width={46 + ((seed >>> (i * 3)) % 40)}
          height={h * 0.6}
          rx={1.5}
          fill={i % 2 === 0 ? INK_STRONG : INK}
        />
      ))}
    </>
  );
}

function Lines({ seed, dense }: { seed: number; dense: boolean }) {
  const count = dense ? 9 : 6;
  const gap = dense ? 7 : 9;
  return (
    <>
      <Circle cx={78} cy={22} r={10} fill={INK_STRONG} />
      {Array.from({ length: count }, (_, i) => (
        <Rect
          key={i}
          x={12}
          y={40 + i * gap - (dense ? 10 : 0)}
          width={30 + ((seed >>> (i * 2)) % 50)}
          height={2.6}
          rx={1.3}
          fill={i === 0 ? INK_STRONG : INK}
        />
      ))}
    </>
  );
}

function Arcs({ seed }: { seed: number }) {
  const cx = pick(seed, 0, 2) === 0 ? 0 : 100;
  return (
    <>
      {[78, 60, 42, 24].map((r, i) => (
        <Circle key={r} cx={cx} cy={100} r={r} fill="none" stroke={i % 2 ? INK : INK_STRONG} strokeWidth={7} />
      ))}
    </>
  );
}

function Frame({ seed }: { seed: number }) {
  const r = 22 + pick(seed, 0, 8);
  return (
    <>
      <Circle cx={50} cy={50} r={r + 10} fill={INK} />
      <Path d="M43 37 L66 50 L43 63 Z" fill={INK_STRONG} />
    </>
  );
}

function Waves({ seed }: { seed: number }) {
  const amp = 6 + pick(seed, 0, 6);
  return (
    <>
      {[34, 50, 66].map((y, i) => (
        <Path
          key={y}
          d={`M0 ${y} Q12.5 ${y - amp} 25 ${y} T50 ${y} T75 ${y} T100 ${y}`}
          fill="none"
          stroke={i === 1 ? INK_STRONG : INK}
          strokeWidth={4}
          strokeLinecap="round"
        />
      ))}
    </>
  );
}

function Grid({ seed }: { seed: number }) {
  return (
    <>
      {Array.from({ length: 16 }, (_, i) => (
        <Rect
          key={i}
          x={14 + (i % 4) * 19}
          y={14 + Math.floor(i / 4) * 19}
          width={13}
          height={13}
          rx={2}
          fill={(seed >>> i) & 1 ? INK_STRONG : INK}
        />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', backgroundColor: palette.elevated },
  glyph: { position: 'absolute', left: '8%', bottom: '8%' },
});
