# TDD: Slack-to-Obsidian Todo Automation

> Technical Design Document — PRD v1.0 기반 기술 설계서

| 항목 | 내용 |
|------|------|
| Version | 1.0 |
| Date | 2026-02-27 |
| Author | Plutonix |
| Status | Draft |
| 관련 문서 | [PRD v1.0](./Slack-to-Obsidian_PRD_v1.md) |

---

## 1. 기술 스택 요약

| 레이어 | 기술 | 버전/사양 |
|--------|------|-----------|
| Slack App | Slack API (Block Kit, Events API) | Manifest v2 |
| Backend | Cloudflare Workers | ES Modules, Wrangler CLI |
| Storage | Cloudflare KV | `TODO_QUEUE` namespace |
| AI | Google Gemini API | `gemini-2.0-flash` (또는 최신 안정 모델) |
| Local Consumer | Obsidian Templater Plugin | Startup Template |
| Vault | Obsidian + Obsidian Sync | 로컬 파일 시스템 |

---

## 2. Slack 커스텀 앱 설계

### 2.1 App Manifest

```yaml
display_information:
  name: Obsidian Todo
  description: 슬랙 메시지를 옵시디언 투두로 보내기
  background_color: "#7C3AED"

features:
  shortcuts:
    - name: 투두로 보내기
      type: message
      callback_id: send_to_obsidian
      description: 이 메시지를 옵시디언 데일리 노트에 투두로 등록합니다

oauth_config:
  scopes:
    bot:
      - commands
      - chat:write
      - reactions:read
      - channels:history
      - groups:history
      - im:history
      - mpim:history

settings:
  event_subscriptions:
    request_url: https://<worker-domain>/slack/events
    bot_events:
      - reaction_added
  interactivity:
    is_enabled: true
    request_url: https://<worker-domain>/slack/events
```

### 2.2 이모지 설정

- **트리거 이모지**: `:obsidian-todo:` (커스텀 이모지 등록) 또는 기존 이모지 중 사용 빈도가 낮은 것 선택 (예: `📌`)
- **권장**: 커스텀 이모지로 혼동 방지

### 2.3 모달 UI (Block Kit)

```json
{
  "type": "modal",
  "callback_id": "todo_modal_submit",
  "title": { "type": "plain_text", "text": "투두로 보내기" },
  "submit": { "type": "plain_text", "text": "등록" },
  "close": { "type": "plain_text", "text": "취소" },
  "private_metadata": "{\"channel_id\":\"C...\",\"message_ts\":\"...\",\"message_text\":\"...\",\"permalink\":\"...\"}",
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*선택한 메시지:*\n> {message_text_preview}"
      }
    },
    {
      "type": "input",
      "block_id": "todo_input_block",
      "optional": true,
      "element": {
        "type": "plain_text_input",
        "action_id": "todo_text",
        "placeholder": { "type": "plain_text", "text": "비워두면 AI가 자동 요약합니다" },
        "multiline": false
      },
      "label": { "type": "plain_text", "text": "할 일" }
    }
  ]
}
```

**`private_metadata`에 포함되는 데이터:**

| 필드 | 설명 | 출처 |
|------|------|------|
| `channel_id` | 메시지가 속한 채널 ID | Shortcut payload의 `channel.id` |
| `message_ts` | 메시지 타임스탬프 (고유 ID) | Shortcut payload의 `message.ts` |
| `message_text` | 메시지 원본 텍스트 | Shortcut payload의 `message.text` |
| `permalink` | 메시지 퍼마링크 | `chat.getPermalink` API 호출로 획득 |

---

## 3. Cloudflare Worker 설계

### 3.1 프로젝트 구조

```
slack-obsidian-todo/
├── wrangler.toml
├── src/
│   ├── index.js            # 메인 라우터
│   ├── slack/
│   │   ├── verify.js       # Slack 서명 검증
│   │   ├── shortcut.js     # Message Shortcut 핸들러
│   │   ├── emoji.js        # Emoji Reaction 핸들러
│   │   ├── modal.js        # Modal 제출 핸들러
│   │   └── blocks.js       # Block Kit 빌더
│   ├── gemini/
│   │   └── summarize.js    # Gemini API 요약 호출
│   ├── kv/
│   │   ├── store.js        # KV 읽기/쓰기 헬퍼
│   │   └── dedup.js        # 중복 방지 로직
│   └── api/
│       └── todos.js        # Templater용 REST API
└── test/
    └── ...
```

