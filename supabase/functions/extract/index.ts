// extract: 写真 or PDF から X/Y 座標を、ブロック(表)単位で抽出する。
// 各ブロックの位置(bbox)・点名・信頼度を返し、UI側で行の切り抜き表示に使う。
import { handlePreflight, json } from "../_shared/cors.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT =
  `あなたは日本の測量座標表(座標リスト/座標求積表など)の読み取り専門家です。\n` +
  `画像またはPDFに含まれる表(ブロック)ごとに、各点の X座標(左) と Y座標(右)、及び点名(あれば)を正確に読み取ります。\n` +
  `ルール:\n` +
  `- 各表を1ブロックとして扱う。ブロックの並び順は「左にあるものを最優先、次に上にあるもの」。\n` +
  `- 各ブロック内の行は上から下の順。\n` +
  `- 抽出する数値は X座標 と Y座標 のみ(備考等の他列の値は出さない)。点名は name として別に出す。\n` +
  `- 数値は表記そのまま(符号・小数点・桁を保持)。カンマは除去。例 -33532.077 / -12679.159。\n` +
  `- 手書きの赤字・赤線・下線・丸印は無視し、印字された数値のみを対象とする。\n` +
  `- 点名は英数字の符号(例 94C3, 54C5, 154C6-1, 54C8-2, 54SU1, 94LB3, 54R8, 区8-3 等)。数字・アルファベット(C,G,L,R,S,U,B,T,A や 区 等)・ハイフンが混在する。1文字ずつ丁寧に読み、アルファベットを数字に(またはその逆に)変換しない。特に先頭の 5/S、0/O、1/I の取り違えに注意。名前は基本的にすべての行で読めるはずなので、空欄にせず読み取り、少しでも不確かなら confidence を下げる。無ければ空文字。\n` +
  `- 判読不能な桁は推測せず "?" とし、その行の confidence を大きく下げる。\n` +
  `- 各ブロックについて、データ行領域(見出し行は除く)の外接矩形 bbox を返す。座標は画像全体を横0〜1000・縦0〜1000として整数 [x0,y0,x1,y1]。横範囲は「点名列(無ければX座標列)の左端」から「Y座標列の右端」まで。この矩形を行数で均等分割すると各行になるよう、データ行の上端〜下端をぴったり囲む。\n` +
  `- 利用者からの特記事項があれば最優先で従う。\n` +
  `出力は指定JSONのみ。前置き・説明文・コードフェンスは書かない。`;

function userInstruction(notes: string): string {
  const base =
    `この資料から、ブロックごとに 点名・X座標・Y座標 を抽出し、次の形のJSONだけを返してください。\n` +
    `rows の各要素は [name, x, y, confidence] の配列です(confidenceは0-100)。\n` +
    `{"overall_confidence":<0-100>,"has_names":<true|false>,"blocks":[{"title":"<表の見出し。無ければ空>","bbox":[x0,y0,x1,y1],"rows":[["<点名 or 空>","<X>","<Y>",<0-100>]]}],"warnings":[]}\n`;
  const note = notes && notes.trim()
    ? `\n【利用者からの特記事項(最優先で考慮)】\n${notes.trim()}\n`
    : "";
  return base + note;
}

interface ExtractRequest { fileBase64: string; mediaType: string; notes?: string; }

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
      { role: "user", content: [mediaBlock, { type: "text", text: userInstruction(body.notes ?? "") }] },
    ],
  };

  let anthropicRes: Response;
  try {
    anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) { return json({ error: "Anthropic API 呼び出しに失敗", detail: String(e) }, 502); }

  if (!anthropicRes.ok) {
    const t = await anthropicRes.text();
    console.log(`anthropic error ${anthropicRes.status}: ${t.slice(0, 800)}`);
    return json({ error: `Anthropic API エラー (${anthropicRes.status})`, detail: t.slice(0, 300) }, 502);
  }

  const data = await anthropicRes.json();
  const textPart: string = (data?.content ?? [])
    .filter((c: { type: string }) => c.type === "text")
    .map((c: { text: string }) => c.text).join("");
  const stop = data?.stop_reason ?? "";
  const types = (data?.content ?? []).map((c: { type: string }) => c.type).join(",");
  console.log(`extract: len=${textPart.length} stop=${stop} types=${types} model=${MODEL}`);

  const parsed = robustParse(textPart);
  if (!parsed || parsed.blocks.every((b) => b.rows.length === 0)) {
    return json({ error: `座標を読み取れませんでした (stop=${stop}, types=${types}, len=${textPart.length})`, raw_head: textPart.slice(0, 300) }, 502);
  }

  const warnings = parsed.warnings.slice();
  if (stop === "max_tokens") warnings.push("出力が上限に達したため、末尾の行/ブロックが欠けている可能性があります。点数をご確認ください。");

  return json({
    overall_confidence: parsed.overall_confidence,
    has_names: parsed.has_names,
    blocks: parsed.blocks,
    warnings,
    model: MODEL,
    usage: data?.usage ?? null,
  });
});

