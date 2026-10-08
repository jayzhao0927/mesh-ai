# 见见后端（Fastify 联调骨架）

单体 Node.js + TypeScript + Fastify + PostgreSQL + Redis。Docker Compose 一键起。

## 快速启动

```bash
cp .env.example .env
docker compose up -d          # api + postgres + redis
npm run migrate               # 建表
npm run seed                  # 写入演示候选人（上线前清空）
# API: http://localhost:8080/health
bash scripts/smoke.sh         # 真实环境全链路冒烟（需 curl、jq）
```

本机 5432/6379 已被占用时，在 `.env` 改 `DB_PORT` / `REDIS_PORT`，并同步改 `DATABASE_URL` / `TEST_DATABASE_URL` 的端口。

## 网页版前端（web/）

```bash
cd web && npm install && npm run dev   # http://localhost:5173，/api 等请求代理到 8080
# 或用构建产物：npm run build && npx vite preview（同样监听 5173、同样代理）
```

建档走「聊天」里和见见的对话（规则式，先问连接目标再分叉，选项化、可跳过）；「我的」里的手动表单只是聊天不可用时的备用入口。
标注「开发调试」的入口（演示账号、手动生成推荐）仅用于联调。
被推荐人在浏览器打开 `/s/rec/{token}`，登录后看到发起方的卡片并表态；接口不暴露对方是否已表态。web/ 仍是联调前端，最新 H5 视觉与对话流程以创始人提供的前端说明为准。

## 测试

```bash
npm run typecheck && npm run build && npm test
```

`npm test` 连真实 PostgreSQL 的 `TEST_DATABASE_URL`（库不存在会自动创建，每个用例前清空），覆盖全部产品规则。

本地不用 Docker 也行：`npm install && npm run dev`（需本机有 postgres/redis 并配好 `.env`）。

本机真实数据库的 HTTP 冒烟：`SMOKE_DB_MODE=local bash scripts/smoke.sh`（需 `DATABASE_URL`、`psql`、`curl`、`jq`）。默认冒烟仍使用 Docker Compose 查询数据库。
受限环境可用 `API_HOST=127.0.0.1 npm start`；Docker 默认仍监听 `0.0.0.0`。
迁移、seed、定时任务与测试使用 `node --import tsx`，无需 tsx CLI 的 Unix IPC socket。

