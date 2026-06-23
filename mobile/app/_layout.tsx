import '../global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';

import { AuthProvider } from '../context/AuthContext';
import { queryClient } from '../lib/queryClient';
import { isSupabaseConfigured } from '../lib/supabase';
import { useNetworkSync } from '../lib/useNetworkSync';
import { useOtaUpdates } from '../lib/useOtaUpdates';

function NetworkSyncMount() {
  useNetworkSync();
  useOtaUpdates();
  return null;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <NetworkSyncMount />
          {!isSupabaseConfigured ? (
            <View
              style={{
                position: 'absolute',
                left: 12,
                right: 12,
                bottom: 24,
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: 12,
                backgroundColor: '#2b2b2b',
                zIndex: 9999,
                opacity: 0.92,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>
                App misconfigured: missing Supabase keys.
              </Text>
              <Text style={{ color: '#e5e5e5', fontSize: 12, marginTop: 4 }}>
                Rebuild with EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.
              </Text>
            </View>
          ) : null}
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(officer)" />
            <Stack.Screen name="(audit)" />
          </Stack>
          <StatusBar style="auto" />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
