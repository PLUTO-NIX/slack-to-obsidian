<%*
// ════════════════════════════════════════════════
// Slack To Obsidia — Templater Startup Script
// 이 파일을 볼트의 템플릿 폴더에 넣고,
// Templater 설정 → Startup Templates에 등록하세요.
// ════════════════════════════════════════════════

// ── 설정 ──
const CONFIG = {
  workerUrl: "https://slack-to-obsidian.plutonix.workers.dev",
  apiToken: "64da95ed650040f1eed9a3e7d31335aa85af61a88014caf9588baf889e83a543",
  pollInterval: 30000,  // 30초
  dailyNotePath: "03 Resource/Me & Life/Journal/Daily",
  insertAfter: "### Today",  // 이 헤딩 다음 줄에 투두 추가
};

// ── 유틸: YYYY-MM-DD (또는 YYYY-MM-DD dd) → 데일리 노트 파일 경로 (로케일 자동 적용) ──
function toFilePath(dateStr) {
  const datePart = dateStr.split(" ")[0];
  const d = new Date(datePart + "T12:00:00Z");
  const locale = navigator.language || "ko-KR";
  const dayName = d.toLocaleDateString(locale, {
    weekday: "narrow",
    timeZone: "UTC",
  });
  const filename = `${datePart} ${dayName}`;
  return `${CONFIG.dailyNotePath}/${filename}.md`;
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

  let file = app.vault.getAbstractFileByPath(filepath);

  // 파일 없으면 생성 (insertAfter 헤딩 + 빈 줄 + 투두)
  if (!file) {
    const header = CONFIG.insertAfter + "\n\n" + line + "\n";
    await app.vault.create(filepath, header);
    return;
  }

  let content = await app.vault.read(file);
  const lines = content.split("\n");

  // 덮어쓰기: URL로 기존 라인 검색 후 교체
  if (todo.status === "updated" && todo.message_url) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(todo.message_url)) {
        lines[i] = line;
        await app.vault.modify(file, lines.join("\n"));
        return;
      }
    }
  }

  // 이미 같은 URL이 있으면 건너뜀 (중복 방지)
  if (content.includes(todo.message_url)) return;

  // insertAfter 헤딩 다음 줄에 삽입
  const marker = CONFIG.insertAfter;
  const markerIndex = lines.findIndex((l) => l.trim() === marker);

  if (markerIndex >= 0) {
    const insertAt = markerIndex + 1;
    lines.splice(insertAt, 0, line);
    await app.vault.modify(file, lines.join("\n"));
  } else {
    // 헤딩 없으면 맨 끝에 append
    const newContent = content.endsWith("\n")
      ? content + line + "\n"
      : content + "\n" + line + "\n";
    await app.vault.modify(file, newContent);
  }
}

// ── 메인 사이클 ──
async function poll() {
  const todos = await fetchPending();

  for (const todo of todos) {
    await writeTodo(todo);
    await markWritten(todo.key);
  }

  if (todos.length > 0) {
    new Notice(`📌 ${todos.length}개의 슬랙 투두가 등록되었습니다.`);
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
