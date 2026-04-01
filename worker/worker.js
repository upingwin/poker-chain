// Poker Chain API · Cloudflare Worker
// Env bindings: DB (D1), BOT_TOKEN (secret)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Tg-Init-Data',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ─── Telegram initData Verification ──────────────────────────────────────────
// Returns parsed user object {id, first_name, username, photo_url} or null
async function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const enc = new TextEncoder();
    // Secret key = HMAC-SHA256(key="WebAppData", data=botToken)
    const hmacKey = await crypto.subtle.importKey(
      'raw', enc.encode('WebAppData'),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const secretKey = await crypto.subtle.sign('HMAC', hmacKey, enc.encode(botToken));
    const dataKey = await crypto.subtle.importKey(
      'raw', secretKey,
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', dataKey, enc.encode(dataCheckString));
    const hex = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    if (hex !== hash) return null;
    return JSON.parse(params.get('user') || 'null');
  } catch {
    return null;
  }
}

async function getAuthUser(request, env) {
  const initData = request.headers.get('X-Tg-Init-Data') || '';
  return verifyInitData(initData, env.BOT_TOKEN);
}

async function upsertUser(env, user) {
  await env.DB.prepare(`
    INSERT INTO users (user_id, first_name, username, avatar_url, updated_at)
    VALUES (?, ?, ?, ?, unixepoch())
    ON CONFLICT(user_id) DO UPDATE SET
      first_name = excluded.first_name,
      username   = COALESCE(excluded.username, username),
      avatar_url = COALESCE(excluded.avatar_url, avatar_url),
      updated_at = unixepoch()
  `).bind(
    user.id,
    user.first_name || '',
    user.username   || null,
    user.photo_url  || null
  ).run();
}

// ─── POST /api/score ──────────────────────────────────────────────────────────
// Body: { level_id: number, score: number, stars: 1|2|3 }
// Returns: { ok, rank, total, best_score }
async function handleSubmitScore(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Bad JSON' }, 400); }

  const { level_id, score, stars } = body;
  if (!Number.isInteger(level_id) || !Number.isInteger(score) || score < 0 ||
      level_id < 1 || level_id > 150) {
    return json({ error: 'Invalid params' }, 400);
  }

  await upsertUser(env, user);

  // Upsert score — only improve, never decrease
  await env.DB.prepare(`
    INSERT INTO scores (user_id, level_id, score, stars, updated_at)
    VALUES (?, ?, ?, ?, unixepoch())
    ON CONFLICT(user_id, level_id) DO UPDATE SET
      score      = CASE WHEN excluded.score > score THEN excluded.score ELSE score END,
      stars      = CASE WHEN excluded.score > score THEN excluded.stars ELSE stars END,
      updated_at = CASE WHEN excluded.score > score THEN unixepoch()   ELSE updated_at END
  `).bind(user.id, level_id, score, stars).run();

  // Fetch user's current best (may differ from submitted score if it's not higher)
  const best = await env.DB.prepare(
    `SELECT score FROM scores WHERE user_id = ? AND level_id = ?`
  ).bind(user.id, level_id).first();
  const bestScore = best?.score ?? score;

  // Rank among all players for this level
  const aboveRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM scores WHERE level_id = ? AND score > ?`
  ).bind(level_id, bestScore).first();
  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM scores WHERE level_id = ?`
  ).bind(level_id).first();

  return json({
    ok: true,
    rank: (aboveRow?.c ?? 0) + 1,
    total: totalRow?.c ?? 1,
    best_score: bestScore,
  });
}

// ─── GET /api/level/:id ───────────────────────────────────────────────────────
// Returns top 10 players for a single level
async function handleGetLevel(levelId, env) {
  if (levelId < 1 || levelId > 150) return json({ error: 'Invalid level' }, 400);

  const rows = await env.DB.prepare(`
    SELECT s.score, s.stars,
           u.user_id, u.first_name, u.username, u.avatar_url
    FROM scores s
    JOIN users u ON s.user_id = u.user_id
    WHERE s.level_id = ?
    ORDER BY s.score DESC
    LIMIT 10
  `).bind(levelId).all();

  return json({ top: rows.results });
}

