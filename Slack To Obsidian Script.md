<%*
// ════════════════════════════════════════════════
// Slack To Obsidian — Templater Startup Script
// 이 파일을 볼트의 템플릿 폴더에 넣고,
// Templater 설정 → Startup Templates에 등록하세요.
// ════════════════════════════════════════════════

// ── 설정 ──
const CONFIG = {
  workerUrl: "https://YOUR-WORKER-DOMAIN",
  apiToken: "YOUR_API_TOKEN",  // Slack에서 전역 숏컷 "Obsidian Todo 설정"으로 확인
  pollInterval: 30000,  // 30초
  dailyNotePath: "YOUR/DAILY/NOTE/PATH",
  insertAfter: "### Today",  // 이 헤딩 다음 줄에 투두 추가
};

// ── 유틸: YYYY-MM-DD → 데일리 노트 파일 경로 (날짜 접두어로 검색, 로케일 무관) ──
function toFilePath(dateStr) {
  const datePart = dateStr.split(" ")[0];
  const folder = app.vault.getAbstractFileByPath(CONFIG.dailyNotePath);
  if (folder && folder.children) {
    const match = folder.children.find(
      (f) => f.name.startsWith(datePart) && f.name.endsWith(".md")
    );
    if (match) return match.path;
  }
  return null;
}

// ── 유틸: 투두 마크다운 라인 포맷 ──
function formatLine(todo) {
  return `- [ ] ${todo.todo_text} - [원본](${todo.message_url})`;
}

// ── Worker API: Pending 투두 가져오기 ──
async function fetchPending() {
  try {
    const res = await requestUrl({
      url: `${CONFIG.workerUrl}/api/todos?status=pending`,
      method: "GET",
      headers: { "Authorization": `Bearer ${CONFIG.apiToken}` },
    });
    const data = JSON.parse(res.text);
    return data.todos || [];
  } catch (e) {
    console.error("[SlackTodo] fetch error:", e);
    return [];
  }
}

// ── Worker API: 상태 업데이트 ──
async function markWritten(key) {
  try {
    await requestUrl({
      url: `${CONFIG.workerUrl}/api/todos/${encodeURIComponent(key)}`,
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${CONFIG.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "written" }),
    });
  } catch (e) {
    console.error("[SlackTodo] update error:", e);
  }
}

// ── 데일리 노트에 쓰기 ──
async function writeTodo(todo) {
  const filepath = toFilePath(todo.target_date);
  const line = formatLine(todo);

  // 파일 없으면 skip (pending 유지, 다음 폴링에서 재시도)
  if (!filepath) {
    console.log(`[SlackTodo] Daily note not found for date: ${todo.target_date}`);
    return false;
  }

  let file = app.vault.getAbstractFileByPath(filepath);
  if (!file) {
    console.log(`[SlackTodo] Daily note not found: ${filepath}`);
    return false;
  }

  let content = await app.vault.read(file);
  const lines = content.split("\n");

  // 덮어쓰기: URL로 기존 라인 검색 후 교체
  if (todo.status === "updated" && todo.message_url) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(todo.message_url)) {
        lines[i] = line;
        await app.vault.modify(file, lines.join("\n"));
        return true;
      }
    }
  }

  // 이미 같은 URL이 있으면 건너뜀 (중복 방지)
  if (content.includes(todo.message_url)) return true;

  // insertAfter 헤딩 다음 줄에 삽입
  const marker = CONFIG.insertAfter;
  const markerIndex = lines.findIndex((l) => l.trim() === marker);

  if (markerIndex >= 0) {
    const insertAt = markerIndex + 1;
    lines.splice(insertAt, 0, line);
    await app.vault.modify(file, lines.join("\n"));
    return true;
  } else {
    // 헤딩 없으면 skip (pending 유지, 다음 폴링에서 재시도)
    console.log(`[SlackTodo] Heading not found: ${CONFIG.insertAfter} in ${filepath}`);
    return false;
  }
}

// ── 메인 사이클 ──
async function poll() {
  const todos = await fetchPending();
  let successCount = 0;
  let skipCount = 0;

  for (const todo of todos) {
    try {
      const written = await writeTodo(todo);
      if (written) {
        await markWritten(todo.key);
        successCount++;
      } else {
        skipCount++;
      }
    } catch (err) {
      console.error(`[SlackTodo] Error processing todo:`, err);
    }
  }

  if (successCount > 0) {
    new Notice(`📌 ${successCount}개의 슬랙 투두가 등록되었습니다.`);
  }
}

// ── 시작 ──
// 즉시 1회 실행 (Obsidian 시작 시 밀린 투두 처리)
await poll();

// 주기적 폴링
const intervalId = setInterval(poll, CONFIG.pollInterval);

// 참고: Templater Startup Template에서 this.registerInterval()은
// 사용 불가할 수 있음. setInterval만으로도 Obsidian 종료 시
// 프로세스와 함께 자연스럽게 정리됨.
%>
