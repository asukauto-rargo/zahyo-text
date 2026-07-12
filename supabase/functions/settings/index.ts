// settings: 送信先メールの登録/確認。
//  GET  -> 登録状況とマスクした表示のみ返す (実アドレスは返さない = 機密性)
//  POST -> ADMIN_KEY 認証のうえでメールを登録
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_KEY = Deno.env.get("ADMIN_KEY") ?? "";

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  if (req.method === "GET") {
    const { data } = await supabase
      .from("settings").select("target_email, updated_at").eq("id", 1).maybeSingle();
    const email = data?.target_email ?? null;
    return json({
      configured: !!email,
      masked: email ? maskEmail(email) : null,
      updated_at: data?.updated_at ?? null,
    });
  }

  if (req.method === "POST") {
    let body: { admin_key?: string; email?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }
    if (!ADMIN_KEY || body.admin_key !== ADMIN_KEY) {
      return json({ error: "管理キーが違います" }, 401);
    }
    const email = (body.email ?? "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ error: "メールアドレスの形式が不正です" }, 400);
    }
    const { error } = await supabase
      .from("settings")
      .upsert({ id: 1, target_email: email, updated_at: new Date().toISOString() });
    if (error) return json({ error: "登録に失敗", detail: error.message }, 500);
    return json({ ok: true, masked: maskEmail(email) });
  }

  return json({ error: "GET or POST only" }, 405);
});

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  const head = local.slice(0, 1);
  const maskedLocal = head + "*".repeat(Math.max(1, local.length - 1));
  return `${maskedLocal}@${domain}`;
}
