# Changelog

## [1.1.0] - 2026-03-01

### Added

- **KV Metadata 필터 최적화**: Cloudflare Workers KV Read 연산 대폭 감소
  - `saveTodo`: put 시 `metadata: { status }` 저장
  - `listPendingTodos`: list 결과의 metadata로 pending/updated만 필터 후 해당 키만 get
  - `written` 상태 키는 get 생략 → 키 100개 중 pending 2개 시 Read 100회 → 2회로 감소
  - metadata 없는 기존 키(레거시)는 get으로 status 확인 (하위 호환)

### Changed

- README에 KV 저장소 최적화 사양 문서화
