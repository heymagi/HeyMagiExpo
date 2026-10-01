/**
 * Supabase client.
 *
 * Session storage differs by platform on purpose. On native the refresh token goes into the
 * device keychain via expo-secure-store, not AsyncStorage — this app holds health data about
 * people including minors, and AsyncStorage is plain text on disk. On web, SecureStore does
 * not exist, so localStorage is used and the shorter session lifetime is accepted.
 */

import 'react-native-url-polyfill/auto';
import { createClient, type SupportedStorage } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Loud, early and specific: a missing key otherwise surfaces as an opaque auth failure.
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Copy .env.example to .env and fill in the project values.',
  );
}

/**
 * SecureStore rejects values over 2048 bytes on some platforms, and a Supabase session with
 * a large JWT can approach that. Chunking keeps it inside the keychain rather than silently
 * falling back to unencrypted storage.
 */
const CHUNK_SIZE = 1800;

const secureStorage: SupportedStorage = {
  getItem: async (key) => {
    const head = await SecureStore.getItemAsync(`${key}.0`);
    if (head === null) return SecureStore.getItemAsync(key);
    let value = head;
    for (let i = 1; ; i++) {
      const part = await SecureStore.getItemAsync(`${key}.${i}`);
      if (part === null) break;
      value += part;
    }
    return value;
  },
  setItem: async (key, value) => {
    await secureStorage.removeItem?.(key);
    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }
    const chunks = Math.ceil(value.length / CHUNK_SIZE);
    for (let i = 0; i < chunks; i++) {
      await SecureStore.setItemAsync(`${key}.${i}`, value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    }
  },
  removeItem: async (key) => {
    await SecureStore.deleteItemAsync(key).catch(() => undefined);
    for (let i = 0; i < 16; i++) {
      const part = await SecureStore.getItemAsync(`${key}.${i}`);
      if (part === null) break;
      await SecureStore.deleteItemAsync(`${key}.${i}`).catch(() => undefined);
    }
  },
};

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Deep-link session detection is not used; there is no OAuth flow in the beta.
    detectSessionInUrl: false,
  },
});

export const SUPABASE_URL = url;
