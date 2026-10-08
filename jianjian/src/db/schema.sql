-- MESH AI 生产库 schema v0.1
-- Living Profile 双轨（stated/revealed，带来源/置信度/更新时间）存在 profiles.data JSONB 中

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 用户：手机号为唯一身份
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT UNIQUE NOT NULL,
  nickname    TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Agent 设置（viewer-scoped）：Agent 名等
CREATE TABLE IF NOT EXISTS agent_settings (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  agent_name  TEXT NOT NULL DEFAULT '见见',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only change the default for new settings. Never rewrite existing user-selected names.
ALTER TABLE agent_settings ALTER COLUMN agent_name SET DEFAULT '见见';

-- 连接目标：只保留 恋爱 / 结婚（战略聚焦）
CREATE TABLE IF NOT EXISTS connection_targets (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  target      TEXT NOT NULL CHECK (target IN ('稳定恋爱', '奔着结婚认真谈')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Living Profile：data JSONB 结构
-- { "stated": { "<key>": { "value":…, "source":"user", "confidence":1.0, "updated_at":"…" } },
--   "revealed": { "<key>": { "value":…, "source":"chat:…", "confidence":0.7, "updated_at":"…" } } }
CREATE TABLE IF NOT EXISTS profiles (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data        JSONB NOT NULL DEFAULT '{"stated":{}, "revealed":{}}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 搭桥邀请（盲盒）：邀请人只能看到注册/体验状态，看不到画像与选择
CREATE TABLE IF NOT EXISTS invites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_phone TEXT,
  invitee_email TEXT,
  code          TEXT UNIQUE NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'bridge' CHECK (kind IN ('bridge', 'crush')),
  status        TEXT NOT NULL DEFAULT 'sent'
                CHECK (status IN ('sent','registered','experienced','withdrawn','expired')),
  claimed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT invitee_contact_required CHECK (invitee_phone IS NOT NULL OR invitee_email IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_invites_inviter ON invites(inviter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code);

-- 每周推荐：candidate_snapshot 为脱敏展示快照，link_token 为短信/微信链接唯一参数
CREATE TABLE IF NOT EXISTS recommendations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week               TEXT NOT NULL, -- 'YYYY-Www'
  candidate_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_snapshot JSONB NOT NULL,
  reasons            JSONB NOT NULL, -- 推荐理由：禁止出现收入/身高数字（由 matching.ts 强制）
  link_token         TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(18), 'hex'),
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','mutual','passed','expired')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, week)
);
CREATE INDEX IF NOT EXISTS idx_reco_user ON recommendations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reco_token ON recommendations(link_token);

-- p_mutual 打分明细（第二阶段训练数据；每次推荐的四项分值 + 最终双向结果必须记下来）
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS score_breakdown JSONB;
-- 连续推荐替代每周限额；week 仅保留为历史统计维度。
ALTER TABLE recommendations DROP CONSTRAINT IF EXISTS recommendations_user_id_week_key;
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS mutual_at TIMESTAMPTZ;

-- 双向意愿：blind，双方 interested 才揭晓
CREATE TABLE IF NOT EXISTS recommendation_intents (
  recommendation_id UUID NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  side              TEXT NOT NULL CHECK (side IN ('a','b')),
  choice            TEXT NOT NULL CHECK (choice IN ('interested','pass')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (recommendation_id, user_id)
);

-- 视频房间：双方确认时间后生成持久房间号
CREATE TABLE IF NOT EXISTS video_rooms (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
  room_id           TEXT UNIQUE NOT NULL,
  scheduled_at      TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled','live','done','cancelled')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_video_recommendation ON video_rooms(recommendation_id);
ALTER TABLE video_rooms ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE video_rooms ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- 旧 mutual 的时钟从双方最后一次表态开始，不因迁移重新计时。
UPDATE recommendations r SET mutual_at = COALESCE(
  (SELECT max(i.created_at) FROM recommendation_intents i WHERE i.recommendation_id = r.id),
  r.created_at
) WHERE r.status = 'mutual' AND r.mutual_at IS NULL;

CREATE TABLE IF NOT EXISTS matching_states (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  no_response_streak INTEGER NOT NULL DEFAULT 0 CHECK (no_response_streak BETWEEN 0 AND 3),
  paused BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 每张到期卡、每个参与人只结算一次，重启/并发任务不重复计数。
CREATE TABLE IF NOT EXISTS recommendation_response_events (
  recommendation_id UUID NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  responded BOOLEAN NOT NULL,
  PRIMARY KEY (recommendation_id, user_id)
);

-- Agent 分享卡：对外可打开的 Agent 介绍页（免登录）
CREATE TABLE IF NOT EXISTS agent_shares (
  token      TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(18), 'hex'),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 通知日志：微信模板消息 / 短信
CREATE TABLE IF NOT EXISTS notification_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  channel    TEXT NOT NULL CHECK (channel IN ('wechat','sms')),
  kind       TEXT NOT NULL, -- 'recommendation' | 'video' | 'otp' | …
  ref_id     TEXT,
  status     TEXT NOT NULL DEFAULT 'stubbed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 对话建档：用户跳过的问题（跳过后不再追问；之后回答会自动移除）
CREATE TABLE IF NOT EXISTS onboarding_skips (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  step_key   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, step_key)
);
