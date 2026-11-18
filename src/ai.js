// Workers AI 呼び出しと JSON 取り出し

export const VISION_MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct';
export const TEXT_MODEL = '@cf/openai/gpt-oss-120b';
export const FAST_MODEL = '@cf/openai/gpt-oss-20b';

export function parseJSON(text) {
  if (text && typeof text === 'object') return text;
  let s = String(text || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const start = s.search(/[\[{]/);
  if (start < 0) throw new Error('AIの応答にJSONが含まれていません');
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  const end = s.lastIndexOf(close);
  let body = s.slice(start, end + 1);
  try {
    return JSON.parse(body);
  } catch {
    body = body
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/[“”]/g, '"')
      .replace(/\u0000/g, '');
    return JSON.parse(body);
  }
}

function extract(res) {
  if (res == null) return '';
  if (typeof res === 'string') return res;
  if (res.response !== undefined) return res.response;
  if (res.choices?.[0]?.message?.content !== undefined) return res.choices[0].message.content;
  if (Array.isArray(res.output)) {
    const msg = res.output.find((o) => o.type === 'message');
    const txt = msg?.content?.find((c) => c.type === 'output_text') || msg?.content?.[0];
    if (txt?.text) return txt.text;
  }
  return res;
}

export async function chatJSON(env, { system, user, images = [], maxTokens = 4096, model }) {
  const content = images.length
    ? [{ type: 'text', text: user }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))]
    : user;
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content },
  ];
  const m = model || (images.length ? env.VISION_MODEL || VISION_MODEL : env.TEXT_MODEL || TEXT_MODEL);
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const input = m.includes('gpt-oss')
        ? { input: messages, reasoning: { effort: 'low' }, max_output_tokens: maxTokens + 2000 }
        : { messages, max_tokens: maxTokens, temperature: attempt ? 0.1 : 0.3 };
      const res = await env.AI.run(m, input);
      return parseJSON(extract(res));
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`AIの処理に失敗しました：${lastErr?.message || lastErr}`);
}
