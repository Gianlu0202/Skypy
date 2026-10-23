import { useEffect, useState } from 'react';
import { DoorOpen, Lock, UserX, MonitorSmartphone } from 'lucide-react';
import type { RoomInfo } from '../../../shared/protocol.ts';
import { ApiError, peekRoom } from '../lib/api.ts';
import { Meeting, currentMeeting, type JoinOptions } from '../lib/meeting.ts';
import { navigate } from '../lib/router.ts';
import { deviceKey, hostKeyFor, inviteFor, rememberHostedRoom, saveInvite } from '../lib/storage.ts';
import { resetMeetingStore, useStore } from '../lib/store.ts';
import { MeetingView } from './MeetingView.tsx';
import { NoticePage } from './Notice.tsx';
import { PreJoin } from './PreJoin.tsx';

/** Read ?host= / ?invite= once, remember them, and tidy the address bar. */
function takeLinkSecrets(roomId: string): { hostKey?: string; invite?: string } {
  const url = new URL(location.href);
  const host = url.searchParams.get('host') ?? undefined;
  const invite = url.searchParams.get('invite') ?? undefined;
  if (host || invite) {
    url.searchParams.delete('host');
    url.searchParams.delete('invite');
    history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + url.hash);
  }
  if (invite) saveInvite(roomId, invite);
  return { hostKey: host ?? hostKeyFor(roomId), invite: invite ?? inviteFor(roomId) };
}

export function RoomPage({ roomId }: { roomId: string }) {
  const [secrets] = useState(() => takeLinkSecrets(roomId));
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [inMeeting, setInMeeting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const ended = useStore((s) => s.ended);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    peekRoom(roomId, { deviceKey, invite: secrets.invite, hostKey: secrets.hostKey })
      .then((res) => {
        if (cancelled) return;
        setInfo(res);
        document.title = `${res.name} · Skypy`;
        if (secrets.hostKey && res.you?.host) rememberHostedRoom({ id: roomId, name: res.name, hostKey: secrets.hostKey });
      })
      .catch((err: ApiError) => {
        if (!cancelled) setLoadError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, secrets, attempt]);

  // Leaving the page (e.g. back button) ends the call.
  useEffect(() => () => currentMeeting()?.leave('left'), []);

  if (loadError) {
    if (loadError.status === 404) {
      return (
        <NoticePage
          icon="?"
          title="This meeting doesn’t exist"
          actions={
            <button className="btn btn-primary" onClick={() => navigate('/')}>
              Start a new meeting
            </button>
          }
        >
          <p>
            The link <code>/r/{roomId}</code> isn’t a Skypy meeting. Check for typos, or ask your host to send the link again.
          </p>
        </NoticePage>
      );
    }
    return (
      <NoticePage
        icon="!"
        title="Can’t reach Skypy"
        actions={
          <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        }
      >
        <p>{loadError.message}</p>
      </NoticePage>
    );
  }

  if (!info) {
    return (
      <div className="loading-page">
        <div className="spinner" />
      </div>
    );
  }

  if (ended) {
    const rejoin = () => {
      resetMeetingStore();
      setInMeeting(false);
      setAttempt((n) => n + 1);
    };
    const home = (
      <button className="btn btn-secondary" onClick={() => navigate('/')}>
        Return to home
      </button>
    );
    switch (ended.kind) {
      case 'kicked':
        return (
          <NoticePage icon={<UserX size={26} />} title="You were removed from the meeting" actions={home}>
            <p>{ended.message}</p>
          </NoticePage>
        );
      case 'replaced':
        return (
          <NoticePage
            icon={<MonitorSmartphone size={26} />}
            title="You’re in this meeting somewhere else"
            actions={
              <>
                <button className="btn btn-primary" onClick={rejoin}>
                  Join here instead
                </button>
                {home}
              </>
            }
          >
            <p>{ended.message}</p>
          </NoticePage>
        );
      case 'denied':
        return (
          <NoticePage
            icon={<Lock size={24} />}
            title="Can’t join this meeting"
            actions={
              <>
                <button className="btn btn-primary" onClick={rejoin}>
                  Try again
                </button>
                {home}
              </>
            }
          >
            <p>{ended.message}</p>
          </NoticePage>
        );
      default:
        return (
          <NoticePage
            icon={<DoorOpen size={26} />}
            title="You left the meeting"
            actions={
              <>
                <button className="btn btn-primary" onClick={rejoin}>
                  Rejoin
                </button>
                {home}
              </>
            }
          >
            <p>{info.name}</p>
          </NoticePage>
        );
    }
  }

  if (!inMeeting) {
    return (
      <PreJoin
        info={info}
        hostKey={secrets.hostKey}
        onJoin={(opts: Omit<JoinOptions, 'roomId' | 'hostKey' | 'invite'>) => {
          new Meeting({ ...opts, roomId, hostKey: secrets.hostKey, invite: secrets.invite });
          setInMeeting(true);
        }}
      />
    );
  }

  return <MeetingView />;
}