interface OutRow { name: string; x: string; y: string; confidence: number; }
interface OutBlock { title: string; bbox: number[] | null; rows: OutRow[]; }
interface Parsed { overall_confidence: number; has_names: boolean; blocks: OutBlock[]; warnings: string[]; }

function robustParse(text: string): Parsed | null {
  const stripped = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const obj = tryParse(stripped) ?? tryParse(sliceBraces(stripped));

  if (obj && typeof obj === "object") {
    const o = obj as Record<string, unknown>;
    if (Array.isArray(o.blocks)) {
      const blocks = (o.blocks as unknown[]).map(normBlock).filter((b) => b.rows.length > 0);
      if (blocks.length > 0) {
        return {
          overall_confidence: clampConf(o.overall_confidence),
          has_names: !!o.has_names || blocks.some((b) => b.rows.some((r) => r.name !== "")),
          blocks,
          warnings: toStrArr(o.warnings),
        };
      }
    }
    // 旧形式 rows[] にも一応対応
    if (Array.isArray(o.rows)) {
      const rows = (o.rows as unknown[]).map(normRow).filter((r) => r.x || r.y);
      if (rows.length) return { overall_confidence: clampConf(o.overall_confidence), has_names: rows.some((r) => r.name !== ""), blocks: [{ title: "", bbox: null, rows }], warnings: toStrArr(o.warnings) };
    }
  }

  // フォールバック: 配列行 [name,x,y,conf] を正規表現で回収
  const rows: OutRow[] = [];
  const re = /\[\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*(\d{1,3})\s*\]/g;
  for (const m of stripped.matchAll(re)) {
    rows.push({ name: m[1], x: cleanNum(m[2]), y: cleanNum(m[3]), confidence: clampConf(m[4]) });
  }
  if (rows.length === 0) return null;
  return {
    overall_confidence: 0,
    has_names: rows.some((r) => r.name !== ""),
    blocks: [{ title: "", bbox: null, rows }],
    warnings: ["出力の一部が壊れていたため、読める行のみ復元しました。点数と末尾を必ず確認してください。"],
  };
}

function normBlock(b: unknown): OutBlock {
  const o = (b ?? {}) as Record<string, unknown>;
  const rowsRaw = Array.isArray(o.rows) ? o.rows : [];
  const rows = rowsRaw.map(normRow).filter((r) => r.x || r.y);
  let bbox: number[] | null = null;
  if (Array.isArray(o.bbox) && o.bbox.length === 4) bbox = (o.bbox as unknown[]).map((n) => Number(n));
  return { title: String(o.title ?? ""), bbox, rows };
}

function normRow(r: unknown): OutRow {
  if (Array.isArray(r)) {
    return { name: String(r[0] ?? ""), x: cleanNum(String(r[1] ?? "")), y: cleanNum(String(r[2] ?? "")), confidence: clampConf(r[3]) };
  }
  const o = (r ?? {}) as Record<string, unknown>;
  return { name: String(o.name ?? ""), x: cleanNum(String(o.x ?? "")), y: cleanNum(String(o.y ?? "")), confidence: clampConf(o.confidence) };
}

function tryParse(s: string): unknown | null { try { return JSON.parse(s); } catch { return null; } }
function sliceBraces(s: string): string { const a = s.indexOf("{"); const b = s.lastIndexOf("}"); return a >= 0 && b > a ? s.slice(a, b + 1) : s; }
function toStrArr(v: unknown): string[] { return Array.isArray(v) ? v.map((x) => String(x)) : []; }
function cleanNum(s: string): string { return s.replace(/,/g, "").replace(/\s+/g, "").trim(); }
function clampConf(v: unknown): number { const n = Number(v); if (!isFinite(n)) return 0; return Math.max(0, Math.min(100, Math.round(n))); }
