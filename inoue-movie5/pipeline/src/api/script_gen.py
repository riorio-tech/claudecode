from __future__ import annotations
"""
Claude API でTikTok Shop動画の構成スクリプトを生成するモジュール。
商品説明テキストから、動画プロンプト・ナレーション・字幕を一括生成する。
"""
import json
import re


def generate(product_text: str, system_prompt: str, model: str = "claude-sonnet-4-6") -> dict:
    """
    Claude を使って動画スクリプトを生成する。

    Returns:
        {
          "hook_video_prompt": str,     # Kling 向け英語プロンプト
          "benefit_video_prompt": str,  # Kling 向け英語プロンプト
          "hook_narration": str,        # フック部ナレーション（〜4秒）
          "benefit_narration": str,     # ベネフィット部ナレーション（〜10秒）
          "cta_narration": str,         # CTA ナレーション（〜2秒）
          "hook_subtitle": str,         # フック部字幕（15字以内）
          "benefit_subtitle": str,      # ベネフィット部字幕（20字以内）
          "cta_text": str,             # CTA 表示テキスト（10字以内）
        }
    """
    import anthropic

    client = anthropic.Anthropic()
    message = client.messages.create(
        model=model,
        max_tokens=1024,
        system=system_prompt,
        messages=[{"role": "user", "content": f"商品説明: {product_text}"}],
    )

    raw = message.content[0].text.strip()

    # コードブロック内の JSON を抽出
    m = re.search(r"```(?:json)?\s*([\s\S]+?)```", raw)
    if m:
        raw = m.group(1).strip()

    return json.loads(raw)
