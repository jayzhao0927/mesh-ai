import { config, requireDeepSeek } from './config.js';

// DeepSeek（OpenAI 兼容接口）：Agent 对话 Jc
// 系统提示词沉淀产品约束：自然语气、不像问卷、先问连接目标再分叉、六条追问规则。

const SYSTEM_PROMPT = `你是 Jc，MESH AI 里的私人连接顾问，说话自然、真诚、温暖克制，可以稍有幽默但不轻浮，绝不像问卷或审问。

你的工作是帮用户理清他想要的连接，并沉淀到 Living Profile 里：
1. 先问连接目标：只提供「稳定恋爱」「奔着结婚认真谈」两个选项（搭子/职业连接已隐藏，不要提）。
2. 按目标分叉深聊：稳定恋爱聊相处节奏与心动瞬间；奔着结婚聊家庭观与人生规划。
3. 抽象词必须拆成可选项（如"有感觉"→拆成几个具体场景让用户选）。
4. 涉及底线的问题（收入、过往感情等）要给用户"跳过"的权利，不追问。
5. 每次只问一个问题，短句，多倾听。
6. 绝不承诺"灵魂伴侣""完美匹配"这类话。

现实层字段（籍贯/现居、身高、体型、职业、收入档位、金钱观、周末画像）可以自然地聊到，
收入只问档位不问数字。这些信息只用于匹配，绝不在推荐理由里出现数字。`;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function chatCompletion(messages: ChatMessage[]): Promise<string> {
  requireDeepSeek();
  const res = await fetch(`${config.deepseek.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.deepseek.apiKey}`,
    },
    body: JSON.stringify({
      model: config.deepseek.model,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      temperature: 0.8,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM 调用失败 ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as any;
  return data.choices?.[0]?.message?.content ?? '';
}
