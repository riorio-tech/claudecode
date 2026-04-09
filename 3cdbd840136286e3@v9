#!/usr/bin/env python3
from __future__ import annotations
"""
AI商品差し替え動画生成パイプライン

Usage:
  python swap.py \\
    --clips-dir /path/to/01_mobile \\
    --product /path/to/product.jpg \\
    --output /path/to/output.mp4 \\
    --text "商品説明"

Pipeline:
  1. 商品画像を fal.ai にアップロード
  2. Claude でクリップラベル + 商品ビジュアル説明を生成
  3. 各クリップ:
       a. オリジナルクリップの先頭フレームを抽出
       b. 商品ゾーンのマスクを作成
       c. FLUX Pro Fill でマスク領域のみ新商品に置換（インペインティング）
       d. Runway Gen-3 でアニメート
       e. キーワードバナーを焼き込み
  4. 全クリップを concat
  5. Real-ESRGAN で4Kアップスケール
  6. ElevenLabs v3 でナレーション生成（タイムスタンプ付き）
  7. 音声 + 字幕 + カラーグレード追加
"""
import json
import os
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

import click
import httpx
from dotenv import load_dotenv

# .env 読み込み
_here = Path(__file__).parent
load_dotenv(_here.parent / ".env")
load_dotenv(_here / ".env", override=True)

