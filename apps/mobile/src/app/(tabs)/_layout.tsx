import { Tabs } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ColorValue } from 'react-native';

const icon =
  (name: SymbolViewProps['name']) =>
  ({ color }: { color: ColorValue }) => <SymbolView name={name} tintColor={color} size={24} />;

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#0A84FF' }}>
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: icon('heart.text.square') }} />
      <Tabs.Screen name="food" options={{ title: 'Food', tabBarIcon: icon('fork.knife') }} />
      <Tabs.Screen name="log" options={{ title: 'Log', tabBarIcon: icon('plus.circle') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('gearshape') }} />
    </Tabs>
  );
}
