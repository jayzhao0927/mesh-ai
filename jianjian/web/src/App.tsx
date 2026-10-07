import { useCallback, useEffect, useState } from 'react';
import { api, session } from './api';
import { Bridge } from './pages/Bridge';
import { Chat } from './pages/Chat';
import { Login } from './pages/Login';
import { Me } from './pages/Me';
import { Recommend } from './pages/Recommend';
import { SharedRec } from './pages/SharedRec';

type Tab = 'rec' | 'bridge' | 'chat' | 'me';

const TABS: { key: Tab; label: string }[] = [
  { key: 'chat', label: '聊天' },
  { key: 'rec', label: '推荐' },
  { key: 'bridge', label: '搭桥' },
  { key: 'me', label: '我的' },
];

function sharedTokenFromPath(): string | null {
  const m = location.pathname.match(/^\/s\/rec\/([^/]+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function App() {
  const [token, setToken] = useState(session.token);
  const [tab, setTab] = useState<Tab>('chat');
  const [shared, setShared] = useState<string | null>(sharedTokenFromPath);
  const [agentName, setAgentName] = useState('');

  const logout = useCallback(() => {
    session.clear();
    setToken(null);
  }, []);

  useEffect(() => {
    const onPop = () => setShared(sharedTokenFromPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const openShared = useCallback((t: string) => {
    history.pushState(null, '', `/s/rec/${encodeURIComponent(t)}`);
    setShared(t);
  }, []);

  const goHome = useCallback(() => {
    history.pushState(null, '', '/');
    setShared(null);
    setTab('rec');
  }, []);

  useEffect(() => {
    if (!token) return;
    api<{ agentName: string }>('GET', '/api/settings')
      .then((s) => setAgentName(s.agentName))
      .catch(logout);
  }, [token, logout]);

  if (!token) {
    return (
      <Login
        hint={shared ? '有人通过见见给你带来了一位可能合拍的人。登录后就能看到 TA，并决定要不要认识。' : undefined}
        onLogin={(t) => {
          session.set(t);
          setToken(t);
          if (!shared) setTab('chat');
        }}
      />
    );
  }

  return (
    <div className="shell">
      <header className="top">
        <span className="brand">见见</span>
        <span className="muted small">{agentName ? `你的 AI 红娘：${agentName}` : ''}</span>
      </header>
      <main className="content">
        {shared ? (
          <SharedRec token={shared} agentName={agentName} onHome={goHome} />
        ) : (
          <>
            {tab === 'rec' && <Recommend agentName={agentName} onOpenShared={openShared} onGoChat={() => setTab('chat')} />}
            {tab === 'bridge' && <Bridge />}
            {tab === 'chat' && <Chat agentName={agentName} onGoRecommend={() => setTab('rec')} />}
            {tab === 'me' && <Me agentName={agentName} onAgentName={setAgentName} onLogout={logout} />}
          </>
        )}
      </main>
      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={!shared && tab === t.key ? 'tab active' : 'tab'}
            onClick={() => {
              if (shared) goHome();
              setTab(t.key);
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
