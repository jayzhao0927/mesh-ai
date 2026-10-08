# 见见后端任务 1：阶段验收记录

日期：2026-10-08。基准：用户提供的后端 v0.2 与 2026-10-08 H5 产品流程。
代码来源：`origin/web-handoff`，基线提交 `20f98d0`。
工作分支：`codex/jianjian-backend-validation`，尚未推送。

**结论：真实数据库与 HTTP 核心链路通过，任务 1 尚未完整结束。**
本轮没有进入任务 2–6，没有修改 H5 前端或旧 Next.js 产品代码，也没有接真实短信、DeepSeek 或 TRTC。

## 已实际运行

| 检查 | 结果 | 证据与范围 |
| --- | --- | --- |
| 安装依赖 | 通过 | `npm ci` |
| Node 20 | 通过 | 最终检查使用 Node v20.20.2 |
| 真实 PostgreSQL | 通过 | PostgreSQL 16.15 原生进程，本机隔离数据目录；不是 pg-mem |
| Redis | 通过 | Redis 7.0.15 原生进程，`PING` 返回 `PONG`；当前 API 尚未实际使用 Redis 队列或缓存 |
| 迁移与演示数据 | 通过 | `npm run migrate`、`npm run seed`，含 `score_breakdown` |
| 严格编译 | 通过 | `npm run typecheck`、`npm run build` 零错误 |
| 自动化规则测试 | 通过 | `npm test`：68 项通过，0 失败、0 跳过、0 取消 |
| 真实 HTTP 冒烟 | 通过 | `SMOKE_DB_MODE=local bash scripts/smoke.sh` 输出 `ALL SMOKE CHECKS PASSED` |
| Docker Compose 真实链路 | 未运行 | 当前环境没有 Docker daemon；不能以原生服务通过替代 Compose 通过 |
| GitHub Actions Compose 验收 | 待运行 | 工作流已准备；尚无 GitHub 写入连接，未推送或触发 |

HTTP 冒烟实际包含：`/health`、注册及身份读取、建档及非法目标拒绝、邀请及领取、邀请去重与盲盒视图、单人推荐及目标一致、分值直接查询落库、卡片零数字、双方 Interested → mutual、视频房创建及固定房号、双方可取进房信息而第三人被拒绝、Pass 保密、旧链接 301。
视频房 API 返回的 UserSig 仍是 stub，此结果不能解释为真实通话验收通过。
`/health` 路径与返回值保持原样。

## 已复现并修复

原有 38 项真实 PostgreSQL 测试通过；新增 11 项回归测试在修复前全部失败，修复后通过。随后增加跨用户并发、反向去重、历史快照脱敏、事务回滚及默认 Agent 名保护，当时共 55 项通过。本次增加连续匹配、暂停/恢复、mutual 时钟与期限、预约校验及内部完成/复盘状态等 13 项测试，最终共 68 项通过。

- 推荐按周查询造成跨周卡片消失：改为按真实有效期查询。
- 超过 24 小时仍可表态：普通推荐到期后 current/incoming 不再返回有效卡，by-token 和 intent 返回同样的中性 410，公开落地页为 expired。与对方 Pass、未读、已 Interested 无关；mutual 管线继续占位。
- 被推荐人或已 mutual 的人仍可被再次推荐：双向推荐位检查，生成接口与周任务共用同一服务。
- 并发生成触发重复推荐或服务错误：双方用户按固定顺序行锁，事务内重查推荐位及暂停状态；表态也通过行锁与事务原子处理。
- 撤回邀请后可绕过发送上限与去重：计数包含已发送后撤回的邀请；同一发起人的并发邀请通过行锁串行校验。
- 数字过滤只覆盖 ASCII 与全角：扩展到 Unicode 十进制数字；历史快照与理由也在读取时脱敏，私有 revealed 内容不进入推荐卡。
- 新用户默认名仍为 Jc：新默认改为见见，重跑迁移不更新已有名字；通知按用户自己的 Agent 名署名。
- 受限运行环境禁止 Unix socket：迁移/seed/测试/周任务切换到 `node --import tsx`；API 可配置 loopback 绑定，生产默认不变；冒烟增加本机真实 PostgreSQL 模式。

