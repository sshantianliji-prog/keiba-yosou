import { buildBets, settle, judge } from '../src/bets.js';
import assert from 'node:assert/strict';
const t = (name, fn) => { try { fn(); console.log('ok', name); } catch (e) { console.log('NG', name, e.message); process.exitCode = 1; } };
t('3連複 軸1頭流し 600円', () => {
  const b = buildBets({ type: 'sanrenpuku_1', budget: 600, axes: [5], partners: [1, 3, 7, 9] });
  assert.equal(b.points, 6); assert.equal(b.total, 600); assert(b.bets.every((x) => x.amount === 100));
});
t('端数を上位に配分し合計一致', () => {
  const b = buildBets({ type: 'sanrenpuku_1', budget: 1000, axes: [5], partners: [1, 3, 7, 9] });
  assert.equal(b.total, 1000); assert.deepEqual(b.bets.map((x) => x.amount), [200, 200, 200, 200, 100, 100]);
});
t('単勝', () => { const b = buildBets({ type: 'tansho', budget: 500, axes: [3] }); assert.equal(b.total, 500); assert.equal(b.points, 1); });
t('ボックス', () => { const b = buildBets({ type: 'sanrenpuku_box', budget: 1000, axes: [1], partners: [2, 3, 4, 5] }); assert.equal(b.points, 10); assert.equal(b.total, 1000); });
t('3連単1着固定', () => { const b = buildBets({ type: 'sanrentan_1', budget: 1200, axes: [1], partners: [2, 3, 4] }); assert.equal(b.points, 6); });
t('予算不足', () => assert.throws(() => buildBets({ type: 'sanrenpuku_1', budget: 300, axes: [1], partners: [2, 3, 4, 5] })));
t('判定', () => {
  assert(judge('sanrenpuku_1', [1, 3, 5], [5, 1, 3])); assert(!judge('sanrentan_1', [1, 3, 5], [5, 1, 3]));
  assert(judge('fukusho', [3], [1, 2, 3], 10)); assert(!judge('fukusho', [3], [1, 2, 3], 7)); assert(judge('wide_nagashi', [1, 3], [1, 2, 3]));
});
t('精算', () => {
  const b = buildBets({ type: 'sanrenpuku_1', budget: 600, axes: [5], partners: [1, 3, 7, 9] });
  const s = settle(b, [1, 5, 3], { '1-3-5': 2350 }, 16); assert.equal(s.hit, true); assert.equal(s.payout, 2350); assert.equal(s.invest, 600);
});
