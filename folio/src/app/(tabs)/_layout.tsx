import { BottomTabBar, Tabs } from 'expo-router/tabs';
import { StyleSheet, View, type ColorValue } from 'react-native';

import { Icon, NowStudyingBar, type IconColor, type IconName } from '@/components';
import { color } from '@/theme';

const tabIcon =
  (active: IconName, idle: IconName) =>
  ({ focused, color: tint, size }: { focused: boolean; color: ColorValue; size: number }) => (
    <Icon name={focused ? active : idle} size={size} color={tint as IconColor} />
  );

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => (
        <View style={styles.dock}>
          <NowStudyingBar />
          <BottomTabBar {...props} />
        </View>
      )}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: color.bg },
        tabBarActiveTintColor: color.text,
        tabBarInactiveTintColor: color.textFaint,
        tabBarStyle: { backgroundColor: color.bg, borderTopColor: color.hairline },
        tabBarLabelStyle: { fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon('home', 'home-outline') }} />
      <Tabs.Screen name="search" options={{ title: 'Search', tabBarIcon: tabIcon('search', 'search-outline') }} />
      <Tabs.Screen name="library" options={{ title: 'Library', tabBarIcon: tabIcon('library', 'library-outline') }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  dock: { backgroundColor: color.bg },
});
