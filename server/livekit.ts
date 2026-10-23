// LiveKit integration: access tokens and moderation via the server API.
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { config } from './config.ts';

let client: RoomServiceClient | null = null;
function rooms(): RoomServiceClient {
  client ??= new RoomServiceClient(config.livekit.apiUrl, config.livekit.apiKey, config.livekit.apiSecret);
  return client;
}

export async function createToken(opts: { roomId: string; identity: string; name: string; host: boolean }): Promise<string> {
  const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity: opts.identity,
    name: opts.name,
    ttl: '12h',
  });
  at.addGrant({
    room: opts.roomId,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canUpdateOwnMetadata: false,
  });
  return at.toJwt();
}

/** Server-side mute of a participant's microphone. Hosts can mute, never unmute. */
export async function muteMicrophone(roomId: string, identity: string): Promise<boolean> {
  try {
    const p = await rooms().getParticipant(roomId, identity);
    const mics = p.tracks.filter((t) => t.source === TrackSource.MICROPHONE && !t.muted);
    await Promise.all(mics.map((t) => rooms().mutePublishedTrack(roomId, identity, t.sid, true)));
    return true;
  } catch (err) {
    console.warn(`[livekit] mute ${identity} failed:`, (err as Error).message);
    return false;
  }
}

export async function removeParticipant(roomId: string, identity: string): Promise<void> {
  try {
    await rooms().removeParticipant(roomId, identity);
  } catch (err) {
    // Not connected to media (yet) — nothing to remove.
    console.warn(`[livekit] remove ${identity}:`, (err as Error).message);
  }
}

export async function checkLivekit(): Promise<{ ok: boolean; error?: string }> {
  try {
    await rooms().listRooms();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
