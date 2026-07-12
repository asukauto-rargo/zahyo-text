// extract: 写真 or PDF から X/Y 座標を抽出し、行ごとの信頼度を返す。
// Claude (ビジョン) を使用。JSON崩れ・途中切れにも強い堅牢パーサ付き。
import { handlePreflight, json } from "../_shared/cors.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT =
  `あなたは日本の測量座標表(座標リスト/座標求積表など)の読み取り専門家です。` +
  `画像またはPDFの表から、各点の X座標(左) と Y座標(右) の数値だけを、上から下への出現順で正確に読み取ります。\n` +
  `ルール:\n` +
  `- 抽出は X座標 と Y座標 の2列のみ。点名・備考などの他列は出さない。\n` +
  `- 数値は表記そのまま(符号・小数点・桁を保持)。カンマは除去。例 -24210.139 / 498.965。\n` +
  `- 手書きの赤線・下線は無視。印字された数値のみ。\n` +
  `- 判読不能な桁は推測せず "?" とし、その行の confidence を大きく下げる。\n` +
  `- 表が複数あれば左上→右下の順に各行を連結。\n` +
  `- note は原則空文字。不安な時だけ10文字以内で簡潔に。冗長な説明は禁止。\n` +
  `出力は指定JSONのみ。前置き・コードフェンス・説明文は書かない。`;

const USER_INSTRUCTION =
  `この資料から X座標・Y座標を抽出し、次の形のJSONだけを返してください。\n` +
  `{"overall_confidence": <0-100>, "rows": [{"x":"<X>","y":"<Y>","confidence":<0-100>,"note":""}], "warnings": []}\n` +
  `confidenceは各行の読み取り確度。少しでも曖昧なら90未満。`;

interface ExtractRequest { fileBase64: string; mediaType: string; }

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY が未設定です" }, 500);

  let body: ExtractRequest;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const { fileBase64, mediaType } = body;
  if (!fileBase64 || !mediaType) return json({ error: "fileBase64 と mediaType は必須です" }, 400);

  const isPdf = mediaType === "application/pdf";
  const mediaBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: fileBase64 } };

  const payload = {
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: [mediaBlock, { type: "text", text: USER_INSTRUCTION }] },
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
  const textPart: string = (data?.content ?? [])
    .filter((c: { type: string }) => c.type === "text")
    .map((c: { text: string }) => c.text)
    .join("");
  // プレフィルの "{" を先頭に戻す
  const full = textPart;
  const stop = data?.stop_reason ?? "";
  console.log(`extract: len=${full.length} stop=${stop} model=${MODEL}`);

  const types = (data?.content ?? []).map((c: { type: string }) => c.type).join(",");
  const parsed = robustParse(full);
  if (!parsed || parsed.rows.length === 0) {
    return json({ error: `座標を読み取れませんでした (stop=${stop}, types=${types}, len=${full.length})`, stop_reason: stop, raw_head: full.slice(0, 300) }, 502);
  }

  const cleaned = parsed.rows.map((r) => ({
    x: cleanNum(String(r.x ?? "")),
    y: cleanNum(String(r.y ?? "")),
    confidence: clampConf(r.confidence),
    note: String(r.note ?? "").slice(0, 40),
  })).filter((r) => r.x !== "" || r.y !== "");

  const warnings = parsed.warnings.slice();
  if (stop === "max_tokens") warnings.push("出力が上限に達したため、末尾の行が欠けている可能性があります。点数をご確認ください。");

  return json({
    overall_confidence: clampConf(parsed.overall_confidence),
    rows: cleaned,
    warnings,
    model: MODEL,
    usage: data?.usage ?? null,
  });
});

interface Parsed { overall_confidence: unknown; rows: Record<string, unknown>[]; warnings: string[]; }

// JSON崩れ・途中切れに強いパーサ
function robustParse(text: string): Parsed | null {
  const stripped = text.replace(/```json/gi, "").replace(/```/g, "").trim();

  // 1) まず素直に全体をパース
  const whole = tryParse(stripped) ?? tryParse(sliceBraces(stripped));
  if (whole && Array.isArray((whole as Record<string, unknown>).rows)) {
    const w = whole as Record<string, unknown>;
    return { overall_confidence: w.overall_confidence, rows: w.rows as Record<string, unknown>[], warnings: toStrArr(w.warnings) };
  }

  // 2) 行オブジェクトを個別に正規表現で回収(途中切れ・末尾破損に強い)
  const rows: Record<string, unknown>[] = [];
  const re = /\{[^{}]*?"x"[^{}]*?\}/g;
  for (const m of stripped.matchAll(re)) {
    const r = tryParse(m[0]);
    if (r && (r as Record<string, unknown>).x !== undefined) rows.push(r as Record<string, unknown>);
  }
  if (rows.length === 0) return null;

  let overall = 0;
  const om = stripped.match(/"overall_confidence"\s*:\s*(\d+)/);
  if (om) overall = Number(om[1]);

  return {
    overall_confidence: overall,
    rows,
    warnings: ["出力の一部が壊れていたため、読める行のみ復元しました。点数と末尾を必ず確認してください。"],
  };
}

function tryParse(s: string): unknown | null {
  try { return JSON.parse(s); } catch { return null; }
}
function sliceBraces(s: string): string {
  const a = s.indexOf("{"); const b = s.lastIndexOf("}");
  return a >= 0 && b > a ? s.slice(a, b + 1) : s;
}
function toStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}
function cleanNum(s: string): string { return s.replace(/,/g, "").replace(/\s+/g, "").trim(); }
function clampConf(v: unknown): number {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
