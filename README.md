# 座標テキスト化ツール

測量座標表の**写真 / PDF** から X・Y 座標を Claude(ビジョン)で読み取り、**行ごとの信頼度**を見ながら人間が確認・修正し、確定したテキスト(各行 `X Y`)を**登録済みメール宛に送信**するWebアプリです。JW_cad に読み込んで作図するのが最終目的です。

## 特長
- 入力は写真(JPG/PNG)と PDF の両対応
- Claude が各行の **信頼度(%)** を返し、しきい値未満の行を自動でハイライト → チェックの力の入れどころが分かる
- 出力は 1 ファイル、各行 `X Y`(半角スペース区切り、写真通り 左X・右Y)
- 送信先メールは**サーバ側に秘匿**(画面にはマスク表示のみ)。管理キーで登録
- **送信履歴**を保存し、後から**修正依頼フォーム**で「どの行をどう直すか」を記録
- APIキー類はすべて Supabase の Secret に保管(クライアントに出さない)

## 現在の状態（Claudeが構築済み）
- Supabase プロジェクト **zahyo-text**(東京リージョン, 無料枠)を作成済み
  - Project Ref: `admaspahaysgzjvnscrn`
  - URL: `https://admaspahaysgzjvnscrn.supabase.co`
- DBテーブル(settings / sent_records / corrections)反映済み
- Edge Functions(extract / send / settings / records / correction)デプロイ済み
- `config.js` に URL と anon キーを設定済み

### 残作業（あなたの操作。これが終われば動きます）
Supabase ダッシュボード → プロジェクト `zahyo-text` → **Edge Functions → Secrets**(または Project Settings → Edge Functions）で、次を登録:

| 名前 | 値 | 必須 |
|------|----|------|
| `ANTHROPIC_API_KEY` | ご自身の Claude APIキー(sk-ant-...) | ○ 抽出に必須 |
| `RESEND_API_KEY` | Resend のAPIキー(re_...) | ○ メール送信に必須 |
| `ADMIN_KEY` | 任意の管理キー(送信先メール登録に使用) | ○ |
| `ANTHROPIC_MODEL` | `claude-sonnet-5`(精度最優先なら `claude-opus-4-8`) | 任意 |
| `MAIL_FROM` | 送信元(例 `座標テキスト化 <onboarding@resend.dev>`) | 任意 |

> `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` は自動注入されるので登録不要です。
> Resend は無検証だと `onboarding@resend.dev` から**自分のアカウント宛のみ**送信可。任意の宛先へ送るには独自ドメイン検証が必要です。

登録後、アプリの「③ 設定」タブで ADMIN_KEY と送信先メールを入れて登録すれば運用開始できます。

## 構成
- フロントエンド: `index.html` / `app.js` / `styles.css`(ビルド不要の素のWeb)
- バックエンド: Supabase Edge Functions(`supabase/functions/*`)+ Postgres(`supabase/migrations`)
- メール送信: Resend
- 抽出: Claude API(Anthropic Messages API・ビジョン)

```
座標テキスト化/
├─ index.html / app.js / styles.css   フロント
├─ config.js                          接続設定(SUPABASE_URL / ANON_KEY)
├─ supabase/
│  ├─ migrations/0001_init.sql        DBスキーマ
│  └─ functions/
│     ├─ extract/      写真・PDF → 座標+信頼度(Claude)
│     ├─ send/         txt生成 → メール送信 → 記録保存(Resend)
│     ├─ settings/     送信先メールの登録/確認(ADMIN_KEY保護)
│     ├─ records/      送信履歴の取得
│     └─ correction/   修正依頼の登録
├─ tools/to_jw.py                     txt → JW用(YX並べ替え)
└─ docs/JW_cad連携.md                 JW_cad連携の調査と提案
```

## セットアップ手順

### 1. 必要なキーを用意
- **Anthropic APIキー**(Claude): https://console.anthropic.com/
- **Resend APIキー**(メール送信): https://resend.com/(送信元ドメイン検証。未検証なら `onboarding@resend.dev` でテスト可)

### 2. Supabase プロジェクトを用意しリンク
```bash
npm i -g supabase
supabase login
supabase link --project-ref <your-project-ref>
```

### 3. DBスキーマを反映
```bash
supabase db push
```

### 4. Secret(環境変数)を設定
```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxx
supabase secrets set ANTHROPIC_MODEL=claude-sonnet-5      # 精度最優先なら claude-opus-4-8
supabase secrets set RESEND_API_KEY=re_xxxx
supabase secrets set MAIL_FROM="座標テキスト化 <onboarding@resend.dev>"
supabase secrets set ADMIN_KEY=<任意の管理キー>
```
※ `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` は Supabase が自動注入します。

### 5. Edge Function をデプロイ
```bash
supabase functions deploy extract send settings records correction
```

### 6. フロント設定
`config.js` を編集し、Supabase の URL と anon キーを入れる:
```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://<ref>.supabase.co",
  SUPABASE_ANON_KEY: "<anon key>",
  CONFIDENCE_THRESHOLD: 90,
};
```

### 7. フロントを開く
- そのまま `index.html` をブラウザで開くだけでも動きます。
- 共有したい場合は Netlify / Vercel / GitHub Pages 等に静的サイトとして置けます。

### 8. 送信先メールを登録(アプリ完成後)
アプリの「③ 設定」タブで、送信先メールと ADMIN_KEY を入力して登録。以後は画面上マスク表示のみ。

## 使い方
1. 「① 抽出・確認・送信」でファイルを選び「座標を抽出する」
2. 表で信頼度の低い行(ハイライト)を重点確認し、値を修正
3. txt プレビューを確認 →「登録メール宛に送信する」(必要なら手元にダウンロード)
4. 届いた txt を元データと見比べ、直しがあれば「② 送信履歴・修正依頼」で記録
5. txt を JW_cad へ(`docs/JW_cad連携.md` 参照。**YX読取**で読み込む)

## 注意
- 座標は必ず人の目で最終確認してください(信頼度はあくまで補助)。
- `サンプル画像/` と `config.js` 内の実キーは業務・機密情報のため取り扱い注意(`.gitignore` 済み項目を確認)。
