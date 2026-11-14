import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

export const palette = {
  light: { bg: '#F2F2F7', card: '#FFFFFF', text: '#111111', muted: '#6B6B70', border: '#E2E2E6', input: '#F4F4F6' },
  dark: { bg: '#000000', card: '#1C1C1E', text: '#F5F5F7', muted: '#9A9AA0', border: '#2C2C2E', input: '#2C2C2E' },
};
export const accent = {
  food: '#FF9500',
  weight: '#5856D6',
  sleep: '#AF52DE',
  water: '#0A84FF',
  workout: '#34C759',
  primary: '#0A84FF',
  danger: '#FF3B30',
};

export function useTheme() {
  return palette[useColorScheme() === 'dark' ? 'dark' : 'light'];
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.card }, style]}>{children}</View>;
}

export function Title({ children, color }: { children: ReactNode; color?: string }) {
  const t = useTheme();
  return <Text style={[styles.title, { color: color ?? t.text }]}>{children}</Text>;
}

export function Label({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.label, { color: t.muted }]}>{children}</Text>;
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  const t = useTheme();
  return <Text style={[styles.body, { color: muted ? t.muted : t.text }, style]}>{children}</Text>;
}

export function BigNumber({ value, unit, color }: { value: string; unit?: string; color?: string }) {
  const t = useTheme();
  return (
    <Text style={[styles.big, { color: color ?? t.text }]}>
      {value}
      {unit ? <Text style={[styles.bigUnit, { color: t.muted }]}> {unit}</Text> : null}
    </Text>
  );
}

export function Input(props: TextInputProps & { label?: string }) {
  const t = useTheme();
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: 6, flex: 1 }}>
      {label ? <Label>{label}</Label> : null}
      <TextInput
        placeholderTextColor={t.muted}
        {...rest}
        style={[styles.input, { backgroundColor: t.input, color: t.text }, style]}
      />
    </View>
  );
}

export function Button({
  title,
  onPress,
  color = accent.primary,
  variant = 'solid',
  loading,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  color?: string;
  variant?: 'solid' | 'outline';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const solid = variant === 'solid';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        solid ? { backgroundColor: color } : { borderColor: color, borderWidth: 1.5 },
        { opacity: pressed || disabled ? 0.6 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={solid ? '#fff' : color} />
      ) : (
        <Text style={[styles.buttonText, { color: solid ? '#fff' : color }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Chip({ label, active, onPress, color = accent.primary }: { label: string; active: boolean; onPress: () => void; color?: string }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active ? { backgroundColor: color } : { backgroundColor: t.input }]}
    >
      <Text style={{ color: active ? '#fff' : t.text, fontWeight: '600', textTransform: 'capitalize' }}>{label}</Text>
    </Pressable>
  );
}

export function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const t = useTheme();
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <View style={[styles.track, { backgroundColor: t.input }]}>
      <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: color, borderRadius: 4 }} />
    </View>
  );
}

export const Row = ({ children, style }: { children: ReactNode; style?: ViewStyle }) => (
  <View style={[{ flexDirection: 'row', gap: 10, alignItems: 'center' }, style]}>{children}</View>
);

const styles = StyleSheet.create({
  card: { borderRadius: 14, padding: 16, gap: 10 },
  title: { fontSize: 17, fontWeight: '700' },
  label: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  body: { fontSize: 15, lineHeight: 21 },
  big: { fontSize: 30, fontWeight: '700', fontVariant: ['tabular-nums'] },
  bigUnit: { fontSize: 15, fontWeight: '500' },
  input: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16 },
  button: { borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
});