FFMPEG = os.environ.get("FFMPEG_PATH", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE_PATH", "ffprobe")

# API モデル
RUNWAY_MODEL = "fal-ai/runway-gen3/alpha/image-to-video"
FLUX_FILL_MODEL = "fal-ai/flux-pro/v1/fill"

# ─── クリップ定義（5クリップ × 5秒 = 25秒）────────────────────────────────────
# source_clip: 01_mobile 内のオリジナルクリップ名（フレーム抽出元）
# zone:        商品が映っている矩形（2160×3840 座標系）→ FLUX Fill マスクに変換
# inpaint_prompt: FLUX Fill に渡す置換指示（{product_desc} プレースホルダーあり）
# runway_prompt:  Runway に渡すモーション指示
DEFAULT_CLIPS: dict[str, dict] = {
    "AI_cut1": {
        "source_clip": "AI_cut1",
        "zone": {"x": 100, "y": 200, "w": 1900, "h": 2600},
        "inpaint_prompt": (
            "A {product_desc} held firmly by a hand. "
            "Studio white background. Professional product photography. "
            "Clean and natural looking."
        ),
        "runway_prompt": (
            "The hand holds the product steady and slowly rotates it "
            "to reveal all sides. Smooth cinematic motion. White background."
        ),
    },
    "AI_cut3": {
        "source_clip": "AI_cut3",
        "zone": {"x": 350, "y": 500, "w": 1450, "h": 1900},
        "inpaint_prompt": (
            "A {product_desc} cradled in two hands. "
            "Soft studio lighting. Clean white background."
        ),
        "runway_prompt": (
            "Two hands gently hold the product at chest level. "
            "Gentle natural sway. Soft studio lighting. White background."
        ),
    },
    "AI_cut6": {
        "source_clip": "AI_cut6",
        "zone": {"x": 1050, "y": 1400, "w": 800, "h": 1100},
        "inpaint_prompt": (
            "A {product_desc} placed upright on a clean white table surface. "
            "Minimal lifestyle setting. Soft overhead lighting."
        ),
        "runway_prompt": (
            "Camera slowly orbits around the product resting on the table. "
            "Clean minimal setting. Soft natural side lighting."
        ),
    },
    "AI_cut7": {
        "source_clip": "AI_cut7",
        "zone": {"x": 380, "y": 380, "w": 1350, "h": 1200},
        "inpaint_prompt": (
            "A {product_desc} resting on a flat surface with a finger touching it. "
            "Extreme close-up. Clean white background."
        ),
        "runway_prompt": (
            "A finger gently presses or taps the product. "
            "Extreme close-up detail shot. Satisfying tactile motion."
        ),
    },
    "AI_cut9": {
        "source_clip": "AI_cut9",
        "zone": {"x": 270, "y": 380, "w": 1550, "h": 2150},
        "inpaint_prompt": (
            "A {product_desc} held by two hands at chest level, front view. "
            "Warm lifestyle lighting. Natural look."
        ),
        "runway_prompt": (
            "Two hands hold the product at chest level facing camera. "
            "Natural gentle breathing motion. Warm lifestyle lighting."
        ),
    },
}


@click.command()
@click.option("--clips-dir", required=True, type=click.Path(exists=True), help="オリジナルクリップ格納ディレクトリ")
@click.option("--product", required=True, type=click.Path(exists=True), help="商品画像パス")
@click.option("--output", required=True, type=click.Path(), help="出力 MP4 パス")
@click.option("--text", default="商品紹介", help="ナレーション用商品説明テキスト")
@click.option("--clips-json", default=None, type=click.Path(), help="クリップ設定 JSON（省略時はデフォルト使用）")
@click.option("--no-audio", is_flag=True, help="音声生成をスキップ")
@click.option("--no-upscale", is_flag=True, help="Real-ESRGAN アップスケールをスキップ（高速テスト用）")
@click.option("--resume", default=None, help="既存 job_id を指定して中断地点から再開")
def main(clips_dir: str, product: str, output: str, text: str,
         clips_json: str | None, no_audio: bool, no_upscale: bool,
         resume: str | None) -> None:

    if resume:
        job_id = resume
        work_dir = Path(tempfile.gettempdir()) / f"swap-{job_id}"
        if not work_dir.exists():
            raise click.ClickException(f"Job {job_id} が見つかりません: {work_dir}")
        print(f"\nResume job: {job_id}  Work: {work_dir}\n")
    else:
        job_id = str(uuid.uuid4())[:8]
        work_dir = Path(tempfile.gettempdir()) / f"swap-{job_id}"
        work_dir.mkdir(parents=True, exist_ok=True)
        print(f"\nJob: {job_id}  Work: {work_dir}\n")

    state_path = work_dir / "state.json"
    state = _load_state(state_path)

    clips_config = DEFAULT_CLIPS
    if clips_json:
        with open(clips_json, encoding="utf-8") as f:
            clips_config = json.load(f)

    clips_path = Path(clips_dir)
    clip_names = sorted(clips_config.keys(), key=lambda k: _clip_num(k))

    # ─── Step 1: 商品画像をアップロード ──────────────────────────────────────
    print("Step 1: 商品画像をアップロード中...")
    product_url = _ensure_product_url(state, Path(product), work_dir, state_path)
    print(f"  → {product_url}\n")

    # ─── Step 2: Claude でラベル＋商品ビジュアル説明を生成 ──────────────────
    if "clip_labels" not in state or "product_desc" not in state:
        print("Step 2: クリップラベル＋商品説明を生成中...")
        clip_labels = _generate_clip_labels(text, clip_names)
        product_desc = _describe_product_visually(text)
        state["clip_labels"] = clip_labels
        state["product_desc"] = product_desc
        _save_state(state_path, state)
        print(f"  商品説明（英語）: {product_desc}")
        print(f"  ラベル: {clip_labels}\n")
    else:
        clip_labels = state["clip_labels"]
        product_desc = state["product_desc"]
        print(f"Step 2: スキップ（キャッシュ済み）\n")

    # ─── Step 3: 各クリップを生成（FLUX Fill → Runway 並列 → バナー）──────────
    print("Step 3: クリップ生成")
    processed: list[Path] = []
    pending_runway: dict[str, dict] = {}  # Runway 並列用

    for name in clip_names:
        cfg = clips_config[name]
        out_path = work_dir / f"clip_{name}.mp4"

        if name in state.get("clips", {}):
            cached = Path(state["clips"][name])
            if cached.exists():
                processed.append(cached)
                print(f"  {name}: スキップ（生成済み）")
                continue

        print(f"  {name}:")

        # 3a: オリジナルクリップから先頭フレームを抽出
        source_name = cfg.get("source_clip", name)
        source_clip = clips_path / f"{source_name}.mp4"
        frame_path = work_dir / f"frame_{name}.jpg"

        if source_clip.exists():
            print(f"    フレーム抽出中...")
            _extract_frame(source_clip, frame_path)
        else:
            print(f"    ⚠ オリジナルクリップなし → 商品画像をフレームとして使用")
            shutil.copy(work_dir / "product_upload.jpg", frame_path)

        # 3b: マスク作成（商品ゾーン = 白、背景 = 黒）
        zone = cfg.get("zone")
        mask_path = work_dir / f"mask_{name}.png"
        if zone and source_clip.exists():
            _create_zone_mask(zone, mask_path)
            print(f"    マスク作成: zone={zone}")
        else:
            _create_full_mask(mask_path)
            print(f"    マスク作成: フレーム全体")

        # 3c: FLUX Pro Fill でインペインティング
        print(f"    FLUX Fill インペインティング中...", end="", flush=True)
        inpaint_prompt_tmpl = cfg.get(
            "inpaint_prompt",
            "A {product_desc}. Professional studio photography. Clean background."
        )
        inpaint_prompt = inpaint_prompt_tmpl.format(product_desc=product_desc)
        frame_url = _upload_file(frame_path)
        mask_url = _upload_file(mask_path)
        inpainted_url = _flux_fill_inpaint(frame_url, mask_url, inpaint_prompt)
        print(" 完了")

        # 3d: Runway Gen-3 に Submit（ポーリングは後でまとめて並列実行）
        print(f"    Runway Gen-3 submit中...", end="", flush=True)
        runway_prompt = cfg.get("runway_prompt", "Smooth natural product motion. 9:16 vertical video.")
        submit_data = _submit_runway(inpainted_url, runway_prompt)
        pending_runway[name] = {
            "submit_data": submit_data,
            "out_path": out_path,
            "inpainted_url": inpainted_url,
            "runway_prompt": runway_prompt,
            "label": clip_labels.get(name, ""),
        }
        print(f" 受付完了（request_id={submit_data.get('request_id', '?')[:8]}）")

    # 3d（続き）: 全クリップを並列ポーリング
    if pending_runway:
        print(f"\n  Runway {len(pending_runway)}クリップを並列ポーリング中（最大15分）...")
        _poll_all_runway(pending_runway)

    # 3e: 静止画チェック（最大3回リトライ）+ バナー焼き込み + state 保存
    for name in clip_names:
        if name not in pending_runway:
            continue
        job = pending_runway[name]
        out_path = job["out_path"]

        for attempt in range(3):
            if not _is_static_clip(out_path):
                break
            print(f"  {name}: 静止画検出→リトライ {attempt + 1}/3...")
            retry_prompt = "DYNAMIC VIDEO. " + job["runway_prompt"] + " Strong visible motion throughout."
            _generate_runway(job["inpainted_url"], retry_prompt, out_path)

        label = job["label"]
        if label:
            labeled = work_dir / f"clip_{name}_labeled.mp4"
            _add_banner(out_path, label, labeled)
            labeled.replace(out_path)

        processed.append(out_path)
        state.setdefault("clips", {})[name] = str(out_path)
        _save_state(state_path, state)
        print(f"  {name}: 完了")

    # ─── Step 4: 全クリップを結合 ────────────────────────────────────────────
    print("\nStep 4: クリップ結合")
    concat_path = work_dir / "concat.mp4"
    _concat_clips(processed, concat_path)
    total_dur = _get_duration(concat_path)
    print(f"  → {total_dur:.2f}秒  ({_get_resolution(concat_path)})\n")

    if no_audio:
        shutil.copy(concat_path, output)
        print(f"✅ 完了（音声なし）: {output}")
        print(f"   Job ID: {job_id}（--resume {job_id} で再実行可能）")
        return

    # ─── Step 5: Real-ESRGAN で4Kアップスケール ──────────────────────────────
    if no_upscale:
        upscale_path = concat_path
        print("Step 5: アップスケールスキップ（--no-upscale）\n")
    elif "upscale_path" in state and Path(state["upscale_path"]).exists():
        upscale_path = Path(state["upscale_path"])
        print(f"Step 5: スキップ（キャッシュ済み）\n")
    else:
        print("Step 5: Real-ESRGAN 4Kアップスケール中...")
        upscale_path = work_dir / "concat_4k.mp4"
        _upscale_esrgan(concat_path, upscale_path)
        state["upscale_path"] = str(upscale_path)
        _save_state(state_path, state)
        print(f"  → {_get_resolution(upscale_path)}\n")

    # ─── Step 6: ElevenLabs ナレーション ─────────────────────────────────────
    print("Step 6: ElevenLabs ナレーション生成")
    narration_text = _generate_narration(text, total_dur)
    print(f"  テキスト: {narration_text}")
    narration_path = work_dir / "narration.mp3"
    alignment = _elevenlabs_tts_with_timestamps(narration_text, narration_path)
    print(f"  → {narration_path}\n")

    # ─── Step 7: 音声ミックス＋字幕＋カラーグレード ──────────────────────────
    print("Step 7: 音声ミックス・字幕・カラーグレード")
    if alignment:
        sub_clips = _build_subtitle_from_alignment(narration_text, alignment)
    else:
        audio_dur = _get_duration(narration_path)
        sub_clips = _build_subtitle_segments(narration_text, audio_dur)
    _add_audio_with_subtitles(upscale_path, narration_path, Path(output), sub_clips)

    final_dur = _get_duration(Path(output))
    print(f"\n✅ 完了: {output}")
    print(f"   {final_dur:.1f}秒 / {_get_resolution(Path(output))}")
    print(f"   Job ID: {job_id}（--resume {job_id} で再実行可能）")


# ─── ユーティリティ ──────────────────────────────────────────────────────────

def _clip_num(stem: str) -> int:
    import re
    m = re.search(r"(\d+)$", stem)
    return int(m.group(1)) if m else 0


def _load_state(path: Path) -> dict:
    if path.exists():
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return {}


def _save_state(path: Path, state: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def _ensure_product_url(state: dict, product: Path, work_dir: Path, state_path: Path) -> str:
    """state の product_url を検証し、有効なら再利用・期限切れなら再アップロード"""
    if "product_url" in state:
        try:
            r = httpx.head(state["product_url"], timeout=10, follow_redirects=True)
            if r.status_code < 400:
                print(f"Step 1: スキップ（キャッシュ済み）")
                return state["product_url"]
        except Exception:
            pass
        print("  product_url 期限切れ → 再アップロード")
    url = _upload_image(product, work_dir)
    state["product_url"] = url
    _save_state(state_path, state)
    return url


def _upload_image(src: Path, work_dir: Path) -> str:
    """商品画像を 1080×1920 JPEG にリサイズして fal.ai にアップロード"""
    fal_key = os.environ.get("FAL_KEY", "").strip()
    if not fal_key:
        raise RuntimeError("FAL_KEY が未設定です")

    import fal_client
    os.environ["FAL_KEY"] = fal_key

    prepared = work_dir / "product_upload.jpg"
    cmd = [
        FFMPEG, "-y", "-i", str(src),
        "-vf",
        "scale=1080:1920:force_original_aspect_ratio=decrease,"
        "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=white",
        "-frames:v", "1", "-q:v", "2",
        str(prepared),
    ]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"画像リサイズ失敗: {r.stderr.decode()[-300:]}")

    return fal_client.upload_file(str(prepared))


def _upload_file(path: Path) -> str:
    """任意のファイルを fal.ai にアップロードして URL を返す"""
    import fal_client
    return fal_client.upload_file(str(path))


def _extract_frame(clip: Path, out: Path,
                   width: int = 1080, height: int = 1920) -> None:
    """クリップの先頭フレームを抽出（1080×1920 にリサイズ）"""
    cmd = [
        FFMPEG, "-y", "-i", str(clip),
        "-vf", f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
               f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=white",
        "-frames:v", "1", "-q:v", "2",
        str(out),
    ]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"フレーム抽出失敗: {r.stderr.decode()[-300:]}")


