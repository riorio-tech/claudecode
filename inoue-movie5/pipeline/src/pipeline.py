from __future__ import annotations
import json
import os
import shutil
import uuid
from pathlib import Path

import yaml

from .config import (
    WORK_DIR_BASE,
    has_anthropic_key,
    has_elevenlabs_key,
    has_fal_key,
    get_elevenlabs_key,
    get_elevenlabs_voice,
    get_bgm_path,
)
from .state import PipelineState
from .api import ffmpeg as ff
from .api import fal as fal_api
from .api import elevenlabs as el_api
from .api import script_gen


def load_prompts(prompts_path: Path) -> dict:
    with open(prompts_path) as f:
        return yaml.safe_load(f)


def run(
    image_url: str,
    text: str,
    output_path: Path,
    job_id: str | None = None,
    only_step: str | None = None,
) -> Path:
    """
    メインパイプライン。

    Steps:
      script  → Claude でスクリプト生成（プロンプト・ナレーション・字幕）
      hook    → Kling v2.1, 5s → 1080×1920 → trim 3s
      benefit → Kling v2.1, 10s → 1080×1920
      cta     → ffmpeg 静止画 + テキスト 2s
      concat  → ffmpeg 結合 (15s)
      grain   → フィルムグレイン + 字幕オーバーレイ
      audio   → ElevenLabs TTS + ミックス + BGM（オプション）
    """
    job_id = job_id or str(uuid.uuid4())
    work_dir = WORK_DIR_BASE / f"inoue-pipeline-{job_id}"
    work_dir.mkdir(parents=True, exist_ok=True)

    state = PipelineState(job_id, work_dir)
    prompts_path = Path(__file__).parent.parent / "prompts.yaml"
    prompts = load_prompts(prompts_path)
    video_model = prompts.get("video_model", "fal-ai/kling-video/v2.1/standard/image-to-video")

    print(f"\nJob ID: {job_id}")
    print(f"Work dir: {work_dir}\n")

    # ─── 画像を公開 URL に変換 ──────────────────────────────────────────────
    if not image_url.startswith("http"):
        print(f"ローカルファイルを fal.ai にアップロード中: {image_url}")
        image_url = fal_api.upload_file(image_url)
        print(f"  → {image_url}\n")

    # ─── Step 0: SCRIPT — Claude でスクリプト生成 ───────────────────────────
    if _should_run("script", only_step, state):
        print("Step 0/7 SCRIPT — Claude でスクリプト生成")
        script_path = work_dir / "script.json"

        if has_anthropic_key():
            sys_prompt = prompts["script_gen"]["system"]
            claude_model = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6")
            script = script_gen.generate(text, sys_prompt, model=claude_model)
            with open(script_path, "w", encoding="utf-8") as f:
                json.dump(script, f, ensure_ascii=False, indent=2)
            print(f"  → hook_subtitle: {script.get('hook_subtitle')}")
            print(f"  → benefit_subtitle: {script.get('benefit_subtitle')}")
            print(f"  → cta_text: {script.get('cta_text')}\n")
        else:
            print("  ⚠ ANTHROPIC_API_KEY 未設定 → フォールバックテンプレート使用")
            script = _make_fallback_script(text, prompts)
            with open(script_path, "w", encoding="utf-8") as f:
                json.dump(script, f, ensure_ascii=False, indent=2)

        state.mark_done("script", str(script_path))

    # スクリプトを読み込み（後続ステップで参照）
    script = _load_script(state, work_dir, text, prompts)

    # ─── Step 1: HOOK — Kling, 5s → 1080×1920 → trim 3s ──────────────────
    if _should_run("hook", only_step, state):
        print(f"Step 1/7 HOOK — {video_model.split('/')[-3]} 5s → 1080×1920 → trim 3s")
        raw_hook = work_dir / "step1_hook_raw.mp4"
        hook_v = work_dir / "step1_hook_vertical.mp4"
        hook_path = work_dir / "step1_hook.mp4"

        fal_api.generate_video(image_url, script["hook_video_prompt"], raw_hook,
                               duration="5", model=video_model)
        ff.force_vertical(raw_hook, hook_v)
        raw_hook.unlink(missing_ok=True)
        ff.trim_clip(hook_v, hook_path, duration=3.0)
        hook_v.unlink(missing_ok=True)

        state.mark_done("hook", str(hook_path))
        print(f"  → {hook_path} ({ff.get_duration(hook_path):.1f}s)\n")

    # ─── Step 2: BENEFIT — Kling, 10s → 1080×1920 ────────────────────────
    if _should_run("benefit", only_step, state):
        print(f"Step 2/7 BENEFIT — {video_model.split('/')[-3]} 10s → 1080×1920")
        raw_benefit = work_dir / "step2_benefit_raw.mp4"
        benefit_path = work_dir / "step2_benefit.mp4"

        fal_api.generate_video(image_url, script["benefit_video_prompt"], raw_benefit,
                               duration="10", model=video_model)
        ff.force_vertical(raw_benefit, benefit_path)
        raw_benefit.unlink(missing_ok=True)

        state.mark_done("benefit", str(benefit_path))
        print(f"  → {benefit_path} ({ff.get_duration(benefit_path):.1f}s)\n")

    # ─── Step 3: CTA — ffmpeg 2s ──────────────────────────────────────────
    if _should_run("cta", only_step, state):
        print("Step 3/7 CTA — ffmpeg テキストオーバーレイ 2s")
        cta_path = work_dir / "step3_cta.mp4"
        cta_style = prompts.get("cta_style", {})
        ff.generate_cta(image_url, script["cta_text"], cta_path, duration=2, style=cta_style)
        state.mark_done("cta", str(cta_path))
        print(f"  → {cta_path} ({ff.get_duration(cta_path):.1f}s)\n")

    # ─── Step 4: CONCAT — 3 + 10 + 2 = 15s ───────────────────────────────
    if _should_run("concat", only_step, state):
        print("Step 4/7 CONCAT — ffmpeg 結合")
        concat_path = work_dir / "step4_concat.mp4"
        clips = [
            Path(state.get_output("hook")),
            Path(state.get_output("benefit")),
            Path(state.get_output("cta")),
        ]
        ff.concat_clips(clips, concat_path)
        state.mark_done("concat", str(concat_path))
        print(f"  → {concat_path} ({ff.get_duration(concat_path):.1f}s)\n")

    # ─── Step 5: GRAIN + 字幕オーバーレイ ────────────────────────────────
    if _should_run("grain", only_step, state):
        print("Step 5/7 GRAIN + 字幕オーバーレイ")
        grain_path = work_dir / "step5_grain.mp4"
        grain_sub_path = work_dir / "step5_grain_sub.mp4"
        concat_path = Path(state.get_output("concat"))

        grain_cfg = prompts.get("film_grain", {})
        ff.add_film_grain(concat_path, grain_path, grain_cfg.get("strength", 0.03))

        # 字幕を焼き込む（hook: 0〜3s, benefit: 3〜13s）
        subtitles = []
        if script.get("hook_subtitle"):
            subtitles.append({"text": script["hook_subtitle"], "start": 0.0, "end": 3.0})
        if script.get("benefit_subtitle"):
            subtitles.append({"text": script["benefit_subtitle"], "start": 3.0, "end": 13.0})

        ff.add_subtitle_overlays(grain_path, grain_sub_path, subtitles)
        grain_path.unlink(missing_ok=True)

        state.mark_done("grain", str(grain_sub_path))
        print(f"  → {grain_sub_path} ({ff.get_duration(grain_sub_path):.1f}s)\n")

    # ─── Step 6: AUDIO — ElevenLabs TTS + BGM ────────────────────────────
    if _should_run("audio", only_step, state):
        print("Step 6/7 AUDIO — ElevenLabs TTS + ミックス")
        audio_out = work_dir / "output.mp4"
        grain_path = Path(state.get_output("grain"))

        try:
            if not has_elevenlabs_key():
                raise RuntimeError("ELEVENLABS_API_KEY 未設定")

            api_key = get_elevenlabs_key()
            voice_id = get_elevenlabs_voice()
            if not voice_id:
                raise RuntimeError("ELEVENLABS_VOICE 未設定")

            tts_hook = work_dir / "tts_hook.mp3"
            tts_benefit = work_dir / "tts_benefit.mp3"
            tts_cta = work_dir / "tts_cta.mp3"

            print(f"  narration hook: {script['hook_narration'][:40]}...")
            el_api.generate_tts(script["hook_narration"], tts_hook, api_key, voice_id)
            el_api.generate_tts(script["benefit_narration"], tts_benefit, api_key, voice_id)
            el_api.generate_tts(script["cta_narration"], tts_cta, api_key, voice_id)

            tts_all = work_dir / "tts_all.m4a"
            ff.concat_audio([tts_hook, tts_benefit, tts_cta], tts_all)
            for tmp in [tts_hook, tts_benefit, tts_cta]:
                tmp.unlink(missing_ok=True)

            ff.add_audio_to_video(grain_path, tts_all, audio_out)
            tts_all.unlink(missing_ok=True)
            print(f"  → ElevenLabs ナレーション追加済み")

        except Exception as e:
            print(f"  ⚠ ElevenLabs スキップ（{e}）→ 音声なしでコピー")
            shutil.copy(grain_path, audio_out)

        # BGM ミックス（BGM_PATH が設定されている場合）
        bgm_path_str = get_bgm_path()
        if bgm_path_str and Path(bgm_path_str).exists():
            print(f"  BGM ミックス: {bgm_path_str}")
            bgm_out = work_dir / "output_bgm.mp4"
            ff.mix_bgm(audio_out, Path(bgm_path_str), bgm_out)
            audio_out.unlink(missing_ok=True)
            bgm_out.rename(audio_out)
            print(f"  → BGM ミックス完了")

        state.mark_done("audio", str(audio_out))
        print(f"  → {audio_out} ({ff.get_duration(audio_out):.1f}s)\n")

    # ─── 最終ファイルをコピー ───────────────────────────────────────────────
    final_source = Path(state.get_output("audio"))
    shutil.copy(final_source, output_path)

    duration = ff.get_duration(output_path)
    print(f"✅ 完了: {output_path} ({duration:.1f}秒)")
    print(f"   Job ID: {job_id}  (再開: --resume {job_id})")
    return output_path


