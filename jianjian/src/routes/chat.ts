import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth.js';
import { chatCompletion, type ChatMessage } from '../llm.js';
import { query } from '../db/db.js';
import { DEFAULT_AGENT_NAME } from '../agent-name.js';
import { resumeMatching, settleMatchingLifecycle } from '../matching-lifecycle.js';

export async function chatRoutes(app: FastifyInstance) {
  // Agent 对话：见见（DeepSeek），保留用户自定义名
  // TODO: 结构化画像抽取——当前只返回回复文本，画像更新走 PUT /api/profile；
  //       后续让模型输出 JSON 补丁并经用户确认后写入 profiles（冲突时温和确认，不静默覆盖）
  app.post('/api/chat', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    const { message, history } = (req.body ?? {}) as {
      message?: string;
      history?: ChatMessage[];
    };
    if (!message?.trim()) return reply.code(400).send({ error: '消息不能为空' });

    const settings = await query<{ agent_name: string }>(
      'SELECT agent_name FROM agent_settings WHERE user_id = $1',
      [userId],
    );
    const agentName = settings[0]?.agent_name ?? DEFAULT_AGENT_NAME;
    if (/^(?:请|帮我)?继续匹配[。！!]?$/u.test(message.trim())) {
      await resumeMatching(userId);
      return { reply: '好，我会继续为你寻找合适的人。', agentName, persisted: true, profileUpdates: [] };
    }

    await settleMatchingLifecycle();
    const [state] = await query<{ paused: boolean }>('SELECT paused FROM matching_states WHERE user_id = $1', [userId]);
    const messages: ChatMessage[] = [
      ...(history ?? []).filter(m => m.role === 'user' || m.role === 'assistant').slice(-20),
      { role: 'system', content: state?.paused
        ? '当前用户的匹配已暂停。普通聊天不会恢复匹配；如用户想继续，可告诉他在对话中说“继续匹配”。不得声称已经恢复。'
        : '不得透露任何匹配对象是否已读、拒绝或表态。只代表你自己的身份说话。' },
      { role: 'user', content: message },
    ];
    try {
      const replyText = await chatCompletion(messages, agentName);
      return { reply: replyText, agentName, persisted: true, profileUpdates: [] };
    } catch (err: any) {
      return reply.code(502).send({ error: err.message ?? 'AI 服务暂不可用' });
    }
  });
}
