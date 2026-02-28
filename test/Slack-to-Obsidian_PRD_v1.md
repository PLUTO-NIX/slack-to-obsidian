# PRD: Slack-to-Obsidian Todo Automation

> 슬랙 메시지를 옵시디언 데일리 노트에 투두로 자동 등록하는 개인용 자동화 파이프라인

| 항목 | 내용 |
|------|------|
| Version | 1.0 |
| Date | 2026-02-27 |
| Author | Plutonix |
| Status | Draft |

---

## 1. 개요 (Overview)

### 1.1 배경 및 목적

슬랙에서 발생하는 업무 요청, 버그 리포트, 회의 후속 작업 등의 메시지를 빠르게 옵시디언 데일리 노트에 투두로 등록하여, 슬랙과 개인 태스크 관리 시스템 간의 간극을 제거한다.

### 1.2 핵심 가치

- 슬랙 컨텍스트를 벗어나지 않고 투두 등록 가능
- 메시지 원본 URL이 함께 기록되어 나중에 맥락 추적 가능
- AI가 메시지를 요약하거나, 직접 할 일을 입력할 수 있음
- 개인 전용 — 본인 외 사용 불가

### 1.3 프로젝트 정보

| 항목 | 내용 |
|------|------|
| 프로젝트명 | Slack-to-Obsidian Todo |
| 대상 사용자 | 본인 (1인) |
| AI 모델 | Google Gemini API |
| 옵시디언 동기화 | Obsidian Sync (로컬) |
| 데일리 노트 경로 | `03 Resource/Me & Life/Journal/Daily/` |
| 데일리 노트 형식 | `YYYY-MM-DD ddd` (e.g., `2026-02-27 Fri`) |

---

## 2. 시스템 아키텍처 (System Architecture)

### 2.1 전체 구성도

```
[Slack] ──→ [Cloudflare Worker] ──→ [Cloudflare KV]
             │                            ↑
             ├─ Slack 서명 검증            │
             ├─ User ID 체크              │
             ├─ Gemini API 호출           │
             └─ 투두 데이터 저장           │
                                          │
                              [Templater Startup Script]
                              (Obsidian 실행 시 자동 시작)
                              (setInterval로 주기적 KV 폴링)
                              (Obsidian API로 데일리 노트 직접 수정)
```

### 2.2 구성 요소

| Component | Technology | Role |
|-----------|-----------|------|
| 슬랙 커스텀 앱 | Slack API | 메시지 숏컷 + 이모지 이벤트 수신, 모달 UI 제공 |
| 서버리스 백엔드 | Cloudflare Workers | 웹훅 수신, 서명 검증, User ID 체크, Gemini 호출, KV 저장, KV 읽기 API 제공 |
| 임시 저장소 (큐) | Cloudflare KV | 투두 데이터 임시 저장, 중복 방지 키 |
| AI 요약 | Google Gemini API | 사용자 입력 없을 시 메시지 자동 요약 |
| 로컬 소비자 | Templater Startup Script | 주기적 KV 폴링, 데일리 노트 파일 직접 쓰기/수정 |

### 2.3 이전 구조 대비 변경점

Templater 스타트업 스크립트를 도입함으로써 다음 구성 요소가 **제거**되었다:

- ~~Cloudflare Tunnel~~ — 외부에서 PC로 들어올 필요 없음 (스크립트가 pull 방식)
- ~~별도 Node.js 프로세스~~ — Obsidian 내부에서 실행
- ~~OS 서비스 등록~~ (launchd / systemd / Task Scheduler) — Obsidian 실행 시 자동 시작

대신 Cloudflare Worker에 **KV 읽기/상태 업데이트용 API 엔드포인트**가 추가된다.

### 2.4 데이터 흐름 상세

**Case A: PC 켜져있을 때 (실시간)**

1. Slack에서 이모지/숏컷 트리거
2. Cloudflare Worker가 웹훅 수신
3. Slack 서명 검증 + User ID 체크
4. 필요 시 Gemini API로 메시지 요약
5. 마크다운 투두 텍스트 조립 → KV에 저장
6. Templater 스크립트가 주기적 폴링으로 KV에서 감지
7. Obsidian `app.vault` API로 데일리 노트에 append
8. Worker의 KV 상태 업데이트 API 호출 → 처리 완료 표시

**Case B: PC 꺼져있을 때 (모바일)**

1. 1~5단계 동일 (클라우드에서 즉시 처리)
2. KV에 투두가 대기 상태로 저장됨
3. Obsidian 실행 시 Templater 스크립트 자동 시작
4. 밀린 투두를 한꺼번에 데일리 노트에 쓰기

---

## 3. 기능 요구사항 (Functional Requirements)

### 3.1 트리거 방식 (Dual Trigger)