### 3.2 wrangler.toml

```toml
name = "slack-obsidian-todo"
main = "src/index.js"
compatibility_date = "2026-02-01"

[[kv_namespaces]]
binding = "TODO_QUEUE"
id = "<KV_NAMESPACE_ID>"

[vars]
ALLOWED_USER_ID = "U_YOUR_SLACK_ID"
TRIGGER_EMOJI = "obsidian-todo"

# Secrets (wrangler secret put 으로 등록):
# SLACK_SIGNING_SECRET
# SLACK_BOT_TOKEN
# GEMINI_API_KEY
# KV_API_TOKEN
```

### 3.3 메인 라우터 (`src/index.js`)

```javascript
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;

    // ── Slack 웹훅 ──
    if (method === "POST" && url.pathname === "/slack/events") {
      return handleSlackEvent(request, env);
    }

    // ── Templater용 API ──
    if (url.pathname.startsWith("/api/todos")) {
      // Bearer 토큰 인증
      const authHeader = request.headers.get("Authorization");
      if (authHeader !== `Bearer ${env.KV_API_TOKEN}`) {
        return new Response("Unauthorized", { status: 403 });
      }

      if (method === "GET") {
        return handleGetTodos(request, env);
      }
      if (method === "PATCH") {
        return handleUpdateTodo(request, env);
      }
    }

    return new Response("Not Found", { status: 404 });
  }
};
```

### 3.4 Slack 이벤트 분기 로직

```javascript
async function handleSlackEvent(request, env) {
  const body = await request.text();
  const payload = JSON.parse(body);

  // 1. URL Verification (앱 설치 시 한 번)
  if (payload.type === "url_verification") {
    return Response.json({ challenge: payload.challenge });
  }

  // 2. Slack 서명 검증
  if (!await verifySlackSignature(request, body, env.SLACK_SIGNING_SECRET)) {
    return new Response("Invalid signature", { status: 401 });
  }

  // 3. Event API (이모지 리액션)
  if (payload.type === "event_callback" && payload.event.type === "reaction_added") {
    ctx.waitUntil(handleEmojiReaction(payload.event, env));
    return new Response("ok");
  }

  // 4. Interactivity (숏컷 트리거 또는 모달 제출)
  //    Slack은 interactivity payload를 form-encoded로 보냄
  const interactivePayload = JSON.parse(new URLSearchParams(body).get("payload"));

  if (interactivePayload.type === "message_action") {
    // Message Shortcut 트리거
    return handleShortcutTrigger(interactivePayload, env);
  }

  if (interactivePayload.type === "view_submission") {
    // 모달 제출
    ctx.waitUntil(handleModalSubmit(interactivePayload, env));
    return new Response();  // 200 빈 응답 = 모달 닫기
  }

  return new Response("ok");
}
```

> **참고**: Slack interactivity payload는 `application/x-www-form-urlencoded` 형식으로 `payload` 필드에 JSON 문자열이 담겨옵니다. Event API는 `application/json`으로 옵니다. 두 형식을 모두 처리해야 합니다.

### 3.5 Slack 서명 검증 (`src/slack/verify.js`)

```javascript
export async function verifySlackSignature(request, body, signingSecret) {
  const timestamp = request.headers.get("X-Slack-Request-Timestamp");
  const slackSignature = request.headers.get("X-Slack-Signature");

  // 5분 이상 된 요청은 리플레이 공격 방지를 위해 거부
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(sigBasestring)
  );
  const hexSignature = "v0=" + [...new Uint8Array(signature)]
    .map(b => b.toString(16).padStart(2, "0")).join("");

  return hexSignature === slackSignature;
}
```

### 3.6 User ID 체크

모든 핸들러 공통으로 적용:

```javascript
function checkUser(userId, env) {
  if (userId !== env.ALLOWED_USER_ID) {
    return false;
  }
  return true;
}
```

- **숏컷 핸들러**: `checkUser` 실패 시 → 에러 모달 (`views.open`)로 "개인용 앱입니다" 표시
- **이모지 핸들러**: `checkUser` 실패 시 → 조용히 `return` (아무 응답 없음)

### 3.7 Message Shortcut 핸들러 (`src/slack/shortcut.js`)