// ─── GET /api/champions?from=1&to=10 ─────────────────────────────────────────
// Returns the #1 player for each level in the range (for level grid avatars)
async function handleGetChampions(from, to, env) {
  const rows = await env.DB.prepare(`
    WITH ranked AS (
      SELECT s.level_id, s.score, s.stars, s.user_id,
             u.first_name, u.username, u.avatar_url,
             ROW_NUMBER() OVER (
               PARTITION BY s.level_id
               ORDER BY s.score DESC, s.updated_at ASC
             ) AS rn
      FROM scores s
      JOIN users u ON s.user_id = u.user_id
      WHERE s.level_id BETWEEN ? AND ?
    )
    SELECT level_id, score, stars, user_id, first_name, username, avatar_url
    FROM ranked
    WHERE rn <= 3
  `).bind(from, to).all();

  const champions = {};
  for (const row of rows.results) {
    if (!champions[row.level_id]) champions[row.level_id] = [];
    champions[row.level_id].push(row);
  }
  return json({ champions });
}

// ─── GET /api/global?user_id=X ───────────────────────────────────────────────
// Returns global top-100 by total score + caller's rank
async function handleGlobal(request, env) {
  const url    = new URL(request.url);
  const meId   = parseInt(url.searchParams.get('user_id') || '0') || 0;

  const rows = await env.DB.prepare(`
    SELECT u.user_id, u.first_name, u.username, u.avatar_url,
           SUM(s.score)                                  AS total_score,
           COUNT(s.level_id)                             AS levels_played,
           SUM(CASE WHEN s.stars = 3 THEN 1 ELSE 0 END) AS perfect_levels
    FROM scores s
    JOIN users u ON s.user_id = u.user_id
    GROUP BY s.user_id
    ORDER BY total_score DESC
    LIMIT 100
  `).all();

  let myRank = null, myScore = null;
  if (meId) {
    const meRow = await env.DB.prepare(
      `SELECT SUM(score) as total FROM scores WHERE user_id = ?`
    ).bind(meId).first();
    myScore = meRow?.total || 0;

    const aboveMe = await env.DB.prepare(`
      SELECT COUNT(*) as c FROM (
        SELECT user_id, SUM(score) as total
        FROM scores
        GROUP BY user_id
        HAVING total > ?
      )
    `).bind(myScore).first();
    myRank = (aboveMe?.c || 0) + 1;
  }

  return json({ top: rows.results, my_rank: myRank, my_score: myScore });
}

// ─── POST /api/invoice ────────────────────────────────────────────────────────
// Body: { tool_type: 'shuffle'|'undo'|'timecard', qty: 5|10|20, stars: 30|50|90 }
// Returns: { url }  — invoice link to pass to WebApp.openInvoice()
//
// SETUP: After deploying, register the webhook once:
//   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<worker>.workers.dev/webhook"
const VALID_PACKS = [
  { qty: 5,  stars: 30 },
  { qty: 10, stars: 50 },
  { qty: 20, stars: 90 },
];
const TOOL_LABELS = {
  shuffle:  'Shuffle',
  undo:     'Undo',
  timecard: '+60s Card',
};

