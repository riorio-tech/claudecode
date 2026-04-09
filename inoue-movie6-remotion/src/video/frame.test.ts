import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeXml } from './frame.ts';

test('escapeXml: 特殊文字をエスケープする', () => {
  assert.equal(escapeXml('<Hello & "World">'), '&lt;Hello &amp; &quot;World&quot;&gt;');
});

test('escapeXml: 通常の文字列はそのまま返す', () => {
  assert.equal(escapeXml('通常のテキスト'), '通常のテキスト');
});
