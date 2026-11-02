import { DarkTheme, ThemeProvider, type Theme } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { LibraryProvider, useLibrary } from '@/store';
import { color } from '@/theme';

SystemUI.setBackgroundColorAsync(color.bg).catch(() => undefined);

const theme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: color.accent,
    background: color.bg,
    card: color.bg,
    text: color.text,
    border: color.hairline,
  },
};

/** Hold rendering until stored data is hydrated, so the sample library never flashes over yours. */
function HydrationGate({ children }: { children: ReactNode }) {
  const { ready } = useLibrary();
  return ready ? children : <View style={{ flex: 1, backgroundColor: color.bg }} />;
}

export default function RootLayout() {
  return (
    <LibraryProvider>
      <ThemeProvider value={theme}>
        <StatusBar style="light" />
        <HydrationGate>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: color.bg },
              headerTintColor: color.text,
              headerShadowVisible: false,
              headerBackButtonDisplayMode: 'minimal',
              contentStyle: { backgroundColor: color.bg },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="material/[id]" options={{ title: '' }} />
            <Stack.Screen name="playlist/[id]" options={{ title: '' }} />
            <Stack.Screen name="category/[id]" options={{ title: '' }} />
            <Stack.Screen name="new-material" options={{ presentation: 'modal', title: 'Add material' }} />
            <Stack.Screen name="new-playlist" options={{ presentation: 'modal', title: 'New playlist' }} />
            <Stack.Screen name="settings" options={{ presentation: 'modal', title: 'Settings' }} />
          </Stack>
        </HydrationGate>
      </ThemeProvider>
    </LibraryProvider>
  );
}
