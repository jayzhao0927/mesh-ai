import { useEffect, useRef, useState } from 'react';
import { api, isDemo, session, display, FIELD_LABELS, type OnboardingState, type OnboardingStep, type ProfileResponse, type Recommendation } from '../api';
import { demoMutual } from '../demo';
import { randomScene, type Scene } from '../scenes';
import { RecCard } from './RecCard';
interface Msg { role: 'user' | 'assistant'; content: string }
const BASICS: OnboardingStep[] = [
 {key:'city', question:'先认识现在的你。你平时在哪个城市生活？', options:[], allowText:true, skippable:true},
 {key:'age', question:'方便说说你的年龄吗？只记在你的私有资料里，不会出现在推荐卡上。', options:[], allowText:true, skippable:true},
 {key:'gender', question:'你通常怎么描述自己的性别？不想加标签，也可以跳过。', options:['女生','男生','不想加标签'], skippable:true},
];
export function Chat({ agentName, onAgentName }: { agentName: string; onAgentName: (name: string) => void }) {
 const [ob,setOb]=useState<OnboardingState|null>(null); const [profile,setProfile]=useState<ProfileResponse|null>(null);
 const [skips,setSkips]=useState<string[]>(() => JSON.parse(localStorage.getItem('jj.basic-skips:'+session.token)||'[]'));
 const [msgs,setMsgs]=useState<Msg[]>([]); const [text,setText]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 const [day,setDay]=useState(() => Number(localStorage.getItem('jj.try.day')||0));
 const [scene,setScene]=useState<Scene>(()=>randomScene(day)); const [rec,setRec]=useState<Recommendation|null>(null);
 const bottom=useRef<HTMLDivElement>(null);
 const finished=useRef(localStorage.getItem('jj.finished:'+session.token)==='true');
 async function load() { const [o,p]=await Promise.all([api<OnboardingState>('GET','/api/onboarding'),api<ProfileResponse>('GET','/api/profile')]);setOb(finished.current?{...o,done:true,step:null}:o);setProfile(p); }
 async function loadRec() {
  try { setRec(await api<Recommendation>('GET','/api/recommendations/current')); }
  catch { try { const incoming=await api<{token:string}>('GET','/api/recommendations/incoming');setRec(await api<Recommendation>('GET','/api/recommendations/by-token/'+incoming.token)); } catch { setRec(null); } }
 }
 useEffect(()=>{void load().catch(e=>setError(e.message));},[]);
 useEffect(()=>{bottom.current?.scrollIntoView?.({block:'end'});},[ob,msgs,day]);
 useEffect(()=>{if(ob?.done){finished.current=true;localStorage.setItem('jj.finished:'+session.token,'true');}},[ob?.done]);
 const basic = profile ? BASICS.find(s=>!profile.data.stated[s.key]&&!skips.includes(s.key)) : undefined;
 const done=!!ob?.done&&!basic;
 useEffect(()=>{if(done && (!isDemo||day>=2)) { void loadRec(); const t=setInterval(()=>{void loadRec();},15000);return()=>clearInterval(t);}},[done,day]);
 async function answer(step:OnboardingStep, body:{value?:string|string[];skip?:boolean}) {
  setBusy(true);setError('');
  try {
   if(BASICS.some(s=>s.key===step.key)&&profile) {
    if(body.skip) {const next=[...skips,step.key];setSkips(next);localStorage.setItem('jj.basic-skips:'+session.token,JSON.stringify(next));}
    else { const data={...profile.data,stated:{...profile.data.stated,[step.key]:{value:body.value!,source:'user',confidence:1,updated_at:new Date().toISOString()}}};await api('PUT','/api/profile',{data});setProfile({...profile,data});const next=[...skips,step.key];setSkips(next);localStorage.setItem('jj.basic-skips:'+session.token,JSON.stringify(next)); }
   } else setOb(await api<OnboardingState>('POST','/api/onboarding/answer',{key:step.key,...body}));
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function send() {
  const message=text.trim();if(!message||busy)return;setText('');setBusy(true);setError('');
  const history=msgs;setMsgs([...history,{role:'user',content:message}]);
  try {
   let reply:string;
   const remove=message.match(/^删除(.+)$/); const edit=message.match(/^把(.+?)(?:改成|改为)(.+)$/); const rename=message.match(/^(?:以后)?叫你(.+)$/);
   const aliases: Record<string,string> = {城市:'city',现居:'city',年龄:'age',年纪:'age',工作:'occupation',爱好:'hobbies'};
   const keyFor=(label:string)=>aliases[label.trim()]||Object.keys(FIELD_LABELS).find(k=>FIELD_LABELS[k]===label.trim());
   if(message==='看看我的资料'&&profile) reply=Object.entries(profile.data.stated).map(([k,v])=>(FIELD_LABELS[k]||k)+'：'+display(v.value)).join('\n')||'我们还没聊到太多，你可以慢慢告诉我。';
   else if(remove&&keyFor(remove[1])) {await api('DELETE','/api/profile/stated/'+keyFor(remove[1]));reply='好，这条资料已经删掉了。';await load();}
   else if(edit&&keyFor(edit[1])&&profile) {const key=keyFor(edit[1])!;const value=key==='hobbies'?edit[2].split(/[，,、]/).filter(Boolean):edit[2].trim();await api('PUT','/api/profile',{data:{...profile.data,stated:{...profile.data.stated,[key]:{value,source:'user',confidence:1}}}});reply='好，已经按你说的改好了。';await load();}
   else if(rename) {const r=await api<{agentName:string}>('PUT','/api/settings',{agentName:rename[1].trim()});onAgentName(r.agentName);reply='好，以后就这么叫我。';}
   else reply=(await api<{reply:string}>('POST','/api/chat',{message,history})).reply;
   setMsgs([...history,{role:'user',content:message},{role:'assistant',content:reply}]);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 function advance() {const next=Math.min(2,day+1);setDay(next);localStorage.setItem('jj.try.day',String(next));setScene(randomScene(next));}
 async function generate() {setBusy(true);setError('');try{await api('POST','/api/recommendations/generate');await loadRec();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 if(!ob||!profile)return <p className="muted">{error||'见见正在准备…'}</p>;
 const step=basic||ob.step;
 return <div className="chat"><div className="conversation-label">THIS IS WHERE WE BEGIN</div><div className="bubble">嗨，我是{agentName}。不用急着表现得很好，我们慢慢聊。你想说多少，都由你决定。</div>
 {done ? <details className="conversation-history"><summary>看看我们聊过的内容</summary> {BASICS.filter(s=>profile.data.stated[s.key]||skips.includes(s.key)).map(s=><Turn key={s.key} question={s.question} answer={profile.data.stated[s.key]?display(profile.data.stated[s.key].value):'这题先跳过'}/>)}
 {!basic&&ob.transcript.map((t,i)=><Turn key={i} question={t.question} answer={t.answer||'这题先跳过'}/>)}</details> : <> {BASICS.filter(s=>profile.data.stated[s.key]||skips.includes(s.key)).map(s=><Turn key={s.key} question={s.question} answer={profile.data.stated[s.key]?display(profile.data.stated[s.key].value):'这题先跳过'}/>)}
 {!basic&&ob.transcript.map((t,i)=><Turn key={i} question={t.question} answer={t.answer||'这题先跳过'}/>)}</>}
 {step?<><div className="bubble">{step.question}</div><Answer key={step.key} step={step} busy={busy} onReply={b=>{void answer(step,b);}}/></>:<>
 {isDemo&&day<2?<><div className="bubble">谢谢你愿意让我认识你。见见正在为你安排模拟约会，先看看意见不同的时候，彼此会怎样回应。</div><section className="scene-card"><span className="sticker-label">AI 推演样例 · {scene.kind}</span><h2>{scene.title}</h2><p>{scene.trigger}</p><div className="scene-dialogue">{scene.turns.map((t,i)=><p key={i}><b>{t.who}</b><span>{t.text}</span></p>)}</div><p className="scene-note">{scene.note}</p></section><div className="test-controls"><span>仅体验控件 · 正式流程每天解锁一集</span><button onClick={()=>setScene(randomScene(day))}>换个随机场景</button><button onClick={advance}>{day===0?'模拟明天，解锁下一集':'跳到揭晓，查看样例推荐'} ↗</button></div></>:<>
 {isDemo?<div className="bubble">AI 推演样例播完了。我为你带来一张样例推荐卡，先看看相处的可能。</div>:<div className="bubble">我已经记下了你亲口说的内容。模拟约会尚未接通；现在可以试真实推荐流程。</div>}
 {rec?<><RecCard id={rec.id} eyebrow={isDemo?'见见的推荐样例':'见见为你留意到一位'} stated={rec.candidate_snapshot.stated} reasons={rec.reasons} status={rec.status} myChoice={rec.myChoice} createdAt={rec.created_at} onChanged={loadRec}/>{isDemo&&rec.myChoice==='interested'&&rec.status!=='mutual'&&<div className="test-controls"><span>仅体验控件 · 正式流程需要双方真实表态</span><button onClick={()=>{demoMutual();void loadRec();}}>模拟双方都感兴趣 ↗</button></div>}</>:<button className="primary self-start" disabled={busy} onClick={()=>{void generate();}}>让见见看看是否有合适的人</button>}
 </>}
 <div className="chat-help"><button onClick={()=>setText('看看我的资料')}>看看我的资料</button><span>想修改？直接说“把城市改成上海”</span></div>
 </>}
 {msgs.map((m,i)=><div key={i} className={m.role==='user'?'bubble me':'bubble'}>{m.content}</div>)}<div ref={bottom}/>
 {error&&<p role="alert" className="error">{error}</p>}
 {done&&<form className="composer" onSubmit={e=>{e.preventDefault();void send();}}><input value={text} onChange={e=>setText(e.target.value)} placeholder="想到什么，都可以告诉我…"/><button aria-label="发送消息" className="primary" disabled={busy||!text.trim()}>↑</button></form>}
 </div>;
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
