const apiUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3000').trim();
const parsed = new URL(apiUrl);
if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('VITE_API_URL must use HTTP or HTTPS.');
export const config = { apiUrl: apiUrl.replace(/\/+$/, '') };
