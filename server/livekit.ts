// LiveKit integration: access tokens and moderation via the server API.
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { config } from './config.ts';

let client: RoomServiceClient | null = null;
function rooms(): RoomServiceClient {
  client ??= new RoomServiceClient(config.livekit.apiUrl, config.livekit.apiKey, config.livekit.apiSecret);
  return client;
}

function sources(screenShare: boolean): TrackSource[] {
  const base = [TrackSource.CAMERA, TrackSource.MICROPHONE];
  return screenShare ? [...base, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] : base;
}

export async function createToken(opts: { roomId: string; identity: string; name: string; screenShare: boolean }): Promise<string> {
  const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity: opts.identity,
    name: opts.name,
    // The client asks for a fresh token whenever it reconnects to media.
    ttl: '2h',
  });
  at.addGrant({
    room: opts.roomId,
    roomJoin: true,
    canPublish: true,
    canPublishSources: sources(opts.screenShare),
    canSubscribe: true,
    canPublishData: true,
    canUpdateOwnMetadata: false,
  });
  return at.toJwt();
}

/** Allow or forbid screen sharing for one participant, enforced by LiveKit. */
export async function setScreenSharePermission(roomId: string, identity: string, allowed: boolean): Promise<void> {
  try {
    await rooms().updateParticipant(roomId, identity, {
      permission: {
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        canUpdateMetadata: false,
        canPublishSources: sources(allowed),
      },
    });
  } catch {
    // Not connected to media right now; their next token carries the rule.
  }
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

/** Disconnect someone from media; with `revoke`, their existing tokens stop working. */
export async function removeParticipant(roomId: string, identity: string, opts: { revoke?: boolean } = {}): Promise<void> {
  try {
    await rooms().removeParticipant(roomId, identity, opts.revoke ? { revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)) } : undefined);
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
