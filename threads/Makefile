.PHONY: POST DRY_RUN SCHEDULE RESEARCH_FORMATS install

# ─── 手動実行（テスト中はこちらを使う） ──────────────────────────────────────

# 実際にThreadsへ投稿する
POST:
	node cli.js post

# 投稿文を生成して確認するだけ（実際には投稿しない）
DRY_RUN:
	node cli.js post --dry-run

# ─── 初回セットアップ ──────────────────────────────────────────────────────────

# 投稿フォーマット10型をAIリサーチして更新（初回のみ）
RESEARCH_FORMATS:
	node cli.js research-formats

install:
	npm install

# Threads APIキーをインタラクティブに設定（初回）
SETUP:
	node setup.js

# ─── 自動実行（本番移行後に使う） ────────────────────────────────────────────

# 2時間おきに自動投稿（本番運用時）
SCHEDULE:
	node cli.js schedule --interval $(or $(INTERVAL),2)
