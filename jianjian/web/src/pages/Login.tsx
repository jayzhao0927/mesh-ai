import { useState } from 'react';
import { api } from '../api';

const DEMO = [
  { phone: '13800000001', name: '演示A · 稳定恋爱' },
  { phone: '13800000002', name: '演示B · 奔着结婚' },
  { phone: '13800000003', name: '演示C · 稳定恋爱' },
];

export function Login({ onLogin, hint }: { onLogin: (token: string) => void; hint?: string }) {
  const [phone, setPhone] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function login(p: string, n = '') {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ token: string }>('POST', '/api/auth/dev-token', { phone: p, nickname: n }, null);
      onLogin(res.token);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell login">
      <div className="hero">
        <div className="brand big">见见</div>
        <p className="tagline">AI 先认识你，再帮你认识值得认识的人。</p>
      </div>
      {hint && <p className="waiting">{hint}</p>}
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          void login(phone, nickname);
        }}
      >
        <label className="field">
          <span>手机号</span>
          <input inputMode="numeric" maxLength={11} value={phone} onChange={(e) => setPhone(e.target.value.trim())} placeholder="11 位手机号" />
        </label>
        <label className="field">
          <span>昵称（选填）</span>
          <input value={nickname} maxLength={20} onChange={(e) => setNickname(e.target.value)} placeholder="别人看到的名字" />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy || phone.length !== 11}>
          进入见见
        </button>
        <p className="dev-note">开发模式：手机号直接登录，正式版改为短信验证码。</p>
      </form>
      <div className="card dev">
        <div className="dev-title">开发调试 · 演示账号</div>
        {DEMO.map((d) => (
          <button key={d.phone} className="ghost" disabled={busy} onClick={() => void login(d.phone)}>
            {d.name}
          </button>
        ))}
      </div>
    </div>
  );
}
