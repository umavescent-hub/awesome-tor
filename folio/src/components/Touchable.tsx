import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

interface Props extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** Visual feedback while pressed. Default 'fade'. */
  feedback?: 'fade' | 'scale' | 'none';
}

/** Pressable with consistent press feedback across iOS, Android and web. */
export function Touchable({ style, feedback = 'fade', ...rest }: Props) {
  return (
    <Pressable
      {...rest}
      style={({ pressed }) => [
        style,
        pressed && feedback === 'fade' && { opacity: 0.6 },
        pressed && feedback === 'scale' && { transform: [{ scale: 0.97 }], opacity: 0.9 },
      ]}
    />
  );
}