def _load_script(state: PipelineState, work_dir: Path, text: str, prompts: dict) -> dict:
    """完了済みの script.json を読む。なければフォールバックを返す。"""
    script_path_str = state.get_output("script")
    if script_path_str and Path(script_path_str).exists():
        with open(script_path_str, encoding="utf-8") as f:
            return json.load(f)
    return _make_fallback_script(text, prompts)


def _make_fallback_script(text: str, prompts: dict) -> dict:
    hook_tmpl = prompts.get("hook", {}).get("template", "")
    benefit_tmpl = prompts.get("benefit", {}).get("template", "")
    cta_tmpl = prompts.get("cta_text", {}).get("template", "今すぐ注文 →")
    return {
        "hook_video_prompt": hook_tmpl.format(text=text) if hook_tmpl else f"Vertical 9:16. Product reveal: {text}",
        "benefit_video_prompt": benefit_tmpl.format(text=text) if benefit_tmpl else f"Vertical 9:16. Product demo: {text}",
        "hook_narration": f"{text}、見てください！",
        "benefit_narration": f"{text}。毎日のケアに取り入れてみてください。",
        "cta_narration": "今すぐリンクからチェック！",
        "hook_subtitle": "これ試してほしい",
        "benefit_subtitle": "毎日使いたくなる",
        "cta_text": cta_tmpl.format(text=text),
    }


def _should_run(step: str, only_step: str | None, state: PipelineState) -> bool:
    if only_step:
        if step == only_step:
            state.reset_step(step)
            return True
        return False
    return not state.is_done(step)
