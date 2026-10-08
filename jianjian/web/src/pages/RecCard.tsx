import { useEffect, useState } from 'react';
import { api, isDemo, display, FIELD_LABELS, type Choice, type Room } from '../api';

interface Props {
  id: string;
  eyebrow: string;
  stated: Record<string, { value: string | string[] }>;
  reasons: string[];
  status: 'pending' | 'mutual';
  myChoice: Choice | null;
  onChanged: () => Promise<void>;
  createdAt?: string;
}

/** 一张推荐卡：展示对方、表态、mutual 后约视频。对方的选择永远不在这里出现。 */
export function RecCard({ id, eyebrow, stated, reasons, status, myChoice, onChanged, createdAt }: Props) {
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const expired = status !== 'mutual' && !!createdAt && now - Date.parse(createdAt) >= 86_400_000;
  const allowed = new Set(['hometown', 'hobbies', 'occupation', 'vibe', 'weekend', 'ideal_date', 'comm_style']);
  const fields = Object.entries(stated ?? {}).filter(([k, f]) => allowed.has(k) && !/\p{Decimal_Number}/u.test(display(f.value)));
  const safeReasons = reasons.filter(r => !/\p{Decimal_Number}/u.test(r));

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
      <div className="polaroid-art" aria-hidden="true"><span>♡</span><i>慢慢了解，也很好。</i></div>
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
        {safeReasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>

      {expired ? <p className="waiting">这次推荐已结束，见见会继续为你留意。</p> : status === 'mutual' ? (
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
            <span>一起选个视频时间</span>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
          <button className="primary" disabled={!when} onClick={() => void create()}>
            预约视频
          </button>
        </>
      ) : (
        <>
          <p className="small">
            房间号 <code>{room.roomId}</code>，链接已发给双方：
            <br />
            <a href={new URL(room.link, location.origin).pathname} target="_blank" rel="noreferrer">
              {room.link}
            </a>
          </p>
          <button className="primary" onClick={() => void join()}>
            进入房间
          </button>
          {joined && <p className="dev-note">{isDemo ? '样例房间，不会连接其他人。' : '进房请求已完成，真实视频通话尚未接通。'}</p>}
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
