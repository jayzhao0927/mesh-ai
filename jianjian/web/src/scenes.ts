export interface Scene { kind: string; title: string; trigger: string; turns: { who: string; text: string }[]; note: string }
const SCENES: Scene[][] = [
 [{ kind: '冲突爆发', title: '周末，往哪边走？', trigger: '你想在家休息，TA 已经和朋友约好爬山，希望你一起去。', turns: [{who:'你',text:'我这周有些累了，想把周末留给自己。'}, {who:'TA',text:'我期待一起出去，也听见你需要休息。要不要这次我去，回来给你带好吃的？'}, {who:'你',text:'好呀。下次我们挑个都舒服的安排。'}], note:'AI 推演样例：不同安排不一定是冲突，愿意听见彼此的需要更重要。' },
 { kind: '冲突爆发', title: '临时改变的计划', trigger:'你准备了一个安静的约会，TA 临时想邀请朋友一起。', turns:[{who:'你',text:'我原本期待今天只有我们，突然加人会有点失落。'},{who:'TA',text:'我没想到这个对你很重要。今天按原计划，朋友我们改天再见。'},{who:'你',text:'谢谢你听我说，我们以后提前商量。'}],note:'AI 推演样例：说出失落而不是指责，是为沟通留一扇门。'}],
 [{kind:'一方受委屈',title:'今天，想被接住',trigger:'你在工作中受了委屈，回家后只想说一句“今天真的很难受”。',turns:[{who:'你',text:'今天当着同事被批评，我心里堵得慌。'},{who:'TA',text:'被当众说一定不好受。你想让我先听你说，还是一起想办法？'},{who:'你',text:'先陪我坐一会儿吧。'},{who:'TA',text:'好，我在。'}],note:'AI 推演样例：先问对方需要什么，再决定给陪伴还是给方案。'},
 {kind:'一方受委屈',title:'没关系，我在',trigger:'你付出了很多，却没有得到期待的认可。',turns:[{who:'你',text:'好像我怎么努力都不够。'},{who:'TA',text:'我看到你很用心了。今天不用急着证明什么，我先陪你。'}],note:'AI 推演样例：不急着纠正感受，先把情绪接住。'}],
 [{kind:'喜悦分享',title:'你的好消息，我也开心',trigger:'TA 收到期待已久的工作机会，兴冲冲地向你分享。',turns:[{who:'TA',text:'我拿到那个一直想去的机会了！'},{who:'你',text:'太为你开心了。快跟我说说你最期待什么，我们找个地方庆祝吧。'}],note:'AI 推演样例：把对方的喜悦放大，而不是把话题转回自己。'},
 {kind:'喜悦分享',title:'值得一起庆祝的小事',trigger:'TA 终于完成了一个认真准备很久的作品。',turns:[{who:'TA',text:'终于做完了，虽然累，但真的很开心。'},{who:'你',text:'我知道你投入了多少。可以让我看看吗？今天值得好好庆祝。'}],note:'AI 推演样例：对一件小事的认真回应，也能让人觉得被看见。'}],
];
export function randomScene(episode: number, random = Math.random): Scene { const list = SCENES[Math.min(2, Math.max(0, episode))]; return list[Math.floor(random() * list.length)]!; }
