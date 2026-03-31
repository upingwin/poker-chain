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
    WHERE rn = 1
  `).bind(from, to).all();

  const champions = {};
  for (const row of rows.results) {
    champions[row.level_id] = row;
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

      return json({ error: 'Not found' }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: 'Internal error' }, 500);
    }
  },
};
