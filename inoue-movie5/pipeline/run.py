#!/usr/bin/env python3
from __future__ import annotations
"""
TikTok Shop 動画自動生成パイプライン

Usage:
  python run.py --image <url> --text "説明文"
  python run.py --image <url> --text "説明文" --resume <job_id>
  python run.py --image <url> --text "説明文" --step hook
  python run.py --image <url> --text "説明文" --output custom.mp4
"""

import sys
from pathlib import Path

# src/ を import パスに追加
sys.path.insert(0, str(Path(__file__).parent))

import click
from src import pipeline as pl
from src.config import WORK_DIR_BASE
from src.state import PipelineState


@click.command()
@click.option("--image", required=True, help="商品画像 URL")
@click.option("--text", required=True, help="商品説明テキスト")
@click.option("--resume", default=None, metavar="JOB_ID",
              help="中断した job_id を指定して失敗ステップから再開")
@click.option("--output", default="output.mp4", show_default=True,
              help="出力 MP4 ファイルパス")
@click.option("--step", default=None,
              type=click.Choice(PipelineState.STEPS),
              help="指定したステップのみ強制再実行")
@click.option("--status", default=None, metavar="JOB_ID",
              help="ジョブのステップ状態を表示して終了")
def main(image: str, text: str, resume: str | None, output: str,
         step: str | None, status: str | None):

    # --status: ジョブ状態の表示のみ
    if status:
        work_dir = WORK_DIR_BASE / f"inoue-pipeline-{status}"
        if not work_dir.exists():
            click.echo(f"ジョブが見つかりません: {status}", err=True)
            sys.exit(1)
        state = PipelineState(status, work_dir)
        click.echo(state.summary())
        return

    try:
        pl.run(
            image_url=image,
            text=text,
            output_path=Path(output),
            job_id=resume,
            only_step=step,
        )
    except Exception as e:
        click.echo(f"\n❌ エラー: {e}", err=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
