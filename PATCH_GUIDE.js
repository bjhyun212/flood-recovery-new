// ============================================================
// index.html 수정 사항 - 복붙용 코드 모음
// ============================================================
// 
// 수정 방법:
// index.html 열고 아래 [1]~[4] 순서대로 찾아서 교체
// ============================================================


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// [1] 헤더 UI 수정 - API 키 입력란 → 사용자 이름 입력란으로 교체
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// 찾을 내용 (index.html 약 142번 줄):
//   <input type="password" id="apiKey" class="api-input" placeholder="sk-ant-... API 키 입력">
//   <button class="api-btn" onclick="saveKey()">저장</button>
//
// 교체할 내용:
/*
      <input type="text" id="userName" class="api-input" placeholder="이름 입력 (예: 홍길동)" style="width:110px;">
      <input type="text" id="userOrg"  class="api-input" placeholder="소속 (예: 충북지사)" style="width:110px;margin-left:4px;">
      <button class="api-btn" onclick="saveUserInfo()">확인</button>
*/


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// [2] JS 변수/함수 교체 - 기존 API 키 관련 코드 전체 교체
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// 찾을 내용 (index.html 약 659번 줄):
//   var API_KEY = localStorage.getItem('cak') || '';
//
// 그리고 약 844~893번 줄 전체 블록:
//   // ★ 무료 사용 횟수 관리 (10회 무료 → API 키 필요)
//   ...
//   setTimeout(updateFreeUI, 100);
//
// 그리고 약 1466~1479번 줄:
//   var k = document.getElementById('apiKey').value.trim();
//   ...
//   if (API_KEY) { document.getElementById('apiKey').value = API_KEY; ... }
//
// ── 위 3곳을 모두 지우고 아래 코드로 교체 ──────────────────

var API_KEY = '';  // 하위 호환용 (실제로는 사용 안 함)

// ── 사용자 식별 ──────────────────────────────────────────────
var CURRENT_USER_ID = localStorage.getItem('floodUserId') || '';
var CURRENT_USER_NAME = localStorage.getItem('floodUserName') || '';

function saveUserInfo() {
  var name = (document.getElementById('userName').value || '').trim();
  var org  = (document.getElementById('userOrg').value  || '').trim();
  if (!name) { alert('이름을 입력해주세요.'); return; }
  CURRENT_USER_NAME = name + (org ? ' (' + org + ')' : '');
  // userId = 이름+소속을 영문/한글 그대로 저장 (서버에서 _ 치환)
  CURRENT_USER_ID = name + '_' + (org || 'unknown');
  localStorage.setItem('floodUserId',   CURRENT_USER_ID);
  localStorage.setItem('floodUserName', CURRENT_USER_NAME);
  updateFreeUI();
  setDot(true, CURRENT_USER_NAME + ' 님 확인');
}

// ── 무료 횟수 UI (서버 응답 기준으로 업데이트) ───────────────
var FREE_LIMIT = 10;
var _freeUsedCount = parseInt(localStorage.getItem('floodFreeUsed') || '0');

function updateFreeUI() {
  var el = document.getElementById('freeCount');
  if (!el) return;
  if (!CURRENT_USER_ID) {
    el.textContent = '👤 이름·소속 입력 후 사용 가능';
    el.style.color = 'var(--warn)';
    return;
  }
  var remain = Math.max(0, FREE_LIMIT - _freeUsedCount);
  if (remain > 0) {
    el.textContent = '🎁 무료 ' + (FREE_LIMIT - remain) + '/' + FREE_LIMIT + '회 사용 (' + CURRENT_USER_NAME + ')';
    el.style.color = 'var(--success)';
  } else {
    el.textContent = '⚠️ ' + CURRENT_USER_NAME + ' - 무료 ' + FREE_LIMIT + '회 소진';
    el.style.color = 'var(--warn)';
  }
}

function checkCanUseAPI() {
  if (!CURRENT_USER_ID) {
    alert('이름과 소속을 먼저 입력해주세요.\n(상단 입력란 → 확인 버튼)');
    return false;
  }
  return true;  // 실제 횟수 제한은 서버에서 처리
}

// ── 핵심: 모든 API 호출을 이 함수로 통일 ────────────────────
async function callClaudeAPI(payload) {
  if (!checkCanUseAPI()) throw new Error('사용자 정보 없음');

  var res = await fetch('/.netlify/functions/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: CURRENT_USER_ID,
      payload: payload
    })
  });

  var data = await res.json();

  if (res.status === 429) {
    throw new Error(
      '🎁 무료 사용 ' + FREE_LIMIT + '회가 모두 소진되었습니다.\n\n' +
      '계속 사용하려면 강사에게 문의하거나\n' +
      'Anthropic API 키를 직접 발급받아 입력해주세요.'
    );
  }
  if (!res.ok) {
    throw new Error(data.error || 'API 오류 (status: ' + res.status + ')');
  }

  // 서버에서 내려준 사용 횟수 동기화
  if (data._freeUsed !== undefined) {
    _freeUsedCount = data._freeUsed;
    localStorage.setItem('floodFreeUsed', String(_freeUsedCount));
    updateFreeUI();
  }

  return data;
}

// 초기 UI
setTimeout(function() {
  if (CURRENT_USER_ID) {
    var nameParts = CURRENT_USER_NAME.split(' (');
    var el = document.getElementById('userName');
    if (el) el.value = nameParts[0];
    var el2 = document.getElementById('userOrg');
    if (el2 && nameParts[1]) el2.value = nameParts[1].replace(')', '');
  }
  updateFreeUI();
}, 100);


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// [3] API 호출부 교체 패턴 (16군데 동일하게 적용)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// ── 기존 패턴 (찾아서 교체) ────────────────────────────────
//
//   var res = await fetch('https://api.anthropic.com/v1/messages', {
//     method: 'POST',
//     headers: { 'Content-Type':'application/json', 'x-api-key':API_KEY,
//                'anthropic-version':'2023-06-01',
//                'anthropic-dangerous-direct-browser-access':'true' },
//     body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:..., ... })
//   });
//   var d = await res.json();
//
// ── 교체할 패턴 ────────────────────────────────────────────
//
//   var d = await callClaudeAPI({ model:'claude-sonnet-4-6', max_tokens:..., ... });
//
// ── 핵심: fetch + headers 2줄을 callClaudeAPI() 1줄로 교체
//   payload 안에는 model/max_tokens/messages 등 기존 내용 그대로 유지
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// [4] addFreeCount() 제거
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// 찾을 내용 (약 3087번 줄):
//   addFreeCount(); // 무료 횟수 차감
//
// → 이 줄 삭제 (서버에서 자동 처리하므로 불필요)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