```javascript
export async function handleShortcutTrigger(payload, env) {
  const userId = payload.user.id;

  // 권한 체크
  if (!checkUser(userId, env)) {
    await openErrorModal(payload.trigger_id, env);
    return new Response();
  }

  // 메시지 퍼마링크 획득
  const permalink = await getPermalink(
    payload.channel.id,
    payload.message.ts,
    env.SLACK_BOT_TOKEN
  );

  // 모달 열기
  const modal = buildTodoModal({
    channelId: payload.channel.id,
    messageTs: payload.message.ts,
    messageText: payload.message.text,
    permalink: permalink,
  });

  await fetch("https://slack.com/api/views.open", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({
      trigger_id: payload.trigger_id,
      view: modal,
    }),
  });

  return new Response();
}

async function getPermalink(channelId, messageTs, token) {
  const res = await fetch(
    `https://slack.com/api/chat.getPermalink?channel=${channelId}&message_ts=${messageTs}`,
    { headers: { "Authorization": `Bearer ${token}` } }
  );
  const data = await res.json();
  return data.permalink;
}
```

### 3.8 모달 제출 핸들러 (`src/slack/modal.js`)

```javascript
export async function handleModalSubmit(payload, env) {
  const metadata = JSON.parse(payload.view.private_metadata);
  const userInput = payload.view.state.values
    .todo_input_block.todo_text.value;  // null if empty

  const { channelId, messageTs, messageText, permalink } = metadata;
  const kvKey = `todo:${channelId}:${messageTs}`;

  // 중복 체크 + 덮어쓰기 판단
  const existing = await env.TODO_QUEUE.get(kvKey, { type: "json" });
  if (existing && existing.source === "shortcut") {
    // 숏컷 → 숏컷: 무시
    await postEphemeral(channelId, payload.user.id, "이미 등록된 투두입니다.", env);
    return;
  }

  // 투두 텍스트 결정
  let todoText;
  if (userInput && userInput.trim()) {
    todoText = userInput.trim();
  } else {
    todoText = await summarizeWithGemini(messageText, env);
  }

  // KV 저장
  const todoData = {
    todo_text: todoText,
    message_url: permalink,
    source: "shortcut",
    target_date: formatDateForDailyNote(new Date()),
    status: existing ? "updated" : "pending",  // 덮어쓰기면 updated
    created_at: new Date().toISOString(),
    previous_text: existing?.todo_text || null,  // 덮어쓰기 시 이전 텍스트 보존
  };
  await env.TODO_QUEUE.put(kvKey, JSON.stringify(todoData));

  // Slack ephemeral 확인 메시지
  await postEphemeral(channelId, payload.user.id, "✅ 투두가 등록되었습니다.", env);
}
```

### 3.9 이모지 리액션 핸들러 (`src/slack/emoji.js`)

```javascript
export async function handleEmojiReaction(event, env) {
  // 이모지 필터
  if (event.reaction !== env.TRIGGER_EMOJI) return;

  // 권한 체크
  if (!checkUser(event.user, env)) return;

  const kvKey = `todo:${event.item.channel}:${event.item.ts}`;

  // 중복 체크
  const existing = await env.TODO_QUEUE.get(kvKey, { type: "json" });
  if (existing) return;  // 이미 등록됨 (이모지든 숏컷이든)

  // 메시지 원본 가져오기
  const messageText = await fetchMessageText(
    event.item.channel,
    event.item.ts,
    env.SLACK_BOT_TOKEN
  );

  // 퍼마링크 획득
  const permalink = await getPermalink(
    event.item.channel,
    event.item.ts,
    env.SLACK_BOT_TOKEN
  );

  // Gemini로 요약
  const todoText = await summarizeWithGemini(messageText, env);

  // KV 저장
  const todoData = {
    todo_text: todoText,
    message_url: permalink,
    source: "emoji",
    target_date: formatDateForDailyNote(new Date()),
    status: "pending",
    created_at: new Date().toISOString(),
    previous_text: null,
  };
  await env.TODO_QUEUE.put(kvKey, JSON.stringify(todoData));
}

async function fetchMessageText(channelId, messageTs, token) {
  const res = await fetch(
    `https://slack.com/api/conversations.history?channel=${channelId}&latest=${messageTs}&inclusive=true&limit=1`,
    { headers: { "Authorization": `Bearer ${token}` } }
  );
  const data = await res.json();
  return data.messages?.[0]?.text || "";
}
```

---

## 4. Gemini API 연동

### 4.1 요약 함수 (`src/gemini/summarize.js`)

```javascript
const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