def _create_zone_mask(zone: dict, out: Path,
                      src_w: int = 2160, src_h: int = 3840,
                      out_w: int = 1080, out_h: int = 1920) -> None:
    """商品ゾーン（2160×3840基準）を白、背景を黒にした 1080×1920 マスク PNG を生成"""
    sx, sy = out_w / src_w, out_h / src_h
    x = int(zone["x"] * sx)
    y = int(zone["y"] * sy)
    w = max(1, int(zone["w"] * sx))
    h = max(1, int(zone["h"] * sy))
    cmd = [
        FFMPEG, "-y",
        "-f", "lavfi", "-i", f"color=black:s={out_w}x{out_h}:r=1",
        "-vf", f"drawbox=x={x}:y={y}:w={w}:h={h}:color=white:t=fill",
        "-frames:v", "1",
        str(out),
    ]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"マスク生成失敗: {r.stderr.decode()[-300:]}")


def _create_full_mask(out: Path, out_w: int = 1080, out_h: int = 1920) -> None:
    """フレーム全体が白のマスク（ゾーン未定義クリップ用）"""
    cmd = [
        FFMPEG, "-y",
        "-f", "lavfi", "-i", f"color=white:s={out_w}x{out_h}:r=1",
        "-frames:v", "1",
        str(out),
    ]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"フルマスク生成失敗: {r.stderr.decode()[-300:]}")


