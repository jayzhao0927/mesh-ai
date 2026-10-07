#!/usr/bin/env bash
# 真实环境冒烟：docker compose up -d && npm run migrate && npm run seed 之后执行
# 用法：bash scripts/smoke.sh [API_BASE]   依赖 curl、jq、docker compose
set -euo pipefail
API=${1:-http://localhost:8080}
RUN=$(date +%s | tail -c 7)
fail() { echo "FAIL: $*"; exit 1; }
ok() { echo "PASS: $*"; }
sql() { docker compose exec -T db psql -U mesh -d mesh -tA -c "$1"; }
call() { # method path token [json]
  local out
  out=$(curl -s -w '\n%{http_code}' -X "$1" "$API$2" -H "authorization: Bearer ${3:-x}" \
    ${4:+-H 'content-type: application/json' -d "$4"})
  BODY=$(echo "$out" | sed '$d'); CODE=$(echo "$out" | tail -n1)
}
login() { call POST /api/auth/dev-token "" "{\"phone\":\"$1\",\"nickname\":\"$2\"}"; [ "$CODE" = 200 ] || fail "login $1 $CODE $BODY"; echo "$BODY"; }

call GET /health; [ "$BODY" = '{"ok":true,"version":"0.1.0"}' ] || fail "health $BODY"; ok "/health"

A=$(login "139${RUN}01" "冒烟A"); TA=$(echo "$A" | jq -r .token); UA=$(echo "$A" | jq -r .userId)
call GET /api/auth/me "$TA"; [ "$(echo "$BODY" | jq -r .userId)" = "$UA" ] || fail "me"; ok "注册 + /api/auth/me"

PROFILE='{"target":"稳定恋爱","data":{"stated":{"hometown":{"value":"杭州","source":"user","confidence":1},"hobbies":{"value":["徒步","摄影"],"source":"user","confidence":1},"height":{"value":"180","source":"user","confidence":1}},"revealed":{}}}'
call PUT /api/profile "$TA" "$PROFILE"; [ "$CODE" = 200 ] || fail "profile $BODY"
call GET /api/profile "$TA"; [ "$(echo "$BODY" | jq -r .target)" = "稳定恋爱" ] || fail "profile target"
call PUT /api/profile "$TA" '{"target":"交朋友"}'; [ "$CODE" = 400 ] || fail "非开放目标应 400"
ok "建档（目标仅开放两项）"

call POST /api/invites "$TA" "{\"inviteePhone\":\"139${RUN}09\",\"kind\":\"crush\"}"; [ "$CODE" = 200 ] || fail "invite $BODY"
CODE_INV=$(echo "$BODY" | jq -r .code)
call POST /api/invites "$TA" "{\"inviteePhone\":\"139${RUN}09\"}"; [ "$CODE" = 429 ] || fail "30 天去重 $CODE"
I=$(login "139${RUN}09" "被邀请人"); TI=$(echo "$I" | jq -r .token)
call GET /api/invites/inbox "$TI"; echo "$BODY" | jq -e 'length==1 and (.[0]|has("kind")|not)' >/dev/null || fail "inbox 泄露邀请类型 $BODY"
call POST "/api/invites/$CODE_INV/claim" "$TI"; [ "$CODE" = 200 ] || fail "claim $BODY"
call GET /api/invites "$TA"; echo "$BODY" | jq -e '.[0].status=="registered" and (.[0]|keys==["created_at","id","kind","status"])' >/dev/null || fail "inviter 视图 $BODY"
ok "搭桥邀请：发出 / 30 天去重 / 领取 / 邀请人只见状态"

call POST /api/recommendations/generate "$TA"; [ "$CODE" = 200 ] || fail "generate $CODE $BODY"
RID=$(echo "$BODY" | jq -r .id)
call POST /api/recommendations/generate "$TA"; [ "$CODE" = 409 ] || fail "同周第二次应 409"
SB=$(sql "select score_breakdown from recommendations where id='$RID'")
echo "$SB" | jq -e '.version=="p_mutual-v1" and (.p_mutual|type=="number") and .p_mutual>0 and ([.alignment_ab,.chemistry_ab,.alignment_ba,.chemistry_ba]|all(type=="number"))' >/dev/null || fail "score_breakdown $SB"
CAND_PHONE=$(sql "select u.phone from recommendations r join users u on u.id=r.candidate_id where r.id='$RID'")
CAND_TARGET=$(sql "select ct.target from recommendations r join connection_targets ct on ct.user_id=r.candidate_id where r.id='$RID'")
[ "$CAND_TARGET" = "稳定恋爱" ] || fail "目标硬过滤 $CAND_TARGET"
call GET /api/recommendations/current "$TA"
echo "$BODY" | jq -e '([.reasons[], (.candidate_snapshot|tostring)] | map(test("[0-9０-９]")) | any) | not' >/dev/null || fail "推荐卡含数字 $BODY"
echo "$BODY" | jq -e 'has("score_breakdown")|not' >/dev/null || fail "score 外泄"
ok "推荐：一人 / 同周 409 / 目标一致 / score_breakdown 落库 $(echo "$SB" | jq -c '{p_mutual,p_ab,p_ba}') / 卡片无数字"

B=$(login "$CAND_PHONE" ""); TB=$(echo "$B" | jq -r .token)
call POST "/api/recommendations/$RID/intent" "$TA" '{"choice":"interested"}'; echo "$BODY" | jq -e '.mutual==false' >/dev/null || fail "A intent"
call POST "/api/recommendations/$RID/intent" "$TB" '{"choice":"interested"}'; echo "$BODY" | jq -e '.mutual==true' >/dev/null || fail "B intent $BODY"
ok "双向意愿 → mutual"

call POST /api/video/rooms "$TA" "{\"recommendationId\":\"$RID\",\"scheduledAt\":\"2026-10-10T12:00:00Z\"}"; [ "$CODE" = 200 ] || fail "room $BODY"
ROOM=$(echo "$BODY" | jq -r .roomId)
call POST /api/video/rooms "$TB" "{\"recommendationId\":\"$RID\"}"; [ "$(echo "$BODY" | jq -r .roomId)" = "$ROOM" ] || fail "room 不固定"
call GET "/v/$ROOM" "$TB"; [ "$CODE" = 200 ] || fail "B 进房 $CODE"
call GET "/v/$ROOM" "$TI"; [ "$CODE" = 403 ] || fail "第三人应 403"
ok "视频房：固定房间号 / 双方可进 / 第三人 403"

# 盲选保密：候选人 pass，发起方与链接都看不出
C=$(login "139${RUN}02" "冒烟C"); TC=$(echo "$C" | jq -r .token)
call PUT /api/profile "$TC" '{"target":"奔着结婚认真谈","data":{"stated":{"hometown":{"value":"成都","source":"user","confidence":1}},"revealed":{}}}'
call POST /api/recommendations/generate "$TC"; [ "$CODE" = 200 ] || fail "C generate $BODY"
RC=$(echo "$BODY" | jq -r .id); LINK_TOKEN=$(echo "$BODY" | jq -r .link | sed 's#.*/##')
[ "$(sql "select ct.target from recommendations r join connection_targets ct on ct.user_id=r.candidate_id where r.id='$RC'")" = "奔着结婚认真谈" ] || fail "C 目标硬过滤"
D=$(login "$(sql "select u.phone from recommendations r join users u on u.id=r.candidate_id where r.id='$RC'")" ""); TD=$(echo "$D" | jq -r .token)
call POST "/api/recommendations/$RC/intent" "$TD" '{"choice":"pass"}'; [ "$CODE" = 200 ] || fail "D pass"
call POST "/api/recommendations/$RC/intent" "$TC" '{"choice":"interested"}'; echo "$BODY" | jq -e '.mutual==false' >/dev/null || fail "C intent"
call GET /api/recommendations/current "$TC"; [ "$(echo "$BODY" | jq -r .status)" != "passed" ] || fail "发起方从 /current 得知对方 pass"
call GET "/s/rec/$LINK_TOKEN"; [ "$(echo "$BODY" | jq -r .status)" != "passed" ] || fail "分享链接泄露 pass"
call POST /api/video/rooms "$TC" "{\"recommendationId\":\"$RC\"}"; [ "$CODE" = 403 ] || fail "未 mutual 不能建房"
ok "盲选保密：pass 不可见 / 未 mutual 不能建房"

call GET "/r/$LINK_TOKEN"; [ "$CODE" = 301 ] || fail "旧链接 301"; ok "/r/:token 301"
echo "ALL SMOKE CHECKS PASSED"