GitHub 工作流 `Jianjian backend validation` 准备了 Node 20 + Docker Compose 的编译、迁移、seed、真实 PostgreSQL 测试与 HTTP 冒烟。推送验收分支、相关 PR 或手动触发可运行；工作流文件存在不等于验收已通过。
本轮通过项与尚未完成项见 [验收记录](./VALIDATION-2026-10-08.md)。

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/dev-token` | dev 换 token（`{phone}` → `{token}`；生产下线） |
| GET | `/api/auth/me` | 当前用户 |
| GET/PUT | `/api/settings` | Agent 名（默认见见，保留自定义名） |
| GET | `/api/onboarding` | 对话建档：当前该问的一题（选项/可否跳过）+ 已聊内容 |
| POST | `/api/onboarding/answer` | 回答当前题 `{key, value}` 或跳过 `{key, skip:true}`；写入画像 stated 轨与连接目标 |
| POST | `/api/chat` | 和见见对话（DeepSeek，`{message, history?}`） |
| GET/PUT | `/api/profile` | Living Profile 双轨 + 连接目标 |
| DELETE | `/api/profile/:track/:key` | 单条删除 stated/revealed |
| POST/GET | `/api/invites` | 发起搭桥邀请 / 我的邀请（盲盒：只看注册状态） |
| GET | `/api/invites/inbox` | 我收到的邀请 |
| POST | `/api/invites/:code/claim` | 领取邀请 |
| POST | `/api/invites/:id/revoke` | 撤回 |
| POST | `/api/recommendations/generate` | 生成下一条推荐并触达 |
| GET | `/api/recommendations/current` | 当前有效推荐（含自己的 `myChoice`；mutual 在视频管线中继续保留） |
| GET | `/api/recommendations/incoming` | 待我表态：我作为被推荐人、尚未表态的一条（`{token, link}`） |
| GET | `/api/recommendations/by-token/:token` | 分享链接登录后看推荐：按身份返回对方卡片 + 自己的选择（第三人 403） |
| GET | `/r/:token` | 推荐落地页（短信/微信链接直达，免登录） |
| POST | `/api/recommendations/:id/intent` | 感兴趣 / 没感觉（盲选）；未 mutual 且超过 24 小时返回中性 410 |
| POST | `/api/video/rooms` | 双方 mutual 后建房排期 |
| GET | `/v/:roomId` | 进房信息（链接直达） |

API 进程启动后及每分钟执行一次匹配周期：结算到期、解除超时连接、给空闲且未暂停的用户补位。API 请求即时校验期限。`npm run job:weekly` 保留为单次周期命令，已无每周生成限额。

## 产品规则已编码

- 连接目标只开放「稳定恋爱」「奔着结婚认真谈」（战略聚焦）
- 推荐：一次一人；目标不一致硬过滤；30 天内不重复推同一人
- **推荐理由禁止出现数字**（`matching.ts` 正则强制，防止收入/身高泄露）
- 搭桥邀请：每周 5 封上限；同一对象 30 天一次；邀请人看不到画像与选择
- 双向盲选：任一方 pass，另一方与邀请人永远不知道
- 普通推荐 24 小时有效；Pass 不提前释放等待位，跨周不会使有效卡消失；到期后继续匹配
- 每人独立计算未响应次数：到期前未点 Interested/Pass 才累计；任何表态清零；连续三次暂停，暂停者也从候选池排除
- 暂停后只有认证用户在 `/api/chat` 明确说“继续匹配”才恢复并清零；普通聊天、登录及修改画像不会恢复
- 从 mutual 时起 24 小时内完成预约、48 小时内完成视频；逾期解除并重新进入匹配池。无预约时间的空房间不算完成预约，旧房间不可继续进
- 视频完成记录与复盘记录均存在后释放推荐位；只有真实完成事件才能写入完成时间，获取 stub UserSig 不算完成
- 推荐生成与邀请限额使用事务和参与人行锁，防止并发绕过；撤回不抵消已发送邀请的限额或去重窗口
- 历史推荐快照/理由在返回时重新脱敏，支持 Unicode 十进制数字过滤

2026-10-08 用户确认的新期限规则替代原“48 小时内预约、回访一次”的规则。

尚未接通：真实视频供应商完成事件、复盘采集流程，以及指定搭桥双方的关联和 mutual 后搭桥人揭晓。`recordVideoCompletion` / `recordVideoReview` 是内部集成函数，未暴露可伪造完成的公开 API；TRTC 仍为 stub，不能声称已完成真实视频闭环。

## 哪些还是 stub（下一步要接的）

| 模块 | 状态 | 接入要点 |
|---|---|---|
| 微信模板消息 | stub（只落库日志） | `src/notify.ts` → 认证服务号 + 模板审核 |
| 短信网关 | stub | 同上；⚠️ 婚恋类目模板需单独报备 |
| TRTC userSig | stub | `src/video.ts` → 按官方算法签发 |
| 手机验证码登录 | dev token | `src/auth.ts` AUTH_MODE=otp + 短信验证码 |
| 匹配模型 | 规则 stub | `src/matching.ts` → dyad p_mutual 打分 |
| 画像结构化抽取 | TODO | 聊天返回 profileUpdates 补丁，经确认后写入 |

## 下一步

1. 你拍板：公司 / 云厂商 / 触达主通道（见《生产化方案》§10）
2. 买服务器+域名 → 跑 `docker compose up -d`
3. 接微信服务号 + 短信 + TRTC（把三个 stub 换成真实现）
4. 前端 H5 对接这套 API（替换原型里的 server actions）
5. 内测 → 备案并行 → 公测