export async function summarizeWithGemini(messageText, env) {
  const prompt = `다음 슬랙 메시지를 읽고, 내가 해야 할 행동을 한 문장의 To-Do 형식으로 요약해줘.
규칙:
- "~하기", "~확인", "~검토" 등 행동 중심으로 작성
- 15자~50자 사이로 작성
- 부가 설명 없이 투두 한 줄만 출력

슬랙 메시지:
${messageText}`;

  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 100,
        },
      }),
    });

    const data = await res.json();
    const summary = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!summary) throw new Error("Empty response from Gemini");
    return summary;

  } catch (error) {
    // 폴백: 원본 텍스트 앞부분 사용
    console.error("Gemini API error:", error);
    return messageText.slice(0, 80) + (messageText.length > 80 ? "..." : "");
  }
}
```

### 4.2 에러 폴백 전략

| 실패 유형 | 폴백 동작 |
|-----------|-----------|
| API 응답 없음 / 타임아웃 | 원본 텍스트 앞 80자 사용 |
| 빈 응답 (empty candidates) | 원본 텍스트 앞 80자 사용 |
| Rate limit (429) | 원본 텍스트 사용 + 로그 기록 |
| API 키 오류 (401/403) | 원본 텍스트 사용 + 로그 기록 |

모든 경우에 투두 등록 자체는 실패하지 않는다. 요약만 불가능할 뿐이다.

---

## 5. Cloudflare KV 설계

### 5.1 KV 키 설계

```
키 패턴:  todo:{channel_id}:{message_ts}
예시:     todo:C02ABC123:1709012345.678900
```

- `channel_id` + `message_ts` 조합은 슬랙 전체에서 고유하다.
- KV의 `list()` API로 `prefix: "todo:"` 검색이 가능하다.

### 5.2 KV Value 구조 (JSON)

```json
{
  "todo_text": "프론트엔드 배포 전 QA 체크리스트 확인",
  "message_url": "https://myworkspace.slack.com/archives/C02ABC123/p1709012345678900",
  "source": "emoji",
  "target_date": "2026-02-27 Fri",
  "status": "pending",
  "created_at": "2026-02-27T09:30:00.000Z",
  "previous_text": null
}
```

### 5.3 상태 흐름

```
pending ──→ written    (Templater가 데일리 노트에 최초 기록)
pending ──→ updated    (숏컷 덮어쓰기로 KV 값 변경됨)
updated ──→ written    (Templater가 데일리 노트에서 라인 교체 완료)
```

### 5.4 TTL (만료)

- `status: "written"` 상태인 항목은 **7일 후 자동 삭제** (KV `expirationTtl` 활용)
- 처리 완료 후 불필요한 데이터가 쌓이지 않도록 관리

```javascript
// 상태 업데이트 시 TTL 설정
await env.TODO_QUEUE.put(kvKey, JSON.stringify(data), {
  expirationTtl: 7 * 24 * 60 * 60  // 7일
});
```

---

## 6. Templater용 REST API

### 6.1 GET `/api/todos?status=pending`

Pending 및 Updated 상태의 투두 목록을 반환한다.

```javascript
export async function handleGetTodos(request, env) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "pending";

  // KV list로 모든 todo 키 조회
  const list = await env.TODO_QUEUE.list({ prefix: "todo:" });

  const todos = [];
  for (const key of list.keys) {
    const data = await env.TODO_QUEUE.get(key.name, { type: "json" });
    if (data && (data.status === "pending" || data.status === "updated")) {
      todos.push({ key: key.name, ...data });
    }
  }

  return Response.json({ todos });
}
```

**응답 예시:**

```json
{
  "todos": [
    {
      "key": "todo:C02ABC123:1709012345.678900",
      "todo_text": "프론트엔드 배포 전 QA 체크리스트 확인",
      "message_url": "https://...",
      "source": "emoji",
      "target_date": "2026-02-27 Fri",
      "status": "pending",
      "created_at": "2026-02-27T09:30:00.000Z",
      "previous_text": null
    }
  ]
}
```

### 6.2 PATCH `/api/todos/:key`

투두 상태를 업데이트한다 (Templater가 파일 쓰기 완료 후 호출).

```javascript
export async function handleUpdateTodo(request, env) {
  const url = new URL(request.url);
  const key = decodeURIComponent(url.pathname.replace("/api/todos/", ""));
  const body = await request.json();

  const existing = await env.TODO_QUEUE.get(key, { type: "json" });
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const updated = { ...existing, ...body };

  // written 상태면 TTL 설정
  const options = updated.status === "written"
    ? { expirationTtl: 7 * 24 * 60 * 60 }
    : {};

  await env.TODO_QUEUE.put(key, JSON.stringify(updated), options);
  return Response.json({ success: true });
}
```

---

## 7. Templater Startup Script

### 7.1 파일 위치

```
{vault}/
├── _templates/              ← Templater 템플릿 폴더
│   └── startup.md           ← Startup Template
└── 03 Resource/Me & Life/Journal/Daily/
    └── 2026-02-27 Fri.md    ← 데일리 노트
