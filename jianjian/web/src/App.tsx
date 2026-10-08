import { useCallback, useEffect, useState } from 'react';
import { api, isDemo, session } from './api';
import { Bridge } from './pages/Bridge';
import { Chat } from './pages/Chat';
import { Login } from './pages/Login';
import { SharedRec } from './pages/SharedRec';

export function App() {
  const [token, setToken] = useState(session.token);
  const [page, setPage] = useState<'chat' | 'bridge'>('chat');
  const [name, setName] = useState('见见');
  const [shared, setShared] = useState(() => location.pathname.match(/^\/s\/rec\/([^/]+)$/)?.[1] || null);
  const logout = useCallback(() => { session.clear(); setToken(null); }, []);
  useEffect(() => {
    if (token) api<{ agentName: string }>('GET', '/api/settings').then(s => setName(s.agentName)).catch(logout);
  }, [token, logout]);
  useEffect(() => {
    const pop = () => setShared(location.pathname.match(/^\/s\/rec\/([^/]+)$/)?.[1] || null);
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  return <div className="experience">
    <aside className="editorial">
      <a className="wordmark" href={isDemo ? '/try' : '/'}>见见<span>jianjian</span></a>
      <p className="handwritten">让相遇，慢一点。</p>
      <h1>先懂你，<br />再遇见你。</h1>
      <p className="intro">把找人的焦虑交给见见。<br />把真实的你，留给值得认识的人。</p>
      <div className="paper-art" aria-hidden="true"><span className="sun">✳</span><span className="heart">♡</span><span className="paper-note">认真靠近<br />慢慢喜欢</span><span className="sticker">good things<br />take time</span></div>
      <p className="manifesto">Website → Message → Meet</p>
    </aside>
    <div className="phone-panel">
      <div className="mode-note">{isDemo ? '样例体验 · 内容预写，仅保存在本机' : '真实 API 联调 · 当前为开发登录'}</div>
      {!token ? <Login onLogin={t => { session.set(t); setToken(t); }} /> : <>
        <header className="top"><div className="avatar" aria-hidden="true">见</div><div className="identity"><strong>{name}</strong><span>你的 AI 红娘 · 温柔在线</span></div><button className="icon-button" onClick={logout} aria-label="退出登录">↗</button></header>
        <nav className="chat-nav" aria-label="主要入口"><button className={page === 'chat' ? 'active' : ''} onClick={() => { setPage('chat'); setShared(null); }}>和{name}聊聊</button><button className={page === 'bridge' ? 'active' : ''} onClick={() => setPage('bridge')}>帮朋友搭桥 ↗</button></nav>
        <main className="content">{shared ? <SharedRec token={shared} agentName={name} onHome={() => { setShared(null); history.pushState(null, '', isDemo ? '/try' : '/'); }} /> : page === 'bridge' ? <Bridge /> : <Chat agentName={name} onAgentName={setName} />}</main>
      </>}
    </div>
  </div>;
}
