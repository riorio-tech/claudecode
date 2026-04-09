import { z } from 'zod';

/**
 * JSON文字列内の未エスケープ制御文字（改行・タブ等）を修復する。
 * @param {string} jsonText
 * @returns {string}
 */
function repairJsonString(jsonText) {
  // 文字列リテラル内の未エスケープ改行・タブをエスケープする
  // ダブルクォートで囲まれた範囲を正規表現でマッチし、その中の制御文字を置換
  return jsonText.replace(/("(?:[^"\\]|\\.)*")/gs, (match) => {
    return match
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  });
}

/**
 * JSONコメント（// 行コメントおよびブロックコメント）を除去する。
 * 文字列リテラル内のコメント記号は除去しない。
 * @param {string} jsonText
 * @returns {string}
 */
function stripJsonComments(jsonText) {
  let result = '';
  let inString = false;
  let i = 0;
  while (i < jsonText.length) {
    const ch = jsonText[i];
    if (inString) {
      if (ch === '\\') {
        result += ch + (jsonText[i + 1] || '');
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      result += ch;
      i++;
    } else {
      if (ch === '"') {
        inString = true;
        result += ch;
        i++;
      } else if (ch === '/' && jsonText[i + 1] === '/') {
        // 行コメント: 行末まで読み飛ばす
        while (i < jsonText.length && jsonText[i] !== '\n') i++;
      } else if (ch === '/' && jsonText[i + 1] === '*') {
        // ブロックコメント: */ まで読み飛ばす
        i += 2;
        while (i < jsonText.length && !(jsonText[i] === '*' && jsonText[i + 1] === '/')) i++;
        i += 2;
      } else {
        result += ch;
        i++;
      }
    }
  }
  return result;
}

/**
 * テキストからJSON部分を抽出する。
 * コードブロック（```json ... ```）にも対応。
 * 文字列内の未エスケープ改行は自動修復する。
 *
 * @param {string} text - Claude APIの生出力など
 * @returns {unknown} パース済みのJSONオブジェクト
 * @throws {Error} JSON部分が見つからない、またはパースに失敗した場合
 */
export function extractJson(text) {
  const tryParse = (str) => {
    try {
      return JSON.parse(str);
    } catch {
      try {
        return JSON.parse(repairJsonString(str));
      } catch {
        return JSON.parse(repairJsonString(stripJsonComments(str)));
      }
    }
  };

  // コードブロック内のJSONを優先して抽出
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return tryParse(codeBlockMatch[1].trim());
  }

  // コードブロックなし: 最初の { または [ から最後の } または ] まで抽出
  const objectMatch = text.match(/(\{[\s\S]*\})/);
  if (objectMatch) {
    return tryParse(objectMatch[1]);
  }

  const arrayMatch = text.match(/(\[[\s\S]*\])/);
  if (arrayMatch) {
    return tryParse(arrayMatch[1]);
  }

  throw new Error('テキスト内にJSONが見つかりませんでした');
}

/**
 * ZodスキーマでデータをバリデートしてパースされたJSONを返す。
 *
 * @template T
 * @param {z.ZodType<T>} schema - Zodスキーマ
 * @param {unknown} data - バリデート対象データ
 * @returns {T} バリデーション済みデータ
 * @throws {z.ZodError} バリデーション失敗時
 */
export function validate(schema, data) {
  return schema.parse(data);
}
