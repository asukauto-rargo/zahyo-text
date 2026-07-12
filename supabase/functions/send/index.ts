// send: 確定した座標行から .txt を生成し、Gmail(SMTP)で登録済みメール宛に添付送信、記録を保存する。
// Resend などの外部サービスは不要。既存の Gmail アカウント + アプリパスワードを使う。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { handlePreflight, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Gmail アドレスと「アプリパスワード」(通常のログインパスワードではない)
const GMAIL_USER = Deno.env.get("GMAIL_USER") ?? "";
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD") ?? "";
// 表示名(任意)
const MAIL_FROM_NAME = Deno.env.get("MAIL_FROM_NAME") ?? "座標テキスト化";

interface Row { x: string; y: string; confidence?: number; note?: string; }
interface SendRequest {
  rows: Row[];
  filename?: string;
  source_name?: string;
  overall_confidence?: number;
  recipient_override?: string;
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  let body: SendRequest;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) return json({ error: "rows が空です" }, 400);

  // 送信先: 設定テーブルのメールを最優先(機密性のためクライアントからは指定しない)
  const { data: setting } = await supabase
    .from("settings").select("target_email").eq("id", 1).maybeSingle();
  const recipient = setting?.target_email || body.recipient_override || "";
  if (!recipient) {
    return json({ error: "送信先メールが未登録です。設定画面で登録してください。" }, 400);
  }

  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    return json({ error: "GMAIL_USER / GMAIL_APP_PASSWORD が未設定です" }, 500);
  }

  // txt 生成: 各行 "X Y" 半角スペース区切り、写真通り左X・右Y
  const txt = rows.map((r) => `${r.x} ${r.y}`).join("\r\n") + "\r\n";
  const filename = sanitizeFilename(body.filename || "coords.txt");

  const html =
    `<p>座標テキスト化アプリからの自動送信です。</p>` +
    `<p>ファイル名: ${escapeHtml(filename)}<br>` +
    `点数: ${rows.length}<br>` +
    `全体信頼度: ${body.overall_confidence ?? "-"}%<br>` +
    `元データ: ${escapeHtml(body.source_name ?? "-")}</p>` +
    `<p>元資料とテキストを見比べて内容をご確認ください。</p>`;

  // Gmail SMTP 送信
  try {
    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD },
      },
    });
    await client.send({
      from: `${MAIL_FROM_NAME} <${GMAIL_USER}>`,
      to: recipient,
      subject: `【座標テキスト】${filename} (${rows.length}点)`,
      content: `座標テキストを添付します。ファイル名: ${filename} / 点数: ${rows.length}`,
      html,
      attachments: [
        { filename, content: txt, encoding: "text", contentType: "text/plain; charset=utf-8" },
      ],
    });
    await client.close();
  } catch (e) {
    return json({ error: "メール送信に失敗", detail: String(e) }, 502);
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
      email_id: null,
    })
    .select("id, filename, recipient, row_count, overall_confidence, created_at")
    .single();

  if (insErr) {
    return json({ ok: true, warning: "送信は成功、記録保存に失敗", detail: insErr.message }, 200);
  }
  return json({ ok: true, record: rec });
});

function sanitizeFilename(name: string): string {
  let n = name.replace(/[\/\\:*?"<>|]/g, "_").trim();
  if (!n) n = "coords.txt";
  if (!n.toLowerCase().endsWith(".txt")) n += ".txt";
  return n;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}
