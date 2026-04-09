# 懸念点・対応策・検証方法

## 懸念点と対応策

| # | 懸念 | 対応 |
|---|------|------|
| 1 | TikTok API は法人アカウント審査が必要 | Phase 2 は Instagram → YouTube → TikTok の順で実装 |
| 2 | YouTube OAuth2 は手動ブラウザ認証が必要 | `make AUTH_YOUTUBE` で初回 token 取得・保存 |
| 3 | Instagram は動画の公開 URL が必要 | Cloudflare R2（無料枠）に一時アップロードして URL 生成 |
| 4 | HeyGen 日本語アバター・ボイスの実在未確認 | Phase 1 着手前に `GET /v2/avatars` で確認必須 |
| 5 | 指標取得タイミングがズレると比較困難 | 投稿時刻を DB に記録し、経過時間で計測ポイントを管理 |
| 6 | Node.js setTimeout でのスケジュールはプロセス停止で消える | OS cron を使用（`make POST DIR=...` を定期実行） |
| 7 | 複数商品の一括処理は未対応 | 将来対応として設計上の余地を確保（バッチキュー設計） |
| 8 | HeyGen 課金: 1本あたり$0.10〜$0.50 程度 | 月の上限を `.env` で設定し、超えたら Slack アラート |

## 検証方法

1. `AVATAR_PROVIDER=heygen make UGC IMG=test.jpg TITLE="テスト"` で HeyGen 動画が生成される
2. `make POST DIR=output/inpaint1` で各プラットフォームに投稿・`post_result.json` が生成される
3. 投稿 24h 後に `make ANALYTICS` を実行し `analytics_report.md` が生成される
4. 2回目の `make UGC` 時に `research.js` が前回の勝ちパターンを参照していることをログで確認
5. `node --test` で全テストが通る

## フェーズ別チェックリスト

### Phase 1 完了基準
- [ ] HeyGen で 3本の縦型（1080×1920）動画が生成される
- [ ] `AVATAR_PROVIDER=makeugc` に切り替えても動作する
- [ ] `node --test` 全パス

### Phase 2 完了基準
- [ ] Instagram に動画が投稿され `post_result.json` が生成される
- [ ] YouTube に動画が投稿される（OAuth2 認証済み）
- [ ] cron で定時投稿が動作する

### Phase 3 完了基準
- [ ] `make ANALYTICS` で `analytics_report.md` が生成される
- [ ] 2回目以降の `make UGC` で analytics レポートがプロンプトに注入される
- [ ] SQLite に投稿指標が蓄積されている
