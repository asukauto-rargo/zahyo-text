// records: 送信履歴の一覧を返す (修正依頼フォームで参照する)。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "GET") return json({ error: "GET only" }, 405);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const url = new URL(req.url);
  const withCorrections = url.searchParams.get("corrections") === "1";

  const { data: records, error } = await supabase
    .from("sent_records")
    .select("id, filename, recipient, row_count, overall_confidence, source_name, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return json({ error: error.message }, 500);

  if (!withCorrections) return json({ records });

  const { data: corrections } = await supabase
    .from("corrections")
    .select("id, sent_record_id, line_number, current_value, desired_value, comment, status, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  return json({ records, corrections: corrections ?? [] });
});
