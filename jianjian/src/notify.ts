import { config } from './config.js';
import { query } from './db/db.js';

// 触达层：微信服务号模板消息（主）+ 短信（兜底）
// v0.1 为 stub：只落 notification_logs，不真实发送。
// 接入时分别实现 wechatSend / smsSend，替换 stubSend 即可。

export type Channel = 'wechat' | 'sms';

export interface NotifyPayload {
  userId: string;
  kind: 'recommendation' | 'video' | 'otp';
  title: string;
  link: string;
}

async function stubSend(channel: Channel, p: NotifyPayload): Promise<void> {
  await query(
    `INSERT INTO notification_logs (user_id, channel, kind, ref_id, status)
     VALUES ($1, $2, $3, $4, 'stubbed')`,
    [p.userId, channel, p.kind, p.link],
  );
  console.log(`[notify:${channel}] ${p.kind} -> user ${p.userId}: ${p.title} ${p.link}`);
}

// TODO: 微信服务号模板消息
// 需：认证服务号（300元/年）+ 用户关注 + 模板审核通过
// 接口：POST https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=…
async function wechatSend(p: NotifyPayload): Promise<void> {
  if (!config.wechat.appId) return stubSend('wechat', p);
  // 真实实现：换 access_token → 按模板填充 → 发送 → 落库 status='sent'
  return stubSend('wechat', p);
}

// TODO: 短信网关（阿里云/腾讯云）
// 注意：婚恋交友类短信模板需单独报备，套餐包默认不支持该类目
async function smsSend(p: NotifyPayload): Promise<void> {
  if (!config.sms.accessKey) return stubSend('sms', p);
  // 真实实现：按 provider 调 SendSms → 落库 status
  return stubSend('sms', p);
}

/** 推荐触达：微信主 + 短信兜底 */
export async function notifyRecommendation(userId: string, link: string): Promise<void> {
  const payload: NotifyPayload = {
    userId,
    kind: 'recommendation',
    title: 'Jc 给你带来了一位新的朋友',
    link,
  };
  await wechatSend(payload);
  await smsSend(payload);
}

/** 视频链接触达 */
export async function notifyVideo(userId: string, link: string): Promise<void> {
  const payload: NotifyPayload = { userId, kind: 'video', title: '你们的视频见面链接', link };
  await wechatSend(payload);
  await smsSend(payload);
}