## 用户新决策与本次落实

2026-10-08 用户确认，以下规则替代原交接中的每周频率与 mutual 回访规则：

- 推荐到期后继续匹配。连续三次没有反应暂停；没有反应指到期仍未点 Interested 或 Pass。主动 Pass 不累计，任一次表态清零。暂停只由用户在聊天中明确说“继续匹配”恢复。
- 从 mutual 时起，24 小时内完成预约、48 小时内完成视频；否则解除匹配并立即回到匹配池。实际新卡由每分钟的后台周期补位，有合适候选人才生成。

落实：删除旧 `UNIQUE (user_id, week)` 限额，保留 week 为统计字段；为双方独立持久化未响应次数和暂停状态，以每卡每人事件键防重；数据库事务锁协调生成、表态、到期与预约，重复周期或服务重启不会重复计数。暂停者不能自己生成，也不进入别人候选池。普通聊天不自动恢复，模型收到服务端真实暂停状态和自定义 Agent 名，客户端历史不能伪造系统指令。

`mutual_at` 从双方 Interested 时记录，重发表态不延长期限；预约时间必须在未来且早于视频截止时间。已有空房可以补排期，但空房不是已预约。超时关闭旧房并释放双方；内部真实视频完成时间存在后可等待复盘，复盘记录完成后释放。进房/获取 stub 不写入视频完成记录。

实际 HTTP 验证使用新版构建的独立端口，包含原核心链路以及：已预约但视频超时 → 旧房关闭 → 同周再推荐；第三次未响应 → 暂停 → 明确聊天命令恢复；未预约超过期限 → 迟到预约不能复活连接。通过 SQL 推进测试记录时间，不需要实际等待两天；暂停冒烟预置前两次计数，自动化测试另覆盖三次真实到期的连续结算。

第一次重跑测试时，原测试库 PostgreSQL 系统表出现 `unexpected data beyond EOF`。换用新的独立真实 PostgreSQL 测试库后完整回归通过。此环境问题已记录，未把失败当作通过。

## 尚不能签收的产品链路

1. TRTC 视频完成事件与复盘采集仍未接通：本次提供内部 `recordVideoCompletion` / `recordVideoReview` 集成函数及状态测试，没有公开可伪造完成的接口，也没有声称真实通话或复盘闭环已验收。这属于后续视频供应商和产品对话流程的接入工作。
2. 指定搭桥双方的关联与 mutual 后向双方揭晓搭桥人：当前邀请表每行只关联一个被邀请人，缺少指定双方关系及揭晓流程。本轮只验证邀请人的视图保密，不能声称完整搭桥配对闭环已完成。
3. Docker Compose：仍需在具有 Docker daemon 的环境执行已准备的工作流；当前尚未发生实际运行。
4. GitHub 分支仍只有本地提交，未推送，Actions 未运行。

## 复现

```bash
cd jianjian
npm ci
cp .env.example .env
docker compose up -d --build
npm run migrate
npm run seed
npm run typecheck
npm run build
npm test
bash scripts/smoke.sh
```

如使用原生服务，配置独立开发库和以 `_test` 结尾的测试库，启动 PostgreSQL 与 Redis，然后执行同样的迁移和测试；HTTP 冒烟使用 `SMOKE_DB_MODE=local`。
测试会清空测试库，因此测试库必须独立。

GitHub 工作流对 `jianjian/` 变更运行上述 Docker 链路，并保存 Compose 日志。任务 1 结束前仍需补齐本节列出的链路与实际 Compose 结果，之后先汇报给创始人，等待确认才开始任务 2。
