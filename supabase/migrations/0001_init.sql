-- 座標テキスト化アプリ 初期スキーマ
-- すべてのテーブルは RLS を有効化し、アクセスは Edge Function (service_role) 経由に限定する。

-- 送信先メールなどの設定 (単一行)
create table if not exists public.settings (
  id           int primary key default 1,
  target_email text,
  updated_at   timestamptz not null default now(),
  constraint settings_single_row check (id = 1)
);

-- 送信記録
create table if not exists public.sent_records (
  id                 uuid primary key default gen_random_uuid(),
  filename           text not null,
  recipient          text not null,
  row_count          int  not null,
  txt_content        text not null,          -- 実際に送ったテキスト内容
  rows               jsonb,                  -- 抽出行 [{x,y,confidence,note}]
  overall_confidence numeric,                -- 全体の信頼度 (0-100)
  source_name        text,                   -- 元ファイル名 (写真/PDF)
  email_id           text,                   -- メール送信プロバイダのID
  created_at         timestamptz not null default now()
);

-- 修正依頼
create table if not exists public.corrections (
  id             uuid primary key default gen_random_uuid(),
  sent_record_id uuid references public.sent_records(id) on delete set null,
  line_number    int,           -- 何行目か
  current_value  text,          -- 現在の値
  desired_value  text,          -- 修正後の値
  comment        text,          -- 補足
  status         text not null default 'open',   -- open / done
  created_at     timestamptz not null default now()
);

create index if not exists idx_sent_records_created_at on public.sent_records (created_at desc);
create index if not exists idx_corrections_sent_record on public.corrections (sent_record_id);

-- RLS: デフォルト拒否。Edge Function は service_role で RLS をバイパスするため
-- クライアント (anon) からの直接アクセスは不可。
alter table public.settings     enable row level security;
alter table public.sent_records enable row level security;
alter table public.corrections  enable row level security;
