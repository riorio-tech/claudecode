# ai-drama — AI 短編ドラマ動画パイプライン 設計書

**バージョン:** 1.0.0
**ターゲットプラットフォーム:** TikTok / Instagram Reels（9:16 縦型、1 話 1 分 × 3 話形式）
**技術スタック:** NanoBanana Pro（画像生成）+ Kling AI via fal.ai（動画生成）+ FFmpeg（編集）+ ElevenLabs（音声）

---

## 0. 哲学 — 感情の波をハックし、AI で熱狂を作り出す

> **感情の波をハックし、AI で熱狂を作り出す。**

これが ai-drama の本質だ。動画を作るためのツールではない。

---

### 感情はハック可能だ

人が何かを見て止まる瞬間、コメントを書かずにいられない瞬間、友人に送りつける瞬間——  
それは偶然ではない。感情には構造がある。

怒りには「理不尽な権力」が必要だ。  
共感には「自分と重なる弱さ」が必要だ。  
熱狂には「逆転の瞬間」が必要だ。

この構造を解析し、コードで記述し、大量に実行する。  
それが ai-drama のやることだ。

---

### アルゴリズムは感情の増幅装置だ

TikTok は公平ではない。  
強い感情反応を引き起こすコンテンツを、指数関数的に増幅する。  
怒り、驚き、続きへの渇望——これらを精密に設計できる者が、アルゴリズムを支配できる。

従来、これには巨大な組織が必要だった。  
テレビ局、映画会社、編集者、監督、宣伝部——すべてが束になって、ようやく感情を動かせた。

**ai-drama はその構造を 1 人に圧縮する。**

1 行のコンセプト文を入力する。  
AI が脚本を書き、演出を設計し、映像を生成し、音声を乗せ、評価し、改善する。  
人間がやることは「何で熱狂させるか」を決めることだけでいい。

---

### 熱狂の設計図をコードで書く

感情アーク、クリフハンガーのタイミング、ショットの緊張感——  
これらはパラメータだ。チューニング可能な設計要素だ。

評価スコアが返ってくる。どこで感情が落ちたか分かる。改善する。また回す。  
**熱狂は、反復によって精度を上げる。**

これは動画制作の効率化ではない。  
**感情工学の実験場だ。**

---

### このプロジェクトが問い続けること

- 1 人が 100 万人の感情体験を設計できるとき、それは表現か、操作か
- AI が生成したキャラクターは、視聴者の記憶に残れるか
- 熱狂を再現性のある形で量産できるとき、熱狂は本物か

答えは出ない。だから作る。届ける。数字を見る。また作る。  
KPI は問いへの、暫定的な回答に過ぎない。

---

## 1. プロジェクト概要

`ai-drama` は、TikTok・Reels 向けの連続ショートドラマを自動生成するパイプラインです。

### アカウント戦略・最終目標

| 目標 | 数値 |
|------|------|
| フォロワー | 100 万人 |
| 平均再生数 | 500 万回/動画 |
| 案件依頼 | 月 30 件（大手企業・1 日 1 件ペース） |

**コンテンツ設計:**
- テーマ: **学生生活の物語 — 逆襲・復讐・成り上がり系**
- スタイル: 中国・韓国の人気漫画原作風（「나혼자만 레벨업」「斗破蒼穹」系の構図・テンポ）
- フォーマット: **1 話 1 分 × 3 話完結シリーズ**
  - 第 1 話: 状況設定 + 第 1 の屈辱・発覚
  - 第 2 話: 逆転の兆し + 最大の試練
  - 第 3 話: 完全な逆襲・復讐完結 または 新たな脅威（続編予告）

### 商品動画との違い

| | inoue-movie5（商品） | ai-drama（ドラマ） |
|---|---|---|
| 最適化目標 | 購買 CVR | 完視聴率・コメント率・シェア率 |
| 主役 | 商品・小道具 | 人物・感情 |
| 構図 | 商品を大きく見せる | 顔・表情・緊張感を演出 |
| カラーグレード | ウォーム（購買欲） | コールド（映画的緊張感） |
| 音声 | ナレーション 1 本 | キャラクター複数 + ナレーター |
| 単位 | 1 本完結 | 3 話シリーズ |

### KPI 採択基準

| 指標 | 採択ライン |
|------|-----------|
| 完視聴率 | 35% 以上 |
| 3 秒維持率 | 60% 以上 |
| コメント率 | 0.5% 以上 |
| シェア率 | 0.3% 以上 |
| シリーズ 2 話目移行率 | 40% 以上（1 話→2 話の継続視聴） |

---

## 2. パイプライン概要（9 エージェント）

