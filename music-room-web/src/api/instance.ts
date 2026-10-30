import { ApiClient } from './client';
import { config } from '../lib/config';

// Memory only: reload/closing the tab signs out. Never persist bearer credentials
// in localStorage. Durable browser sessions need a separate cookie/BFF design.
const values = new Map<string, string>();
export const client = new ApiClient(config.apiUrl, {
  getItem: async key => values.get(key) ?? null,
  setItem: async (key, value) => { values.set(key, value); },
  deleteItem: async key => { values.delete(key); },
});
