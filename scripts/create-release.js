/**
 * GitHub Release 생성
 * 사용법: GITHUB_TOKEN=xxx node scripts/create-release.js
 *
 * 토큰: https://github.com/settings/tokens (repo 권한)
 */
const REPO = "PLUTO-NIX/slack-to-obsidian";
const TAG = "v1.1.0";
const RELEASE_BODY = `## KV Metadata 필터 최적화

### Added
- **KV Metadata 필터 최적화**: Cloudflare Workers KV Read 연산 대폭 감소
  - \`saveTodo\`: put 시 \`metadata: { status }\` 저장
  - \`listPendingTodos\`: list 결과의 metadata로 pending/updated만 필터 후 해당 키만 get
  - \`written\` 상태 키는 get 생략 → 키 100개 중 pending 2개 시 Read 100회 → 2회로 감소
  - metadata 없는 기존 키(레거시)는 get으로 status 확인 (하위 호환)

### Changed
- README에 KV 저장소 최적화 사양 문서화`;

async function createRelease() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN 환경 변수를 설정하세요.");
    console.error("예: $env:GITHUB_TOKEN='xxx'; node scripts/create-release.js");
    process.exit(1);
  }

  const res = await fetch(`https://api.github.com/repos/${REPO}/releases`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tag_name: TAG,
      name: `${TAG} - KV Metadata 필터 최적화`,
      body: RELEASE_BODY,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    if (res.status === 422 && err.includes("already_exists")) {
      console.log(`Release ${TAG} already exists.`);
      return;
    }
    throw new Error(`Release failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  console.log(`Release created: ${data.html_url}`);
}

createRelease().catch((e) => {
  console.error(e);
  process.exit(1);
});
