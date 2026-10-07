import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth.js';
import { chatCompletion, type ChatMessage } from '../llm.js';
import { query } from '../db/db.js';

export async function chatRoutes(app: FastifyInstance) {
  // Agent 对话：Jc（DeepSeek）
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
    const agentName = settings[0]?.agent_name ?? 'Jc';

    const messages: ChatMessage[] = [
      ...(history ?? []).slice(-20),
      { role: 'user', content: message },
    ];
    try {
      const replyText = await chatCompletion(messages);
      return { reply: replyText, agentName, persisted: true, profileUpdates: [] };
    } catch (err: any) {
      return reply.code(502).send({ error: err.message ?? 'AI 服务暂不可用' });
    }
  });
}