| | 이모지 리액션 | 메시지 숏컷 |
|---|---|---|
| **트리거** | 지정 이모지 반응 | ⋮ 메뉴 → 숏컷 선택 |
| **UX** | 클릭 1회 (빠름) | 클릭 3회 (정교함) |
| **사용자 입력** | 불가 (AI 자동 요약만) | 모달로 직접 입력 가능 |
| **용도** | 빠른 투두 등록 | 구체적 투두 작성 |

### 3.2 모달 UI (숏컷 방식만)

- **제목**: "투두로 보내기"
- **입력 필드**: 할 일 내용 (Optional, placeholder: "AI가 자동 요약합니다")
- **버튼**: 제출 / 취소
- **제출 후**: Slack ephemeral 메시지로 "투두가 등록되었습니다" 확인

### 3.3 AI 요약 로직

- **조건**: 숏컷 모달에서 입력값이 비어있거나, 이모지 방식으로 트리거된 경우
- **API**: Google Gemini API
- **프롬프트 요구사항**: 슬랙 메시지를 읽고, 해야 할 행동을 한 문장의 To-Do 형식으로 요약
- **출력 예시**: "프론트엔드 배포 전 QA 체크리스트 확인"

### 3.4 데일리 노트 출력 포맷

```markdown
- [ ] {AI 요약 또는 직접 입력} - [원본](https://slack.com/archives/C.../p...)
```

- **파일 경로**: `03 Resource/Me & Life/Journal/Daily/YYYY-MM-DD ddd.md`
- **위치**: 파일 맨 끝에 append
- **구분 키**: 슬랙 메시지 URL (고유값)

### 3.5 중복 방지 및 덮어쓰기

같은 메시지에 대해 이모지와 숏컷을 모두 사용할 경우의 처리 정책:

| 상황 | 동작 | 이유 |
|------|------|------|
| 이모지 → 이모지 | 두 번째 무시 | 이미 등록됨 |
| 숏컷 → 숏컷 | 두 번째 무시 | 이미 등록됨 |
| 이모지 → 숏컷 | **숏컷으로 덮어쓰기** | 직접 입력이 AI 요약보다 우선 |
| 숏컷 → 이모지 | 무시 | 이미 정교하게 입력됨 |

#### 3.5.1 덮어쓰기 처리 상세

- **KV에만 있는 경우**: KV 내용을 교체
- **이미 데일리 노트에 쓴 경우**: 파일에서 해당 슬랙 URL이 포함된 라인을 찾아서 통째로 교체

슬랙 메시지 URL이 투두 라인에 항상 포함되므로, 이를 검색 키로 사용하여 정확한 라인만 수정한다.

```
기존: - [ ] AI가 요약한 내용 - [원본](https://slack.com/archives/xxx/p123)
교체: - [ ] 내가 직접 쓴 내용 - [원본](https://slack.com/archives/xxx/p123)
```

---

## 4. 보안 (Security)

### 4.1 인증 및 권한

| 항목 | 내용 |
|------|------|
| Slack 서명 검증 | `X-Slack-Signature` 헤더로 모든 요청 검증. 슬랙 외부 요청 차단. |
| User ID 체크 | 허용된 사용자 ID (1인)만 통과. 미인가 시 에러 메시지 반환. |
| KV API 인증 | Templater 스크립트 → Worker API 호출 시 Bearer 토큰 검증 |
| API 키 관리 | 모든 키(Gemini, Slack Token, Bearer Token)는 환경변수/Secrets에 저장. |

### 4.2 비인가 사용자 처리

다른 팀원이 버튼을 누르는 경우:

- **숏컷**: 모달에 "개인용 앱입니다. 권한이 없습니다." 메시지 표시
- **이모지**: 조용히 무시 (피드백 채널 없음)

---

## 5. 기술 사양 (Technical Specification)

### 5.1 Slack 커스텀 앱 설정

- **App Name**: Obsidian Todo
- **Message Shortcut**: "투두로 보내기"
- **Event Subscription**: `reaction_added`
- **Interactivity URL**: Cloudflare Worker endpoint
- **OAuth Scopes**: `commands`, `chat:write`, `reactions:read`, `channels:history`, `groups:history`

### 5.2 Cloudflare Worker