```
コンセプト文
    │
    ▼
[01_script-writer] ──→ 01_script.json（脚本・感情ビート・台詞）
    │
    ▼
[02_scene-breakdown] ──→ 02_scene-plan.json（ショットタイプ・カメラ角度・画像プロンプト）
    │
    ├──────────────────────────────────┐
    ▼                                  ▼
[03_image-gen]                   [05_voice-gen]
03_image-variants.json           05_voice-plan.json
    │                                  │
    ▼                                  ▼
[04_video-gen]                   [06_sfx-music]
04_clips.json                    06_audio-plan.json
    │                                  │
    └────────────────┬─────────────────┘
                     ▼
              [07_assembly]
              07_assembly/final.mp4
                     │
                     ▼
                [08_qa]
              08_qa-report.json
```

**並列実行:** 02 完了後、03→04（映像ブランチ）と 05→06（音声ブランチ）を同時実行。
07 は両ブランチ完了後に実行。

### エージェント一覧

| # | エージェント | 入力 | 出力 | 責務 |
|---|------------|------|------|------|
| 01 | script-writer | コンセプト + ジャンル + テンプレート | `01_script.json` | ドラマ脚本生成（Claude Sonnet） |
| 02 | scene-breakdown | `01_script.json` | `02_scene-plan.json` | 映像演出設計（Claude Sonnet） |
| 03 | image-gen | `02_scene-plan.json` | `03_image-gen/*.jpg` + JSON | NanoBanana Pro でキーフレーム生成 |
| 04 | video-gen | `03_image-variants.json` | `04_video-gen/*.mp4` + JSON | Kling AI でクリップ生成 |
| 05 | voice-gen | `01_script.json` | `05_voice/*.mp3` + JSON | ElevenLabs v3 音声生成 |
| 06 | sfx-music | `01_script.json` + `04_clips.json` | BGM + `06_audio-plan.json` | BGM 選択・SFX 配置 |
| 07 | assembly | 04/05/06 全出力 | `final.mp4` | FFmpeg 最終合成 |
| 08 | qa | `final.mp4` + `01_script.json` | `08_qa-report.json` | 技術品質チェック |
| 09 | eval | `final.mp4` + 参照動画（任意） | `eval_log.md` + JSON | 100点満点品質評価・参照動画との比較 |

---

## 3. ドラマ構図システム

### 3.1 ショットタイプ 15 種

| shotType | 説明 | 主な用途 |
|----------|------|---------|
| `establishing` | ワイドショット・全体環境 | シーン冒頭のみ（1 カット限定） |
| `medium_two_shot` | 2 人ウエスト以上・向き合い | 対話・対立 |
| `medium_single` | 1 人ウエスト以上・やや外れ | 内省・リアクション |
| `ots_left` | 左キャラの肩越し | 発話（左→右） |
| `ots_right` | 右キャラの肩越し | 応答（右→左） |
| `close_face` | 顔がフレームの 70% | 感情表出・告白 |
| `extreme_close_eyes` | 目・眉のみ | 沈黙の緊張・凝視 |
| `extreme_close_prop` | 小道具クローズアップ | 発覚・証拠フォーカス |
| `low_angle_power` | 見上げるアングル | 宣言・支配・圧力 |
| `high_angle_weak` | 見下ろすアングル | 弱さ・絶望・孤立 |
| `dutch_angle` | 15〜25° 傾き | 裏切り・衝撃・不安定 |
| `pov_subjective` | 主観視点 | 発見・混乱 |
| `insert_environment` | 環境ディテール（雨・時計・扉） | 感情の転換・時間経過 |
| `back_walkaway` | 背中・歩き去り | 別れ・拒絶・反抗 |
| `silhouette` | 逆光シルエット | 謎・登場・退場 |

### 3.2 感情ビート 11 種

| emotionalBeat | 主ショット | モーション | 照明 |
|--------------|-----------|-----------|------|
| `hook_opener` | `close_face` | `snap_zoom_in` | `single_source_hard` |
| `tension_build` | `medium_two_shot` | `slow_push_in` | `cold_blue_night` |
| `revelation` | `extreme_close_prop` | `fast_zoom_in` | `high_contrast_backlight` |
| `confrontation` | `low_angle_power` | `micro_handheld` | `single_source_hard` |
| `silent_stare` | `extreme_close_eyes` | `static_with_drift` | `cold_blue_night` |
| `despair` | `high_angle_weak` | `slow_pull_back` | `window_natural_soft` |
| `shock_reaction` | `close_face` | `snap_zoom_in` | `high_contrast_backlight` |
| `declaration` | `low_angle_power` | `dolly_in_slow` | `high_contrast_backlight` |
| `departure` | `back_walkaway` | `track_follow` | `rain_diffused` |
| `insert_environment` | `insert_environment` | `static_with_drift` | `window_natural_soft` |
| `cliffhanger_end` | `extreme_close_prop` or `close_face` | `freeze` | （前シーン継続） |

