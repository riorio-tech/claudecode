import os
from pathlib import Path
from dotenv import load_dotenv

_pipeline_dir = Path(__file__).parent.parent
_root_dir = _pipeline_dir.parent  # inoue-movie5/

# ルートの .env を先に読み込み、pipeline/.env で上書き
load_dotenv(_root_dir / ".env")
load_dotenv(_pipeline_dir / ".env", override=True)


def get_runway_api_key() -> str:
    key = os.environ.get("RUNWAY_API_KEY", "")
    if not key:
        raise RuntimeError("RUNWAY_API_KEY が設定されていません。.env を確認してください。")
    return key


def get_kling_api_key() -> str:
    key = os.environ.get("KLING_API_KEY", "")
    if not key:
        raise RuntimeError("KLING_API_KEY が設定されていません。.env を確認してください。")
    return key


def get_fal_key() -> str:
    key = os.environ.get("FAL_KEY", "")
    if not key:
        raise RuntimeError("FAL_KEY が設定されていません。.env を確認してください。")
    return key


def has_fal_key() -> bool:
    return bool(os.environ.get("FAL_KEY", ""))


def get_elevenlabs_key() -> str:
    key = os.environ.get("ELEVENLABS_API_KEY", "")
    if not key:
        raise RuntimeError("ELEVENLABS_API_KEY が設定されていません。.env を確認してください。")
    return key


def get_elevenlabs_voice() -> str:
    return os.environ.get("ELEVENLABS_VOICE", "")


def has_elevenlabs_key() -> bool:
    return bool(os.environ.get("ELEVENLABS_API_KEY", ""))


def has_anthropic_key() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY", ""))


def get_bgm_path() -> str:
    return os.environ.get("BGM_PATH", "")


# ffmpeg / ffprobe のパス（環境変数で上書き可能、デフォルトは PATH から解決）
FFMPEG_PATH: str = os.environ.get("FFMPEG_PATH", "ffmpeg")
FFPROBE_PATH: str = os.environ.get("FFPROBE_PATH", "ffprobe")

# ジョブ一時ディレクトリのベース
WORK_DIR_BASE: Path = Path(os.environ.get("WORK_DIR", "/tmp"))
