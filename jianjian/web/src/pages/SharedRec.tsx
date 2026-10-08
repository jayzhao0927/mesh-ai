import { useEffect, useState } from 'react';
import { api, ApiError, type SharedRecommendation } from '../api';
import { RecCard } from './RecCard';

/** 分享链接 /s/rec/:token 进入（已登录）。被推荐人在这里表态。 */
export function SharedRec({ token, agentName, onHome }: { token: string; agentName: string; onHome: () => void }) {
  const [rec, setRec] = useState<SharedRecommendation | null>(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      setRec(await api<SharedRecommendation>('GET', `/api/recommendations/by-token/${encodeURIComponent(token)}`));
      setError('');
    } catch (e) {
      setRec(null);
      setError(e instanceof ApiError && e.status === 403 ? '这条推荐不是发给你的，换成收到链接的手机号登录再看。' : (e as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  const name = agentName || '见见';
  return (
    <div className="stack">
      {error ? (
        <section className="card center">
          <p className="error">{error}</p>
        </section>
      ) : !rec ? (
        <p className="muted center">加载中…</p>
      ) : (
        <RecCard
          id={rec.id}
          eyebrow={rec.role === 'candidate' ? `${name} 觉得你们值得认识一下` : `${name} 本周为你留意到一位`}
          stated={rec.candidate_snapshot.stated}
          reasons={rec.reasons}
          status={rec.status}
          myChoice={rec.myChoice}
          createdAt={rec.created_at}
          onChanged={load}
        />
      )}
      <button className="link" onClick={onHome}>
        回到首页
      </button>
    </div>
  );
}
