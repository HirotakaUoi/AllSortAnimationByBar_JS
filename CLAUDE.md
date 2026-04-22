# ソートアルゴリズム アニメーション v1

ブラウザ上でソートアルゴリズムをリアルタイムにアニメーション表示する Web アプリ。

## 起動

```bash
uvicorn main:app --reload --port 8000
```

ブラウザ: http://localhost:8000

## デモ

https://allsortanimationbybar-js.onrender.com/

## 対応アルゴリズム（12種）

バブル / 選択 / 挿入 / シェル /
クイック(通常・3点中央値・ランダム) /
バイトニック / 並列バイトニック / コム / ノーム / パンケーキ

## ファイル構成

```
main.py              # FastAPI + WebSocket エンドポイント
sort_algorithms.py   # 12種のソートアルゴリズム（ジェネレータ形式）
requirements.txt
render.yaml          # Render 自動デプロイ設定
static/
  index.html
  css/style.css
  js/
    canvas.js        # SortCanvas クラス（Canvas 2D 描画）
    ws_client.js     # AnimationClient（WebSocket ラッパー）
    app.js           # SortPanel クラス + パネル管理
```

## アーキテクチャ

```
[Browser] ←─ WebSocket ─→ [FastAPI / main.py] ←─ import ─→ [sort_algorithms.py]
  app.js                    /api/start                         generator関数群
  canvas.js                 /ws/{session_id}
```

## WebSocket フレーム形式

```json
{
  "data":     [42, 17, 95, ...],
  "color":    ["b", "r", "g", ...],
  "arrows":   [[i, j], ...],
  "texts":    ["pivot=42", ...],
  "lines":    [{"x": 3, "color": "gray"}, ...],
  "bars":     [2, 5],
  "finished": false
}
```

| フィールド | 内容 |
|---|---|
| `color` | `b`=青 / `r`=赤 / `y`=黄 / `g`=緑 / `gray` / `m`=マゼンタ / `c`=シアン |
| `arrows` | 比較・交換を示す矢印ペア |
| `finished` | ソート完了フラグ |

## v1 の注意点

`n > 100` のとき比較ステップのフレームを省略していたため、O(n²) アルゴリズムが
O(n log n) より速く見える逆転現象が起きる。修正版は v2 を参照。

## アルゴリズム追加手順

1. `sort_algorithms.py` にジェネレータ関数を実装（`yield` でフレームを1つずつ出力）
2. `main.py` の `ALGORITHMS` リストに登録
