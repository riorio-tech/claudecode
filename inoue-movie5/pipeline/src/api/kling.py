import time
from pathlib import Path

import httpx

from ..config import get_kling_api_key


BASE_URL = "https://api.kie.ai/api/v1"
POLL_INTERVAL = 5
MAX_WAIT = 600   # Kling は生成が遅い場合があるため余裕を持たせる


class KlingError(Exception):
    pass


def generate_benefit(image_url: str, prompt: str, output_path: Path, duration: str = "10") -> Path:
    """
    Kling v2.1 standard で BENEFIT 動画を生成し output_path に保存する。

    duration: "5" or "10"
    """
    api_key = get_kling_api_key()
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": "kling-v2-1-standard/image-to-video",
        "input": {
            "prompt": prompt,
            "image_urls": [image_url],
            "duration": duration,
        },
    }

    print(f"  [Kling] ジョブ投入中 (duration={duration}s)...")
    with httpx.Client(timeout=30) as client:
        resp = client.post(f"{BASE_URL}/jobs/createTask", headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()

    if data.get("code") != 0:
        raise KlingError(f"Kling ジョブ投入失敗: {data}")

    task_id = data["data"]["taskId"]
    print(f"  [Kling] task_id={task_id} ポーリング開始")

    waited = 0
    while waited < MAX_WAIT:
        time.sleep(POLL_INTERVAL)
        waited += POLL_INTERVAL

        with httpx.Client(timeout=30) as client:
            resp = client.get(f"{BASE_URL}/jobs/{task_id}", headers=headers)
            resp.raise_for_status()
            result = resp.json()

        task_data = result.get("data", {})
        status = task_data.get("status", "")

        if status == "completed":
            videos = task_data.get("output", {}).get("video", [])
            if not videos:
                raise KlingError("Kling: 動画 URL が返却されませんでした")
            video_url = videos[0]["url"]
            print(f"  [Kling] 生成完了 → ダウンロード中")
            _download(video_url, output_path)
            return output_path

        if status == "failed":
            raise KlingError(f"Kling タスク失敗: task_id={task_id}, data={task_data}")

        print(f"  [Kling] {status} ({waited}s 経過)")

    raise KlingError(f"Kling タイムアウト: {MAX_WAIT}秒以内に完了しませんでした")


def _download(url: str, dest: Path) -> None:
    with httpx.stream("GET", url, follow_redirects=True, timeout=120) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_bytes(chunk_size=65536):
                f.write(chunk)
