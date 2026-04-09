import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config.ts';

let _client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!_client) {
    if (!config.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY が設定されていません');
    }
    _client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  }
  return _client;
}

/** テスト用：クライアントをリセット */
export function _resetClient(): void {
  _client = null;
}
