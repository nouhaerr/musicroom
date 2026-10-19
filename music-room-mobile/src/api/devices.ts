import type { ApiClient } from './client';

export type Device = { id: string; model: string; platform: string; appVersion: string; createdAt?: string };
export const DEVICE_PAGE_SIZE = 20;

export async function devicePage(client: ApiClient, page: number): Promise<Device[]> {
  const data = await client.request<Device[]>(`/devices?page=${page}&limit=${DEVICE_PAGE_SIZE}`);
  if (!Array.isArray(data) || !data.every(d => d && typeof d.id === 'string' && typeof d.platform === 'string' && typeof d.model === 'string')) {
    throw new Error('Unable to read your devices.');
  }
  return data;
}

export async function detachDevice(client: ApiClient, id: string): Promise<void> {
  if (id === client.currentDeviceId) throw new Error('Use Log out in Profile to leave this device.');
  await client.request(`/devices/${encodeURIComponent(id)}`, 'DELETE');
}
