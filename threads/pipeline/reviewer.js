import { chat } from '../lib/ai-client.js';
import fs from 'fs';
import path from 'path';
import { writeJson } from '../lib/job-dir.js';
import { logger } from '../lib/logger.js';

export async function reviewer(jobDir, theme, draft) {
  logger.stage(4, 'レビュー');

  const posted = JSON.parse(fs.readFileSync(path.resolve('memory/posted.json'), 'utf-8'));
  const recentTexts = posted.slice(-5).map(p => p.text).join('\n---\n');

  const variantSummaries = draft.variants.map(v => {
    const text = v.parts
      ? `【投稿1】${v.parts.hook}\n【投稿2】${v.parts.detail}\n【投稿3】${v.parts.summary}`
      : v.text;
    return `[バリアント${v.id}] ${v.hook_type}\n${text}`;
  }).join('\n\n');

  const rawText = await chat([{
    role: 'user',
    content: `あなたはAI事業プロフェッショナルのThreads投稿を担当する編集者です。
以下の3バリアントをレビューして最適なものを選んでください。

## バリアント
${variantSummaries}

## 直近の投稿（重複・マンネリ確認用）
${recentTexts || 'なし'}

## 評価軸

**第一基準: フック力（20点満点）**
冒頭1行が25文字以内・単独で完結・スクロールを止める力があるか。
**25文字を超えているバリアントは他の点が高くても選ばない。** まず文字数を確認すること。

1. フック力: 冒頭1行が25文字以内かつスクロールが止まるか（20点）
   - 20点: 25文字以内、単独で意味が完結、引きが強い
   - 10点: 25文字以内だが引きが弱い
   - 0点: 25文字超過（即失格）
2. 当事者性: 現場経験・判断・失敗が入っているか（10点）
3. 具体性: 抽象論でなく実例・数字・固有の経験があるか（10点）
4. 重複なし: 直近投稿と似ていないか（5点）
5. NG表現なし: 「知らなかった」「試してみて」プロンプトtips・初心者向け語り口がないか（5点）

合計50点満点。フック力が15点以上かつ1行目が25文字以内のバリアントを優先して選べ。
全バリアントが25文字超の場合は、最も短いフックのバリアントを選び、final_textで1行目を25文字以内に修正せよ。

必ずJSON形式のみで返してください。テキストの出力は不要。IDとスコアのみ。

{
  "selected_id": 0,
  "scores": [
    { "id": 0, "total": 45, "comment": "選んだ理由（30文字以内）" },
    { "id": 1, "total": 38, "comment": "落とした理由（30文字以内）" },
    { "id": 2, "total": 40, "comment": "落とした理由（30文字以内）" }
  ]
}`,
  }], { model: 'fast', maxTokens: 512 });


  const result = JSON.parse(rawText.match(/\{[\s\S]*\}/)[0]);

  // 選択バリアントからfinal_parts / final_textをセット
  const selected = draft.variants.find(v => v.id === result.selected_id) ?? draft.variants[0];
  if (selected?.parts) {
    result.final_parts = selected.parts;
    const p = selected.parts;
    // 4パート or 旧3パートどちらにも対応
    const texts = p.bridge
      ? [p.hook, p.bridge, p.detail, p.summary]
      : [p.hook, p.detail, p.summary];
    result.final_text = texts.filter(Boolean).join('\n\n');
  } else {
    result.final_text = selected?.text ?? '';
  }

  writeJson(jobDir, '04_review.json', result);
  logger.success(`バリアント${result.selected_id}を選択（スコア: ${result.scores.find(s => s.id === result.selected_id)?.total}/50）`);
  return result;
}