### 3.3 Kling AI モーションコード 12 種

`templates/motion-prompts.json` に格納。以下がコードと Kling AI プロンプトの対応。

| motionCode | Kling AI プロンプト（英語） |
|-----------|--------------------------|
| `slow_push_in` | `camera slowly moves forward toward the subject, subtle dolly in, cinematic depth of field, emotional tension` |
| `snap_zoom_in` | `sudden dramatic zoom into subject's face, handheld camera snap, intense emotional moment` |
| `micro_handheld` | `slight handheld camera shake, intimate realistic movement, characters in dialogue` |
| `dolly_in_slow` | `graceful slow dolly forward, subject holds still, dramatic lighting maintained` |
| `slow_pull_back` | `camera slowly pulls back revealing environment, subject remains centered, melancholic mood` |
| `track_follow` | `camera follows character walking away, tracking shot from behind, emotional farewell` |
| `freeze` | `completely static camera, subject holds position, cinematic freeze frame, dramatic pause` |
| `static_with_drift` | `nearly static camera with 1-2% gentle drift, subject motionless, oppressive silence` |
| `fast_zoom_in` | `rapid zoom into object or face, revealing detail, sudden camera acceleration` |
| `dutch_drift` | `camera tilted 20 degrees, slow drift to the right, psychological disorientation` |
| `whip_pan_cut` | `rapid horizontal whip pan from left to right, energy cut transition` |
| `orbit_slow` | `camera orbits subject at 45-degree angle, 180 degrees total movement, slow and deliberate` |

### 3.4 照明コード 8 種

| lightingCode | 説明 | 用途 |
|-------------|------|------|
| `high_contrast_backlight` | 強い逆光・リムライト | 謎の登場・感情的な強さ |
| `single_source_hard` | 45° 上からの硬い 1 灯 | 尋問・告白・対立 |
| `window_natural_soft` | 窓からの柔らかい自然光 | 静かな悲しみ・後悔 |
| `cold_blue_night` | 夜の青みがかった環境光 | 危機・夜の対立 |
| `warm_golden_memory` | 暖かいゴールデンアワー | 回想・苦い思い出 |
| `overhead_fluorescent` | 冷たい蛍光灯の直上照明 | 病院・オフィス・絶望 |
| `candle_firelight` | 揺れる暖かいオレンジ光 | 夜の秘密・親密な告白 |
| `rain_diffused` | 雨の曇り空・灰色拡散光 | 別れ・悲しみ・送別 |

### 3.5 感情アークテンプレート 3 種

**betrayal（裏切り）— 45〜60 秒・6 シーン**
```
Scene 1 [hook_opener]:       冒頭から感情のピーク。スクロール停止させる (5s)
Scene 2 [tension_build]:     何かがおかしい。不安の伏線 (8s)
Scene 3 [revelation]:        真実の発覚。小道具クローズアップ (8s)
Scene 4 [confrontation]:     正面対決。感情爆発 (12s)
Scene 5 [despair]:           現実の重さ。沈黙ソロ (8s)
Scene 6 [cliffhanger_end]:   解決なし。余韻のみ (5s)
```

**declaration（宣言）— 30〜45 秒・5 シーン**
```
Scene 1 [hook_opener]:       キャラが限界状態から始まる (4s)
Scene 2 [confrontation]:     対立相手からの最大圧力 (8s)
Scene 3 [silent_stare]:      答える前の長い沈黙 (6s)
Scene 4 [declaration]:       ローアングルからの力強い宣言 (10s)
Scene 5 [cliffhanger_end]:   相手のリアクション。解決なし (5s)
```

**discovery（発覚）— 60〜75 秒・7 シーン**
```
Scene 1 [hook_opener]:       何かを発見するシーン（小道具 ECU） (4s)
Scene 2 [shock_reaction]:    発見への反応（顔クローズアップ） (6s)
Scene 3 [insert_environment]: 世界は知らずに動き続ける（対比） (5s)
Scene 4 [tension_build]:     どうすべきか。判断の岐路 (10s)
Scene 5 [confrontation]:     発覚の相手への対峙 (15s)
Scene 6 [despair]:           対峙後の余波。代償 (8s)
Scene 7 [cliffhanger_end]:   未解決の問いかけ (5s)
```

### 3.6 カラーグレード（ドラマ用コールド）

```
eq=brightness=-0.01:contrast=1.12:saturation=0.88,
colorbalance=rs=-0.02:gs=0.00:bs=0.04:rm=-0.01:gm=0.00:bm=0.03:rh=-0.01:gh=0.00:bh=0.02
```

inoue-movie5 のウォームグレードと逆方向。青みがかった高コントラスト。
`config.FFMPEG_COLOR_GRADE` で上書き可能。

