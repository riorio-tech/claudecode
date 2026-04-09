---
name: Claude設定ファイルの保存先パス
description: memory/rules/skillsを書く正しいパス。~/.claude/には書かない
type: feedback
---

memory・rules・skills のファイルは必ず以下のパスに書くこと。

| 種別 | 正しいパス |
|------|-----------|
| memory | `/Users/reoreo/claudecode/.claude/memory/` |
| rules  | `/Users/reoreo/claudecode/.claude/rules/` |
| skills | `/Users/reoreo/claudecode/.claude/skills/` |

**Why:** `~/.claude/` に書くと意図したディレクトリに反映されない。ユーザーが明示的に指定した。  
**How to apply:** 新しい memory/rules/skills ファイルを作成・更新するときは常にこのパスを使う。`~/.claude/` 配下には絶対に書かない。
