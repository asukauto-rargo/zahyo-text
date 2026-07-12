// send: 確定した座標行から .txt を生成し、登録済みメール宛に添付送信、記録を保存する。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
// 送信元アドレス。独自ドメイン未検証なら Resend のテスト用 onboarding@resend.dev が使える。
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "onboarding@resend.dev";

interface Row {
  x: string;
  y: string;
  confidence?: number;
  note?: string;
}
interface SendRequest {
  rows: Row[];
  filename?: string; // 例: coords.txt
  source_name?: string; // 元ファイル名
  overall_confidence?: number;
  recipient_override?: string; // 通常は使わない。設定のメールを優先。
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  let body: SendRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) return json({ error: "rows が空です" }, 400);

  // 送信先: 設定テーブルのメールを最優先 (機密性のためクライアントからは指定しない)
  const { data: setting } = await supabase
    .from("settings").select("target_email").eq("id", 1).maybeSingle();
  const recipient = setting?.target_email || body.recipient_override || "";
  if (!recipient) {
    return json({ error: "送信先メールが未登録です。設定画面で登録してください。" }, 400);
  }

  // txt 生成: 各行 "X Y" 半角スペース区切り、写真通り左X・右Y
  const txt = rows.map((r) => `${r.x} ${r.y}`).join("\r\n") + "\r\n";
  const filename = sanitizeFilename(body.filename || "coords.txt");
  const b64 = base64Encode(txt);

  if (!RESEND_API_KEY) {
    return json({ error: "RESEND_API_KEY が未設定です" }, 500);
  }

  // メール送信 (Resend)
  const html =
    `<p>座標テキスト化アプリからの自動送信です。</p>` +
    `<p>ファイル名: ${escapeHtml(filename)}<br>` +
    `点数: ${rows.length}<br>` +
    `全体信頼度: ${body.overall_confidence ?? "-"}%<br>` +
    `元データ: ${escapeHtml(body.source_name ?? "-")}</p>` +
    `<p>元資料とテキストを見比べて内容をご確認ください。</p>`;

  let emailId: string | null = null;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [recipient],
        subject: `【座標テキスト】${filename} (${rows.length}点)`,
        html,
        attachments: [{ filename, content: b64 }],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return json({ error: "メール送信に失敗", detail: t }, 502);
    }
    const j = await res.json();
    emailId = j?.id ?? null;
  } catch (e) {
    return json({ error: "メール送信で例外", detail: String(e) }, 502);
  }

  // 記録を保存
  const { data: rec, error: insErr } = await supabase
    .from("sent_records")
    .insert({
      filename,
      recipient,
      row_count: rows.length,
      txt_content: txt,
      rows,
      overall_confidence: body.overall_confidence ?? null,
      source_name: body.source_name ?? null,
      email_id: emailId,
    })
    .select("id, filename, recipient, row_count, overall_confidence, created_at")
    .single();

  if (insErr) {
    return json({ ok: true, warning: "送信は成功、記録保存に失敗", detail: insErr.message }, 200);
  }

  return json({ ok: true, record: rec, email_id: emailId });
});

function sanitizeFilename(name: string): string {
  let n = name.replace(/[\/\\:*?"<>|]/g, "_").trim();
  if (!n) n = "coords.txt";
  if (!n.toLowerCase().endsWith(".txt")) n += ".txt";
  return n;
}

function base64Encode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}
