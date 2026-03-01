# Slack-to-Obsidian Todo

슬랙 메시지를 옵시디언 데일리 노트에 투두로 자동 등록하는 개인용 자동화 파이프라인.

---

## 목차

- [아키텍처](#아키텍처)
- [사전 준비](#사전-준비)
- [셋업 (처음부터 순서대로)](#셋업-처음부터-순서대로)
- [설정 참조](#설정-참조)
- [사용법](#사용법)
- [트러블슈팅](#트러블슈팅)
- [개발](#개발)

---

## 아키텍처

```
[Slack] ──→ [Cloudflare Worker] ──→ [Cloudflare KV]
             │                            ↑
             ├─ Slack 서명 검증            │
             ├─ User ID 체크              │
             ├─ Gemini API (메시지 요약)   │
             └─ 투두 데이터 저장           │
                                          │
                              [Templater Startup Script]
                              (Obsidian 실행 시 자동, 30초 폴링)
                                          │
                                          ↓
                              [Obsidian 데일리 노트]
```

- **Slack**: 이모지 리액션 또는 메시지 숏컷 → Worker로 전송
- **Worker**: 서명 검증, Gemini 요약, KV 저장, Templater용 API 제공
- **Templater**: 30초마다 KV 폴링 → 데일리 노트에 투두 추가

---

## 사전 준비

| 항목 | 설명 |
|------|------|
| Cloudflare 계정 | https://dash.cloudflare.com |
| Slack 워크스페이스 | 앱 설치 권한 필요 |
| Google 계정 | Gemini API 키 발급용 |
| Obsidian | Templater 플러그인 설치 |

---

## 셋업

> 의존성 순서: **자격 증명 수집 → Worker 설정·배포 → 외부 연동 → 확인**

```
Phase 1  Wrangler 설치·로그인
Phase 2  Worker 초기 배포 ──→ Worker URL 획득
Phase 3  Slack 앱 생성 ──────→ Signing Secret, Bot Token, User ID 획득
Phase 4  Gemini API 키 발급 ─→ API Key 획득
Phase 5  KV_API_TOKEN 생성 ──→ 랜덤 토큰 (메모 필수, Phase 7에서 재사용)
         ────────────────── 자격 증명 수집 완료 ──────────────────
Phase 6  Worker 설정·최종 배포 (wrangler.toml vars + Secrets 등록 + deploy)
         ────────────────── Worker 가동 ──────────────────
Phase 7  Obsidian Templater 연동 (Worker URL + KV_API_TOKEN 필요)
Phase 8  Slack 커스텀 이모지 등록
Phase 9  동작 확인
```

---

### Phase 1: Wrangler 설치·로그인

```bash
npm install -g wrangler
wrangler login
```

### Phase 2: Worker 초기 배포 → Worker URL 획득

```bash
cd slack-obsidian-todo

# KV 네임스페이스 생성 (이미 있으면 생략)
wrangler kv namespace create TODO_QUEUE
# → 출력된 id를 wrangler.toml의 [[kv_namespaces]] id에 입력

# 초기 배포 (Secrets 없이 URL만 확보하는 목적)
wrangler deploy
# → 예: https://slack-to-obsidian.xxxx.workers.dev  ← 메모
```

### Phase 3: Slack 앱 생성 → Signing Secret, Bot Token, User ID 획득

> Phase 2의 Worker URL이 필요 — Slack이 앱 생성 시 `request_url`로 검증 요청을 보내므로,
> Worker가 배포되어 있어야 한다.

1. **Manifest 준비**
   - `slack-app-manifest.yaml`에서 `YOUR-WORKER-DOMAIN` 2곳을 Phase 2의 도메인으로 치환
   - 예: `YOUR-WORKER-DOMAIN` → `slack-to-obsidian.xxxx.workers.dev` (`https://` 제외)

2. **앱 생성·설치**
   - https://api.slack.com/apps → Create New App → From a manifest
   - 워크스페이스 선택 → 수정한 Manifest 붙여넣기 → Create
   - Install to Workspace → 권한 승인

3. **자격 증명 복사** (3개 모두 메모)
   - **Basic Information** → App Credentials → Signing Secret (Show) → 복사
   - **OAuth & Permissions** → Bot User OAuth Token (`xoxb-...`) → 복사
   - **본인 프로필** → More → Copy member ID (`U05FDHF9FCL` 형식) → 복사

4. **봇을 채널에 초대**
   - 투두로 등록할 메시지가 올라오는 채널에서 `/invite @Obsidian Todo`
   - 봇이 채널 멤버여야 `reaction_added` 이벤트 수신 + 메시지 원본 조회 가능

### Phase 4: Gemini API 키 발급

1. https://aistudio.google.com/ 접속
2. Get API key → Create API key → 복사 (메모)

### Phase 5: KV_API_TOKEN 생성

Templater와 Worker 간 인증에 사용할 토큰을 직접 생성한다.

```bash
# 예시: 32자 이상 랜덤 문자열
node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"
# → 메모 (Phase 6에서 Secret 등록, Phase 7에서 Templater CONFIG에 입력)
```

### Phase 6: Worker 설정·최종 배포

> Phase 3~5에서 수집한 자격 증명이 모두 필요

**1) wrangler.toml 환경 변수 설정**

```toml
[vars]
ALLOWED_USER_ID = "U05FDHF9FCL"   # Phase 3에서 복사한 본인 User ID
TRIGGER_EMOJI = "hg-todo"         # 커스텀 이모지 이름 (: 제외)
```

**2) Secrets 등록** (각 명령 실행 후 값 붙여넣기)

```bash
wrangler secret put SLACK_SIGNING_SECRET   # Phase 3
wrangler secret put SLACK_BOT_TOKEN        # Phase 3
wrangler secret put GEMINI_API_KEY         # Phase 4
wrangler secret put KV_API_TOKEN           # Phase 5
```

> **주의**: `wrangler.toml`에 Secret 값을 절대 적지 말 것. Git에 노출됨.

**3) 최종 배포**

```bash
wrangler deploy
```

### Phase 7: Obsidian + Templater 연동

> Phase 2의 Worker URL, Phase 5의 KV_API_TOKEN이 필요

1. **Templater 플러그인**
   - Obsidian 설정 → Community plugins → Templater 설치·활성화
   - Template folder: `_templates` (또는 사용 중인 폴더)

2. **Startup 스크립트**
   - `Slack To Obsidian Script.md`를 볼트의 `_templates` 폴더에 복사

3. **CONFIG 수정** (스크립트 내부)

```javascript
const CONFIG = {
  workerUrl: "https://slack-to-obsidian.xxxx.workers.dev",  // Phase 2
  apiToken: "YOUR_KV_API_TOKEN",   // Phase 5와 동일한 값
  pollInterval: 30000,
  dailyNotePath: "03 Resource/Me & Life/Journal/Daily",  // 본인 데일리 노트 경로
  insertAfter: "### Today",  // 이 헤딩 다음 줄에 투두 추가
};
```

4. **Startup Template 등록**
   - Obsidian 설정 → Templater → Startup Templates에 해당 파일 추가
   - Obsidian 재시작

### Phase 8: Slack 커스텀 이모지

1. Slack 워크스페이스 설정 → Customize [워크스페이스명]
2. Emoji 탭 → Add Custom Emoji
3. 이름: `hg-todo` (wrangler.toml의 TRIGGER_EMOJI와 일치)
4. 이미지 업로드 후 저장

### Phase 9: 동작 확인

1. 봇이 초대된 채널에서 메시지 **⋮** → **Add to Todo** → 모달에서 등록
2. 같은 채널에서 메시지에 `:hg-todo:` 이모지 → 자동 등록 확인
3. Obsidian 실행 후 30초 이내에 데일리 노트에 투두 추가되는지 확인

> 동작하지 않으면: `wrangler tail`로 실시간 로그 확인 → [트러블슈팅](#트러블슈팅) 참조

---

## 설정 참조

### wrangler.toml

| 항목 | 설명 |
|------|------|
| `name` | Worker 이름 (URL에 반영) |
| `ALLOWED_USER_ID` | 본인 Slack User ID (1인만 허용) |
| `TRIGGER_EMOJI` | 이모지 트리거 이름 (`:` 제외) |

### Slack Manifest (slack-app-manifest.yaml)

- `request_url`: Worker URL + `/slack/events`
- `event_subscriptions`, `interactivity` 두 곳 모두 동일 URL

### Templater CONFIG

| 항목 | 설명 |
|------|------|
| `workerUrl` | 배포된 Worker URL |
| `apiToken` | `KV_API_TOKEN`과 동일 |
| `dailyNotePath` | 데일리 노트 폴더 경로 |
| `insertAfter` | 투두 삽입 위치 헤딩 (예: `### Today`) |

### 데일리 노트 형식

- **파일명**: `YYYY-MM-DD dd.md` (로케일 자동 적용)
  - 한국어: `2026-02-28 토.md`
  - 영어: `2026-02-28 S.md` (narrow)
- **투두 포맷**: `- [ ] {내용} - [원본](슬랙_URL)`

---

## 사용법

| 방식 | 동작 |
|------|------|
| **이모지** | 메시지에 `:hg-todo:` 추가 → AI 자동 요약 |
| **숏컷** | 메시지 ⋮ → "Add to Todo" → 직접 입력 또는 AI 요약 |

---

## 트러블슈팅

### HMAC key length (0) 에러

- **원인**: `SLACK_SIGNING_SECRET` 미등록 또는 빈 값
- **조치**: `wrangler secret put SLACK_SIGNING_SECRET` 후 Slack Basic Information에서 Signing Secret 복사해 등록

### invalid_auth (Slack API)

- **원인**: `SLACK_BOT_TOKEN` 잘못됨 또는 만료
- **조치**: OAuth & Permissions에서 Bot Token 확인, 필요 시 Reinstall to Workspace 후 새 토큰으로 `wrangler secret put SLACK_BOT_TOKEN`

### Gemini API 404

- **원인**: deprecated 모델 사용 (gemini-2.0-flash 등)
- **조치**: `src/gemini/summarize.js`의 `MODELS_TO_TRY`에 사용 가능한 모델만 포함 (gemini-2.5-flash, gemini-flash-latest 등)

### 이모지 반응해도 투두가 안 만들어짐

- **원인**: 봇이 해당 채널의 멤버가 아님
- **조치**: 채널에서 `/invite @Obsidian Todo` 실행. 봇이 채널에 있어야 `reaction_added` 이벤트 수신 및 메시지 원본 조회 가능

### Unauthorized (API 호출)

- **원인**: Templater의 `apiToken`과 Worker의 `KV_API_TOKEN` 불일치
- **조치**: 두 값을 동일하게 맞추고 `wrangler secret put KV_API_TOKEN` 재등록

### Obsidian에 투두가 안 들어옴

1. `curl -H "Authorization: Bearer YOUR_TOKEN" "https://YOUR-WORKER/api/todos?status=pending"` 로 pending 확인
2. Templater CONFIG의 `workerUrl`, `apiToken`, `dailyNotePath` 확인
3. Obsidian 실행 중인지, Startup Template 등록 여부 확인
4. `dailyNotePath`가 볼트 내 실제 경로와 일치하는지 확인

### 디버깅

```bash
wrangler tail   # 실시간 로그 (터미널 종료해도 Worker 동작에는 영향 없음)
```

---

## 개발

### 프로젝트 구조

```
slack-obsidian-todo/
├── src/
│   ├── index.js          # 메인 라우터
│   ├── slack/            # Slack 핸들러 (verify, shortcut, emoji, modal)
│   ├── gemini/           # Gemini 요약
│   ├── kv/               # KV 저장/중복 방지
│   ├── api/              # Templater용 REST API
│   └── utils.js
├── test/                 # 단위 테스트
├── wrangler.toml
├── slack-app-manifest.yaml
└── Slack To Obsidian Script.md
```

### KV 저장소 (Metadata 필터 최적화)

Cloudflare Workers KV 무료 티어 일일 Read 한도(100,000회)를 절약하기 위해 **metadata 필터**를 적용했다.

| 항목 | 설명 |
|------|------|
| **키 형식** | `todo:{channelId}:{messageTs}` — 슬랙 메시지 1개당 1키 |
| **metadata** | `put` 시 `status` 저장 → `list` 결과로 필터링 |
| **Read 최적화** | `written` 키는 `get` 생략, `pending`/`updated`만 조회 |

**GET /api/todos 호출당 KV 연산:**

- **이전**: List 1 + Read N (전체 키)
- **이후**: List 1 + Read M (pending/updated만, M ≪ N)

예: 키 100개 중 pending 2개 → Read 100회 → **2회**로 감소.

### 테스트

```bash
npm test
```

### 배포 후

- Worker는 Cloudflare에서 24/7 실행
- 터미널을 꺼도 동작함
- Obsidian만 실행 중이면 Templater가 30초마다 폴링

---

## 참고 문서

- [PRD](test/Slack-to-Obsidian_PRD_v1.md)
- [TDD](test/Slack-to-Obsidian_TDD_v1.md)
