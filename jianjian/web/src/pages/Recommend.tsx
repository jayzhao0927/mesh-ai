import { useEffect, useState } from 'react';
import { api, ApiError, type OnboardingState, type Recommendation } from '../api';
import { RecCard } from './RecCard';

export function Recommend({
  agentName,
  onOpenShared,
  onGoChat,
}: {
  agentName: string;
  onOpenShared: (token: string) => void;
  onGoChat: () => void;
}) {
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [incoming, setIncoming] = useState<string | null>(null);
  const [onboarded, setOnboarded] = useState(true);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setError('');
    const [cur, inc, ob] = await Promise.allSettled([
      api<Recommendation>('GET', '/api/recommendations/current'),
      api<{ token: string }>('GET', '/api/recommendations/incoming'),
      api<OnboardingState>('GET', '/api/onboarding'),
    ]);
    setOnboarded(ob.status !== 'fulfilled' || ob.value.done);
    if (cur.status === 'fulfilled') {
      setRec(cur.value);
      setEmpty('');
    } else {
      setRec(null);
      if (cur.reason instanceof ApiError && cur.reason.status === 404) setEmpty('本周推荐还没生成');
      else setError((cur.reason as Error).message);
    }
    setIncoming(inc.status === 'fulfilled' ? inc.value.token : null);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function generate() {
    setError('');
    try {
      await api('POST', '/api/recommendations/generate');
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const name = agentName || '见见';
  if (loading) return <p className="muted center">加载中…</p>;

  return (
    <div className="stack">
      {incoming && (
        <section className="card">
          <p className="eyebrow">有人在等你的回应</p>
          <p className="small">{name} 把你推荐给了一位可能合拍的人。看看 TA，再决定要不要认识。你的选择对方不会提前知道。</p>
          <button className="primary" onClick={() => onOpenShared(incoming)}>
            去看看
          </button>
        </section>
      )}
      {rec ? (
        <RecCard
          id={rec.id}
          eyebrow={`${name} 本周为你留意到一位`}
          stated={rec.candidate_snapshot.stated}
          reasons={rec.reasons}
          status={rec.status}
          myChoice={rec.myChoice}
          onChanged={load}
        />
      ) : !onboarded ? (
        <section className="card center">
          <h2>先和 {name} 聊几句</h2>
          <p className="muted">{name} 还不太了解你。聊完几个问题，就能帮你留意合适的人。</p>
          <button className="primary" onClick={onGoChat}>
            去聊天
          </button>
        </section>
      ) : (
        <section className="card center">
          <h2>{name} 正在帮你留意</h2>
          <p className="muted">{empty || '暂时没有推荐'}。每周只推一位，宁缺毋滥。</p>
          {error && <p className="error">{error}</p>}
          <button className="primary" onClick={() => void generate()}>
            生成本周推荐
          </button>
          <p className="dev-note">开发调试：正式版每周自动生成并通过微信/短信通知。</p>
        </section>
      )}
    </div>
  );
}
