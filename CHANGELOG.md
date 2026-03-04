# Changelog

## [2.0.0] - 2026-03-04

### Added

- **멀티유저 지원**: 첫 사용 시 자동 등록, 유저별 API 토큰 발급
  - `src/user/registry.js` — 유저 등록/조회, 토큰 생성
  - `src/user/auth.js` — Bearer 토큰 인증
  - 유저별 KV 격리: `todo:{userId}:{channelId}:{messageTs}`
  - 유저별 pending 인덱스: `idx:pending:{userId}`
- **설정 전역 숏컷**: "Obsidian Todo 설정" → 모달에서 API 토큰 확인
  - `src/slack/settings.js` — 설정 숏컷 핸들러
  - `blocks.js` — `buildSettingsModal`, `buildRegistrationGuideModal`
- **KV 마이그레이션 스크립트**: `scripts/migrate-to-multiuser.js`
- **유닛 테스트**: registry, auth, store 모듈

### Changed

- **보안**: 서명 비교를 constant-time XOR로 변경 (타이밍 공격 방지)
- **보안**: PATCH API에 `status:"written"` 화이트리스트 + 키 소유권 검증
- **보안**: `ALLOWED_USER_ID` 단일 유저 체크 제거 → 유저별 토큰 인증으로 대체
- **안정성**: `fetchMessageText`가 `reactions.get`을 사용하도록 변경 (스레드 답글 지원)
- **안정성**: KV 인덱스 stale 키 자동 정리
- **Templater**: 데일리 노트 / 헤딩 없으면 skip (pending 유지, 다음 폴링에서 재시도)
- **Templater**: 투두별 try-catch로 에러 격리 (하나 실패해도 나머지 계속 처리)
- **Templater**: `writeTodo` 반환값으로 성공 여부 확인 후 `markWritten` 호출

### Removed

- `ALLOWED_USER_ID` 환경변수 (wrangler.toml)
- `KV_API_TOKEN` 단일 시크릿 인증 (유저별 토큰으로 대체)

### Migration

기존 배포에서 업그레이드 시:
1. `KV_API_TOKEN=기존토큰 node scripts/migrate-to-multiuser.js`
2. `wrangler deploy`
3. Slack 앱 매니페스트 업데이트 (전역 숏컷 추가)

---

## [1.1.0] - 2026-03-01

### Added

- **KV Metadata 필터 최적화**: Cloudflare Workers KV Read 연산 대폭 감소
  - `saveTodo`: put 시 `metadata: { status }` 저장
  - `listPendingTodos`: list 결과의 metadata로 pending/updated만 필터 후 해당 키만 get
  - `written` 상태 키는 get 생략 → 키 100개 중 pending 2개 시 Read 100회 → 2회로 감소
  - metadata 없는 기존 키(레거시)는 get으로 status 확인 (하위 호환)

### Changed

- README에 KV 저장소 최적화 사양 문서화
