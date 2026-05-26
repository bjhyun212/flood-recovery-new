// ============================================================
// Netlify Functions - Claude API 프록시
// 역할: API 키 보호 + 사용자별 10회 제한 (Netlify Blobs 저장)
// ============================================================

const { getStore } = require('@netlify/blobs');

const FREE_LIMIT = 10;

exports.handler = async function (event, context) {
  // CORS 헤더 (브라우저에서 직접 호출 허용)
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: '허용되지 않는 메서드' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { userId, payload } = body;

    // userId 필수 (이름+소속으로 프론트에서 생성)
    if (!userId || userId.length < 2) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: '사용자 정보가 필요합니다. 이름과 소속을 입력해주세요.' }),
      };
    }

    // ── 사용 횟수 확인 ──────────────────────────────────────
    const store = getStore('flood-usage');
    const key = 'user_' + userId.replace(/[^a-zA-Z0-9가-힣]/g, '_');

    let usageData = { count: 0, firstUsed: null, lastUsed: null };
    try {
      const raw = await store.get(key);
      if (raw) usageData = JSON.parse(raw);
    } catch (e) {
      // 처음 사용자 → 기본값 유지
    }

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

    // ── Claude API 호출 ──────────────────────────────────────
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: '서버 설정 오류: API 키가 없습니다.' }),
      };
    }

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });

    const apiData = await apiRes.json();

    if (!apiRes.ok) {
      return {
        statusCode: apiRes.status,
        headers: corsHeaders,
        body: JSON.stringify({ error: apiData.error?.message || 'API 오류' }),
      };
    }

    // ── 호출 성공 → 횟수 증가 저장 ──────────────────────────
    usageData.count += 1;
    usageData.lastUsed = new Date().toISOString();
    if (!usageData.firstUsed) usageData.firstUsed = usageData.lastUsed;
    await store.set(key, JSON.stringify(usageData));

    // 남은 횟수 응답에 포함
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
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: '서버 오류: ' + err.message }),
    };
  }
};
