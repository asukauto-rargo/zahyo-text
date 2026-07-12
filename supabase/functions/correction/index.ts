// correction: 送信済みファイルに対する修正依頼を受け付けて保存する。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface CorrectionRequest {
  sent_record_id: string;
  line_number?: number;
  current_value?: string;
  desired_value?: string;
  comment?: string;
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  let body: CorrectionRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  if (!body.sent_record_id) {
    return json({ error: "sent_record_id は必須です" }, 400);
  }

  const { data, error } = await supabase
    .from("corrections")
    .insert({
      sent_record_id: body.sent_record_id,
      line_number: body.line_number ?? null,
      current_value: body.current_value ?? null,
      desired_value: body.desired_value ?? null,
      comment: body.comment ?? null,
    })
    .select("id, created_at")
    .single();

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, correction: data });
});