def _flux_fill_inpaint(frame_url: str, mask_url: str, prompt: str) -> str:
    """FLUX Pro Fill でマスク領域を新商品に置換し、合成済みフレームの URL を返す"""
    import fal_client
    result = fal_client.subscribe(
        FLUX_FILL_MODEL,
        arguments={
            "image_url": frame_url,
            "mask_url": mask_url,
            "prompt": prompt,
            "guidance_scale": 20,
            "num_inference_steps": 28,
            "output_format": "jpeg",
        },
    )
    if isinstance(result, dict):
        images = result.get("images", [])
        url = images[0].get("url") if images else result.get("url")
    else:
        images = getattr(result, "images", [])
        url = images[0].url if images else None

    if not url:
        raise RuntimeError(f"FLUX Fill 失敗: {result}")
    return url


def _submit_runway(image_url: str, prompt: str) -> dict:
    """Runway Gen-3 Alpha にジョブを投入し、submit_data（status_url / response_url）を返す"""
    fal_key = os.environ.get("FAL_KEY", "").strip()
    if not fal_key:
        raise RuntimeError("FAL_KEY が設定されていません")
    r = httpx.post(
        f"https://queue.fal.run/{RUNWAY_MODEL}",
        headers={"Authorization": f"Key {fal_key}", "Content-Type": "application/json"},
        json={"image_url": image_url, "prompt": prompt, "duration": 5, "ratio": "9:16"},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def _poll_all_runway(jobs: dict[str, dict]) -> None:
    """複数の Runway ジョブを並列ポーリングして各 out_path にダウンロード（最大15分）

    jobs: {name: {submit_data: {...}, out_path: Path}}
    """
    fal_key = os.environ.get("FAL_KEY", "").strip()
    poll_headers = {"Authorization": f"Key {fal_key}"}
    pending = dict(jobs)  # shallow copy

    for _ in range(180):  # 5s × 180 = 15分
        time.sleep(5)
        done_names = []
        for name, job in list(pending.items()):
            try:
                sr = httpx.get(job["submit_data"]["status_url"], headers=poll_headers, timeout=30)
            except Exception:
                continue
            if sr.status_code != 200:
                continue
            st = sr.json()
            status = st.get("status", "")
            if status == "FAILED":
                raise RuntimeError(f"{name}: Runway 失敗: {st}")
            if status != "COMPLETED":
                continue
            # 結果取得
            rr = httpx.get(job["submit_data"]["response_url"], headers=poll_headers, timeout=30)
            rr.raise_for_status()
            result = rr.json()
            video_url = (result.get("video") or {}).get("url") or result.get("url")
            if not video_url:
                raise RuntimeError(f"{name}: Runway 結果 URL なし: {result}")
            dl = httpx.get(video_url, timeout=180, follow_redirects=True)
            dl.raise_for_status()
            job["out_path"].write_bytes(dl.content)
            done_names.append(name)

        for name in done_names:
            del pending[name]
            print(f"  {name}: Runway 完了")

        if not pending:
            return

    raise RuntimeError(f"Runway タイムアウト（15分超過）: {list(pending.keys())}")


def _generate_runway(image_url: str, prompt: str, out: Path) -> None:
    """Runway Gen-3 Alpha image-to-video（単発・同期版）- 静止画リトライ用"""
    fal_key = os.environ.get("FAL_KEY", "").strip()
    if not fal_key:
        raise RuntimeError("FAL_KEY が設定されていません")

    submit_data = _submit_runway(image_url, prompt)
    poll_headers = {"Authorization": f"Key {fal_key}"}
    status_url = submit_data["status_url"]
    response_url = submit_data["response_url"]

    for _ in range(180):
        time.sleep(5)
        sr = httpx.get(status_url, headers=poll_headers, timeout=30)
        if sr.status_code == 200:
            st = sr.json()
            if st.get("status") == "COMPLETED":
                break
            if st.get("status") == "FAILED":
                raise RuntimeError(f"Runway 生成失敗: {st}")
    else:
        raise RuntimeError("Runway タイムアウト（15分超過）")

    rr = httpx.get(response_url, headers=poll_headers, timeout=30)
    rr.raise_for_status()
    result = rr.json()
    video_url = (result.get("video") or {}).get("url") or result.get("url")
    if not video_url:
        raise RuntimeError(f"Runway 結果 URL なし: {result}")
    dl = httpx.get(video_url, timeout=180, follow_redirects=True)
    dl.raise_for_status()
    out.write_bytes(dl.content)


def _upscale_esrgan(src: Path, out: Path) -> None:
    """fal.ai Real-ESRGAN で4Kアップスケール（フォールバック: lanczos）"""
    import fal_client
    video_url = _upload_file(src)
    try:
        result = fal_client.subscribe(
            "fal-ai/real-esrgan",
            arguments={"video_url": video_url, "scale": 4, "model": "RealESRGAN_x4plus"},
        )
        if isinstance(result, dict):
            upscaled_url = (result.get("video") or {}).get("url") or result.get("url")
        else:
            upscaled_url = getattr(getattr(result, "video", None), "url", None)

        if not upscaled_url:
            raise RuntimeError("URL なし")

        raw = out.parent / "upscale_raw.mp4"
        r = httpx.get(upscaled_url, timeout=300, follow_redirects=True)
        r.raise_for_status()
        raw.write_bytes(r.content)

        cmd = [FFMPEG, "-y", "-i", str(raw),
               "-vf", "scale=2160:3840:flags=lanczos",
               "-c:v", "libx264", "-pix_fmt", "yuv420p",
               "-preset", "fast", "-b:v", "55M", "-c:a", "copy", str(out)]
        r2 = subprocess.run(cmd, capture_output=True)
        if r2.returncode != 0:
            raise RuntimeError(r2.stderr.decode()[-300:])
        raw.unlink(missing_ok=True)

    except Exception as e:
        print(f"  ⚠ Real-ESRGAN 失敗 → ソフトウェアアップスケール: {e}")
        cmd = [FFMPEG, "-y", "-i", str(src),
               "-vf", "scale=2160:3840:flags=lanczos+accurate_rnd",
               "-c:v", "libx264", "-pix_fmt", "yuv420p",
               "-preset", "medium", "-b:v", "55M", "-c:a", "copy", str(out)]
        r = subprocess.run(cmd, capture_output=True)
        if r.returncode != 0:
            raise RuntimeError(f"ソフトアップスケール失敗: {r.stderr.decode()[-300:]}")


def _concat_clips(clips: list[Path], out: Path) -> None:
    lst = out.parent / "list.txt"
    lst.write_text("\n".join(f"file '{c.resolve()}'" for c in clips), encoding="utf-8")
    cmd = [FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
           "-c", "copy", str(out)]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"concat 失敗: {r.stderr.decode()[-500:]}")
    lst.unlink(missing_ok=True)