---

## 4. ディレクトリ構造

```
ai-drama/
├── DESIGN.md
├── CLAUDE.md
├── package.json
├── config.js
├── orchestrator.js
├── cli.js
│
├── agents/
│   ├── 01_script-writer/
│   │   ├── agent.js
│   │   ├── CLAUDE.md
│   │   └── skills.md
│   ├── 02_scene-breakdown/
│   │   ├── agent.js
│   │   ├── CLAUDE.md
│   │   └── skills.md
│   ├── 03_image-gen/
│   │   ├── agent.js
│   │   ├── CLAUDE.md
│   │   └── skills.md
│   ├── 04_video-gen/
│   │   ├── agent.js
│   │   ├── CLAUDE.md
│   │   └── skills.md
│   ├── 05_voice-gen/
│   │   ├── agent.js
│   │   ├── CLAUDE.md
│   │   └── skills.md
│   ├── 06_sfx-music/
│   │   ├── agent.js
│   │   ├── CLAUDE.md
│   │   └── skills.md
│   ├── 07_assembly/
│   │   ├── agent.js
│   │   ├── CLAUDE.md
│   │   └── skills.md
│   └── 08_qa/
│       ├── agent.js
│       ├── CLAUDE.md
│       └── skills.md
│
├── lib/
│   ├── logger.js           ← inoue-movie5 から流用
│   ├── validate-json.js    ← Zod スキーマ（drama 用に再設計）
│   ├── job-dir.js          ← プレフィックス: drama-job-
│   ├── fal-client.js       ← Kling AI raw HTTP ヘルパー
│   ├── ffmpeg-path.js      ← inoue-movie5 から流用
│   └── extract-json.js     ← Claude 出力から JSON 抽出
│
├── templates/
│   ├── shot-catalogue.json
│   ├── motion-prompts.json
│   ├── lighting-catalogue.json
│   ├── drama-betrayal.json
│   ├── drama-declaration.json
│   ├── drama-discovery.json
│   └── bgm/
│       ├── tension-01.mp3
│       ├── melancholy-01.mp3
│       ├── confrontation-01.mp3
│       └── silence-01.mp3
│
├── output/
│   └── .gitkeep
│
└── db/
    ├── db.js
    └── schema.sql
```

### ジョブ一時ディレクトリ（実行時）

```
$TMPDIR/drama-job-{uuid}/
├── source-concept.txt
├── 01_script.json
├── 02_scene-plan.json
├── 03_image-gen/
│   ├── scene-00-keyframe.jpg
│   └── 03_image-variants.json
├── 04_video-gen/
│   ├── scene-00-clip.mp4
│   └── 04_clips.json
├── 05_voice/
│   ├── scene-00-narrator.mp3
│   └── 05_voice-plan.json
├── 06_sfx-music/
│   ├── bgm-selected.mp3
│   └── 06_audio-plan.json
└── 07_assembly/
    ├── concat-noaudio.mp4
    ├── final.mp4
    └── assembly-output.json
```

---

## 5. config.js スキーマ

