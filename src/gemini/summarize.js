/**
 * Google Gemini API를 이용한 슬랙 메시지 요약
 * MODELS_TO_TRY를 순차 시도하여 첫 성공 모델의 결과를 반환
 * 전부 실패 시 원본 텍스트 앞 80자로 폴백
 */

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

// 우선순위 순서로 시도. 2.0 계열은 deprecated
const MODELS_TO_TRY = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-flash-latest",
  "gemini-pro-latest",
];

/**
 * 슬랙 메시지를 한 줄 투두로 요약
 * @param {string} messageText - 슬랙 메시지 원본
 * @param {object} env - Worker 환경 변수
 * @returns {{ text: string, usedFallback: boolean }} 요약된 투두 텍스트 및 폴백 사용 여부
 */
export async function summarizeWithGemini(messageText, env) {
  const prompt = `다음 슬랙 메시지를 To-Do 형식으로 다듬어줘. 원문의 모든 행동을 빠짐없이 포함해야 한다.

규칙:
- 생략·축약 금지. 모든 행동을 그대로 포함
- 문장은 반드시 완결되어야 함 (동사로 끝나기: ~하기, ~점검, ~정리 등)
- 마크다운, 링크, 특수문자 없이 순수 텍스트만
- 출력은 다듬은 문장 한 줄만 (설명·접두어 없이)

예시:
입력: "리니어에서 triage 이슈 정리하고, 글로벌 프로젝트 이슈 점검"
출력: 리니어 triage 이슈 정리하고 글로벌 프로젝트 이슈 점검

슬랙 메시지:
${messageText}`;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 1,
      maxOutputTokens: 500,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  for (const model of MODELS_TO_TRY) {
    try {
      const url = `${BASE_URL}/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error(`Gemini ${model} HTTP ${res.status}:`, JSON.stringify(data));
        continue;
      }

      // thinking 파트를 제외하고 실제 응답 텍스트만 추출
      const parts = data.candidates?.[0]?.content?.parts || [];
      const nonThought = parts.filter((p) => !p.thought);
      let summary =
        nonThought.length > 0
          ? (nonThought[nonThought.length - 1].text || "").trim()
          : parts.map((p) => p.text || "").join("").trim();
      if (!summary) {
        console.error(`Gemini ${model} empty response`);
        continue;
      }

      // 마크다운 리스트 접두어("- ", "* ", "- [ ] ") 제거 및 공백 정규화
      const text = summary
        .replace(/^[-*]\s*(\[.\]\s*)?/, "")
        .replace(/\s+/g, " ")
        .trim();
      return { text, usedFallback: false };
    } catch (err) {
      console.error(`Gemini ${model} error:`, err.message);
      continue;
    }
  }

  // 모든 모델 실패 시 원본 앞부분 폴백
  console.error("Gemini API: all models failed");
  const fallbackText =
    messageText.slice(0, 80) + (messageText.length > 80 ? "..." : "");
  return { text: fallbackText, usedFallback: true };
}
