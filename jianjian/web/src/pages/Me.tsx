import { useEffect, useState } from 'react';
import { api, display, FIELD_LABELS, TARGETS, type ProfileData, type ProfileResponse, type Target } from '../api';

const EDITABLE = ['hometown', 'occupation', 'hobbies', 'vibe', 'weekend', 'ideal_date', 'comm_style'] as const;
const LIST_FIELDS = new Set(['hobbies']);
const HINTS: Record<string, string> = {
  hometown: '如：杭州',
  occupation: '如：产品经理',
  hobbies: '用逗号分隔，如：徒步，做饭',
  vibe: '如：安静温和',
  weekend: '如：户外 / 宅家',
  ideal_date: '如：一起逛展',
  comm_style: '如：直接坦诚',
};

interface Props {
  agentName: string;
  onAgentName: (name: string) => void;
  onLogout: () => void;
}

export function Me({ agentName, onAgentName, onLogout }: Props) {
  const [profile, setProfile] = useState<ProfileData>({ stated: {}, revealed: {} });
  const [target, setTarget] = useState<Target | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [name, setName] = useState(agentName);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const res = await api<ProfileResponse>('GET', '/api/profile');
    setProfile({ stated: res.data.stated ?? {}, revealed: res.data.revealed ?? {} });
    setTarget(res.target);
    setForm(Object.fromEntries(EDITABLE.map((k) => [k, res.data.stated?.[k] ? display(res.data.stated[k].value) : ''])));
  }

  useEffect(() => {
    void load();
  }, []);
  useEffect(() => setName(agentName), [agentName]);

  async function run(action: () => Promise<unknown>, ok: string) {
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(ok);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function saveProfile() {
    const stated = { ...profile.stated };
    const now = new Date().toISOString();
    for (const key of EDITABLE) {
      const raw = (form[key] ?? '').trim();
      if (!raw) {
        delete stated[key];
        continue;
      }
      const value = LIST_FIELDS.has(key) ? raw.split(/[,，、\s]+/).filter(Boolean) : raw;
      stated[key] = { value, source: 'user', confidence: 1, updated_at: now };
    }
    return run(() => api('PUT', '/api/profile', { data: { stated, revealed: profile.revealed }, ...(target ? { target } : {}) }), '画像已保存');
  }

  const revealed = Object.entries(profile.revealed);
  const stated = Object.entries(profile.stated);

  return (
    <div className="stack">
      <section className="card">
        <h2>{agentName || '见见'} 记下的你</h2>
        <p className="muted small">都是你在聊天里亲口说的，用来帮你找人；推荐卡上不展示任何数字。想改的话删掉，再去聊天里重新说。</p>
        <div className="row">
          <span>想要的连接：{target ?? '还没聊到'}</span>
        </div>
        {stated.length === 0 ? (
          <p className="muted small">还没有。去「聊天」和 {agentName || '见见'} 聊几句吧。</p>
        ) : (
          stated.map(([key, entry]) => (
            <div key={key} className="row">
              <span>
                {FIELD_LABELS[key] ?? key}：{display(entry.value)}
              </span>
              <button className="link" onClick={() => void run(() => api('DELETE', `/api/profile/stated/${encodeURIComponent(key)}`), '已删除')}>
                删除
              </button>
            </div>
          ))
        )}
      </section>

      <details className="card dev">
        <summary className="dev-title">备用入口 · 手动填写（仅在聊天用不了时使用）</summary>
        <p className="small muted">正常请在「聊天」里和 {agentName || '见见'} 聊。只有聊天连不上时，再在这里手动填写。</p>
        <div className="choices">
          {TARGETS.map((t) => (
            <button key={t} className={target === t ? 'choice active' : 'choice'} onClick={() => setTarget(t)}>
              {t}
            </button>
          ))}
        </div>
        {EDITABLE.map((key) => (
          <label key={key} className="field">
            <span>{FIELD_LABELS[key]}</span>
            <input value={form[key] ?? ''} placeholder={HINTS[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
          </label>
        ))}
        <button className="secondary" onClick={() => void saveProfile()}>
          保存
        </button>
      </details>

      <section className="card">
        <h2>{agentName || '见见'} 对你的观察</h2>
        {revealed.length === 0 ? (
          <p className="muted small">还没有。和 Agent 聊得越多，它越懂你；每一条你都可以删除。</p>
        ) : (
          revealed.map(([key, entry]) => (
            <div key={key} className="row">
              <span>
                {FIELD_LABELS[key] ?? key}：{display(entry.value)}
              </span>
              <button className="link" onClick={() => void run(() => api('DELETE', `/api/profile/revealed/${encodeURIComponent(key)}`), '已删除')}>
                删除
              </button>
            </div>
          ))
        )}
      </section>

      <section className="card">
        <h2>给你的 AI 红娘起个名字</h2>
        <div className="inline">
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
          <button
            className="secondary"
            onClick={() =>
              void run(async () => {
                const res = await api<{ agentName: string }>('PUT', '/api/settings', { agentName: name.trim() });
                onAgentName(res.agentName);
              }, '名字已更新')
            }
          >
            保存
          </button>
        </div>
      </section>

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}
      <button className="ghost" onClick={onLogout}>
        退出登录
      </button>
    </div>
  );
}
