from __future__ import annotations
import subprocess
import tempfile
from pathlib import Path

import httpx

from ..config import FFMPEG_PATH, FFPROBE_PATH

# macOS / Linux で使える日本語フォント候補
_FONT_CANDIDATES = [
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJKjp-Regular.otf",
]


def _find_font() -> str | None:
    for p in _FONT_CANDIDATES:
        if Path(p).exists():
            return p
    return None


class FFmpegError(Exception):
    pass


def generate_cta(image_url: str, text: str, output_path: Path, duration: int = 2, style: dict | None = None) -> Path:
    """
    静止画 + テキストオーバーレイで CTA クリップを生成する。
    image_url は URL またはローカルパス。
    """
    s = style or {}
    font_size = s.get("font_size", 96)
    font_color = s.get("font_color", "white")
    shadow_color = s.get("shadow_color", "black@0.6")
    shadow_offset = s.get("shadow_offset", 4)
    pos_y = s.get("position_y", "h*0.78")

    # URL の場合は一時ファイルにダウンロード
    if image_url.startswith("http"):
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            tmp_path = Path(tmp.name)
        _download_file(image_url, tmp_path)
        input_path = tmp_path
    else:
        input_path = Path(image_url)

    font_path = _find_font()
    font_opt = f"fontfile='{font_path}':" if font_path else ""

    safe_text = text.replace("'", "\\'").replace(":", "\\:")
    drawtext = (
        f"drawtext={font_opt}text='{safe_text}'"
        f":fontsize={font_size}"
        f":fontcolor={font_color}"
        f":x=(w-text_w)/2:y={pos_y}"
        f":shadowcolor={shadow_color}:shadowx={shadow_offset}:shadowy={shadow_offset}"
        f":borderw=3:bordercolor=black@0.5"
    )

    vf = (
        f"scale=1080:1920:force_original_aspect_ratio=increase,"
        f"crop=1080:1920,"
        f"{drawtext}"
    )

    cmd = [
        FFMPEG_PATH, "-y",
        "-loop", "1", "-i", str(input_path),
        "-t", str(duration),
        "-r", "30",
        "-vf", vf,
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-preset", "medium", "-b:v", "8M",
        str(output_path),
    ]
    _run(cmd)
    return output_path


def trim_clip(input_path: Path, output_path: Path, duration: float) -> Path:
    """動画を先頭 duration 秒にトリムする（-c copy で無劣化）"""
    cmd = [
        FFMPEG_PATH, "-y",
        "-i", str(input_path),
        "-t", str(duration),
        "-c", "copy",
        str(output_path),
    ]
    _run(cmd)
    return output_path


def concat_clips(clips: list[Path], output_path: Path) -> Path:
    """ffmpeg concat demuxer で複数クリップを結合する"""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        list_path = Path(f.name)
        for clip in clips:
            f.write(f"file '{clip.resolve()}'\n")

    cmd = [
        FFMPEG_PATH, "-y",
        "-f", "concat", "-safe", "0",
        "-i", str(list_path),
        "-c", "copy",
        str(output_path),
    ]
    _run(cmd)
    list_path.unlink(missing_ok=True)
    return output_path


def add_film_grain(input_path: Path, output_path: Path, strength: float = 0.04) -> Path:
    """
    ffmpeg の geq フィルターでフィルムグレインを追加する。
    strength: 0.0〜0.1 程度（0.04 が自然な質感）
    """
    noise = int(strength * 255)
    vf = (
        f"geq="
        f"lum='lum(X,Y)+{noise}*(random(1)-0.5)*2':"
        f"cb='cb(X,Y)':"
        f"cr='cr(X,Y)'"
    )

    codec = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-b:v", "12M",
             "-maxrate", "15M", "-bufsize", "30M"]
    audio = ["-c:a", "copy"]

    cmd = [FFMPEG_PATH, "-y", "-i", str(input_path), "-vf", vf] + codec + audio + [str(output_path)]
    _run(cmd)
    return output_path


