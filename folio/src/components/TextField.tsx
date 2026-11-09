import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { color, radius, space, type } from '@/theme';

interface Props extends TextInputProps {
  label: string;
  hint?: string;
  error?: string;
}

export function TextField({ label, hint, error, style, multiline, ...rest }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={type.micro}>{label}</Text>
      <TextInput
        {...rest}
        multiline={multiline}
        accessibilityLabel={label}
        placeholderTextColor={color.textFaint}
        selectionColor={color.accent}
        style={[type.body, styles.input, multiline && styles.multiline, !!error && styles.invalid, style]}
      />
      {error ? (
        <Text style={[type.caption, { color: color.danger }]}>{error}</Text>
      ) : hint ? (
        <Text style={type.caption}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  input: {
    backgroundColor: color.elevated,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    minHeight: 46,
  },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  invalid: { borderColor: color.danger },
});
