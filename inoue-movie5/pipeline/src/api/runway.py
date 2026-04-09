import time
from pathlib import Path

import httpx

from ..config import get_runway_api_key


POLL_INTERVAL = 5      # 秒
MAX_WAIT = 300         # 最大待機秒数


class RunwayError(Exception):
    pass


def generate_hook(image_url: str, prompt: str, output_path: Path) -> Path:
    """
    Runway Gen-3 Alpha Turbo で HOOK 動画（5秒）を生成し output_path に保存する。

    Runway は duration=5 が最短なので生成後に ffmpeg でトリムする必要があれば
    pipeline.py 側で行う。ここでは生のダウンロードのみ。
    """
    api_key = get_runway_api_key()

    try:
        from runwayml import RunwayML
    except ImportError:
        raise RunwayError("runwayml パッケージが未インストールです: pip install runwayml")

    client = RunwayML(api_key=api_key)

    print(f"  [Runway] ジョブ投入中...")
    task = client.image_to_video.create(
        model="gen3a_turbo",
        prompt_image=image_url,
        prompt_text=prompt,
        duration=5,
        ratio="9:16",
    )
    task_id = task.id
    print(f"  [Runway] task_id={task_id} ポーリング開始")

    waited = 0
    while waited < MAX_WAIT:
        time.sleep(POLL_INTERVAL)
        waited += POLL_INTERVAL

        status_obj = client.tasks.retrieve(task_id)
        status = status_obj.status

        if status == "SUCCEEDED":
            video_url = status_obj.output[0]
            print(f"  [Runway] 生成完了 → ダウンロード中")
            _download(video_url, output_path)
            return output_path

        if status == "FAILED":
            raise RunwayError(f"Runway タスク失敗: task_id={task_id}")

        print(f"  [Runway] {status} ({waited}s 経過)")

    raise RunwayError(f"Runway タイムアウト: {MAX_WAIT}秒以内に完了しませんでした")


def _download(url: str, dest: Path) -> None:
    with httpx.stream("GET", url, follow_redirects=True, timeout=120) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_bytes(chunk_size=65536):
                f.write(chunk)
