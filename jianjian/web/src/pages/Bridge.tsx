import { useEffect, useState } from 'react';
import { api, type InboxInvite, type MyInvite } from '../api';

const STATUS: Record<MyInvite['status'], string> = {
  sent: '已发出，对方还没注册',
  registered: '对方已注册',
  experienced: '对方已体验',
  withdrawn: '已撤回',
};

export function Bridge() {
  const [mine, setMine] = useState<MyInvite[]>([]);
  const [inbox, setInbox] = useState<InboxInvite[]>([]);
  const [phone, setPhone] = useState('');
  const [kind, setKind] = useState<MyInvite['kind']>('bridge');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const [m, i] = await Promise.all([api<MyInvite[]>('GET', '/api/invites'), api<InboxInvite[]>('GET', '/api/invites/inbox')]);
    setMine(m);
    setInbox(i);
  }

  useEffect(() => {
    void load();
  }, []);

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

  return (
    <div className="stack">
      <section className="card">
        <h2>帮朋友搭个桥</h2>
        <p className="muted small">
          觉得谁和谁合适，或者心里有个人？发一封匿名邀请。你的意图全程保密：双方都感兴趣才会揭晓是你搭的桥，任何一方拒绝，谁都不会知道。每周最多 5 封。
        </p>
        <div className="choices">
          <button className={kind === 'bridge' ? 'choice active' : 'choice'} onClick={() => setKind('bridge')}>
            给朋友搭桥
          </button>
          <button className={kind === 'crush' ? 'choice active' : 'choice'} onClick={() => setKind('crush')}>
            我暗恋的人
          </button>
        </div>
        <div className="inline">
          <input inputMode="numeric" maxLength={11} placeholder="对方手机号" value={phone} onChange={(e) => setPhone(e.target.value.trim())} />
          <button
            className="primary"
            disabled={phone.length !== 11}
            onClick={() =>
              void run(async () => {
                await api('POST', '/api/invites', { inviteePhone: phone, kind });
                setPhone('');
              }, '邀请已发出')
            }
          >
            发送
          </button>
        </div>
        {notice && <p className="notice">{notice}</p>}
        {error && <p className="error">{error}</p>}
      </section>

      <section className="card">
        <h2>我发出的</h2>
        <p className="muted small">你只能看到对方是否注册，看不到对方的选择和资料。</p>
        {mine.length === 0 && <p className="muted small">还没有。</p>}
        {mine.map((i) => (
          <div key={i.id} className="row">
            <span>
              {i.kind === 'crush' ? '暗恋' : '搭桥'} · {STATUS[i.status]}
              <br />
              <span className="muted small">{new Date(i.created_at).toLocaleDateString('zh-CN')}</span>
            </span>
            {i.status === 'sent' && (
              <button className="link" onClick={() => void run(() => api('POST', `/api/invites/${i.id}/revoke`), '已撤回')}>
                撤回
              </button>
            )}
          </div>
        ))}
      </section>

      <section className="card">
        <h2>我收到的</h2>
        {inbox.length === 0 && <p className="muted small">还没有人给你发邀请。</p>}
        {inbox.map((i) => (
          <div key={i.id} className="row">
            <span>有人觉得你值得被好好认识</span>
            {i.status === 'sent' ? (
              <button className="secondary" onClick={() => void run(() => api('POST', `/api/invites/${i.code}/claim`), '已接受邀请')}>
                接受
              </button>
            ) : (
              <span className="muted small">已接受</span>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
