---
name: inoue-movie5 動画品質・商品統一の設計判断
description: 商品差し替えの品質を保つための設計選択と根拠
type: feedback
---

## 商品画像の使い方：Sharp `cover` フィット

FLUX Fill / nano-banana で商品を「生成」するのではなく、
Sharp で商品画像を直接 1080×1920 に `cover` フィットして Seedance の入力フレームにする。

**Why:** AI生成は商品の外観・色・ロゴを正確に再現できない。Sharp なら元の商品画像がそのまま映る。  
**How to apply:** `IMAGE_GEN_PROVIDER` の設定に関わらず、Seedance 入力は必ず Sharp 合成を使う。

---

## SHOT_PATTERNS（20種）の設計原則

全パターンに共通するプロンプトルール:
- `product already held in hand in frame` — 商品はすでにフレーム内にある
- `single hand only, no duplicate products, no extra hands or arms` — 手・商品の複製禁止

NG パターン（廃止済み）:
- "画面外から商品が入る" 系（slide_in, rise_reveal, push_toward_cam など）
  → Seedance が既存商品＋新商品の2つを生成してしまう

---

## SAFE_PATTERNS（品質チェック失敗時のリトライ用）

ランダム割り当てされたパターンで品質チェックが失敗した場合、
以下 8 パターンの中からランダムに選んでリトライ（最大2回）:
`slow_zoom_in`, `slow_zoom_out`, `tilt_up`, `tilt_down`, `pan_left`, `pan_right`, `closeup_detail`, `macro_scan`

これらは動きがシンプルで Seedance が安定して処理できるパターン。

---

## ビデオフレームチェックのプロンプト方針

Claude Haiku による生成ビデオのフレームチェックは「商品カテゴリー一致」ではなく
「視覚的品質・リアリズム」に焦点を当てる。

**Why:** ネックマッサージャーのような U 字型商品を Claude Haiku が誤認識したため。  
「コントローラーに見える」などの誤判定を避けるため、商品名ではなく外観品質で判断させる。

---

## カラーグレード（ウォームグレード）

```
eq=brightness=0.03:contrast=1.08:saturation=1.15,
colorbalance=rs=0.04:gs=0.02:bs=-0.06:rm=0.02:gm=0.01:bm=-0.04:rh=0.01:gh=0.00:bh=-0.02
```

TikTok でよく見られるウォームトーン・高コントラスト仕上げ。常に適用する。

---

## 字幕・テキストオーバーレイ仕様

```
字幕:  y=h*0.62  fontsize=32  白文字・影付き（shadowx=2, shadowy=2）
CTA:   廃止（不要とユーザー判断）
```

**Why:** 参照画像に合わせて中央やや下・小さめに変更（旧: y=0.85, size=50 は大きすぎ・下すぎ）。
CTA「⬇ ここから買える」はユーザー指示で削除。

---

## SHOT_PATTERNSはテンプレート動画から抽出すべき

`templates/02_Tumblerver2/` の 10 クリップ（cut1〜cut10）を分析し、
各クリップの画角・手の動きをパターン化して SHOT_PATTERNS に落とし込んだ。

**Why:** ランダム・抽象的なパターン名では Seedance が実際の動きを再現しにくい。
実際に撮影された動きから具体的な motion prompt を作ることで、商品が変わっても
同じ動きパターンが再利用できる。

**テンプレートから抽出した主なパターン:**
- `handle_top_hold_reveal`: 片手トップグリップ・ローアングル（cut1）
- `side_sweep_entry`: 空フレームからサイドスウィープ（cut2）
- `palm_bottom_lift`: 掌で底面を支えて持ち上げ（cut10）
- `top_feature_point`: 機能部を指さしクローズアップ（cut3）
- `top_open_demo`: 開閉メカ・オーバーヘッドデモ（cut4）
- `full_body_vertical_scan`: 縦全身スキャン（cut5）
- `low_angle_underside`: ローアングル下部仰角（cut6）
- `two_hand_front_eye_level`: 両手正面アイレベル（cut8）
- `two_hand_gentle_sway`: 両手包みスウェイ（cut9）
- `base_overhead_macro`: 底面オーバーヘッドマクロ（cut7）

**How to apply:** 新しいテンプレート動画を追加する際は、ffmpegでフレームを抽出して
Claude Visionで分析し、同様にパターン化してSHOT_PATTERNSに追加する。
