// 買い目の組み立て・金額配分・的中判定（AIを使わず厳密に計算する）

export const BET_TYPES = {
  tansho: { label: '単勝', kind: 'single' },
  fukusho: { label: '複勝', kind: 'single' },
  umaren_nagashi: { label: '馬連 軸1頭流し', kind: 'nagashi', size: 2 },
  wide_nagashi: { label: 'ワイド 軸1頭流し', kind: 'nagashi', size: 2 },
  umaren_box: { label: '馬連 ボックス', kind: 'box', size: 2 },
  wide_box: { label: 'ワイド ボックス', kind: 'box', size: 2 },
  sanrenpuku_1: { label: '3連複 軸1頭流し', kind: 'nagashi', size: 3 },
  sanrenpuku_2: { label: '3連複 軸2頭流し', kind: 'nagashi2', size: 3 },
  sanrenpuku_box: { label: '3連複 ボックス', kind: 'box', size: 3 },
  sanrentan_1: { label: '3連単 1着固定流し', kind: 'tan1', size: 3 },
};

const ticketName = (type) => {
  if (type === 'tansho') return '単勝';
  if (type === 'fukusho') return '複勝';
  if (type.startsWith('umaren')) return '馬連';
  if (type.startsWith('wide')) return 'ワイド';
  if (type.startsWith('sanrenpuku')) return '3連複';
  return '3連単';
};

function combinations(arr, k) {
  const out = [];
  const rec = (start, cur) => {
    if (cur.length === k) return out.push([...cur]);
    for (let i = start; i < arr.length; i++) rec(i + 1, [...cur, arr[i]]);
  };
  rec(0, []);
  return out;
}

function permutations(arr, k) {
  const out = [];
  const rec = (cur, rest) => {
    if (cur.length === k) return out.push([...cur]);
    rest.forEach((x, i) => rec([...cur, x], rest.filter((_, j) => j !== i)));
  };
  rec([], arr);
  return out;
}

const uniq = (a) => [...new Set(a.map(Number).filter((n) => Number.isInteger(n) && n > 0))];

/**
 * @param {object} p
 * @param {string} p.type BET_TYPES のキー
 * @param {number} p.budget 予算（100円単位）
 * @param {number[]} p.axes 軸馬（単勝・複勝・ボックスでは対象馬）
 * @param {number[]} p.partners 相手（評価順）
 */
export function buildBets({ type, budget, axes = [], partners = [] }) {
  const def = BET_TYPES[type];
  if (!def) throw new Error('券種が正しくありません');
  budget = Number(budget);
  if (!Number.isInteger(budget) || budget < 100 || budget % 100 !== 0) {
    throw new Error('予算は100円単位で入力してください');
  }
  axes = uniq(axes);
  partners = uniq(partners).filter((n) => !axes.includes(n));
  let combos = [];
  if (def.kind === 'single') {
    combos = axes.map((a) => [a]);
  } else if (def.kind === 'box') {
    combos = combinations(uniq([...axes, ...partners]), def.size);
  } else if (def.kind === 'nagashi') {
    const a = axes[0];
    combos = combinations(partners, def.size - 1).map((c) => [a, ...c]);
  } else if (def.kind === 'nagashi2') {
    const [a, b] = axes;
    if (!b) throw new Error('軸2頭流しには軸が2頭必要です');
    combos = partners.map((p) => [a, b, p]);
  } else if (def.kind === 'tan1') {
    const a = axes[0];
    combos = permutations(partners, 2).map((c) => [a, ...c]);
  }
  if (!combos.length) throw new Error('買い目を組み立てられませんでした（対象馬が不足しています）');
  const units = budget / 100;
  if (units < combos.length) {
    throw new Error(`予算が不足しています（${combos.length}点のため最低${combos.length * 100}円必要です）`);
  }
  const base = Math.floor(units / combos.length);
  const rem = units % combos.length;
  const bets = combos.map((c, i) => ({
    combo: def.kind === 'tan1' ? c : (def.kind === 'single' ? c : [...c].sort((x, y) => x - y)),
    amount: (base + (i < rem ? 1 : 0)) * 100,
  }));
  const total = bets.reduce((s, b) => s + b.amount, 0);
  return {
    type,
    label: def.label,
    ticket: ticketName(type),
    axes,
    partners,
    points: bets.length,
    bets,
    total,
    howto: howTo(type, axes, partners, bets),
  };
}

