-- 演示候选人池（明确标注：seed 数据，上线前清空）
-- 真实候选人来自真实注册用户；matching.ts 为 p_mutual dyad 打分 v1（加权规则版）
INSERT INTO users (id, phone, nickname) VALUES
  ('11111111-1111-1111-1111-111111111111', '13800000001', '演示A'),
  ('22222222-2222-2222-2222-222222222222', '13800000002', '演示B'),
  ('33333333-3333-3333-3333-333333333333', '13800000003', '演示C')
ON CONFLICT (phone) DO NOTHING;

INSERT INTO connection_targets (user_id, target) VALUES
  ('11111111-1111-1111-1111-111111111111', '稳定恋爱'),
  ('22222222-2222-2222-2222-222222222222', '奔着结婚认真谈'),
  ('33333333-3333-3333-3333-333333333333', '稳定恋爱')
ON CONFLICT (user_id) DO UPDATE SET target = EXCLUDED.target;

INSERT INTO profiles (user_id, data) VALUES
  ('11111111-1111-1111-1111-111111111111', '{"stated":{"hometown":{"value":"杭州","source":"user","confidence":1.0},"hobbies":{"value":["徒步","做饭"],"source":"user","confidence":1.0}},"revealed":{}}'),
  ('22222222-2222-2222-2222-222222222222', '{"stated":{"hometown":{"value":"成都","source":"user","confidence":1.0},"hobbies":{"value":["阅读","骑行"],"source":"user","confidence":1.0}},"revealed":{}}'),
  ('33333333-3333-3333-3333-333333333333', '{"stated":{"hometown":{"value":"杭州","source":"user","confidence":1.0},"hobbies":{"value":["徒步","摄影"],"source":"user","confidence":1.0}},"revealed":{}}')
ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data;
