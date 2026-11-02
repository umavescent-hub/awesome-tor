import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { color, radius, space, type } from '@/theme';
import { IconButton } from './IconButton';
import { Icon } from './Icon';

interface Props extends Omit<TextInputProps, 'value' | 'onChangeText'> {
  value: string;
  onChangeText: (text: string) => void;
}

export function SearchField({ value, onChangeText, ...rest }: Props) {
  return (
    <View style={styles.wrap}>
      <Icon name="search" size={18} color={color.textMuted} />
      <TextInput
        {...rest}
        value={value}
        onChangeText={onChangeText}
        style={[type.body, styles.input]}
        placeholderTextColor={color.textFaint}
        selectionColor={color.accent}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="never"
        accessibilityLabel="Search your library"
        accessibilityRole="search"
      />
      {value.length > 0 && (
        <IconButton
          icon="close-circle"
          label="Clear search"
          size={18}
          tint={color.textMuted}
          onPress={() => onChangeText('')}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: color.elevated,
    borderRadius: radius.md,
    paddingLeft: space.md,
    minHeight: 46,
  },
  input: { flex: 1, paddingVertical: space.sm, outlineWidth: 0 },
});