- **역할**: 웹훅 수신, 슬랙 서명 검증, 사용자 검증, 모달 처리, Gemini API 호출, KV 저장, KV 읽기 API
- **언어**: JavaScript (ES Modules)
- **Bindings**: KV namespace (`TODO_QUEUE`), Environment variables (`SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, `GEMINI_API_KEY`, `ALLOWED_USER_ID`, `KV_API_TOKEN`)

**API 엔드포인트:**

| Method | Path | 설명 |
|--------|------|------|
| POST | `/slack/events` | Slack 웹훅 수신 (숏컷, 이모지, 모달 제출) |
| GET | `/api/todos?status=pending` | Pending 투두 목록 조회 (Templater용) |
| PATCH | `/api/todos/:key` | 투두 상태 업데이트 (Templater용) |

### 5.3 Cloudflare KV 스키마

| Field | Type | Description |
|-------|------|-------------|
| key | string | `todo:{channel_id}:{message_ts}` |
| todo_text | string | 투두 텍스트 (직접 입력 또는 AI 요약) |
| message_url | string | 슬랙 메시지 퍼마링크 |
| source | string | `"emoji"` \| `"shortcut"` |
| target_date | string | 대상 데일리 노트 날짜 (`YYYY-MM-DD ddd`) |
| status | string | `"pending"` \| `"written"` \| `"updated"` |
| created_at | string | ISO 8601 timestamp |

### 5.4 Templater Startup Script

- **위치**: 옵시디언 볼트 내 Templater 스크립트 폴더
- **실행 시점**: Obsidian 실행 시 자동 (Templater 설정 → Startup Templates)
- **폴링 주기**: 30초 간격 (`setInterval`, configurable)
- **라이프사이클**: Obsidian 실행 중 지속, 종료 시 자연스럽게 중단
- **파일 쓰기**: `app.vault.read()` / `app.vault.modify()`로 데일리 노트 직접 수정

**처리 로직:**

```
1. fetch → Worker의 GET /api/todos?status=pending
2. pending 투두가 있으면:
   a. 해당 날짜의 데일리 노트 파일 확인 (없으면 생성)
   b. 파일 내용 읽기
   c. 덮어쓰기 대상인지 확인 (URL로 기존 라인 검색)
   d. append 또는 라인 교체
   e. fetch → Worker의 PATCH /api/todos/:key (status → "written")
3. 30초 후 반복
```

---

## 6. 에러 처리 (Error Handling)

| 에러 상황 | 처리 방법 | 사용자 피드백 |
|-----------|-----------|--------------|
| Gemini API 실패 | 메시지 원본을 그대로 투두로 등록 | "요약 실패, 원본 텍스트로 등록됨" |
| 데일리 노트 파일 없음 | 새 파일 생성 후 쓰기 | 없음 (정상 처리) |
| Slack 서명 검증 실패 | 요청 거부 (401) | 없음 |
| KV 연결 실패 | 재시도 (3회) | "일시적 오류, 다시 시도해주세요" |
| KV API 인증 실패 | 요청 거부 (403) | Templater 콘솔에 에러 로그 |
| Templater 스크립트 fetch 실패 | 다음 폴링 주기에 재시도 | 없음 (백그라운드) |

---

## 7. 의존성 및 비용 (Dependencies & Costs)

| 서비스 | 무료 티어 | 비고 |
|--------|-----------|------|
| Cloudflare Workers | 10만 요청/일 | 개인 용도 충분 |
| Cloudflare KV | 읽기 10만/쓰기 1,000건/일 | 개인 용도 충분 |
| Slack App | 무료 | 워크스페이스당 1개 |
| Gemini API | 무료 티어 있음 | 요청당 소량 토큰 사용 |
| Obsidian Sync | 기존 구독 활용 | 추가 비용 없음 |
| Templater 플러그인 | 무료 | 커뮤니티 플러그인 |

**추가 비용: 없음** (모든 구성 요소가 무료 티어 내에서 운영 가능)

---

## 8. 구현 단계 (Implementation Phases)

### Phase 1: 기반 구축

1. Slack 커스텀 앱 생성 및 권한 설정
2. Cloudflare Worker 배포 (Slack 서명 검증 + User ID 체크)
3. Message Shortcut → 모달 → KV 저장 파이프라인 완성
4. Worker에 KV 읽기/상태 업데이트 API 엔드포인트 추가
5. Templater Startup Script 작성 (KV 폴링 → 파일 쓰기)

### Phase 2: AI + 이모지

6. Gemini API 연동 (입력값 없을 시 요약)
7. 이모지 리액션 이벤트 처리 추가
8. 중복 방지 로직 (`message_ts` 기반)

### Phase 3: 안정화 + UX

9. 덮어쓰기 로직 (이모지 → 숏컷 우선)
10. 데일리 노트 파일 내 라인 교체 로직
11. 에러 처리 및 재시도 로직
12. E2E 테스트

---

## 9. 제약사항 및 한계 (Constraints)

- 실시간 데일리 노트 반영은 **Obsidian이 실행 중일 때만** 가능하다.
- Obsidian이 꺼져있을 때는 KV에 대기하며, 실행 시 일괄 처리된다.
- 이모지 방식은 버튼 자체를 본인에게만 숨길 수 없다 (서버에서 필터링으로 대응).
- 데일리 노트 형식이 변경되면 Templater 스크립트의 경로 설정을 수정해야 한다.
- Templater 플러그인이 비활성화되면 폴링이 중단된다.

---

## 10. 향후 확장 가능성 (Future Considerations)

- 특정 채널/스레드별로 다른 노트 파일에 저장하는 라우팅 기능
- 투두 우선순위/태그 설정 모달 필드 추가
- 마감일 설정 및 리마인더 연동
- 다른 메신저(디스코드, 팀즈 등) 연동 확장
- 슬랙 스레드 전체를 요약하여 투두로 등록하는 기능

---

*— End of Document —*