def force_vertical(input_path: Path, output_path: Path) -> Path:
    """動画を 1080×1920 (9:16 縦型) にスケール＆クロップする"""
    vf = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"
    codec = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-b:v", "12M",
             "-maxrate", "15M", "-bufsize", "30M"]
    # 入力に音声がある場合はコピー、ない場合は無視
    cmd = [FFMPEG_PATH, "-y", "-i", str(input_path), "-vf", vf] + codec + ["-c:a", "copy", str(output_path)]
    _run(cmd)
    return output_path


def add_subtitle_overlays(
    input_path: Path,
    output_path: Path,
    subtitles: list[dict],
) -> Path:
    """
    動画に時間帯別字幕オーバーレイを追加する。
    subtitles: [{"text": "...", "start": 0.0, "end": 3.0}, ...]
    """
    if not subtitles:
        import shutil as _sh
        _sh.copy(input_path, output_path)
        return output_path

    font_path = _find_font()
    font_opt = f"fontfile='{font_path}':" if font_path else ""

    vf_parts = []
    for sub in subtitles:
        safe_text = sub["text"].replace("'", "\\'").replace(":", "\\:").replace("\\", "\\\\")
        start = sub["start"]
        end = sub["end"]
        dt = (
            f"drawtext={font_opt}text='{safe_text}'"
            f":fontsize=54:fontcolor=white"
            f":x=(w-text_w)/2:y=h*0.84"
            f":shadowcolor=black@0.9:shadowx=3:shadowy=3"
            f":borderw=4:bordercolor=black@0.8"
            f":enable='between(t,{start},{end})'"
        )
        vf_parts.append(dt)

    vf = ",".join(vf_parts)
    codec = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-b:v", "12M",
             "-maxrate", "15M", "-bufsize", "30M"]
    cmd = [FFMPEG_PATH, "-y", "-i", str(input_path), "-vf", vf] + codec + ["-c:a", "copy", str(output_path)]
    _run(cmd)
    return output_path


def mix_bgm(video_path: Path, bgm_path: Path, output_path: Path, bgm_volume: float = 0.12) -> Path:
    """ナレーション済み動画に BGM を低音量でミックスする"""
    cmd = [
        FFMPEG_PATH, "-y",
        "-i", str(video_path),
        "-stream_loop", "-1", "-i", str(bgm_path),
        "-filter_complex",
        f"[1:a]volume={bgm_volume}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=1[aout]",
        "-map", "0:v",
        "-map", "[aout]",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k",
        str(output_path),
    ]
    _run(cmd)
    return output_path


def add_audio_to_video(video_path: Path, audio_path: Path, output_path: Path) -> Path:
    """動画に音声トラックを追加する（動画の長さに合わせて音声をカット）"""
    cmd = [
        FFMPEG_PATH, "-y",
        "-i", str(video_path),
        "-i", str(audio_path),
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        str(output_path),
    ]
    _run(cmd)
    return output_path


def concat_audio(audio_files: list[Path], output_path: Path) -> Path:
    """複数の音声ファイルを順番に結合する"""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        list_path = Path(f.name)
        for af in audio_files:
            f.write(f"file '{af.resolve()}'\n")
    cmd = [
        FFMPEG_PATH, "-y",
        "-f", "concat", "-safe", "0",
        "-i", str(list_path),
        "-c:a", "aac", "-b:a", "192k",
        str(output_path),
    ]
    _run(cmd)
    list_path.unlink(missing_ok=True)
    return output_path


def get_duration(video_path: Path) -> float:
    """ffprobe で動画の尺（秒）を返す"""
    cmd = [
        FFPROBE_PATH,
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(video_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return float(result.stdout.strip())
    except ValueError:
        return 0.0


def _run(cmd: list[str]) -> None:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise FFmpegError(f"ffmpeg 失敗:\n{result.stderr[-2000:]}")


def _download_file(url: str, dest: Path) -> None:
    with httpx.stream("GET", url, follow_redirects=True, timeout=60) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_bytes(chunk_size=65536):
                f.write(chunk)