```js
export const config = {
  // ── 画像生成 ──────────────────────────────────────────────────────────────
  // "nanobanana" | "fal_flux" | "mock"
  IMAGE_GEN_PROVIDER: process.env.IMAGE_GEN_PROVIDER ?? 'nanobanana',
  NANOBANANA_API_KEY: process.env.NANOBANANA_API_KEY ?? '',
  NANOBANANA_API_URL: process.env.NANOBANANA_API_URL ?? 'https://api.nanobanana.pro/v1',
  NANOBANANA_STYLE:   process.env.NANOBANANA_STYLE   ?? 'cinematic_portrait',
  IMAGE_WIDTH:  Number(process.env.IMAGE_WIDTH  ?? 1080),
  IMAGE_HEIGHT: Number(process.env.IMAGE_HEIGHT ?? 1920),

  // ── 動画生成 ──────────────────────────────────────────────────────────────
  // "kling" | "local_ffmpeg"
  VIDEO_GEN_PROVIDER: process.env.VIDEO_GEN_PROVIDER ?? 'kling',
  FAL_KEY: process.env.FAL_KEY ?? '',
  KLING_FAL_MODEL: process.env.KLING_FAL_MODEL ??
    'fal-ai/kling-video/v1.6/standard/image-to-video',
  // クリップ長（秒）: 5 or 10
  CLIP_DURATION_SEC: Number(process.env.CLIP_DURATION_SEC ?? 5),

  // ── 音声生成 ──────────────────────────────────────────────────────────────
  ELEVENLABS_API_KEY:        process.env.ELEVENLABS_API_KEY ?? '',
  ELEVENLABS_VOICE_A:        process.env.ELEVENLABS_VOICE_A ?? '',        // 主人公
  ELEVENLABS_VOICE_B:        process.env.ELEVENLABS_VOICE_B ?? '',        // 対立キャラ
  ELEVENLABS_VOICE_NARRATOR: process.env.ELEVENLABS_VOICE_NARRATOR ?? '', // ナレーター
  // "eleven_v3" | "eleven_multilingual_v2"
  ELEVENLABS_MODEL: process.env.ELEVENLABS_MODEL ?? 'eleven_v3',

  // ── Claude モデル ─────────────────────────────────────────────────────────
  CLAUDE_MODEL:       process.env.CLAUDE_MODEL       ?? 'claude-sonnet-4-6',
  CLAUDE_HAIKU_MODEL: process.env.CLAUDE_HAIKU_MODEL ?? 'claude-haiku-4-5-20251001',

  // ── パイプライン設定 ──────────────────────────────────────────────────────
  // 1 コンセプトあたりのバリアント数
  VARIANTS_PER_CONCEPT: Number(process.env.VARIANTS_PER_CONCEPT ?? 3),
  // "betrayal" | "declaration" | "discovery" | "auto"
  DEFAULT_ARC_TEMPLATE: process.env.DEFAULT_ARC_TEMPLATE ?? 'auto',
  SKIP_QA: process.env.SKIP_QA === 'true',
  MIN_DURATION_SEC: Number(process.env.MIN_DURATION_SEC ?? 30),
  MAX_DURATION_SEC: Number(process.env.MAX_DURATION_SEC ?? 90),

  // ── DB ────────────────────────────────────────────────────────────────────
  DB_PATH: process.env.DB_PATH ?? './ai-drama.db',

  // ── FFmpeg カラーグレード（ドラマ用コールド）────────────────────────────
  FFMPEG_COLOR_GRADE: process.env.FFMPEG_COLOR_GRADE ??
    'eq=brightness=-0.01:contrast=1.12:saturation=0.88,' +
    'colorbalance=rs=-0.02:gs=0.00:bs=0.04:rm=-0.01:gm=0.00:bm=0.03:rh=-0.01:gh=0.00:bh=0.02',
};
```

---

## 6. 各エージェント CLAUDE.md アウトライン

### 01_script-writer

**役割:** TikTok ショートドラマの脚本家。コンセプト文から完全な感情アーク付きマイクロ脚本を生成。

**入力:**
- `concept`: コンセプト文
- `genre`: `romance_drama` | `family_drama` | `betrayal` | `revenge` | `mystery`
- `characters`: キャラクター配列（名前・役割）
- `arc_template`: `betrayal` | `declaration` | `discovery` | `auto`
- `target_duration_sec`: 30 | 45 | 60 | 75
- `language`: `en` | `ja` | `ko` | `zh`

**出力スキーマ (`01_script.json`):**
```json
{
  "jobId": "uuid",
  "arc_template": "betrayal",
  "characters": [
    { "id": "char_a", "name": "Yuna", "role": "protagonist", "voice_id_key": "ELEVENLABS_VOICE_A" }
  ],
  "scenes": [
    {
      "sceneIndex": 0,
      "emotionalBeat": "hook_opener",
      "description": "シーン説明",
      "targetDurationSec": 5,
      "dialogue": [{ "speakerId": "char_a", "text": "台詞" }],
      "narration": "ナレーション文",
      "visualNote": "映像メモ",
      "subtitleLines": ["字幕テキスト"]
    }
  ],
  "totalEstimatedDurationSec": 55,
  "hookLine": "フック文",
  "cliffhangerLine": "クリフハンガー文"
}
```

**ルール:**
- Scene 0 の最初の一文が視聴維持の命。スクロール停止レベルにする
- `subtitleLines` は 1 行 2〜4 語・最大 3 行
- 感情ビートは承認済みカタログから選ぶ
- 無音シーンでも `visualNote` は必須

---

### 02_scene-breakdown

**役割:** 縦型ドラマ専門の映像監督。脚本の各シーンを映像的な正確さで記述し、画像生成 API に直接渡せる形式にする。

**入力:** `01_script.json`

**出力スキーマ (`02_scene-plan.json`):**
```json
{
  "jobId": "uuid",
  "scenes": [
    {
      "sceneIndex": 0,
      "emotionalBeat": "hook_opener",
      "shotType": "close_face",
      "cameraAngle": "slight_low_angle",
      "lightingCode": "single_source_hard",
      "motionCode": "snap_zoom_in",
      "imagePrompt": "cinematic close-up portrait...(英語)",
      "negativePrompt": "blur, watermark, text, distorted",
      "targetDurationSec": 5,
      "characters": ["char_a"],
      "environment": "interior_apartment_night",
      "colorPalette": "cold_blue"
    }
  ]
}
```

