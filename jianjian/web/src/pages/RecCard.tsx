import { useState } from 'react';
import { api, display, FIELD_LABELS, type Choice, type Room } from '../api';

interface Props {
  id: string;
  eyebrow: string;
  stated: Record<string, { value: string | string[] }>;
  reasons: string[];
  status: 'pending' | 'mutual';
  myChoice: Choice | null;
  onChanged: () => Promise<void>;
}

/** 一张推荐卡：展示对方、表态、mutual 后约视频。对方的选择永远不在这里出现。 */
export function RecCard({ id, eyebrow, stated, reasons, status, myChoice, onChanged }: Props) {
  const [error, setError] = useState('');
  const fields = Object.entries(stated ?? {});

  async function decide(c: Choice) {
    setError('');
    try {
      await api('POST', `/api/recommendations/${id}/intent`, { choice: c });
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="card rec">
      <p className="eyebrow">{eyebrow}</p>
      {fields.length > 0 ? (
        <div className="chips">
          {fields.map(([k, f]) => (
            <span key={k} className="chip">
              <b>{FIELD_LABELS[k] ?? k}</b> {display(f.value)}
            </span>
          ))}
        </div>
      ) : (
        <p className="muted small">对方还没填写可展示的信息。</p>
      )}
      <h3>为什么是 TA</h3>
      <ul className="reasons">
        {reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>

      {status === 'mutual' ? (
        <Mutual recId={id} />
      ) : myChoice === 'interested' ? (
        <p className="waiting">你已表示感兴趣。对方的选择不会提前告诉你，双方都愿意才会揭晓。</p>
      ) : myChoice === 'pass' ? (
        <p className="waiting">好的，这次先不了。对方不会知道你的选择。</p>
      ) : (
        <div className="actions">
          <button className="secondary" onClick={() => void decide('pass')}>
            先不了
          </button>
          <button className="primary" onClick={() => void decide('interested')}>
            感兴趣
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function Mutual({ recId }: { recId: string }) {
  const [when, setWhen] = useState('');
  const [room, setRoom] = useState<Room | null>(null);
  const [joined, setJoined] = useState('');
  const [error, setError] = useState('');

  async function create() {
    setError('');
    try {
      const body: { recommendationId: string; scheduledAt?: string } = { recommendationId: recId };
      if (when) body.scheduledAt = new Date(when).toISOString();
      setRoom(await api<Room>('POST', '/api/video/rooms', body));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function join() {
    if (!room) return;
    setError('');
    try {
      const res = await api<{ roomId: string; userSig: string }>('GET', `/v/${room.roomId}`);
      setJoined(res.userSig);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="mutual">
      <p className="success">你们都愿意认识彼此。约一次视频见面吧。</p>
      {!room ? (
        <>
          <label className="field">
            <span>见面时间（选填）</span>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
          <button className="primary" onClick={() => void create()}>
            预约视频
          </button>
        </>
      ) : (
        <>
          <p className="small">
            房间号 <code>{room.roomId}</code>，链接已发给双方：
            <br />
            <a href={new URL(room.link).pathname} target="_blank" rel="noreferrer">
              {room.link}
            </a>
          </p>
          <button className="primary" onClick={() => void join()}>
            进入房间
          </button>
          {joined && <p className="dev-note">已拿到进房凭证（{joined.startsWith('stub-') ? '当前为 stub，接入 TRTC 后可真正视频' : '有效'}）。</p>}
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
