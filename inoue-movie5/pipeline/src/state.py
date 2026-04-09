from __future__ import annotations
import json
from pathlib import Path


class PipelineState:
    """
    ジョブの各ステップ完了状態を state.json に永続化する。
    失敗ステップのみ再実行するための基盤。
    """

    STEPS = ["script", "hook", "benefit", "cta", "concat", "grain", "audio"]

    def __init__(self, job_id: str, work_dir: Path):
        self.job_id = job_id
        self.work_dir = work_dir
        self.work_dir.mkdir(parents=True, exist_ok=True)
        self._state_path = work_dir / "state.json"
        self._data: dict = self._load()

    def _load(self) -> dict:
        if self._state_path.exists():
            with open(self._state_path) as f:
                return json.load(f)
        return {"job_id": self.job_id, "steps": {}}

    def save(self) -> None:
        with open(self._state_path, "w") as f:
            json.dump(self._data, f, indent=2, ensure_ascii=False)

    def is_done(self, step: str) -> bool:
        entry = self._data["steps"].get(step)
        if not entry:
            return False
        # 出力ファイルが実際に存在するかも確認（壊れた state の検出）
        output_path = entry.get("output_path", "")
        return bool(output_path) and Path(output_path).exists()

    def mark_done(self, step: str, output_path: str) -> None:
        self._data["steps"][step] = {"output_path": str(output_path), "done": True}
        self.save()

    def get_output(self, step: str) -> str | None:
        entry = self._data["steps"].get(step)
        if entry and entry.get("done"):
            return entry.get("output_path")
        return None

    def reset_step(self, step: str) -> None:
        """特定ステップのみリセットして再実行可能にする"""
        self._data["steps"].pop(step, None)
        self.save()

    def summary(self) -> str:
        lines = [f"Job: {self.job_id}"]
        for step in self.STEPS:
            status = "✅ done" if self.is_done(step) else "⬜ pending"
            lines.append(f"  {step:10s} {status}")
        return "\n".join(lines)
