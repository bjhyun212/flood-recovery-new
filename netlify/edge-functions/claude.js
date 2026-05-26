
// ============================================================
// Netlify Edge Function - Claude API 프록시 (스트리밍)
// Edge Function은 무료 플랜에서도 긴 응답 시간 허용
// 역할: API 키 보호 + 사용자별 10회 제한 (Upstash Redis)
// ============================================================

const FREE_LIMIT = 10;

async function redisCmd(command) {
  const url = Netlify.env.get('UPSTASH_REDIS_REST_URL');
  const token = Netlify.env.get('UPSTASH_REDIS_REST_TOKEN');
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
  const data = await res.json();
  return data.result;
}

async function redisGet(key) {
  const result = await redisCmd(['GET', key]);
  return result ? JSON.parse(result) : null;
}
async function redisSet(key, value) {
  await redisCmd(['SET', key, JSON.stringify(value)]);
}
async function redisDel(key) {
  await redisCmd(['DEL', key]);
}
async function redisKeys(pattern) {
  const result = await redisCmd(['KEYS', pattern]);
  return result || [];
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export default async (request, context) => {
  if (request.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: '허용되지 않는 메서드' }), { status: 405, headers: corsHeaders });
  }

  try {
    const body = await request.json();

    // ── 관리자 조회 ──
    if (body.adminAction === 'getUsers') {
      if (body.adminPw !== Netlify.env.get('ADMIN_PW')) {
        return new Response(JSON.stringify({ error: '비밀번호 오류' }), { status: 403, headers: corsHeaders });
      }
      const keys = await redisKeys('user_*');
      const users = [];
      for (const key of keys) {
        const data = await redisGet(key);
        if (data) users.push({ userId: key.replace('user_', ''), ...data });
      }
      users.sort((a, b) => (b.lastUsed || '').localeCompare(a.lastUsed || ''));
      return new Response(JSON.stringify({ users }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── 관리자 리셋 ──
    if (body.adminAction === 'resetUser') {
      if (body.adminPw !== Netlify.env.get('ADMIN_PW')) {
        return new Response(JSON.stringify({ error: '비밀번호 오류' }), { status: 403, headers: corsHeaders });
      }
      await redisDel('user_' + body.targetUserId);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
    }

    // ── 일반 API 호출 ──
    const { userId, payload } = body;
    if (!userId || userId.length < 2) {
      return new Response(JSON.stringify({ error: '사용자 정보가 필요합니다.' }), { status: 400, headers: corsHeaders });
    }

    const key = 'user_' + userId.replace(/[^a-zA-Z0-9가-힣_]/g, '_');

    let usageData = { count: 0, firstUsed: null, lastUsed: null, userName: userId };
    try {
      const saved = await redisGet(key);
      if (saved) usageData = saved;
    } catch (e) {}

    if (usageData.count >= FREE_LIMIT) {
      return new Response(JSON.stringify({ error: `무료 사용 ${FREE_LIMIT}회가 모두 소진되었습니다. (${userId}님)`, used: usageData.count, limit: FREE_LIMIT }), { status: 429, headers: corsHeaders });
    }

    const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: '서버 설정 오류: API 키 없음' }), { status: 500, headers: corsHeaders });
    }

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload),
    });
    const apiData = await apiRes.json();

    if (!apiRes.ok) {
      return new Response(JSON.stringify({ error: apiData.error?.message || 'API 오류' }), { status: apiRes.status, headers: corsHeaders });
    }

    // 횟수 증가
    usageData.count += 1;
    usageData.lastUsed = new Date().toISOString();
    if (!usageData.firstUsed) usageData.firstUsed = usageData.lastUsed;
    usageData.userName = userId;
    try { await redisSet(key, usageData); } catch (e) {}

    return new Response(JSON.stringify({ ...apiData, _freeUsed: usageData.count, _freeRemain: FREE_LIMIT - usageData.count, _freeLimit: FREE_LIMIT }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: '서버 오류: ' + err.message }), { status: 500, headers: corsHeaders });
  }
};

export const config = { path: '/api/claude' };
