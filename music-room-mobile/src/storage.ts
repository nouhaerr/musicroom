import * as SecureStore from 'expo-secure-store';
import type { TokenStorage } from './api/client';

export const secureStorage: TokenStorage = {
  getItem: key => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  deleteItem: key => SecureStore.deleteItemAsync(key),
};
