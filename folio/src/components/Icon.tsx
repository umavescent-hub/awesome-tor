import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export type IconColor = NonNullable<ComponentProps<typeof Ionicons>['color']>;

interface Props {
  /** Ionicons glyph. Accepts plain strings because category icons come from data. */
  name: IconName | string;
  size?: number;
  color: IconColor;
}

export function Icon({ name, size = 20, color }: Props) {
  return <Ionicons name={name as IconName} size={size} color={color} />;
}