async function handleCreateInvoice(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Bad JSON' }, 400); }

  const { tool_type, qty, stars } = body;
  if (!TOOL_LABELS[tool_type]) return json({ error: 'Invalid tool' }, 400);
  if (!VALID_PACKS.some(p => p.qty === qty && p.stars === stars))
    return json({ error: 'Invalid pack' }, 400);

  const toolLabel = TOOL_LABELS[tool_type];
  const payload   = `tool:${tool_type}:${qty}:${user.id}`;

  const tgResp = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/createInvoiceLink`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        title:       `${qty}× ${toolLabel}`,
        description: `Get ${qty} ${toolLabel} power-ups for Poker Chain`,
        payload,
        currency:    'XTR',              // Telegram Stars
        prices:      [{ label: `${qty}× ${toolLabel}`, amount: stars }],
      }),
    }
  );
  const tgData = await tgResp.json();
  if (!tgData.ok) {
    console.error('createInvoiceLink failed:', tgData);
    return json({ error: tgData.description || 'Failed to create invoice' }, 500);
  }
  return json({ url: tgData.result });
}

// ─── GET /api/skins?user_id=X ─────────────────────────────────────────────────
// Returns total stars earned + list of purchased skin IDs
async function handleGetSkins(request, env) {
  const url    = new URL(request.url);
  const userId = parseInt(url.searchParams.get('user_id') || '0') || 0;
  if (!userId) return json({ total_stars: 0, purchased: [] });

  const [starsRow, purchasedRows] = await Promise.all([
    env.DB.prepare(`SELECT SUM(stars) as total FROM scores WHERE user_id = ?`).bind(userId).first(),
    env.DB.prepare(`SELECT skin_id FROM skin_purchases WHERE user_id = ?`).bind(userId).all(),
  ]);

  return json({
    total_stars: starsRow?.total || 0,
    purchased:   purchasedRows.results.map(r => r.skin_id),
  });
}

// ─── POST /api/skin/buy ───────────────────────────────────────────────────────
// Body: { skin_id: 1..8 }
// Returns: { url } — invoice link
const SKIN_STARS_PRICE = 50; // Telegram Stars per skin
const SKIN_NAMES = [
  '', // 0 = default, not purchasable
  'Crimson Damask',
  'Midnight Grid',
  'Forest Plaid',
  'Gold Arabesque',
  'Sakura',
  'Cyber Glow',
  'Marble',
  'Sepia Vintage',
];

async function handleBuySkin(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Bad JSON' }, 400); }

  const { skin_id } = body;
  if (!Number.isInteger(skin_id) || skin_id < 1 || skin_id > 8)
    return json({ error: 'Invalid skin_id' }, 400);

  // Check if already owned
  const owned = await env.DB.prepare(
    `SELECT 1 FROM skin_purchases WHERE user_id = ? AND skin_id = ?`
  ).bind(user.id, skin_id).first();
  if (owned) return json({ error: 'Already owned' }, 400);

  const skinName = SKIN_NAMES[skin_id];
  const payload  = `skin:${skin_id}:${user.id}`;

  const tgResp = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/createInvoiceLink`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        title:       `${skinName} Skin`,
        description: `Unlock the ${skinName} card back skin for Poker Chain`,
        payload,
        currency:    'XTR',
        prices:      [{ label: skinName, amount: SKIN_STARS_PRICE }],
      }),
    }
  );
  const tgData = await tgResp.json();
  if (!tgData.ok) {
    console.error('skin createInvoiceLink failed:', tgData);
    return json({ error: tgData.description || 'Failed to create invoice' }, 500);
  }
  return json({ url: tgData.result });
}

// ─── POST /webhook ────────────────────────────────────────────────────────────
// Telegram bot webhook — answers pre_checkout_query so Stars payments complete
async function handleWebhook(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return new Response('ok'); }

  if (body.pre_checkout_query) {
    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/answerPreCheckoutQuery`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        pre_checkout_query_id: body.pre_checkout_query.id,
        ok: true,
      }),
    });
  }
  if (body.successful_payment) {
    const payload = body.successful_payment.invoice_payload || '';
    // skin:<skin_id>:<user_id>
    const skinMatch = payload.match(/^skin:(\d+):(\d+)$/);
    if (skinMatch) {
      const skinId = parseInt(skinMatch[1]);
      const userId = parseInt(skinMatch[2]);
      await env.DB.prepare(`
        INSERT OR IGNORE INTO skin_purchases (user_id, skin_id, purchased_at)
        VALUES (?, ?, unixepoch())
      `).bind(userId, skinId).run();
    }
  }
  return new Response('ok');
}

// ─── Router ───────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url  = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === 'POST' && path === '/api/score') {
        return handleSubmitScore(request, env);
      }
      if (request.method === 'POST' && path === '/api/invoice') {
        return handleCreateInvoice(request, env);
      }
      if (request.method === 'POST' && path === '/webhook') {
        return handleWebhook(request, env);
      }
      const levelMatch = path.match(/^\/api\/level\/(\d+)$/);
      if (request.method === 'GET' && levelMatch) {
        return handleGetLevel(parseInt(levelMatch[1]), env);
      }
      if (request.method === 'GET' && path === '/api/champions') {
        const from = parseInt(url.searchParams.get('from') || '0');
        const to   = parseInt(url.searchParams.get('to')   || '0');
        if (!from || !to || from > to) return json({ error: 'Invalid range' }, 400);
        return handleGetChampions(from, to, env);
      }
      if (request.method === 'GET' && path === '/api/global') {
        return handleGlobal(request, env);
      }
      if (request.method === 'GET' && path === '/api/skins') {
        return handleGetSkins(request, env);
      }
      if (request.method === 'POST' && path === '/api/skin/buy') {
        return handleBuySkin(request, env);
      }

      return json({ error: 'Not found' }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: 'Internal error' }, 500);
    }
  },
};
