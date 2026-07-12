#!/usr/bin/env python3
"""本アプリ出力の座標txt(各行 "X Y")を JW_cad 用に変換するヘルパー。

使い方:
    python to_jw.py input.txt                 # YX並べ替え版を input_yx.txt に出力
    python to_jw.py input.txt -o out.txt      # 出力先を指定
    python to_jw.py input.txt --keep          # 並べ替えずX Yのまま整形のみ

JW_cad で座標ファイルを直接読み込む場合、測量座標(X=北)は縦横が逆になるため、
既定では Y X の順に並べ替えて出力します(JW側で通常のXY読取に載せられる)。
JW側で「YX読取」を使う運用なら --keep で写真通りのままにしてください。
"""
import argparse
import os
import sys


def main() -> int:
    ap = argparse.ArgumentParser(description="座標txtをJW_cad用に変換")
    ap.add_argument("input", help="入力txt(各行 'X Y')")
    ap.add_argument("-o", "--output", help="出力ファイル名")
    ap.add_argument("--keep", action="store_true", help="X Yの順のまま(並べ替えない)")
    args = ap.parse_args()

    if not os.path.exists(args.input):
        print(f"入力ファイルが見つかりません: {args.input}", file=sys.stderr)
        return 1

    out_lines = []
    with open(args.input, encoding="utf-8") as f:
        for lineno, raw in enumerate(f, 1):
            s = raw.strip()
            if not s:
                continue
            parts = s.split()
            if len(parts) < 2:
                print(f"[警告] {lineno}行目を無視: '{s}'", file=sys.stderr)
                continue
            x, y = parts[0], parts[1]
            out_lines.append(f"{x} {y}" if args.keep else f"{y} {x}")

    if args.output:
        out_path = args.output
    else:
        base, ext = os.path.splitext(args.input)
        suffix = "_keep" if args.keep else "_yx"
        out_path = f"{base}{suffix}{ext or '.txt'}"

    with open(out_path, "w", encoding="utf-8", newline="\r\n") as f:
        f.write("\n".join(out_lines) + "\n")

    print(f"{len(out_lines)} 点を書き出しました: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
