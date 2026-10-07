import { useEffect, useRef, useState } from 'react';
import { api, type OnboardingState, type OnboardingStep } from '../api';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

export function Chat({ agentName, onGoRecommend }: { agentName: string; onGoRecommend: () => void }) {
  const name = agentName || '见见';
  const [ob, setOb] = useState<OnboardingState | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<OnboardingState>('GET', '/api/onboarding')
      .then(setOb)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [ob, msgs]);

  async function reply(step: OnboardingStep, body: { value?: string | string[]; skip?: boolean }) {
    setBusy(true);
    setError('');
    try {
      setOb(await api<OnboardingState>('POST', '/api/onboarding/answer', { key: step.key, ...body }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const message = text.trim();
    if (!message) return;
    setBusy(true);
    setError('');
    setText('');
    const history = msgs;
    setMsgs([...history, { role: 'user', content: message }]);
    try {
      const res = await api<{ reply: string }>('POST', '/api/chat', { message, history });
      setMsgs([...history, { role: 'user', content: message }, { role: 'assistant', content: res.reply }]);
    } catch {
      setError(`${name} 的自由聊天还没接通，先不能接着聊。你说过的内容都已经记下了。`);
    } finally {
      setBusy(false);
    }
  }

  if (!ob) {
    return <div className="chat">{error ? <p className="error">{error}</p> : <p className="muted center">加载中…</p>}</div>;
  }

  return (
    <div className="chat">
      <div className="messages">
        <div className="bubble">嗨，我是 {name}。不用填表，我们聊几句，我慢慢了解你，再帮你留意值得认识的人。</div>
        {ob.transcript.map((t, i) => (
          <Turn key={i} question={t.question} answer={t.answer ?? '（跳过了）'} />
        ))}
        {ob.step ? (
          <>
            <div className="bubble">{ob.step.question}</div>
            <Answer key={ob.step.key} step={ob.step} busy={busy} onReply={(b) => void reply(ob.step!, b)} />
            <p className="progress small muted">
              已聊 {ob.answered} / {ob.total}
            </p>
          </>
        ) : (
          <>
            <div className="bubble">谢谢你愿意说这么多，我大概了解你了。有合适的人我会第一时间告诉你；想到什么也可以随时跟我说。</div>
            <button className="primary self-start" onClick={onGoRecommend}>
              去看看本周推荐
            </button>
            {msgs.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'bubble me' : 'bubble'}>
                {m.content}
              </div>
            ))}
          </>
        )}
        <div ref={bottom} />
      </div>
      {error && <p className="error">{error}</p>}
      {ob.done && (
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input value={text} placeholder="说点什么…" onChange={(e) => setText(e.target.value)} />
          <button className="primary" disabled={busy || !text.trim()}>
            发送
          </button>
        </form>
      )}
    </div>
  );
}

function Turn({ question, answer }: { question: string; answer: string }) {
  return (
    <>
      <div className="bubble">{question}</div>
      <div className="bubble me">{answer}</div>
    </>
  );
}

function Answer({ step, busy, onReply }: { step: OnboardingStep; busy: boolean; onReply: (b: { value?: string | string[]; skip?: boolean }) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState('');

  function toggle(o: string) {
    setPicked(picked.includes(o) ? picked.filter((x) => x !== o) : [...picked, o]);
  }

  function submitMulti() {
    const extra = text
      .split(/[,，、\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    onReply({ value: [...picked, ...extra] });
  }

  return (
    <div className="answer">
      {step.options.length > 0 && (
        <div className="options">
          {step.options.map((o) =>
            step.multi ? (
              <button key={o} className={picked.includes(o) ? 'option active' : 'option'} disabled={busy} onClick={() => toggle(o)}>
                {o}
              </button>
            ) : (
              <button key={o} className="option" disabled={busy} onClick={() => onReply({ value: o })}>
                {o}
              </button>
            ),
          )}
        </div>
      )}
      {(step.allowText || step.multi) && (
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            if (step.multi) submitMulti();
            else if (text.trim()) onReply({ value: text.trim() });
          }}
        >
          {step.allowText && (
            <input value={text} maxLength={30} placeholder={step.multi ? '也可以自己说，用逗号隔开' : '简单说说'} onChange={(e) => setText(e.target.value)} />
          )}
          <button className="primary" disabled={busy || (step.multi ? picked.length === 0 && !text.trim() : !text.trim())}>
            {step.multi ? '就这些' : '发送'}
          </button>
        </form>
      )}
      {step.skippable && (
        <button className="link self-start" disabled={busy} onClick={() => onReply({ skip: true })}>
          这题先跳过
        </button>
      )}
    </div>
  );
}
