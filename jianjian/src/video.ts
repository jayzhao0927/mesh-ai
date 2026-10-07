import { randomUUID } from 'node:crypto';
import { config } from './config.js';

// TRTC 视频房间（v0.1 stub）：
// - createRoom 生成持久 room_id，落库 video_rooms
// - userSig 生成为 stub；接入 TRTC 时用 TRTC_SDK_APP_ID + SECRET_KEY 按官方算法签发
// 内测期可用 TRTC 体验版（每月 1 万分钟免费）

export function createRoomId(): string {
  return `mesh-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function buildUserSig(userId: string): string {
  if (!config.trtc.sdkAppId || !config.trtc.secretKey) {
    return `stub-usersig-${userId}`;
  }
  // TODO: 按 TRTC 官方 UserSig 算法（HMAC-SHA256）实现
  return `stub-usersig-${userId}`;
}

export function roomLink(roomId: string): string {
  // 统一分享链接格式：/s/video/{roomId}（免登录打开落地页）
  return `${config.publicBaseUrl}/s/video/${roomId}`;
}
