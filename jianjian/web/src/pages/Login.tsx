import { useState } from 'react';
import { api, isDemo } from '../api';
export function Login({ onLogin }: { onLogin: (token: string) => void }) {
 const [phone, setPhone] = useState(''); const [nickname, setNickname] = useState('');
 const [busy, setBusy] = useState(false); const [error, setError] = useState('');
 async function start() {
  setBusy(true); setError('');
  try { const r = await api<{token: string}>('POST', '/api/auth/dev-token', { phone: isDemo ? '13800000000' : phone, nickname }, null); onLogin(r.token); }
  catch(e) { setError((e as Error).message); } finally { setBusy(false); }
 }
 return <section className="login"><div className="welcome-flower" aria-hidden="true">✳</div><span className="eyebrow">HELLO, YOU.</span><h2>很高兴，见到你。</h2><p className="muted">不用把自己装进一张表格。<br />我们从一句“你好”开始。</p><form className="login-form" onSubmit={e => { e.preventDefault(); void start(); }}><label className="field">怎么称呼你？<input value={nickname} maxLength={20} onChange={e => setNickname(e.target.value)} placeholder="你的昵称" autoComplete="nickname" /></label>{!isDemo && <label className="field">手机号<input value={phone} inputMode="tel" maxLength={11} onChange={e => setPhone(e.target.value.replace(/\D/g,''))} placeholder="手机号直接开发登录" autoComplete="tel" /></label>}<button className="primary" disabled={busy || (!isDemo && phone.length !== 11)}>{busy ? '正在进入…' : '开始认识我 ↗'}</button>{error && <p role="alert" className="error">{error}</p>}</form><p className="privacy-note">你的资料只用于认真连接。<br />没有公开照片墙，也没有被比较的排行榜。</p>{isDemo ? <a className="link" href="/">切换真实后端联调</a> : <a className="link" href="/try">先试完整样例流程</a>}</section>;
}
