// ============================================================
// Netlify Functions - Claude API 프록시
// 역할: API 키 보호 + 사용자별 10회 제한 (Upstash Redis)
// ============================================================

const FREE_LIMIT = 10;

// Upstash Redis REST API 호출
async function redisGet(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function redisSet(key, value) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(JSON.stringify(value))
  });
}

async function redisDel(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  await fetch(`${url}/del/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function redisKeys(pattern) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const res = await fetch(`${url}/keys/${encodeURIComponent(pattern)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  return data.result || [];
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: '허용되지 않는 메서드' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');

    // ── 관리자 조회 요청 ─────────────────────────────────────
    if (body.adminAction === 'getUsers') {
      if (body.adminPw !== process.env.ADMIN_PW) {
        return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: '비밀번호 오류' }) };
      }
      const keys = await redisKeys('user_*');
      const users = [];
      for (const key of keys) {
        const data = await redisGet(key);
        if (data) users.push({ userId: key.replace('user_', ''), ...data });
      }
      users.sort((a, b) => (b.lastUsed || '').localeCompare(a.lastUsed || ''));
      return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ users }) };
    }

    // ── 관리자 횟수 리셋 요청 ────────────────────────────────
    if (body.adminAction === 'resetUser') {
      if (body.adminPw !== process.env.ADMIN_PW) {
        return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: '비밀번호 오류' }) };
      }
      await redisDel('user_' + body.targetUserId);
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
    }

    // ── 일반 API 호출 ────────────────────────────────────────
    const { userId, payload } = body;
    if (!userId || userId.length < 2) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: '사용자 정보가 필요합니다.' }) };
    }

    const key = 'user_' + userId.replace(/[^a-zA-Z0-9가-힣_]/g, '_');

    // 횟수 확인
    let usageData = { count: 0, firstUsed: null, lastUsed: null, userName: userId };
    try {
      const saved = await redisGet(key);
      if (saved) usageData = saved;
    } catch (e) {}

    if (usageData.count >= FREE_LIMIT) {
      return {
        statusCode: 429,
        headers: corsHeaders,
        body: JSON.stringify({
          error: `무료 사용 ${FREE_LIMIT}회가 모두 소진되었습니다. (${userId}님)`,
          used: usageData.count,
          limit: FREE_LIMIT,
        }),
      };
    }

    // Claude API 호출
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: '서버 설정 오류: API 키 없음' }) };
    }

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload),
    });
    const apiData = await apiRes.json();

    if (!apiRes.ok) {
      return { statusCode: apiRes.status, headers: corsHeaders, body: JSON.stringify({ error: apiData.error?.message || 'API 오류' }) };
    }

    // 횟수 증가 저장
    usageData.count += 1;
    usageData.lastUsed = new Date().toISOString();
    if (!usageData.firstUsed) usageData.firstUsed = usageData.lastUsed;
    usageData.userName = userId;
    await redisSet(key, usageData);

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...apiData,
        _freeUsed: usageData.count,
        _freeRemain: FREE_LIMIT - usageData.count,
        _freeLimit: FREE_LIMIT,
      }),
    };
  } catch (err) {
    console.error('Function 오류:', err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: '서버 오류: ' + err.message }) };
  }
};