**ルール:**
- `imagePrompt` は必ず英語（画像生成モデルは英語訓練）
- 全シーンに `9:16 vertical composition` を含める
- 字幕・テキストは画像プロンプトに絶対含めない
- 感情ビートによって cold/warm カラーパレットを使い分ける

---

### 03_image-gen

**役割:** NanoBanana Pro API を呼び出し、各シーンのキーフレーム画像を生成。

**API パターン（NanoBanana Pro）:**
```
POST {NANOBANANA_API_URL}/generate
{
  prompt: scene.imagePrompt,
  negative_prompt: scene.negativePrompt,
  width: 1080,
  height: 1920,
  style: config.NANOBANANA_STYLE,
  steps: 30,
  guidance_scale: 7.5
}
```

**フォールバック:** `IMAGE_GEN_PROVIDER=fal_flux` → `fal-ai/flux-pro/v1`

**エラー処理:**
- 429: 指数バックオフ、最大 3 回リトライ
- 解像度不正: 拒否して再送
- 全シーン逐次実行（レートリミット対策）

---

### 04_video-gen

**役割:** Kling AI (fal.ai queue) で各キーフレームをモーション付きクリップに変換。

**API パターン（raw HTTP queue）:**
```
POST  https://queue.fal.run/{KLING_FAL_MODEL}
      { image_url, prompt, duration: CLIP_DURATION_SEC, aspect_ratio: "9:16" }
→ { request_id }

GET   https://queue.fal.run/{KLING_FAL_MODEL}/requests/{request_id}/status
→ { status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" }

GET   https://queue.fal.run/{KLING_FAL_MODEL}/requests/{request_id}
→ { video: { url } }
```

**静止フレーム検出:** `ffmpeg freezedetect=n=0.003:d=2.0` → フリーズ検出時はプロンプトに
`DYNAMIC DRAMATIC CAMERA MOVEMENT.` を先頭追加して最大 2 回リトライ。

**全クリップを `Promise.allSettled()` で並列実行。**

---

### 05_voice-gen

**役割:** ElevenLabs でキャラクター台詞とナレーション音声を生成。タイミングデータ付き。

**API:** `/v1/text-to-speech/{voice_id}/with-timestamps`（タイミングデータ取得用）

**感情別 voice_settings:**
| emotionalBeat | stability | similarity_boost | style |
|--------------|-----------|-----------------|-------|
| `hook_opener` | 0.3 | 0.8 | 0.6（囁き・親密） |
| `confrontation` | 0.5 | 0.7 | 0.8（緊張・速め） |
| `despair` | 0.7 | 0.6 | 0.3（遅い・弱い） |
| `declaration` | 0.4 | 0.9 | 0.9（力強い・明確） |

**フォールバック:** `with-timestamps` 失敗 → 通常 TTS エンドポイントを使用

---

### 06_sfx-music

**役割:** 感情ビート構造を読み BGM ファイルを選択、SFX イベントを計画。

**BGM 選択ロジック:**
- `confrontation` / `tension_build` 多数 → `confrontation-01.mp3`
- `despair` / `departure` 多数 → `melancholy-01.mp3`
- `silent_stare` 多数 → `silence-01.mp3`
- それ以外・混合 → `tension-01.mp3`

**SFX カタログ:**
- `heartbeat`: 心拍音、tension_build ピーク時
- `silence_drop`: BGM を急激にダック、silent_stare シーン
- `phone_buzz`: スマホ振動、小道具発覚シーン
- `door_slam`: ドアが閉まる音、departure シーン
- `glass_break`: ガラスが割れる音（細い）、shock_reaction シーン

---

### 07_assembly

**役割:** FFmpeg で全クリップ・音声・字幕・カラーグレードを合成して最終動画を出力。

**処理ステップ:**
1. `list.txt` 作成 → `ffmpeg -f concat -safe 0 -i list.txt -c copy concat-noaudio.mp4`
2. ナレーション + 台詞 + BGM + SFX を `amix` / `adelay` で音声ミックス
3. `05_voice-plan.json` のタイミングデータから字幕 `drawtext` フィルタを構築
4. カラーグレード + 字幕 + 音声ミックスを適用 → `final.mp4`
5. 尺・解像度の検証

**字幕スタイル:**
- フォント: Noto Sans Bold（システムフォールバック）
- 色: 白 + 3px 黒ストローク
- サイズ: `h*0.045`
- 位置: `y=h*0.85`（ロウワーサード）

**エスカレーション:**
- 尺が MIN/MAX を外れる → エラー（出力しない）
- 音声が完全無音 → エラー

---

### 08_qa

**役割:** 完成動画の技術品質・コンテンツ品質を検証。