function howTo(type, axes, partners, bets) {
  const def = BET_TYPES[type];
  const t = ticketName(type);
  const amounts = [...new Set(bets.map((b) => b.amount))];
  const even = amounts.length === 1;
  const lines = [];
  if (def.kind === 'single') {
    lines.push(`券種「${t}」→ 方式「通常」→ 馬番 ${axes.join('・')} を選択`);
  } else if (def.kind === 'box') {
    lines.push(`券種「${t}」→ 方式「ボックス」→ 馬番 ${[...axes, ...partners].join('・')} を選択`);
  } else if (def.kind === 'nagashi') {
    lines.push(`券種「${t}」→ 方式「ながし」（軸1頭）→ 軸 ${axes[0]} → 相手 ${partners.join('・')} を選択`);
  } else if (def.kind === 'nagashi2') {
    lines.push(`券種「${t}」→ 方式「ながし」（軸2頭）→ 軸 ${axes[0]}・${axes[1]} → 相手 ${partners.join('・')} を選択`);
  } else if (def.kind === 'tan1') {
    lines.push(`券種「${t}」→ 方式「フォーメーション」→ 1着 ${axes[0]} → 2着 ${partners.join('・')} → 3着 ${partners.join('・')} を選択`);
  }
  if (even) {
    lines.push(`金額は1点 ${amounts[0]}円 を入力（${bets.length}点・合計 ${bets.length * amounts[0]}円）`);
  } else {
    const hi = bets.filter((b) => b.amount === Math.max(...amounts));
    lines.push(`まず全${bets.length}点を1点 ${Math.min(...amounts)}円 で入力`);
    lines.push(`次に方式「通常」で ${hi.map((b) => b.combo.join('-')).join('、')} を各 ${Math.max(...amounts) - Math.min(...amounts)}円 追加`);
  }
  return lines;
}

/** 的中判定。order: [1着,2着,3着]、runners: 出走頭数 */
export function judge(type, combo, order, runners = 18) {
  const [f, s, t] = order.map(Number);
  const top3 = [f, s, t];
  const c = combo.map(Number);
  switch (ticketName(type)) {
    case '単勝': return c[0] === f;
    case '複勝': return (runners <= 7 ? [f, s] : top3).includes(c[0]);
    case '馬連': return c.length === 2 && c.includes(f) && c.includes(s);
    case 'ワイド': return c.length === 2 && c.every((x) => top3.includes(x));
    case '3連複': return c.length === 3 && c.every((x) => top3.includes(x));
    case '3連単': return c[0] === f && c[1] === s && c[2] === t;
  }
  return false;
}

export const comboKey = (type, combo) =>
  ticketName(type) === '3連単' ? combo.join('→') : combo.join('-');

/** payouts: { comboKey: 100円あたり払戻金 } */
export function settle(yosouBets, order, payouts, runners) {
  const hits = yosouBets.bets
    .filter((b) => judge(yosouBets.type, b.combo, order, runners))
    .map((b) => {
      const key = comboKey(yosouBets.type, b.combo);
      const per100 = Number(payouts?.[key] || 0);
      return { ...b, key, per100, payout: Math.round((b.amount / 100) * per100) };
    });
  const payout = hits.reduce((s, h) => s + h.payout, 0);
  return { hit: hits.length > 0, hits, invest: yosouBets.total, payout };
}
