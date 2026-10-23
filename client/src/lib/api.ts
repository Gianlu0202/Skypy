import type { CreateRoomRequest, CreateRoomResponse, RoomInfo } from '../../../shared/protocol.ts';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError('Can’t reach the Skypy server. Check your connection and try again.', 0);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error ?? `Request failed (${res.status}).`;
    throw new ApiError(msg, res.status);
  }
  return body as T;
}

export function createRoom(req: CreateRoomRequest): Promise<CreateRoomResponse> {
  return request('/api/rooms', { method: 'POST', body: JSON.stringify(req) });
}

export function peekRoom(id: string, who: { deviceKey: string; invite?: string; hostKey?: string }): Promise<RoomInfo> {
  return request(`/api/rooms/${encodeURIComponent(id)}/peek`, { method: 'POST', body: JSON.stringify(who) });
}

export function roomExists(id: string): Promise<RoomInfo> {
  return request(`/api/rooms/${encodeURIComponent(id)}`);
}