**チェック項目:**
| チェック | 重要度 | 基準 |
|---------|-------|------|
| 尺 | error | 30〜90 秒 |
| 解像度 | error | 1080×1920 |
| コーデック | error | H.264/AAC |
| 音声あり | error | 完全無音でないこと |
| フック存在 | warn | hookLine がナレーション/字幕に含まれる |
| クローズアップ存在 | warn | `close_face` or `extreme_close_*` が 1 シーン以上 |
| クリフハンガー存在 | warn | `cliffhanger_end` ビートが存在する |
| 字幕過多 | warn | 1 行 4 語以内 |
| 字幕カバレッジ | warn | 動画尺の 60% 以上で字幕表示 |

---

## 7. lib/validate-json.js — 主要 Zod スキーマ

```js
import { z } from 'zod';

export const EMOTIONAL_BEATS = [
  'hook_opener', 'tension_build', 'revelation', 'confrontation',
  'despair', 'declaration', 'departure', 'silent_stare',
  'insert_environment', 'shock_reaction', 'cliffhanger_end',
];

export const SHOT_TYPES = [
  'establishing', 'medium_two_shot', 'medium_single', 'ots_left', 'ots_right',
  'close_face', 'extreme_close_eyes', 'extreme_close_prop', 'low_angle_power',
  'high_angle_weak', 'dutch_angle', 'pov_subjective', 'insert_environment',
  'back_walkaway', 'silhouette',
];

export const MOTION_CODES = [
  'slow_push_in', 'snap_zoom_in', 'micro_handheld', 'dolly_in_slow',
  'slow_pull_back', 'track_follow', 'freeze', 'static_with_drift',
  'fast_zoom_in', 'dutch_drift', 'whip_pan_cut', 'orbit_slow',
];

// 脚本シーン
const ScriptSceneSchema = z.object({
  sceneIndex:        z.number().int().min(0),
  emotionalBeat:     z.enum(EMOTIONAL_BEATS),
  description:       z.string().min(1),
  targetDurationSec: z.number().min(2).max(20),
  dialogue:          z.array(z.object({ speakerId: z.string(), text: z.string() })),
  narration:         z.string().optional(),
  visualNote:        z.string().min(1),
  subtitleLines:     z.array(z.string().max(30)).max(3),
});

export const ScriptSchema = z.object({
  jobId:                     z.string().uuid(),
  arc_template:              z.enum(['betrayal', 'declaration', 'discovery']),
  characters:                z.array(z.object({
    id: z.string(), name: z.string(), role: z.string(), voice_id_key: z.string(),
  })),
  scenes:                    z.array(ScriptSceneSchema).min(4).max(10),
  totalEstimatedDurationSec: z.number().min(25).max(95),
  hookLine:                  z.string().min(1),
  cliffhangerLine:           z.string().min(1),
});

// シーンプラン
const ScenePlanEntrySchema = z.object({
  sceneIndex:        z.number().int().min(0),
  emotionalBeat:     z.enum(EMOTIONAL_BEATS),
  shotType:          z.enum(SHOT_TYPES),
  motionCode:        z.enum(MOTION_CODES),
  lightingCode:      z.string(),
  imagePrompt:       z.string().min(20),
  negativePrompt:    z.string(),
  targetDurationSec: z.number().min(2).max(20),
  colorPalette:      z.enum(['cold_blue', 'warm_amber', 'desaturated', 'high_contrast']),
});

export const ScenePlanSchema = z.object({
  jobId:  z.string().uuid(),
  scenes: z.array(ScenePlanEntrySchema).min(4).max(10),
});

// 最終アセンブリ
export const AssemblyOutputSchema = z.object({
  jobId:         z.string().uuid(),
  finalVideoPath: z.string(),
  durationSec:   z.number().min(25).max(95),
  hasAudio:      z.boolean(),
  sceneCount:    z.number().int().min(4),
});

export function validate(schema, data) {
  return schema.parse(data);
}
```

---

## 8. DB スキーマ