def _get_duration(path: Path) -> float:
    r = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True,
    )
    return float(r.stdout.strip() or 0)


def _get_resolution(path: Path) -> str:
    r = subprocess.run(
        [FFPROBE, "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True,
    )
    parts = r.stdout.strip().splitlines()
    return f"{parts[0]}×{parts[1]}" if len(parts) >= 2 else "?"


def _describe_product_visually(text: str) -> str:
    """Claude で商品の視覚的外観を英語で短く記述（FLUX Fill / Runway プロンプト用）"""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return text
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    msg = client.messages.create(
        model=os.environ.get("CLAUDE_HAIKU_MODEL", "claude-haiku-4-5-20251001"),
        max_tokens=64,
        messages=[{
            "role": "user",
            "content": (
                f"Describe the visual appearance of this product in 10-15 English words "
                f"suitable for an AI image generator prompt.\n"
                f"Product: {text}\n"
                f"Focus on: shape, color, material, distinctive features. No brand names unless visual.\n"
                f"Example: 'white cylindrical stainless steel water bottle with gray screw cap'\n"
                f"Reply with the description only."
            ),
        }],
    )
    return msg.content[0].text.strip()


def _generate_clip_labels(text: str, clip_names: list[str]) -> dict[str, str]:
    """Claude Haiku でクリップごとのキーワードラベルを生成"""
    n = len(clip_names)
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return {}
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    msg = client.messages.create(
        model=os.environ.get("CLAUDE_HAIKU_MODEL", "claude-haiku-4-5-20251001"),
        max_tokens=128,
        messages=[{
            "role": "user",
            "content": (
                f"商品: {text}\n\n"
                f"TikTok商品動画の{n}クリップ分に表示するキーワードラベルを作ってください。\n"
                f"各ラベルは6〜12文字の日本語。例: 「TikTokでバズ中」「大容量対応」「使い心地◎」\n"
                f"JSON配列のみを返してください（ちょうど{n}個）。"
                f"マークダウン・コードブロック不要。"
            ),
        }],
    )
    import re
    m = re.search(r"\[.*?\]", msg.content[0].text.strip(), re.DOTALL)
    if not m:
        return {}
    labels: list[str] = json.loads(m.group(0))
    return {name: labels[i] for i, name in enumerate(clip_names) if i < len(labels)}


def _generate_narration(text: str, duration_sec: float) -> str:
    """Claude Haiku でナレーションテキストを生成"""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return f"{text}。気になってたので試してみました！使い心地が最高で毎日使ってます。気になる方はチェックしてみてください！"
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    msg = client.messages.create(
        model=os.environ.get("CLAUDE_HAIKU_MODEL", "claude-haiku-4-5-20251001"),
        max_tokens=256,
        messages=[{
            "role": "user",
            "content": (
                f"商品説明: {text}\n"
                f"動画尺: {duration_sec:.0f}秒\n\n"
                f"この商品のTikTok Shop風ナレーションを{int(duration_sec * 3.5)}文字前後の日本語で書いてください。\n"
                f"構成: フック（1文）→ベネフィット（2文）→CTA（1文）。自然な話し言葉のみ。\n"
                f"【絶対厳守】タイトル・ラベル・見出し・マークダウン記法は一切使わない。話し言葉だけ返す。"
            ),
        }],
    )
    return msg.content[0].text.strip()


def _elevenlabs_tts_with_timestamps(text: str, out: Path) -> dict | None:
    """ElevenLabs で TTS 生成（文字レベルタイムスタンプ付き）"""
    api_key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    voice_id = os.environ.get("ELEVENLABS_VOICE", "").strip()
    if not api_key or not voice_id:
        raise RuntimeError("ELEVENLABS_API_KEY または ELEVENLABS_VOICE が未設定")

    headers = {"xi-api-key": api_key, "Content-Type": "application/json"}

    # 利用可能モデルを事前確認（有料プランのみ eleven_v3 が使える）
    models_to_try = ["eleven_v3", "eleven_multilingual_v2"]
    try:
        mr = httpx.get(
            "https://api.elevenlabs.io/v1/models",
            headers={"xi-api-key": api_key},
            timeout=10,
        )
        if mr.status_code == 200:
            available_ids = {m.get("model_id") for m in mr.json()}
            # eleven_v3 が一覧にない場合はスキップ
            if "eleven_v3" not in available_ids:
                models_to_try = ["eleven_multilingual_v2"]
                print("  eleven_v3 非対応プラン → eleven_multilingual_v2 を使用")
    except Exception:
        pass  # フォールバックシーケンスに委ねる

    body = {
        "text": text,
        "voice_settings": {
            "stability": 0.30,
            "similarity_boost": 0.75,
            "style": 0.45,
            "use_speaker_boost": True,
        },
    }

    for model_id in models_to_try:
        body["model_id"] = model_id
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps"
        r = httpx.post(url, json=body, headers=headers, timeout=120)
        if r.status_code == 200:
            import base64
            data = r.json()
            out.write_bytes(base64.b64decode(data["audio_base64"]))
            print(f"  モデル: {model_id}")
            return data.get("alignment")
        elif r.status_code in (402, 422) and model_id == "eleven_v3":
            print("  eleven_v3 不可 → eleven_multilingual_v2 にフォールバック")
            continue
        else:
            r.raise_for_status()

    raise RuntimeError("ElevenLabs TTS 失敗")


def _build_subtitle_from_alignment(text: str, alignment: dict) -> list[dict]:
    """ElevenLabs 文字レベルタイムスタンプから字幕セグメントを生成"""
    chars = alignment.get("characters", [])
    starts = alignment.get("character_start_times_seconds", [])
    ends = alignment.get("character_end_times_seconds", [])
    if not chars:
        return []

    segments: list[dict] = []
    phrase_chars: list[str] = []
    phrase_start: float | None = None

    for i, char in enumerate(chars):
        if phrase_start is None:
            phrase_start = starts[i] if i < len(starts) else 0.0
        phrase_chars.append(char)
        if char in "。！？" or i == len(chars) - 1:
            phrase_text = "".join(phrase_chars).strip()
            phrase_end = ends[i] if i < len(ends) else starts[i]
            if phrase_text:
                segments.append({
                    "text": phrase_text,
                    "start": round(phrase_start, 3),
                    "end": round(phrase_end, 3),
                })
            phrase_chars = []
            phrase_start = None

    return segments


def _build_subtitle_segments(narration_text: str, audio_dur: float) -> list[dict]:
    """フォールバック: 文字数比例で字幕タイミングを推定"""
    import re
    parts = [p.strip() for p in re.split(r"[。！？…]", narration_text) if p.strip()]
    if not parts:
        return [{"text": narration_text, "start": 0.0, "end": round(audio_dur, 2)}]
    total_chars = sum(len(p) for p in parts)
    segments, t = [], 0.0
    for i, part in enumerate(parts):
        end = round(t + audio_dur * len(part) / total_chars, 2)
        if i == len(parts) - 1:
            end = round(audio_dur, 2)
        segments.append({"text": part, "start": round(t, 2), "end": end})
        t = end
    return segments


def _is_static_clip(path: Path) -> bool:
    """静止画クリップかどうか判定（2秒以上の凍結を検出）"""
    r = subprocess.run(
        [FFMPEG, "-i", str(path), "-vf", "freezedetect=n=0.003:d=2.0", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    return "freeze_duration" in r.stderr


def _find_font() -> str | None:
    for p in [
        "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
        "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
        "/Library/Fonts/Arial Unicode.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    ]:
        if Path(p).exists():
            return p
    return None


def _escape_ffmpeg_text(s: str) -> str:
    """ffmpeg drawtext 用テキストを安全にエスケープ"""
    return s.replace("\\", "\\\\").replace("'", "\\'").replace(":", "\\:").replace("%", "\\%")


def _add_banner(clip: Path, label: str, out: Path) -> None:
    """クリップ上部にキーワードバナーを焼き込む"""
    font_path = _find_font()
    font_opt = f"fontfile='{font_path}':" if font_path else ""
    safe = _escape_ffmpeg_text(label)
    vf = (
        f"drawtext={font_opt}text='{safe}'"
        f":fontsize=72:fontcolor=white"
        f":x=(w-text_w)/2:y=h*0.10"
        f":shadowcolor=black@0.9:shadowx=3:shadowy=3"
        f":borderw=4:bordercolor=black@0.75"
        f":enable='between(t,0.3,4.7)'"
    )
    cmd = [FFMPEG, "-y", "-i", str(clip), "-vf", vf,
           "-c:v", "libx264", "-pix_fmt", "yuv420p",
           "-preset", "fast", "-b:v", "15M", "-c:a", "copy", str(out)]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"バナー焼き込み失敗: {r.stderr.decode()[-300:]}")


def _add_audio_with_subtitles(
    video: Path, audio: Path, out: Path, subtitles: list[dict]
) -> None:
    """音声追加＋字幕焼き込み＋ウォームカラーグレード"""
    font_path = _find_font()
    font_opt = f"fontfile='{font_path}':" if font_path else ""

    res = _get_resolution(video)
    try:
        in_w = int(res.split("×")[0])
    except Exception:
        in_w = 720
    base_fontsize = max(40, int(40 * in_w / 720))

    drawtext_filters = []
    for sub in subtitles:
        safe = _escape_ffmpeg_text(sub["text"])
        drawtext_filters.append(
            f"drawtext={font_opt}text='{safe}'"
            f":fontsize={base_fontsize}:fontcolor=white"
            f":x=(w-text_w)/2:y=h*0.88"
            f":shadowcolor=black@0.8:shadowx=2:shadowy=2"
            f":borderw=3:bordercolor=black@0.7"
            f":enable='between(t,{sub['start']},{sub['end']})'"
        )

    warm_grade = (
        "eq=brightness=0.03:contrast=1.08:saturation=1.15,"
        "colorbalance=rs=0.04:gs=0.02:bs=-0.06:"
                     "rm=0.02:gm=0.01:bm=-0.04:"
                     "rh=0.01:gh=0.00:bh=-0.02"
    )
    scale_filter = "scale=2160:3840:flags=lanczos"

    if in_w >= 2160:
        vf_parts = [warm_grade] + drawtext_filters
    else:
        vf_parts = [warm_grade, scale_filter] + drawtext_filters

    vf = ",".join(vf_parts) if vf_parts else "null"

    cmd = [
        FFMPEG, "-y",
        "-i", str(video), "-i", str(audio),
        "-map", "0:v:0", "-map", "1:a:0",
        "-vf", vf, "-r", "30",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-preset", "medium", "-b:v", "55M", "-maxrate", "65M", "-bufsize", "130M",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest", str(out),
    ]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"add_audio_with_subtitles 失敗: {r.stderr.decode()[-800:]}")


if __name__ == "__main__":
    main()
