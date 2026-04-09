from __future__ import annotations
"""
fal.ai 経由で動画生成とファイルアップロードを行うモジュール。
RUNWAY_API_KEY / KLING_API_KEY がない場合のフォールバックとしても使用。
"""
import os
from pathlib import Path

import httpx

from ..config import get_fal_key


def upload_file(local_path: str | Path) -> str:
    """
    ローカル画像ファイルを fal.ai ストレージにアップロードして公開 URL を返す。
    """
    get_fal_key()  # キー存在確認
    import fal_client
    os.environ.setdefault("FAL_KEY", os.environ["FAL_KEY"])
    url = fal_client.upload_file(str(local_path))
    return url


def ensure_url(path_or_url: str) -> str:
    """ローカルパスなら fal.ai にアップロード、URL はそのまま返す"""
    if path_or_url.startswith("http"):
        return path_or_url
    return upload_file(path_or_url)


def generate_video(
    image_url: str,
    prompt: str,
    output_path: Path,
    duration: str = "5",
    model: str = "fal-ai/kling-video/v1.6/standard/image-to-video",
) -> Path:
    """
    fal.ai で画像→動画を生成し output_path に保存する。

    Args:
        image_url:   公開アクセス可能な画像 URL
        prompt:      動画生成プロンプト
        output_path: 保存先 MP4
        duration:    "5" or "10"
        model:       fal.ai エンドポイント
    """
    import fal_client

    fal_key = get_fal_key()
    os.environ["FAL_KEY"] = fal_key

    print(f"  [fal.ai] モデル: {model}")
    print(f"  [fal.ai] duration={duration}s, プロンプト: {prompt[:80]}...")

    arguments = {
        "image_url": image_url,
        "prompt": prompt,
        "duration": duration,
        "aspect_ratio": "9:16",
    }

    result = fal_client.subscribe(
        model,
        arguments=arguments,
        with_logs=False,
    )

    # fal.ai のレスポンスは属性アクセスまたは dict アクセスの両方を試みる
    video_url = (
        getattr(getattr(result, "video", None), "url", None)
        or (result.get("video", {}).get("url") if isinstance(result, dict) else None)
        or (result["video"]["url"] if isinstance(result, dict) else None)
    )

    if not video_url:
        raise RuntimeError(f"fal.ai から動画 URL が取得できませんでした: {result}")

    print(f"  [fal.ai] 生成完了 → ダウンロード中")
    _download(video_url, output_path)
    return output_path


def _download(url: str, dest: Path) -> None:
    with httpx.stream("GET", url, follow_redirects=True, timeout=120) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_bytes(chunk_size=65536):
                f.write(chunk)
