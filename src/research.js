// 公開ページを1件ずつ取得して本文テキストを取り出す（大量取得はしない）

export const COURSE_SLUG = {
  札幌: 'sapporo', 函館: 'hakodate', 福島: 'fukushima', 新潟: 'niigata', 東京: 'tokyo',
  中山: 'nakayama', 中京: 'chukyo', 京都: 'kyoto', 阪神: 'hanshin', 小倉: 'kokura',
};

export const courseUrl = (course) =>
  COURSE_SLUG[course] ? `https://www.jra.go.jp/facilities/race/${COURSE_SLUG[course]}/course/index.html` : null;

const MEMBER_MARKERS = ['会員限定', 'プレミアム会員', '有料会員', 'ログインしてご覧', '続きを読むには', 'この記事は会員'];

function decode(buf, contentType) {
  let charset = /charset=([\w-]+)/i.exec(contentType || '')?.[1];
  if (!charset) {
    const head = new TextDecoder('utf-8').decode(buf.slice(0, 4096));
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder((charset || 'utf-8').toLowerCase(), { fatal: false }).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

function htmlToText(html) {
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '').trim();
  const text = html
    .replace(/<(script|style|noscript|svg|iframe|nav|footer)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d|dd|dt)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t　]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  return { title: title.replace(/\s+/g, ' ').slice(0, 120), text };
}

export async function fetchSource(url) {
  let u;
  try {
    u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
  } catch {
    return { url, ok: false, reason: 'URLの形式が正しくありません' };
  }
  try {
    const res = await fetch(u.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (personal keiba note; single page fetch)', 'Accept-Language': 'ja' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { url, ok: false, reason: `アクセスできませんでした（HTTP ${res.status}）` };
    const ct = res.headers.get('content-type') || '';
    if (!/html|text/.test(ct)) return { url, ok: false, reason: 'HTML以外のページのため使用しません' };
    const buf = (await res.arrayBuffer()).slice(0, 600_000);
    const { title, text } = htmlToText(decode(buf, ct));
    if (MEMBER_MARKERS.some((m) => text.includes(m)) && text.length < 4000) {
      return { url, title, ok: false, reason: '会員限定・有料の可能性があるため使用しません' };
    }
    if (text.length < 200) return { url, title, ok: false, reason: '本文を取得できませんでした' };
    return { url, title, ok: true, text: text.slice(0, 7000) };
  } catch (e) {
    return { url, ok: false, reason: `取得できませんでした（${e.name === 'TimeoutError' ? 'タイムアウト' : e.message}）` };
  }
}
