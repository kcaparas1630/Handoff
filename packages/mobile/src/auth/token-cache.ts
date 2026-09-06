import type { TokenCache } from "@clerk/clerk-expo";
import * as SecureStore from "expo-secure-store";

// Session tokens stay in the OS keychain only; they are never copied into Zustand or plain storage.
export const secureTokenCache: TokenCache = {
  async getToken(key: string) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      // An unreadable entry (reinstall, changed keychain access) must not brick sign-in.
      await SecureStore.deleteItemAsync(key).catch(() => undefined);
      return null;
    }
  },

  async saveToken(key: string, token: string) {
    await SecureStore.setItemAsync(key, token);
  },

  clearToken(key: string) {
    void SecureStore.deleteItemAsync(key).catch(() => undefined);
  },
};