```

### 7.2 Templater 설정

- **Settings → Template folder location**: `_templates`
- **Settings → Startup Templates**: `startup.md` 추가
- **Settings → Enable Folder Templates**: 해당 없음 (Startup만 사용)

### 7.3 스크립트 코드 (`_templates/startup.md`)

```javascript
<%*
// ── 설정 ──
const CONFIG = {
  workerUrl: "https://slack-obsidian-todo.<your-subdomain>.workers.dev",
  apiToken: "YOUR_KV_API_TOKEN",          // Bearer 토큰
  pollInterval: 30000,                     // 30초
  dailyNotePath: "03 Resource/Me & Life/Journal/Daily",
};

// ── 유틸: 날짜 → 데일리 노트 파일명 ──
function dateToFilename(dateStr) {
  // "2026-02-27 Fri" → "2026-02-27 Fri.md"
  return `${dateStr}.md`;
}

// ── 유틸: 오늘 날짜를 데일리 노트 형식으로 ──
function todayFilename() {
  const d = new Date();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const ddd = days[d.getDay()];
  return `${yyyy}-${mm}-${dd} ${ddd}.md`;
}

// ── Pending 투두 가져오기 ──
async function fetchPendingTodos() {
  try {
    const res = await fetch(`${CONFIG.workerUrl}/api/todos?status=pending`, {
      headers: { "Authorization": `Bearer ${CONFIG.apiToken}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.todos || [];
  } catch (e) {
    console.error("[Obsidian Todo] Fetch error:", e);
    return [];
  }
}

// ── 투두 상태 업데이트 ──
async function markAsWritten(key) {
  try {
    await fetch(`${CONFIG.workerUrl}/api/todos/${encodeURIComponent(key)}`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${CONFIG.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "written" }),
    });
  } catch (e) {
    console.error("[Obsidian Todo] Update error:", e);
  }
}

// ── 투두 라인 포맷 ──
function formatTodoLine(todo) {
  return `- [ ] ${todo.todo_text} - [원본](${todo.message_url})`;
}

// ── 데일리 노트에 쓰기 ──
async function writeToDailyNote(todo) {
  const filename = dateToFilename(todo.target_date);
  const filepath = `${CONFIG.dailyNotePath}/${filename}`;
  const todoLine = formatTodoLine(todo);

  // 파일 존재 확인
  let file = app.vault.getAbstractFileByPath(filepath);

  if (!file) {
    // 파일 없으면 생성
    await app.vault.create(filepath, todoLine + "\n");
    return;
  }

  // 파일 내용 읽기
  let content = await app.vault.read(file);

  if (todo.status === "updated" && todo.message_url) {
    // 덮어쓰기: URL로 기존 라인 찾아서 교체
    const lines = content.split("\n");
    const urlPattern = todo.message_url;
    let replaced = false;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(urlPattern)) {
        lines[i] = todoLine;
        replaced = true;
        break;
      }
    }

    if (replaced) {
      await app.vault.modify(file, lines.join("\n"));
    } else {
      // URL을 찾지 못한 경우 → append
      await app.vault.modify(file, content.trimEnd() + "\n" + todoLine + "\n");
    }
  } else {
    // 신규 등록: 맨 끝에 append
    await app.vault.modify(file, content.trimEnd() + "\n" + todoLine + "\n");
  }
}

// ── 메인 폴링 루프 ──
async function pollAndProcess() {
  const todos = await fetchPendingTodos();

  for (const todo of todos) {
    await writeToDailyNote(todo);
    await markAsWritten(todo.key);
  }

  if (todos.length > 0) {
    new Notice(`📌 ${todos.length}개의 투두가 등록되었습니다.`);
  }
}

// ── 시작 ──
// 즉시 1회 실행 (Obsidian 시작 시 밀린 투두 처리)
await pollAndProcess();

// 주기적 폴링 시작
const intervalId = setInterval(pollAndProcess, CONFIG.pollInterval);

// Obsidian 종료 시 정리 (선택적)
this.registerInterval(intervalId);
%>
```

### 7.4 핵심 로직 설명

| 함수 | 역할 |
|------|------|
| `fetchPendingTodos()` | Worker API에서 pending/updated 투두 목록 가져오기 |
| `writeToDailyNote(todo)` | `app.vault`로 데일리 노트 파일에 쓰기 (신규 append 또는 라인 교체) |
| `markAsWritten(key)` | Worker API에 처리 완료 알림 (status → "written") |
| `formatTodoLine(todo)` | 마크다운 투두 라인 포맷팅 |
| `pollAndProcess()` | 전체 사이클 1회 실행 |

### 7.5 `this.registerInterval()` 참고

Templater에서 `this.registerInterval()`을 사용하면 Obsidian의 컴포넌트 라이프사이클에 인터벌이 등록되어, 플러그인 비활성화 또는 Obsidian 종료 시 자동으로 `clearInterval`이 호출된다. 메모리 누수를 방지하는 안전장치이다.

> **주의**: `this.registerInterval()`이 Templater Startup Template 컨텍스트에서 사용 가능한지 실제 테스트가 필요하다. 사용 불가 시 전역 변수에 `intervalId`를 저장하고 수동 정리하거나, Obsidian의 `app.workspace.on('quit', ...)` 이벤트를 활용한다.

---

## 8. 유틸리티 함수

### 8.1 날짜 포맷 (`YYYY-MM-DD ddd`)

Worker 측에서 사용:

```javascript
export function formatDateForDailyNote(date) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const ddd = days[date.getDay()];
  return `${yyyy}-${mm}-${dd} ${ddd}`;
}
```

### 8.2 Slack Ephemeral 메시지

```javascript
export async function postEphemeral(channelId, userId, text, env) {
  await fetch("https://slack.com/api/chat.postEphemeral", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({ channel: channelId, user: userId, text }),
  });
}
```

---

## 9. 중복 방지 의사결정 테이블

Worker에서 KV에 저장하기 전에 적용하는 로직:

```
기존 KV 데이터    새 요청      판정
──────────────    ────────    ────────────────────────
없음              이모지       → 저장 (pending)
없음              숏컷         → 저장 (pending)
emoji/pending     이모지       → 무시
emoji/pending     숏컷         → 덮어쓰기 (updated)
emoji/written     이모지       → 무시
emoji/written     숏컷         → 덮어쓰기 (updated)
shortcut/*        이모지       → 무시
shortcut/*        숏컷         → 무시
```

```javascript
export function shouldProcess(existing, newSource) {
  if (!existing) return { action: "create" };

  // 숏컷 → 이모지 기존 덮어쓰기 허용
  if (existing.source === "emoji" && newSource === "shortcut") {
    return { action: "overwrite" };
  }

  return { action: "ignore" };
}
```

---

## 10. 보안 상세

### 10.1 Slack 서명 검증 흐름

```
Slack 서버
  │
  ├─ X-Slack-Request-Timestamp: 1709012345
  ├─ X-Slack-Signature: v0=abc123...
  └─ Body: { ... }

Worker에서:
  1. timestamp가 현재 시간 ± 5분 이내인지 확인
  2. "v0:{timestamp}:{body}" 문자열을 HMAC-SHA256으로 서명
  3. 계산된 서명 vs X-Slack-Signature 비교
  4. 불일치 시 401 반환
```

### 10.2 KV API 토큰

- Templater 스크립트 → Worker API 호출 시 `Authorization: Bearer {token}` 헤더 사용
- 토큰은 충분히 긴 랜덤 문자열 사용 (최소 32자)
- Worker 환경변수 `KV_API_TOKEN`에 저장
- Templater 스크립트의 `CONFIG.apiToken`에 동일 값 설정

### 10.3 CORS

Templater 스크립트는 Obsidian 내부에서 `fetch`를 호출하므로 브라우저 CORS 정책이 적용될 수 있다. Worker에서 CORS 헤더를 반환해야 한다:

```javascript
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

// OPTIONS preflight 처리
if (request.method === "OPTIONS") {
  return new Response(null, { headers: corsHeaders });
}

// 모든 API 응답에 CORS 헤더 추가
return Response.json(data, { headers: corsHeaders });
```

> **보안 참고**: `Allow-Origin: *`이지만 Bearer 토큰 인증이 있으므로 실질적 보안은 유지된다. 더 엄격하게 하려면 특정 Origin으로 제한할 수 있으나, Obsidian의 Origin이 일정하지 않을 수 있어 `*`이 현실적이다.

---

## 11. 배포 가이드

### 11.1 사전 준비

| 항목 | 설명 |
|------|------|
| Cloudflare 계정 | 무료 계정 생성 |
| Wrangler CLI | `npm install -g wrangler` |
| Slack 워크스페이스 | 앱 설치 권한 필요 |
| Gemini API 키 | [Google AI Studio](https://aistudio.google.com/)에서 발급 |
| Obsidian + Templater | 커뮤니티 플러그인에서 설치 |

### 11.2 배포 순서

```
1. Cloudflare KV 네임스페이스 생성
   $ wrangler kv namespace create TODO_QUEUE

2. wrangler.toml에 KV namespace ID 입력

3. Secrets 등록
   $ wrangler secret put SLACK_SIGNING_SECRET
   $ wrangler secret put SLACK_BOT_TOKEN
   $ wrangler secret put GEMINI_API_KEY
   $ wrangler secret put KV_API_TOKEN

4. Worker 배포
   $ wrangler deploy

5. Slack App 생성 (api.slack.com/apps)
   - Manifest 붙여넣기 (Worker URL 반영)
   - 워크스페이스에 설치
   - Bot Token 확인 → SLACK_BOT_TOKEN으로 사용

6. Templater Startup Script 설정
   - _templates/startup.md 생성
   - CONFIG에 Worker URL, API 토큰 입력
   - Templater 설정에서 Startup Template 등록

7. 테스트
   - Slack에서 메시지에 숏컷 사용 → 모달 → 제출
   - 데일리 노트에 투두가 추가되는지 확인
```

---

## 12. 테스트 계획

### 12.1 단위 테스트

| 대상 | 테스트 항목 |
|------|-------------|
| `verifySlackSignature` | 유효한 서명 통과, 잘못된 서명 거부, 만료된 타임스탬프 거부 |
| `shouldProcess` | 의사결정 테이블의 모든 조합 검증 |
| `formatDateForDailyNote` | 각 요일별 올바른 포맷 출력 |
| `summarizeWithGemini` | 정상 응답 파싱, API 실패 시 폴백 동작 |
| `formatTodoLine` | 마크다운 포맷 정확성 |

### 12.2 통합 테스트

| 시나리오 | 검증 항목 |
|----------|-----------|
| 숏컷 → 직접 입력 | KV 저장 → 데일리 노트 append 확인 |
| 숏컷 → AI 요약 | Gemini 호출 → KV 저장 → 데일리 노트 확인 |
| 이모지 트리거 | 이벤트 수신 → Gemini 호출 → KV 저장 확인 |
| 이모지 → 숏컷 덮어쓰기 | KV 덮어쓰기 → 데일리 노트 라인 교체 확인 |
| 비인가 사용자 숏컷 | 에러 모달 표시, KV 변화 없음 |
| 비인가 사용자 이모지 | KV 변화 없음 |
| PC 꺼진 상태에서 등록 | KV에 pending으로 저장됨 확인 |
| Obsidian 시작 | 밀린 투두 일괄 처리 확인 |
| Gemini API 실패 | 원본 텍스트 폴백으로 저장됨 확인 |
| 데일리 노트 파일 없음 | 새 파일 생성 후 쓰기 확인 |

### 12.3 E2E 테스트 체크리스트

```
[ ] Slack 앱이 워크스페이스에 정상 설치됨
[ ] 메시지 컨텍스트 메뉴에 "투두로 보내기" 표시됨
[ ] 숏컷 클릭 시 모달이 열림
[ ] 모달 제출 시 ephemeral 확인 메시지 표시
[ ] 이모지 리액션 시 투두가 KV에 저장됨
[ ] Templater 폴링이 정상 작동 (Obsidian 콘솔 로그 확인)
[ ] 데일리 노트에 올바른 포맷으로 투두 추가됨
[ ] 중복 트리거 시 무시됨
[ ] 덮어쓰기 시 기존 라인이 교체됨
[ ] 비인가 사용자 접근 시 적절히 거부됨
```

---

*— End of Document —*
