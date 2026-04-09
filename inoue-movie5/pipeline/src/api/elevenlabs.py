from __future__ import annotations
"""ElevenLabs TTS API ラッパー"""
from pathlib import Path

import httpx


def generate_tts(
    text: str,
    output_path: Path,
    api_key: str,
    voice_id: str,
    model_id: str = "eleven_multilingual_v2",
    stability: float = 0.5,
    similarity_boost: float = 0.75,
    style: float = 0.3,
) -> Path:
    """
    ElevenLabs で TTS 音声を生成し output_path（.mp3 or .m4a）に保存する。
    """
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }
    body = {
        "text": text,
        "model_id": model_id,
        "voice_settings": {
            "stability": stability,
            "similarity_boost": similarity_boost,
            "style": style,
            "use_speaker_boost": True,
        },
    }

    with httpx.Client(timeout=60) as client:
        r = client.post(url, json=body, headers=headers)
        r.raise_for_status()
        with open(output_path, "wb") as f:
            f.write(r.content)

    return output_path
