// extract: 写真 or PDF から X/Y 座標を抽出し、行ごとの信頼度を返す。
// Claude (ビジョン) を使用。APIキーはサーバ側 (Supabase Secret) に秘匿。
import { handlePreflight, json } from "../_shared/cors.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
// 精度重視なら claude-opus-4-8。既定は速度と精度のバランスが良い sonnet。
const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5";

const SYSTEM_PROMPT =
  `あなたは日本の測量座標表(座標リスト/座標求積表など)の読み取り専門家です。` +
  `画像またはPDFに写っている表から、各点の X座標 と Y座標 の数値だけを、` +
  `表の上から下への出現順で、正確に読み取ってください。\n` +
  `重要なルール:\n` +
  `- 抽出するのは X座標(左側)と Y座標(右側)の2列のみ。点名・備考などの他の列は出力しない。\n` +
  `- 数値は表記そのまま(符号・小数点・桁を保持)。例: -24210.139 や 498.965。カンマは除去する。\n` +
  `- 手書きの赤線・下線などは無視し、印字された数値のみを対象とする。\n` +
  `- 1点でも読み取りに自信がない桁がある行は confidence を下げ、note に理由を書く。\n` +
  `- 表が複数ある場合は、画像内の左上→右下の順で、各表の行を順に並べる。\n` +
  `- 数値が潰れている/隠れている/判読不能な桁は推測せず、その桁を "?" とし confidence を大きく下げる。\n` +
  `出力は必ず指定のJSONスキーマのみ。前置きや説明文は一切書かない。`;

const USER_INSTRUCTION =
  `この資料から X座標・Y座標を抽出し、次のJSONだけを返してください。\n` +
  `{\n` +
  `  "overall_confidence": <0-100の整数>,\n` +
  `  "rows": [ { "x": "<X座標の文字列>", "y": "<Y座標の文字列>", "confidence": <0-100の整数>, "note": "<不安な点があれば理由、なければ空文字>" } ],\n` +
  `  "warnings": [ "<全体的な注意点があれば>" ]\n` +
  `}\n` +
  `confidence は「その行の数値をどれだけ確実に読み取れたか」を表す。少しでも曖昧なら 90 未満にする。`;

interface ExtractRequest {
  fileBase64: string; // data URL でなく純粋な base64
  mediaType: string; // image/jpeg, image/png, application/pdf など
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ANTHROPIC_API_KEY) {
    return json({ error: "ANTHROPIC_API_KEY が未設定です" }, 500);
  }

  let body: ExtractRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const { fileBase64, mediaType } = body;
  if (!fileBase64 || !mediaType) {
    return json({ error: "fileBase64 と mediaType は必須です" }, 400);
  }

  // 画像 or PDF でコンテンツブロックを切り替える
  const isPdf = mediaType === "application/pdf";
  const mediaBlock = isPdf
    ? {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: fileBase64 },
    }
    : {
      type: "image",
      source: { type: "base64", media_type: mediaType, data: fileBase64 },
    };

  const payload = {
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [mediaBlock, { type: "text", text: USER_INSTRUCTION }],
      },
    ],
  };

  let anthropicRes: Response;
  try {
    anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return json({ error: "Anthropic API 呼び出しに失敗", detail: String(e) }, 502);
  }

  if (!anthropicRes.ok) {
    const t = await anthropicRes.text();
    return json({ error: "Anthropic API エラー", status: anthropicRes.status, detail: t }, 502);
  }

  const data = await anthropicRes.json();
  const text: string = (data?.content ?? [])
    .filter((c: { type: string }) => c.type === "text")
    .map((c: { text: string }) => c.text)
    .join("\n");

  const parsed = extractJson(text);
  if (!parsed) {
    return json({ error: "抽出結果をJSONとして解釈できませんでした", raw: text }, 502);
  }

  // 正規化: 数値文字列のカンマ除去・トリム
  const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
  const cleaned = rows.map((r: Record<string, unknown>) => ({
    x: cleanNum(String(r.x ?? "")),
    y: cleanNum(String(r.y ?? "")),
    confidence: clampConf(r.confidence),
    note: String(r.note ?? ""),
  }));

  return json({
    overall_confidence: clampConf(parsed.overall_confidence),
    rows: cleaned,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    model: MODEL,
    usage: data?.usage ?? null,
  });
});

// モデル出力から JSON 部分を取り出す
function extractJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch { /* try to find a JSON block */ }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch { /* fallthrough */ }
  }
  return null;
}

function cleanNum(s: string): string {
  return s.replace(/,/g, "").replace(/\s+/g, "").trim();
}

function clampConf(v: unknown): number {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
