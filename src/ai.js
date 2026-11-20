// AI 呼び出しと JSON 取り出し
// ANTHROPIC_API_KEY（secret）があれば Claude、なければ Workers AI（無料枠）を使う
import Anthropic from '@anthropic-ai/sdk';

// 出馬表の細かい日本語を読むため、文字認識の精度が高い Qwen を使う（Mistral は騎手名・年齢の誤読が多かった）
export const VISION_MODEL = '@cf/qwen/qwen3.8-27b';
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
  const body = s.slice(start, end + 1);
  try {
    return JSON.parse(body);
  } catch {}
  const clean = (t) => t.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"').replace(/\u0000/g, '');
  try {
    return JSON.parse(clean(body));
  } catch (e) {
    // 出力が途中で切れたときは、最後まで書けている要素だけを取り出す
    const fixed = repairTruncated(clean(s.slice(start)));
    if (fixed !== undefined) return fixed;
    throw e;
  }
}

// 途中で切れた JSON を、閉じ終わっている最後の要素の直後で閉じ直す
export function repairTruncated(s) {
  const cuts = [];
  const stack = [];
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') {
      stack.pop();
      if (stack.length) cuts.push([i + 1, stack.map((o) => (o === '{' ? '}' : ']')).reverse().join('')]);
    }
  }
  for (let k = cuts.length - 1; k >= 0 && k >= cuts.length - 40; k--) {
    const [at, close] = cuts[k];
    try {
      return JSON.parse(s.slice(0, at) + close);
    } catch {}
  }
  return undefined;
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

// ---------- Claude（APIキーが登録されていればすべての AI 処理を Claude で行う） ----------
export const CLAUDE_MODEL = 'claude-opus-5-5';
export const useClaude = (env) => !!env.ANTHROPIC_API_KEY;

async function claudeJSON(env, opts) {
  const { text } = await claudeRun(env, opts);
  return parseJSON(text);
}

// Claude にネット検索をさせながら調べさせる（チャットの Claude と同じやり方）。出典の URL も返す
export async function claudeResearchJSON(env, { system, user, maxTokens = 6000, effort = 'medium', maxSearches = 6 }) {
  const { text, sources } = await claudeRun(env, {
    system, user, maxTokens, effort,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: maxSearches, user_location: { type: 'approximate', country: 'JP', timezone: 'Asia/Tokyo' } }],
  });
  return { json: parseJSON(text), sources };
}

async function claudeRun(env, { system, user, images = [], maxTokens, effort = 'medium', tools }) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 });
  const content = [
    ...images.map((url) => {
      const [, media_type, data] = String(url).match(/^data:([^;]+);base64,(.*)$/) || [];
      return { type: 'image', source: { type: 'base64', media_type, data } };
    }),
    { type: 'text', text: user },
  ];
  const messages = [{ role: 'user', content }];
  const sources = new Map();
  let res;
  try {
    // 検索が長引くと pause_turn で一旦止まるので、そのまま続きを依頼する（最大4回）
    for (let turn = 0; turn < 5; turn++) {
      // 出力が長くなる読み取りでも時間切れにならないよう、ストリーミングで受け取る
      res = await client.beta.messages
        .stream({
          model: env.CLAUDE_MODEL || CLAUDE_MODEL,
          // 考える分も含めた上限。思考はオフにできないモデルなので余裕を持たせる
          max_tokens: Math.max(16000, maxTokens * 3),
          system,
          output_config: { effort },
          ...(tools ? { tools } : {}),
          // 安全上の理由で断られたときは、サーバー側で別モデルに自動で切り替える
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          messages,
        })
        .finalMessage();
      for (const b of res.content) {
        if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
          for (const r of b.content) if (r.url && !sources.has(r.url)) sources.set(r.url, { url: r.url, title: r.title || '' });
        }
      }
      console.log(JSON.stringify({ claudeUsage: { model: res.model, effort, input: res.usage?.input_tokens, output: res.usage?.output_tokens, searches: res.usage?.server_tool_use?.web_search_requests ?? 0, stop: res.stop_reason } }));
      if (res.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: res.content });
    }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Claude の APIキーが正しくありません。登録し直してください。');
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error('Claude の APIキーにこの操作の権限がありません。');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Claude の利用が混み合っています。少し待ってからもう一度お試しください。');
    if (e instanceof Anthropic.BadRequestError && /credit|balance/i.test(e.message)) throw new Error('Claude API のクレジット残高が不足しています。Anthropic Console でチャージしてください。');
    if (e instanceof Anthropic.APIError) throw new Error(`Claude の処理に失敗しました（${e.status ?? '接続'}）：${e.message}`);
    throw e;
  }
  if (res.stop_reason === 'refusal') throw new Error('Claude がこの依頼への回答を控えました。内容を確認してください。');
  // 検索をはさむと文章が出典ごとに細かく分かれるので、最後の検索より後の文章をつなげて使う
  const lastTool = res.content.findLastIndex((b) => b.type === 'server_tool_use' || b.type === 'web_search_tool_result');
  const text = res.content.slice(lastTool + 1).filter((b) => b.type === 'text').map((b) => b.text).join('');
  // max_tokens で途中で切れても、書き終わっている部分は parseJSON が取り出す
  return { text, sources: [...sources.values()] };
}

// preferFree: true のときは無料の Workers AI を先に使い、枠切れや失敗のときは Claude に切り替えて止めない
export async function chatJSON(env, opts) {
  if (useClaude(env) && !opts.preferFree) return claudeJSON(env, opts);
  try {
    return await workersJSON(env, opts);
  } catch (e) {
    if (useClaude(env)) return claudeJSON(env, { ...opts, effort: opts.effort || 'low' });
    throw e;
  }
}

async function workersJSON(env, { system, user, images = [], maxTokens = 4096, model, retries = 2 }) {
  const content = images.length
    ? [{ type: 'text', text: user }, ...images.map((url) => ({ type: 'image_url', image_url: { url, detail: 'high' } }))]
    : user;
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content },
  ];
  const m = model || (images.length ? env.VISION_MODEL || VISION_MODEL : env.TEXT_MODEL || TEXT_MODEL);
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const input = m.includes('gpt-oss')
        ? { input: messages, reasoning: { effort: 'low' }, max_output_tokens: maxTokens + 2000 }
        : { messages, max_tokens: maxTokens, temperature: attempt ? 0.1 : 0.3 };
      // Qwen・Gemma は既定で考える過程を長く出力し、枠と時間を使い切るため止める
      if (/qwen3|gemma-4/.test(m)) input.chat_template_kwargs = { enable_thinking: false };
      const res = await env.AI.run(m, input);
      return parseJSON(extract(res));
    } catch (e) {
      lastErr = e;
      if (/4006|daily free allocation|neurons/i.test(String(e?.message || e))) {
        throw new Error('本日のAI無料枠（Workers AI）を使い切りました。日本時間の朝9時に回復しますので、その後にもう一度お試しください。');
      }
    }
  }
  throw new Error(`AIの処理に失敗しました：${lastErr?.message || lastErr}`);
}
