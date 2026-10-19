import type { ApiClient } from './client.ts';
import { PAGE_SIZE, usersQuery, type FriendRequest, type PublicProfile } from './profiles.ts';

export function socialApi(client: ApiClient) {
  const id = encodeURIComponent;
  const pagination = (page: number) => `page=${page}&limit=${PAGE_SIZE}`;
  return {
    search: (q: string, genre: string, page = 1) => client.request<PublicProfile[]>(usersQuery(q, genre, page)),
    friends: (page = 1) => client.request<PublicProfile[]>(`/friends?${pagination(page)}`),
    pending: (page = 1) => client.request<FriendRequest[]>(`/friends/requests?${pagination(page)}`),
    profile: (userId: string) => client.request<PublicProfile>(`/users/${id(userId)}`),
    send: (userId: string) => client.request<{ status: FriendRequest['status'] }>('/friends/requests', 'POST', { userId }),
    accept: (requestId: string) => client.request(`/friends/requests/${id(requestId)}/accept`, 'POST', {}),
    reject: (requestId: string) => client.request(`/friends/requests/${id(requestId)}/reject`, 'POST', {}),
    cancel: (requestId: string) => client.request(`/friends/requests/${id(requestId)}`, 'DELETE'),
    remove: (userId: string) => client.request(`/friends/${id(userId)}`, 'DELETE'),
  };
}