```sql
CREATE TABLE IF NOT EXISTS drama_jobs (
  job_id       TEXT PRIMARY KEY,
  concept      TEXT,
  genre        TEXT,
  arc_template TEXT,
  status       TEXT DEFAULT 'pending',  -- pending | running | completed | failed
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  params       TEXT  -- JSON blob
);

CREATE TABLE IF NOT EXISTS drama_scenes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id       TEXT REFERENCES drama_jobs(job_id),
  scene_index  INTEGER,
  emotional_beat TEXT,
  shot_type    TEXT,
  motion_code  TEXT,
  image_path   TEXT,
  clip_path    TEXT
);

CREATE TABLE IF NOT EXISTS drama_metrics (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id            TEXT REFERENCES drama_jobs(job_id),
  views             INTEGER,
  watch_time_avg_sec REAL,
  completion_rate   REAL,
  comments          INTEGER,
  shares            INTEGER,
  recorded_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS drama_patterns (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  arc_template           TEXT,
  emotional_beat_sequence TEXT,  -- JSON array
  completion_rate        REAL,
  comment_rate           REAL,
  adopted_at             DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 9. CLI デザイン

```
ai-drama generate <concept>   — コンセプトからドラマ動画を生成
  --genre <genre>             romance_drama | family_drama | betrayal | revenge | mystery
  --characters <json>         '[{"name":"Yuna","role":"protagonist"},...]'
  --template <arc>            betrayal | declaration | discovery | auto
  --duration <sec>            30 | 45 | 60 | 75
  --variants <n>              バリアント数（デフォルト: 3）
  --language <lang>           en | ja | ko | zh（デフォルト: ja）
  --output-dir <dir>          出力先（デフォルト: ./output/）
  --dry-run                   01〜02 のみ実行（画像・動画生成なし）
  --skip-qa                   QA スキップ（開発用）
  --verbose                   全エージェント出力を表示

ai-drama script <concept>     — 脚本のみ生成（API 課金なし・高速プレビュー）
  --genre <genre>
  --duration <sec>

ai-drama measure              — エンゲージメントデータを取り込み、パターン記録
  --job-id <uuid>
  --data <path>               TikTok アナリティクス CSV/JSON
```

---

## 10. 実装フェーズ

### Phase 1 — ライブラリ基盤（inoue-movie5 から流用）

| ファイル | 作業 |
|---------|------|
| `lib/logger.js` | inoue-movie5 からそのままコピー |
| `lib/ffmpeg-path.js` | inoue-movie5 からそのままコピー |
| `lib/job-dir.js` | プレフィックスを `drama-job-` に変更 |
| `lib/validate-json.js` | 上記 Zod スキーマで全面再実装 |
| `lib/fal-client.js` | Kling AI raw HTTP queue ヘルパーを追加 |
| `lib/extract-json.js` | inoue-movie5 から流用 |
| `config.js` | 上記スキーマで実装 |
| `db/db.js` + `db/schema.sql` | テーブル名を drama_xxx に変更 |

### Phase 2 — コアエージェント（脚本→画像）

| 作業 |
|------|
| `agents/01_script-writer/agent.js` — Claude Sonnet で脚本生成 |
| `agents/02_scene-breakdown/agent.js` — Claude Sonnet で映像設計 |
| `agents/03_image-gen/agent.js` — NanoBanana Pro API |

### Phase 3 — 動画生成

| 作業 |
|------|
| `agents/04_video-gen/agent.js` — Kling AI via fal.ai raw HTTP |

### Phase 4 — 音声ブランチ（Phase 2 と並列開発可）

| 作業 |
|------|
| `agents/05_voice-gen/agent.js` — ElevenLabs with-timestamps |
| `agents/06_sfx-music/agent.js` — BGM 選択・SFX 計画 |

### Phase 5 — アセンブリ・QA

| 作業 |
|------|
| `agents/07_assembly/agent.js` — FFmpeg concat + ミックス + 字幕 + グレード |
| `agents/08_qa/agent.js` — ffprobe + コンテンツチェック |

### Phase 6 — オーケストレーション

| 作業 |
|------|
| `orchestrator.js` — 並列ブランチ実装 |
| `cli.js` — commander インターフェース |
| テンプレート JSON ファイル群の作成 |

---

## 11. 設計判断の根拠

**なぜ Kling AI か（Runway でなく）**
Kling AI v1.6 は人物の顔のモーションと感情表現が Runway Gen-3 Alpha より優れている。
ドラマコンテンツは 80% 以上が顔のクローズアップであるため、顔変形リスクの低い Kling が適切。

**なぜ 8 エージェントか（inoue-movie5 は 8 エージェントだが役割が異なる）**
ドラマ制作は商品動画より遥かに多くの業務プロセスを持つ:
- 脚本執筆は映像設計と分離（創作 vs 技術）
- 音声生成は BGM 選択と分離（ElevenLabs vs ローカルファイル）
- 各エージェントを 100〜300 行に抑えることで独立テスト・置換が容易になる

**なぜコールドグレードか**
TikTok で再生数の多い K ドラマ・J ドラマクリップの分析（2024〜2025）では、
脱飽和かつ青みがかったコールドグレードが支配的。ウォームグレードは購買文脈では機能するが、
ドラマ的緊張感の演出には逆効果。

**NanoBanana Pro API について**
公開 API 仕様は実装時に確認。プロバイダ切替構造（`IMAGE_GEN_PROVIDER`）により、
API 仕様確定前でも `fal_flux` フォールバックで開発を進められる。
