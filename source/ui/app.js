/* ── 自定义确认弹窗 ── */
let _confirmResolve = null;

function showConfirm(msg, title = '确认') {
  return new Promise(resolve => {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-msg').textContent = msg;
    _confirmResolve = (result) => {
      closeModal('modal-confirm');
      _confirmResolve = null;
      resolve(result);
    };
    openModal('modal-confirm');
  });
}

/* ── 工具函数 ── */

function pyCall(method, ...args) {
  // pywebview 桥接调用
  return window.pywebview.api[method](...args);
}

function showToast(type, msg, duration = 1000) {
  const c = document.getElementById('toast-container');
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || ''}</span><span>${msg}</span>`;
  c.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => el.remove(), 300); }, duration);
}

function appendLog(boxId, msg) {
  const box = document.getElementById(boxId);
  if (!box) return;
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const lines = msg.split('\n').filter(l => l);
  const MAX_LINES = 500;

  if (!box._logLines) box._logLines = [];
  if (!box._pendingLines) box._pendingLines = [];

  for (const line of lines) {
    const hasTs = /^\d{4}年|^\d{2}:\d{2}:\d{2}/.test(line.trimStart());
    box._pendingLines.push(hasTs ? line : `[${ts}] ${line}`);
  }

  // 200ms 内的日志攒批一次性刷新，避免高频全量重绘
  if (box._flushTimer) return;
  box._flushTimer = setTimeout(() => {
    box._flushTimer = null;
    if (!box._pendingLines.length) return;
    box._logLines.push(...box._pendingLines);
    box._pendingLines = [];
    if (box._logLines.length > MAX_LINES) {
      box._logLines = box._logLines.slice(-MAX_LINES);
    }
    box.textContent = box._logLines.join('\n') + '\n';
    const sel = window.getSelection();
    const userSelecting = sel && sel.rangeCount > 0 && !sel.isCollapsed && box.contains(sel.anchorNode);
    if (!userSelecting) box.scrollTop = box.scrollHeight;
  }, 200);
}

function clearLog(boxId) {
  const box = document.getElementById(boxId);
  if (box) { box.textContent = ''; box._logLines = []; }
}

function copyLog(boxId) {
  const box = document.getElementById(boxId);
  if (!box) return;
  const text = box.textContent;
  if (!text) { showToast('warning', '日志为空'); return; }
  // pywebview 环境下用 pywebview.api 复制
  if (window.pywebview && window.pywebview.api) {
    pyCall('copy_to_clipboard', text).catch(() => {});
  }
  showToast('success', '日志已复制');
}

/* ── 主题切换 ── */
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  _applyThemeIcon(next);
  // 同步更新原生标题栏颜色
  if (window.pywebview && window.pywebview.api) {
    window.pywebview.api.set_titlebar_theme(next);
  }
}

function _applyThemeIcon(theme) {
  const moon = document.getElementById('theme-icon-moon');
  const sun  = document.getElementById('theme-icon-sun');
  const lbl  = document.getElementById('theme-label');
  if (theme === 'dark') {
    moon.style.display = 'none';
    sun.style.display  = '';
    if (lbl) lbl.textContent = '浅色';
  } else {
    moon.style.display = '';
    sun.style.display  = 'none';
    if (lbl) lbl.textContent = '深色';
  }
}

(function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  _applyThemeIcon(saved);
  // 页面加载后同步标题栏颜色（等 pywebview 就绪）
  window.addEventListener('pywebviewready', function() {
    window.pywebview.api.set_titlebar_theme(saved);
  });
})();

// 在日志框内复制完后自动清除选区
document.addEventListener('copy', () => {
  const sel = window.getSelection();
  if (sel && sel.anchorNode) {
    const box = sel.anchorNode.parentElement && sel.anchorNode.parentElement.closest('.log-box');
    if (box) {
      setTimeout(() => sel.removeAllRanges(), 100);
    }
  }
});

/* ── 私信用户列表虚拟化 ──
   textarea 只显示前 PREVIEW_LINES 行 + 统计提示，完整数据存 window._dmAllUsers
   避免 5 万行全量渲染导致前端卡顿 */
const DM_PREVIEW_LINES = 1000;
window._dmAllUsers = [];

function _dmTaFlush(ta) {
  const all = window._dmAllUsers;
  if (all.length <= DM_PREVIEW_LINES) {
    // 行数少，直接显示全部，不加提示
    ta._skipChange = true;
    ta.value = all.join('\n');
    ta._skipChange = false;
    return;
  }
  const preview = all.slice(0, DM_PREVIEW_LINES).join('\n');
  const hint = `\n# ... 共 ${all.length} 个用户，已加载前 ${DM_PREVIEW_LINES} 行（发送时使用全部）`;
  ta._skipChange = true;
  ta.value = preview + hint;
  ta._skipChange = false;
}

document.addEventListener('DOMContentLoaded', () => {
  const ta = document.getElementById('dm-users-input');
  if (!ta) return;

  ta.addEventListener('input', () => {
    if (ta._skipChange) return;
    // 用户手动编辑时，同步回 _dmAllUsers（过滤掉提示行）
    window._dmAllUsers = ta.value.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    if (window._dmAllUsers.length > DM_PREVIEW_LINES) _dmTaFlush(ta);
  });

  ta.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    const newLines = pasted.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    // 合并到现有列表
    const existing = window._dmAllUsers;
    const merged = [...existing, ...newLines];
    // 去重
    window._dmAllUsers = [...new Set(merged.map(l => l.trim()))].filter(Boolean);
    _dmTaFlush(ta);
    showToast('success', `已载入 ${window._dmAllUsers.length} 个用户`);
  });
});

/* ── 页面切换 ── */
function switchPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelector(`[data-page="${name}"]`).classList.add('active');
}

/* ── 弹窗 ── */
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// 点击遮罩关闭
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });
});

/* ── 配置加载 ── */
let _cfg = {};
const DEFAULT_AI_BASE_URL = 'https://right.codes/gemini';

async function loadConfig() {
  const raw = await pyCall('get_config');
  _cfg = JSON.parse(raw);
  applyConfigToUI(_cfg);
  updateAllCounts();
}

function applyConfigToUI(cfg) {
  setVal('cfg-api-id', cfg.api_id || '');
  setVal('cfg-api-hash', cfg.api_hash || '');
  setChk('cfg-keep-online', cfg.keep_online !== false);
  setChk('cfg-device-sim', cfg.device_simulation !== false);
  setVal('cfg-proxies', (cfg.proxies || []).join('\n'));
  const proxyTypeEl = document.getElementById('cfg-proxy-type');
  if (proxyTypeEl) proxyTypeEl.value = cfg.proxy_type || 'socks5';

  setVal('bc-interval-min', cfg.interval_per_group_min ?? 30);
  setVal('bc-interval-max', cfg.interval_per_group_max ?? 60);
  setVal('bc-complete-min', cfg.interval_after_complete_min ?? 60);
  setVal('bc-complete-max', cfg.interval_after_complete_max ?? 120);
  setChk('cfg-auto-leave', !!cfg.auto_leave_restricted);
  setChk('bc-random-send', !!cfg.random_send);
  setChk('bc-use-quote', !!cfg.reply_use_quote);
  setChk('bc-direct-random', !!cfg.direct_random_send);
  setChk('bc-direct-random-suffix', !!cfg.direct_random_suffix);
  setChk('bc-fwd-hide', cfg.forward_hide_sender !== false);
  setChk('bc-fwd-random', !!cfg.forward_random_send);
  setChk('bc-post-random', !!cfg.post_random_send);
  setChk('bc-contact-random', cfg.contact_random_send !== false);

  setVal('dm-interval-min', cfg.dm_interval_min ?? 30);
  setVal('dm-interval-max', cfg.dm_interval_max ?? 60);
  setVal('dm-max-per-account', cfg.dm_max_per_account ?? 0);
  setChk('dm-direct-random', !!cfg.dm_direct_random);
  setChk('dm-random-send', !!cfg.dm_random_send);
  setChk('dm-fwd-hide', cfg.dm_forward_hide_sender !== false);
  setChk('dm-fwd-random', !!cfg.dm_forward_random);
  setChk('dm-post-random', !!cfg.dm_post_random);
  setChk('dm-contact-random', cfg.dm_contact_random !== false);
  setChk('dm-schedule-enable', !!cfg.dm_schedule_enable);
  setVal('dm-schedule-time', cfg.dm_schedule_time || '');
  setChk('bc-schedule-enable', !!cfg.bc_schedule_enable);
  setVal('bc-schedule-time', cfg.bc_schedule_time || '');
  setChk('bc-auto-unspam', !!cfg.bc_auto_unspam);


  // 广播模式
  const bcMode = cfg.broadcast_mode || '引用转发';
  switchBcMode(bcMode, document.querySelector(`.bc-mode-pill[data-mode="${bcMode}"]`));

  // 私信模式
  const dmMode = cfg.dm_mode || '直发';
  switchDmMode(dmMode, document.querySelector(`#page-dm .bc-mode-pill[data-mode="${dmMode}"]`));

  // 链接验活配置
  setVal('ws-threads', cfg.ws_threads ?? 1);
  setVal('ws-public-min', cfg.ws_public_min ?? 0);
  setVal('ws-private-min', cfg.ws_private_min ?? 0);
  setVal('ws-exclude', cfg.ws_exclude_keywords ?? '退押,暂停交易');

  // 过验证配置
  setVal('vf-interval-min', cfg.vf_interval_min ?? 160);
  setVal('vf-interval-max', cfg.vf_interval_max ?? 220);
  setChk('vf-test-speak', !!cfg.vf_test_speak);
  setChk('vf-all-join', !!cfg.vf_all_join);
  setChk('vf-auto-start-broadcast', !!cfg.vf_auto_start_broadcast);
  setChk('vf-ai-enable', !!cfg.vf_ai_enabled);
  setVal('vf-ai-api-key', cfg.vf_ai_api_key || '');
  setVal('vf-ai-base-url', cfg.vf_ai_base_url || DEFAULT_AI_BASE_URL);
  setVal('vf-ai-proxy-scheme', cfg.vf_ai_proxy_scheme || 'auto');
  setVal('vf-ai-proxy-url', cfg.vf_ai_proxy_url || '');
  setVal('vf-ai-timeout', cfg.vf_ai_timeout_sec ?? 3);

  // 活跃度检测配置
  setVal('checker-hours', cfg.checker_active_hours ?? 24);
  setVal('checker-interval-min', cfg.checker_interval_min ?? 3);
  setVal('checker-interval-max', cfg.checker_interval_max ?? 8);
}

function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
function setChk(id, v) { const el = document.getElementById(id); if (el) el.checked = v; }
function getVal(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function getChk(id) { const el = document.getElementById(id); return el ? el.checked : false; }

async function saveConfig() {
  const proxies = getVal('cfg-proxies').split('\n').map(s => s.trim()).filter(Boolean);
  const proxyType = document.getElementById('cfg-proxy-type')?.value || 'socks5';
  const patch = {
    api_id: getVal('cfg-api-id'),
    api_hash: getVal('cfg-api-hash'),
    keep_online: getChk('cfg-keep-online'),
    device_simulation: getChk('cfg-device-sim'),
    proxies,
    proxy_type: proxyType,
  };
  const res = JSON.parse(await pyCall('save_config', JSON.stringify(patch)));
  if (res.ok) { showToast('success', '配置已保存'); _cfg = Object.assign(_cfg, patch); }
  else showToast('error', res.error);
}

/* ── 计数标签 ── */
function updateAllCounts() {
  const counts = {
    'bc-link-count':    (_cfg.message_links || []).length,
    'bc-text-count':    (_cfg.reply_texts || []).length,
    'bc-direct-count':  (_cfg.direct_texts || []).length,
    'bc-fwd-count':     (_cfg.forward_links || []).length,
    'bc-post-count':    (_cfg.post_codes || []).length,
    'bc-sticker-count': (_cfg.sticker_packs || []).length,
    'bc-contact-count': (_cfg.contact_cards || []).length,
    'dm-direct-count':  (_cfg.dm_direct_texts || []).length,
    'dm-link-count':    (_cfg.dm_links || []).length,
    'dm-text-count':    (_cfg.dm_reply_texts || []).length,
    'dm-fwd-count':     (_cfg.dm_forward_links || []).length,
    'dm-post-count':    (_cfg.dm_post_codes || []).length,
    'dm-sticker-count': (_cfg.dm_sticker_packs || []).length,
    'dm-contact-count': (_cfg.dm_contact_cards || []).length,
    'monitor-dm-direct-count':  (_cfg.dm_direct_texts || []).length,
    'monitor-dm-link-count':    (_cfg.dm_links || []).length,
    'monitor-dm-text-count':    (_cfg.dm_reply_texts || []).length,
    'monitor-dm-fwd-count':     (_cfg.dm_forward_links || []).length,
    'monitor-dm-post-count':    (_cfg.dm_post_codes || []).length,
    'monitor-dm-sticker-count': (_cfg.dm_sticker_packs || []).length,
    'monitor-dm-contact-count': (_cfg.dm_contact_cards || []).length,
    'monitor-private-reply-count': (_cfg.monitor_private_reply_texts || []).length,
    'monitor-reply-direct-count':  (_cfg.monitor_reply_direct_texts || []).length,
    'monitor-reply-sticker-count': (_cfg.monitor_reply_sticker_packs || []).length,
    'vf-greeting-count': (_cfg.vf_greeting_texts || []).length,
  };
  for (const [id, n] of Object.entries(counts)) {
    const el = document.getElementById(id);
    if (el) el.textContent = n;
  }
}

/* ── 模式切换 ── */
let _bcMode = '引用转发';
let _dmMode = '直发';

function switchBcMode(mode, btn) {
  _bcMode = mode;
  // 切换模式 pill
  document.querySelectorAll('#page-broadcast .bc-mode-pill').forEach(b => b.classList.remove('active'));
  // 切换参数面板
  document.querySelectorAll('#page-broadcast .bc-param-panel').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const panel = document.getElementById('bc-param-' + mode);
  if (panel) panel.classList.add('active');
}

function switchDmMode(mode, btn) {
  _dmMode = mode;
  document.querySelectorAll('#page-dm .bc-mode-pill').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#page-dm .bc-param-panel').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const panel = document.getElementById('dm-param-' + mode);
  if (panel) panel.classList.add('active');
}

/* ── 账号管理 ── */
let _selectedAccounts = new Set();
let _accountsCache = {};  // session -> {status, username, device} 用于 diff
const ACCOUNT_STATUS_CACHE_KEY = 'fzdn_account_status_cache_v1';

function _loadAccountStatusCache() {
  const cfgCache = (_cfg && _cfg.account_status_cache) || {};
  try {
    const raw = localStorage.getItem(ACCOUNT_STATUS_CACHE_KEY);
    const localCache = raw ? JSON.parse(raw) : {};
    return Object.assign({}, localCache, cfgCache);
  } catch (e) {
    return cfgCache;
  }
}

function _saveAccountStatusCache(cache) {
  try {
    localStorage.setItem(ACCOUNT_STATUS_CACHE_KEY, JSON.stringify(cache || {}));
  } catch (e) {}
  try {
    _cfg.account_status_cache = cache || {};
    if (window.pywebview && window.pywebview.api && window.pywebview.api.save_config) {
      pyCall('save_config', JSON.stringify({ account_status_cache: _cfg.account_status_cache })).catch(() => {});
    }
  } catch (e) {}
}

function _isPlaceholderStatus(status) {
  if (!status) return true;
  const text = String(status);
  return text.includes('\u672a\u68c0\u6d4b') || text.includes('\u672a\u77e5');
}

function _mergeSavedAccountStatus(accounts) {
  const saved = _loadAccountStatusCache();
  return accounts.map(a => {
    const old = saved[a.session];
    if (!old) return a;
    const merged = { ...a };
    if (_isPlaceholderStatus(merged.status) && old.status) merged.status = old.status;
    ['username', 'device', 'spam_label', 'spam_detail', 'user_id', 'premium', 'phone'].forEach(k => {
      if ((merged[k] === undefined || merged[k] === null || merged[k] === '') && old[k] !== undefined) {
        merged[k] = old[k];
      }
    });
    return merged;
  });
}

async function refreshAccounts() {
  const raw = await pyCall('get_accounts_json');
  const accounts = _mergeSavedAccountStatus(JSON.parse(raw));
  renderAccounts(accounts);
}

function _getStatusClass(a) {
  return {
    '正常': 'status-normal', '已冻结': 'status-frozen',
    '已封禁': 'status-banned', '未授权': 'status-banned'
  }[a.status] || (a.status && (a.status.includes('封禁') || a.status.includes('未授权') || a.status.includes('检测失败')) ? 'status-banned'
    : a.status && a.status.includes('冻结') ? 'status-frozen' : 'status-unknown');
}

function _spamHtml(a) {
  if (!a.spam_label) return '';
  const detail = a.spam_detail ? `<div class="account-spam-detail">${a.spam_detail}</div>` : '';
  return `<div class="account-spam-wrap"><span class="account-spam">${a.spam_label}</span>${detail}</div>`;
}

function renderAccounts(accounts) {
  const list = document.getElementById('account-list');
  if (!accounts.length) {
    list.innerHTML = '<tr><td colspan="7" class="empty-state">暂无账号，请导入 Session 文件或登录新账号</td></tr>';
    _accountsCache = {};
    updateSelectCount();
    return;
  }

  const newSessions = new Set(accounts.map(a => a.session));
  const oldSessions = new Set(Object.keys(_accountsCache));
  const needFullRebuild = newSessions.size !== oldSessions.size ||
    [...newSessions].some(s => !oldSessions.has(s)) ||
    [...oldSessions].some(s => !newSessions.has(s));

  if (needFullRebuild) {
    list.innerHTML = accounts.map(a => {
      const statusClass = _getStatusClass(a);
      const checked = _selectedAccounts.has(a.session) ? 'checked' : '';
      const deviceStr = a.device && a.device !== '未分配' ? a.device : '';
      return `
      <tr class="account-item" data-session="${a.session}">
        <td class="ac-check"><input type="checkbox" ${checked} onchange="toggleAccountSelect('${a.session}', this)"></td>
        <td class="ac-name">${a.username || a.session}</td>
        <td class="ac-id">${a.user_id || ''}</td>
        <td class="ac-phone">${a.phone || ''}</td>
        <td class="ac-status"><span class="account-status ${statusClass}">${a.status}</span></td>
        <td class="ac-premium">${a.premium ? '⭐' : ''}</td>
        <td class="ac-spam">${_spamHtml(a)}</td>
      </tr>`;
    }).join('');
    _accountsCache = {};
    accounts.forEach(a => { _accountsCache[a.session] = { status: a.status, username: a.username, device: a.device, spam_label: a.spam_label, spam_detail: a.spam_detail, user_id: a.user_id, premium: a.premium, phone: a.phone }; });
    _saveAccountStatusCache(_accountsCache);
  } else {
    accounts.forEach(a => {
      const cached = _accountsCache[a.session];
      if (!cached || cached.status !== a.status || cached.username !== a.username || cached.spam_label !== a.spam_label || cached.premium !== a.premium || cached.user_id !== a.user_id || cached.phone !== a.phone) {
        const row = list.querySelector(`[data-session="${a.session}"]`);
        if (row) {
          if (!cached || cached.status !== a.status) {
            const el = row.querySelector('.account-status');
            if (el) { el.className = `account-status ${_getStatusClass(a)}`; el.textContent = a.status; }
          }
          if (!cached || cached.username !== a.username) {
            const el = row.querySelector('.ac-name');
            if (el) el.textContent = a.username || a.session;
          }
          if (!cached || cached.user_id !== a.user_id) {
            const el = row.querySelector('.ac-id');
            if (el) el.textContent = a.user_id || '';
          }
          if (!cached || cached.phone !== a.phone) {
            const el = row.querySelector('.ac-phone');
            if (el) el.textContent = a.phone || '';
          }
          if (!cached || cached.premium !== a.premium) {
            const el = row.querySelector('.ac-premium');
            if (el) el.textContent = a.premium ? '⭐' : '';
          }
          if (!cached || cached.spam_label !== a.spam_label || cached.spam_detail !== a.spam_detail) {
            const el = row.querySelector('.ac-spam');
            if (el) el.innerHTML = _spamHtml(a);
          }
        }
        _accountsCache[a.session] = { status: a.status, username: a.username, device: a.device, spam_label: a.spam_label, spam_detail: a.spam_detail, user_id: a.user_id, premium: a.premium, phone: a.phone };
      }
    });
    _saveAccountStatusCache(_accountsCache);
  }

  updateSelectCount();
}

function toggleAccountSelect(session, cb) {
  if (cb.checked) _selectedAccounts.add(session);
  else _selectedAccounts.delete(session);
  updateSelectCount();
  const allCbs = document.querySelectorAll('#account-list tr.account-item input[type="checkbox"]');
  document.getElementById('select-all').checked =
    allCbs.length > 0 && _selectedAccounts.size === allCbs.length;
}

function toggleSelectAll(cb) {
  _selectedAccounts.clear();
  if (cb.checked) {
    document.querySelectorAll('#account-list tr.account-item').forEach(item => {
      item.querySelector('input[type="checkbox"]').checked = true;
      const onchange = item.querySelector('input[type="checkbox"]').getAttribute('onchange');
      const match = onchange && onchange.match(/'([^']+)'/);
      if (match) _selectedAccounts.add(match[1]);
    });
  } else {
    document.querySelectorAll('#account-list tr.account-item input[type="checkbox"]').forEach(el => el.checked = false);
  }
  updateSelectCount();
}

function updateSelectCount() {
  document.getElementById('select-count').textContent = `已选 ${_selectedAccounts.size} 个`;
}

async function detectAccounts() {
  // 读取账号管理页勾选的账号（从 tr 的 data-session 取）
  const checked = [...document.querySelectorAll('#account-list tr.account-item')]
    .filter(tr => tr.querySelector('input[type="checkbox"]')?.checked)
    .map(tr => tr.dataset.session).filter(Boolean);
  showToast('info', checked.length ? `开始检测 ${checked.length} 个账号...` : '开始检测所有账号...');
  await pyCall('detect_accounts', JSON.stringify(checked));
}

async function cleanAbnormal() {
  const res = JSON.parse(await pyCall('clean_abnormal_accounts'));
  showToast('success', `已清理 ${res.deleted} 个异常账号`);
  refreshAccounts();
}

async function moveSpamAccounts() {
  const res = JSON.parse(await pyCall('move_spam_accounts'));
  if (res.ok) {
    if (res.moved === 0) {
      showToast('info', '没有检测到双向账号（请先检测状态）');
    } else {
      showToast('success', `已移出 ${res.moved} 个账号：永久双向 ${res.perm} 个，临时双向 ${res.temp} 个`);
      refreshAccounts();
    }
  } else {
    showToast('error', res.error || '移出失败');
  }
}

async function deleteSelected() {
  if (!_selectedAccounts.size) { showToast('warning', '请先选择账号'); return; }
  const ok = await showConfirm(`确定删除选中的 ${_selectedAccounts.size} 个账号？`, '删除账号');
  if (!ok) return;
  const res = JSON.parse(await pyCall('delete_accounts', JSON.stringify([..._selectedAccounts])));
  if (res.ok) {
    showToast('success', `已删除 ${res.deleted} 个账号`);
    _selectedAccounts.clear();
    refreshAccounts();
  } else showToast('error', res.error);
}

async function kickOtherDevices() {
  if (!_selectedAccounts.size) { showToast('warning', '请先选择账号'); return; }
  const ok = await showConfirm(
    `确定为选中的 ${_selectedAccounts.size} 个账号踢出所有其他登录设备？\n（当前 Session 不受影响）`,
    '踢出其他设备'
  );
  if (!ok) return;
  const res = JSON.parse(await pyCall('kick_other_devices', JSON.stringify([..._selectedAccounts])));
  if (res.ok) {
    showToast('success', `已处理 ${res.success} 个账号，失败 ${res.failed} 个`);
  } else showToast('error', res.error);
}

async function importSessions() {
  if (window.pywebview && window.pywebview.api.open_file_dialog) {
    const paths = await window.pywebview.api.open_file_dialog();
    if (paths && paths.length) {
      const res = JSON.parse(await pyCall('import_session_files_batch', JSON.stringify(paths)));
      if (res.ok) {
        if (res.accounts) showToast('success', `已导入 ${res.accounts} 个账号`);
        if (res.errors && res.errors.length) showToast('error', res.errors[0]);
      } else {
        showToast('error', res.error);
      }
      refreshAccounts();
    }
  }
}

/* ── 登录 ── */
function showLoginModal() { openModal('modal-login'); }

async function importTdata() {
  if (!window.pywebview) return;
  const folders = await window.pywebview.api.open_folder_dialog();
  if (!folders || !folders.length) return;
  showToast('info', `正在导入 ${folders.length} 个直登包，请稍候...`);
  const res = JSON.parse(await pyCall('import_tdata_batch', JSON.stringify(folders)));
  if (res.ok) {
    const cnt = res.accounts || 0;
    const errs = res.errors || [];
    if (cnt > 0) showToast('success', `直登包导入成功：${cnt} 个账号`);
    if (errs.length > 0) showToast('error', errs[0]);
    if (cnt === 0 && errs.length === 0) showToast('warning', '未导入任何账号');
  } else {
    showToast('error', res.error || '导入失败');
  }
  refreshAccounts();
}

async function sendCode() {
  const phone = getVal('login-phone');
  if (!phone) { showToast('warning', '请输入手机号'); return; }
  const apiMode = document.getElementById('login-api-mode').value;
  document.getElementById('login-status').textContent = '正在发送验证码...';
  await pyCall('send_code', phone, apiMode);
}

async function verifyCode() {
  const code = getVal('login-code');
  const pwd = getVal('login-password');
  if (!code) { showToast('warning', '请输入验证码'); return; }
  document.getElementById('login-status').textContent = '正在验证...';
  await pyCall('verify_code', code, pwd);
}

/* ── 接收登录验证码 ── */
let _fcTimer = null;
let _fcSession = '';
let _fcCd = 0;

function showFetchCodeModal() {
  if (_selectedAccounts.size !== 1) { showToast('warning', '请选择一个账号'); return; }
  _fcSession = [..._selectedAccounts][0];
  document.getElementById('fc-session-name').textContent = _fcSession;
  document.getElementById('fc-result-wrap').style.display = 'none';
  document.getElementById('fc-empty').style.display = 'block';
  document.getElementById('fc-error').style.display = 'none';
  document.getElementById('fc-countdown').textContent = '';
  openModal('modal-fetch-code');
  fetchCodeNow();
  _startFetchCodePoll();
}

function closeFetchCodeModal() {
  clearInterval(_fcTimer);
  _fcTimer = null;
  _fcSession = '';  // 清空 session，让正在进行的轮询回调不再处理结果
  closeModal('modal-fetch-code');
}

function _startFetchCodePoll() {
  clearInterval(_fcTimer);
  _fcCd = 5;
  _fcTimer = setInterval(async () => {
    _fcCd--;
    document.getElementById('fc-countdown').textContent = `${_fcCd}s 后自动刷新`;
    if (_fcCd <= 0) {
      _fcCd = 5;
      await fetchCodeNow();
    }
  }, 1000);
}

async function fetchCodeNow() {
  if (!_fcSession) return;
  document.getElementById('fc-countdown').textContent = '刷新中...';
  const res = await pyCall('fetch_login_code', _fcSession);
  let data;
  try { data = JSON.parse(res); } catch { return; }
  if (data.ok) {
    document.getElementById('fc-result-wrap').style.display = 'block';
    document.getElementById('fc-empty').style.display = 'none';
    document.getElementById('fc-error').style.display = 'none';
    document.getElementById('fc-code').textContent = data.code;
    document.getElementById('fc-code-time').textContent = data.date ? `收到时间：${data.date}` : '';
    document.getElementById('fc-code-text').textContent = data.text || '';
  } else {
    document.getElementById('fc-result-wrap').style.display = 'none';
    document.getElementById('fc-empty').style.display = 'block';
    if (data.error && data.error !== '暂无验证码消息') {
      document.getElementById('fc-error').style.display = 'block';
      document.getElementById('fc-error').textContent = data.error;
    }
  }
  _fcCd = 5;
}

async function copyFetchCode() {
  const code = document.getElementById('fc-code').textContent;
  if (!code) return;
  if (window.pywebview && window.pywebview.api) {
    pyCall('copy_to_clipboard', code).catch(() => {});
    showToast('success', `已复制：${code}`);
  } else {
    try {
      await navigator.clipboard.writeText(code);
      showToast('success', `已复制：${code}`);
    } catch {
      showToast('info', `验证码：${code}`);
    }
  }
}

/* ── 批量修改资料 ── */
function showEditProfileModal() {
  if (!_selectedAccounts.size) { showToast('warning', '请先选择账号'); return; }
  openModal('modal-edit-profile');
}

async function runBatchEdit() {
  const rawUsernames = getVal('ep-username-val');
  const usernameList = rawUsernames.split('\n').map(s => s.trim()).filter(s => s.length > 0);
  const opts = {
    do_first: getChk('ep-do-first'), do_last: getChk('ep-do-last'),
    do_bio: getChk('ep-do-bio'), do_username: getChk('ep-do-username'),
    random_affix: getChk('ep-random-affix'),
    username_list: usernameList,
    do_photo: getChk('ep-do-photo'), do_pwd: getChk('ep-do-pwd'),
    do_privacy: getChk('ep-do-privacy'),
    privacy_phone:  document.getElementById('ep-privacy-phone')?.value  || 'nobody',
    privacy_status: document.getElementById('ep-privacy-status')?.value || 'nobody',
    privacy_photo:  document.getElementById('ep-privacy-photo')?.value  || 'everybody',
    privacy_bio:    document.getElementById('ep-privacy-bio')?.value    || 'everybody',
    privacy_invite: document.getElementById('ep-privacy-invite')?.value || 'nobody',
    pwd_cur: getVal('ep-pwd-cur'), pwd_new: getVal('ep-pwd-new'),
  };
  closeModal('modal-edit-profile');
  await pyCall('batch_edit_profile', JSON.stringify([..._selectedAccounts]), JSON.stringify(opts));
}

function toggleUsernameInput(chk) {
  document.getElementById('ep-username-wrap').style.display = chk.checked ? 'block' : 'none';
}

function togglePrivacyPanel(chk) {
  document.getElementById('ep-privacy-wrap').style.display = chk.checked ? 'block' : 'none';
}

/* ── 列表管理弹窗（通用） ── */
let _listModalKey = '';

/* ── 直发文案+媒体管理弹窗 ── */
let _dmModalTarget = 'bc'; // 'bc' 或 'dm'
let _dmModalMediaPath = '';

function _getDmKey(target) {
  if (target === 'bc') return 'direct_texts';
  if (target === 'monitor_reply') return 'monitor_reply_direct_texts';
  return 'dm_direct_texts';
}

function showDirectMediaModal(target) {
  _dmModalTarget = target;
  _dmModalMediaPath = '';
  document.getElementById('dm-modal-title').textContent = target === 'bc' ? '群发直发文案管理' : '私信直发文案管理';
  document.getElementById('dm-modal-text-input').value = '';
  document.getElementById('dm-modal-media-name').textContent = '未选择文件';
  renderDirectMediaList();
  openModal('modal-direct-media');
}

function renderDirectMediaList() {
  const key = _getDmKey(_dmModalTarget);
  const items = _cfg[key] || [];
  const container = document.getElementById('dm-modal-list');
  const countEl = document.getElementById('dm-modal-count');
  countEl.textContent = items.length;
  if (!items.length) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:12px 0">暂无文案，在左侧添加</div>';
    return;
  }
  container.innerHTML = items.map((item, i) => {
    const text = typeof item === 'string' ? item : item.text;
    const media = typeof item === 'string' ? '' : (item.media || '');
    const mediaName = media ? media.split(/[\\/]/).pop() : '';
    return `
    <div class="dm-media-item" data-index="${i}" onclick="toggleDmMediaItem(this)">
      <input type="checkbox" onclick="event.stopPropagation()">
      <div class="dm-media-item-body">
        <div class="dm-media-item-text">${escHtml(text)}</div>
        ${mediaName ? `<div class="dm-media-item-file">📎 ${escHtml(mediaName)}</div>` : '<div class="dm-media-item-file" style="color:var(--text-muted)">无媒体</div>'}
      </div>
      <button class="btn btn-sm btn-ghost" style="flex-shrink:0" onclick="event.stopPropagation();pickMediaForItem(${i})" title="更换媒体">📎</button>
    </div>`;
  }).join('');
}

function toggleDmMediaItem(el) {
  el.classList.toggle('selected');
  el.querySelector('input[type="checkbox"]').checked = el.classList.contains('selected');
}

async function pickDirectMediaFile() {
  const res = JSON.parse(await pyCall('pick_media_file'));
  if (res.path) {
    _dmModalMediaPath = res.path;
    document.getElementById('dm-modal-media-name').textContent = res.path.split(/[\\/]/).pop();
  }
}

function clearDirectMediaFile() {
  _dmModalMediaPath = '';
  document.getElementById('dm-modal-media-name').textContent = '未选择文件';
}

async function pickMediaForItem(index) {
  const res = JSON.parse(await pyCall('pick_media_file'));
  if (!res.path) return;
  const key = _getDmKey(_dmModalTarget);
  const items = _cfg[key] || [];
  const item = items[index];
  if (typeof item === 'string') {
    items[index] = { text: item, media: res.path };
  } else {
    items[index] = { ...item, media: res.path };
  }
  _cfg[key] = items;
  await pyCall('save_config', JSON.stringify({ [key]: items }));
  renderDirectMediaList();
  updateAllCounts();
}

async function directMediaModalAdd() {
  const raw = document.getElementById('dm-modal-text-input').value;
  if (!raw.trim()) return;
  const key = _getDmKey(_dmModalTarget);
  if (!_cfg[key]) _cfg[key] = [];
  // 空行分隔多条
  const texts = raw.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  let added = 0;
  for (const text of texts) {
    const newItem = _dmModalMediaPath ? { text, media: _dmModalMediaPath } : { text, media: '' };
    _cfg[key].push(newItem);
    added++;
  }
  if (added) {
    document.getElementById('dm-modal-text-input').value = '';
    _dmModalMediaPath = '';
    document.getElementById('dm-modal-media-name').textContent = '未选择文件';
    await pyCall('save_config', JSON.stringify({ [key]: _cfg[key] }));
    renderDirectMediaList();
    updateAllCounts();
  }
}

async function directMediaDeleteSelected() {
  const selected = [...document.querySelectorAll('#dm-modal-list .dm-media-item.selected')]
    .map(el => parseInt(el.dataset.index));
  if (!selected.length) { showToast('warning', '请先选择要删除的条目'); return; }
  const key = _getDmKey(_dmModalTarget);
  _cfg[key] = (_cfg[key] || []).filter((_, i) => !selected.includes(i));
  await pyCall('save_config', JSON.stringify({ [key]: _cfg[key] }));
  renderDirectMediaList();
  updateAllCounts();
}

function directMediaSelectAll() {
  document.querySelectorAll('#dm-modal-list .dm-media-item').forEach(el => {
    el.classList.add('selected');
    el.querySelector('input[type="checkbox"]').checked = true;
  });
}

function directMediaDeselectAll() {
  document.querySelectorAll('#dm-modal-list .dm-media-item').forEach(el => {
    el.classList.remove('selected');
    el.querySelector('input[type="checkbox"]').checked = false;
  });
}

/* ── 名片管理弹窗 ── */
let _contactModalTarget = 'bc';

function _getContactKey(target) {
  return target === 'bc' ? 'contact_cards' : 'dm_contact_cards';
}

function showContactModal(target) {
  _contactModalTarget = target;
  document.getElementById('contact-modal-title').textContent = target === 'bc' ? '群发名片管理' : '私信名片管理';
  document.getElementById('contact-phone-input').value = '';
  document.getElementById('contact-name-input').value = '';
  document.getElementById('contact-batch-input').value = '';
  renderContactList();
  openModal('modal-contact');
}

function renderContactList() {
  const key = _getContactKey(_contactModalTarget);
  const items = _cfg[key] || [];
  const container = document.getElementById('contact-modal-list');
  const countEl = document.getElementById('contact-modal-count');
  countEl.textContent = items.length;
  if (!items.length) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:12px 0">暂无名片，在左侧添加</div>';
    return;
  }
  container.innerHTML = items.map((item, i) => {
    // 兼容旧格式 "phone|name" 和新格式 {phone, name}
    let phone, name;
    if (typeof item === 'string') {
      const parts = item.split('|');
      phone = parts[0] || '';
      name = parts[1] || '';
    } else {
      phone = item.phone || '';
      name = item.name || '';
    }
    return `
    <div class="contact-item" data-index="${i}" onclick="toggleContactItem(this)">
      <input type="checkbox" onclick="event.stopPropagation()">
      <div class="contact-item-body">
        <div class="contact-item-name">${escHtml(name) || '<span style="color:var(--text-muted)">无名字</span>'}</div>
        <div class="contact-item-phone">${escHtml(phone)}</div>
      </div>
    </div>`;
  }).join('');
}

function toggleContactItem(el) {
  el.classList.toggle('selected');
  el.querySelector('input[type="checkbox"]').checked = el.classList.contains('selected');
}

async function contactModalAdd() {
  const phone = document.getElementById('contact-phone-input').value.trim();
  const name = document.getElementById('contact-name-input').value.trim();
  if (!phone) { showToast('warning', '请输入手机号'); return; }
  const key = _getContactKey(_contactModalTarget);
  if (!_cfg[key]) _cfg[key] = [];
  _cfg[key].push({ phone, name });
  document.getElementById('contact-phone-input').value = '';
  document.getElementById('contact-name-input').value = '';
  await pyCall('save_config', JSON.stringify({ [key]: _cfg[key] }));
  renderContactList();
  updateAllCounts();
}

async function contactModalBatchAdd() {
  const raw = document.getElementById('contact-batch-input').value.trim();
  if (!raw) return;
  const key = _getContactKey(_contactModalTarget);
  if (!_cfg[key]) _cfg[key] = [];
  let added = 0;
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    // 支持空格或 | 分隔
    const sep = s.includes('|') ? '|' : ' ';
    const idx = s.indexOf(sep);
    const phone = idx > 0 ? s.slice(0, idx).trim() : s;
    const name = idx > 0 ? s.slice(idx + 1).trim() : '';
    if (phone) { _cfg[key].push({ phone, name }); added++; }
  }
  if (added) {
    document.getElementById('contact-batch-input').value = '';
    await pyCall('save_config', JSON.stringify({ [key]: _cfg[key] }));
    renderContactList();
    updateAllCounts();
    showToast('success', `已添加 ${added} 张名片`);
  }
}

async function contactDeleteSelected() {
  const selected = [...document.querySelectorAll('#contact-modal-list .contact-item.selected')]
    .map(el => parseInt(el.dataset.index));
  if (!selected.length) { showToast('warning', '请先选择要删除的名片'); return; }
  const key = _getContactKey(_contactModalTarget);
  _cfg[key] = (_cfg[key] || []).filter((_, i) => !selected.includes(i));
  await pyCall('save_config', JSON.stringify({ [key]: _cfg[key] }));
  renderContactList();
  updateAllCounts();
}

function contactSelectAll() {
  document.querySelectorAll('#contact-modal-list .contact-item').forEach(el => {
    el.classList.add('selected');
    el.querySelector('input[type="checkbox"]').checked = true;
  });
}

function contactDeselectAll() {
  document.querySelectorAll('#contact-modal-list .contact-item').forEach(el => {
    el.classList.remove('selected');
    el.querySelector('input[type="checkbox"]').checked = false;
  });
}

/* ── 通用列表弹窗 ── */
function showListModal(configKey, title, placeholder) {
  _listModalKey = configKey;
  document.getElementById('modal-list-title').textContent = title;
  document.getElementById('modal-list-hint').textContent = `空行分隔多条（${placeholder}）`;
  document.getElementById('modal-list-input').placeholder = placeholder;
  renderListItems();
  openModal('modal-list');
}

function renderListItems() {
  const items = _cfg[_listModalKey] || [];
  const container = document.getElementById('modal-list-items');
  const countEl = document.getElementById('modal-list-count');
  if (countEl) countEl.textContent = items.length;
  container.innerHTML = items.map((item, _) => `
    <div class="list-item" onclick="toggleListItem(this)">
      <input type="checkbox">
      <span class="list-item-text">${escHtml(typeof item === 'string' ? item : (item.text || JSON.stringify(item)))}</span>
    </div>`).join('');
}

function toggleListItem(el) {
  el.classList.toggle('selected');
  el.querySelector('input[type="checkbox"]').checked = el.classList.contains('selected');
}

async function listModalAdd() {
  const raw = document.getElementById('modal-list-input').value;
  if (!raw.trim()) return;
  // 按空行分割，支持多行文案作为一条
  const items = raw.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  if (!_cfg[_listModalKey]) _cfg[_listModalKey] = [];
  let added = 0;
  for (const item of items) {
    if (!_cfg[_listModalKey].includes(item)) {
      _cfg[_listModalKey].push(item);
      added++;
    }
  }
  if (added) {
    document.getElementById('modal-list-input').value = '';
    await pyCall('save_config', JSON.stringify({ [_listModalKey]: _cfg[_listModalKey] }));
    renderListItems();
    updateAllCounts();
  }
}

async function listModalDeleteSelected() {
  const selected = [...document.querySelectorAll('#modal-list-items .list-item.selected')]
    .map(el => el.querySelector('.list-item-text').textContent);
  if (!selected.length) { showToast('warning', '请先选择要删除的条目'); return; }
  _cfg[_listModalKey] = (_cfg[_listModalKey] || []).filter(item => !selected.includes(item));
  await pyCall('save_config', JSON.stringify({ [_listModalKey]: _cfg[_listModalKey] }));
  renderListItems();
  updateAllCounts();
}

function listModalSelectAll() {
  document.querySelectorAll('#modal-list-items .list-item').forEach(el => {
    el.classList.add('selected');
    el.querySelector('input[type="checkbox"]').checked = true;
  });
}

function listModalDeselectAll() {
  document.querySelectorAll('#modal-list-items .list-item').forEach(el => {
    el.classList.remove('selected');
    el.querySelector('input[type="checkbox"]').checked = false;
  });
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── 预设文件 / 头像文件夹 ── */
async function openPresetFile(filename) {
  await pyCall('open_preset_file', filename);
}

async function openPhotoDir() {
  await pyCall('open_photo_dir');
}

/* ── API 池 ── */
function showApiPoolModal() {
  const pool = _cfg.api_pool || [];
  document.getElementById('api-pool-input').value = pool.map(a => `${a.api_id}|${a.api_hash}`).join('\n');
  openModal('modal-api-pool');
}

async function saveApiPool() {
  const raw = document.getElementById('api-pool-input').value.trim();
  const pool = [];
  if (raw) {
    for (const line of raw.split('\n')) {
      const parts = line.trim().split('|');
      if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
        pool.push({ api_id: parts[0].trim(), api_hash: parts[1].trim() });
      } else if (line.trim()) {
        showToast('error', `格式错误: ${line}`); return;
      }
    }
  }
  _cfg.api_pool = pool;
  await pyCall('save_config', JSON.stringify({ api_pool: pool }));
  showToast('success', `已保存 ${pool.length} 组 API`);
  closeModal('modal-api-pool');
}

/* ── 群发 ── */
function _collectBroadcastPatch() {
  return {
    broadcast_mode: _bcMode,
    interval_per_group_min: parseInt(getVal('bc-interval-min')) || 5,
    interval_per_group_max: parseInt(getVal('bc-interval-max')) || 10,
    interval_after_complete_min: parseInt(getVal('bc-complete-min')) || 60,
    interval_after_complete_max: parseInt(getVal('bc-complete-max')) || 120,
    auto_leave_restricted: getChk('cfg-auto-leave'),
    random_send: getChk('bc-random-send'),
    reply_use_quote: getChk('bc-use-quote'),
    direct_random_send: getChk('bc-direct-random'),
    direct_random_suffix: getChk('bc-direct-random-suffix'),
    forward_hide_sender: getChk('bc-fwd-hide'),
    forward_random_send: getChk('bc-fwd-random'),
    post_random_send: getChk('bc-post-random'),
    contact_random_send: getChk('bc-contact-random'),
    bc_schedule_enable: getChk('bc-schedule-enable'),
    bc_schedule_time: getVal('bc-schedule-time'),
    bc_auto_unspam: getChk('bc-auto-unspam'),
  };
}

async function startBroadcast() {
  const patch = _collectBroadcastPatch();

  const res = JSON.parse(await pyCall('start_broadcast', JSON.stringify(patch), JSON.stringify(_getSelectedSessions('broadcast'))));
  if (res.ok) {
    setBroadcastRunning(true);
    appendLog('broadcast-log', '群发任务已启动');
  } else showToast('error', res.error);
}

async function stopBroadcast() {
  await pyCall('stop_broadcast');
  setBroadcastRunning(false);
  setBadge('broadcast-status-badge', 'stopping', '正在停止...');
}

function setBroadcastRunning(running) {
  document.getElementById('broadcast-start-btn').disabled = running;
  document.getElementById('broadcast-stop-btn').disabled = !running;
  setBadge('broadcast-status-badge', running ? 'running' : '', running ? '运行中' : '空闲');
}

async function refreshStats() {
  const raw = await pyCall('get_stats');
  const stats = JSON.parse(raw);
  const tbody = document.getElementById('stats-tbody');
  tbody.innerHTML = Object.entries(stats).map(([sn, s]) => `
    <tr>
      <td title="${s.name || sn}">${s.name || sn}</td>
      <td>${s.phone || ''}</td>
      <td style="color:var(--success);text-align:center">${s.success || 0}</td>
      <td style="color:var(--danger);text-align:center">${s.failed || 0}</td>
      <td style="text-align:center">${s.total_groups || 0}</td>
      <td style="text-align:center">${s.current_round || 0}</td>
      <td>${s.status || ''}</td>
      <td></td>
    </tr>`).join('');
}

/* ── 私信 ── */
let _dmSuccess = 0, _dmFailed = 0;

function copyAllDmUsers() {
  const all = window._dmAllUsers && window._dmAllUsers.length
    ? window._dmAllUsers
    : document.getElementById('dm-users-input').value.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  if (!all.length) { showToast('warning', '没有用户数据'); return; }
  navigator.clipboard.writeText(all.join('\n'))
    .then(() => showToast('success', `已复制 ${all.length} 个用户到剪贴板`))
    .catch(() => showToast('error', '复制失败'));
}

async function startDm() {
  // 优先用内存里的完整列表（虚拟化后 textarea 只显示前1000行）
  const users = window._dmAllUsers && window._dmAllUsers.length
    ? window._dmAllUsers
    : document.getElementById('dm-users-input').value.split('\n').filter(l => l.trim() && !l.startsWith('#'));

  if (!users.length) { showToast('warning', '请输入目标用户'); return; }

  const patch = {
    dm_mode: _dmMode,
    dm_interval_min: parseInt(getVal('dm-interval-min')) || 3,
    dm_interval_max: parseInt(getVal('dm-interval-max')) || 8,
    dm_max_per_account: parseInt(getVal('dm-max-per-account')) || 0,
    dm_direct_random: getChk('dm-direct-random'),
    dm_random_send: getChk('dm-random-send'),
    dm_forward_hide_sender: getChk('dm-fwd-hide'),
    dm_forward_random: getChk('dm-fwd-random'),
    dm_post_random: getChk('dm-post-random'),
    dm_contact_random: getChk('dm-contact-random'),
    dm_stop_on_flood: getChk('dm-stop-on-flood'),
    dm_schedule_enable: getChk('dm-schedule-enable'),
    dm_schedule_time: getVal('dm-schedule-time'),
  };
  _dmSuccess = 0; _dmFailed = 0;
  document.getElementById('dm-success-num').textContent = '0';
  document.getElementById('dm-failed-num').textContent = '0';

  // 传完整用户列表给 Python，JS 不做 split 处理
  const res = JSON.parse(await pyCall('start_dm', JSON.stringify(patch), users.join('\n'), JSON.stringify(_getSelectedSessions('dm'))));
  if (res.ok) {
    setDmRunning(true);
    appendLog('dm-log', '私信任务已启动');
  } else showToast('error', res.error);
}

async function stopDm() {
  document.getElementById('dm-start-btn').disabled = true;
  document.getElementById('dm-stop-btn').disabled = true;
  setBadge('dm-status-badge', 'stopping', '正在停止...');
  try {
    await pyCall('stop_dm');
  } catch (e) {
    setDmRunning(false);
    showToast('error', '停止失败');
  }
}

function setDmRunning(running) {
  document.getElementById('dm-start-btn').disabled = running;
  document.getElementById('dm-stop-btn').disabled = !running;
  setBadge('dm-status-badge', running ? 'running' : '', running ? '运行中' : '就绪');
}

function setBadge(id, cls, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'status-badge' + (cls ? ' ' + cls : '');
  el.textContent = text;
}

/* ── 统计自动刷新 ── */
setInterval(() => {
  if (document.getElementById('page-broadcast').classList.contains('active')) {
    refreshStats();
  }
}, 3000);

/* ── Python → JS 回调注册（pywebview 初始化后调用） ── */
function registerCallbacks() {
  // 这些函数由 gui_web.py 通过 evaluate_js 调用
  window._onLog = (msg) => {
    appendLog('broadcast-log', msg);
    if (typeof msg === 'string' && msg.includes('正在初始化群发任务')) {
      setBroadcastRunning(true);
    }
  };
  window._onDmLog = (msg) => appendLog('dm-log', msg);
  window._onEpLog = (msg) => appendLog('ep-log', msg);
  window._onToast = (type, msg) => {
    showToast(type, msg);
    // 登录成功：清空输入框、重置状态
    if (type === 'success' && msg.startsWith('登录成功')) {
      document.getElementById('login-phone').value = '';
      document.getElementById('login-code').value = '';
      document.getElementById('login-password').value = '';
      document.getElementById('login-status').textContent = '';
    }
    // 验证码已发送：清空状态文字
    if (type === 'success' && msg.includes('验证码')) {
      document.getElementById('login-status').textContent = '';
    }
    // 登录失败/需要密码：重置状态文字
    if ((type === 'error' || type === 'warning') &&
        document.getElementById('login-status').textContent.startsWith('正在')) {
      document.getElementById('login-status').textContent = '';
    }
  };
  window._onAccountsUpdate = (json) => renderAccounts(_mergeSavedAccountStatus(JSON.parse(json)));
  window._onStatsUpdate = (json) => {
    const stats = JSON.parse(json);
    const tbody = document.getElementById('stats-tbody');
    if (!tbody) return;
    tbody.innerHTML = Object.entries(stats).map(([sn, s]) => `
      <tr>
        <td title="${s.name || sn}">${s.name || sn}</td>
        <td>${s.phone || ''}</td>
        <td style="color:var(--success);text-align:center">${s.success || 0}</td>
        <td style="color:var(--danger);text-align:center">${s.failed || 0}</td>
        <td style="text-align:center">${s.total_groups || 0}</td>
        <td style="text-align:center">${s.current_round || 0}</td>
        <td>${s.status || ''}</td>
        <td></td>
      </tr>`).join('');
  };
  window._onBroadcastDone = () => setBroadcastRunning(false);
  window._onDmDone = (remaining) => {
    setDmRunning(false);
    if (remaining !== undefined && remaining !== null) {
      // 后端返回剩余列表，更新内存和 textarea
      window._dmAllUsers = remaining ? remaining.split('\n').filter(l => l.trim()) : [];
      const ta = document.getElementById('dm-users-input');
      if (ta) _dmTaFlush(ta);
    } else if (window._dmDoneUsers && window._dmDoneUsers.size > 0) {
      window._dmAllUsers = window._dmAllUsers.filter(l => !window._dmDoneUsers.has(l.trim()));
      const ta = document.getElementById('dm-users-input');
      if (ta) _dmTaFlush(ta);
    }
    window._dmDoneUsers = new Set();
  };
  window._onDmUserDone = (user) => {
    // 实时从内存数组删除已发送用户，不操作 textarea（避免5万行渲染卡顿）
    if (!window._dmDoneUsers) window._dmDoneUsers = new Set();
    const u = user.trim();
    window._dmDoneUsers.add(u);
    const idx = window._dmAllUsers.indexOf(u);
    if (idx !== -1) window._dmAllUsers.splice(idx, 1);
  };
  window._onDmStat = (ok) => {
    if (ok) { _dmSuccess++; document.getElementById('dm-success-num').textContent = _dmSuccess; }
    else    { _dmFailed++;  document.getElementById('dm-failed-num').textContent = _dmFailed; }
  };
  window._onScraperLog = (msg) => appendLog('scraper-log', msg);
  window._onScraperDone = () => setScraperRunning(false);
  window._onScraperStats = (json) => {
    const s = JSON.parse(json);
    document.getElementById('sc-total-num').textContent = s.total || 0;
    document.getElementById('sc-new-num').textContent = s.new || 0;
    document.getElementById('sc-round-num').textContent = s.round || 0;
  };
  window._onVerifierLog = (msg) => appendLog('verifier-log', msg);
  window._onVerifierDone = () => {
    setVerifierRunning(false);
    // 恢复打包按钮
    const btn = document.getElementById('packer-start-btn');
    if (btn) { btn.disabled = false; btn.textContent = '📦 一键打包群组'; }
  };
  window._onVerifierStats = (json) => {
    const s = JSON.parse(json);
    document.getElementById('vf-joined-num').textContent = s.joined || 0;
    document.getElementById('vf-success-num').textContent = s.success || 0;
    document.getElementById('vf-failed-num').textContent = s.failed || 0;
  };
  window._onCheckerLog = (msg) => appendLog('checker-log', msg);
  window._onCheckerDone = () => setCheckerRunning(false);
  window._onCheckerResult = (json) => {
    const links = JSON.parse(json);
    document.getElementById('checker-output').value = links.join('\n');
  };
  window._onInviterLog = (msg) => appendLog('inviter-log', msg);
  window._onInviterDone = () => setInviterRunning(false);
  window._onInviterStats = (json) => {
    const s = JSON.parse(json);
    document.getElementById('inviter-success-num').textContent = s.success || 0;
    document.getElementById('inviter-skipped-num').textContent = s.skipped || 0;
    document.getElementById('inviter-failed-num').textContent = s.failed || 0;
  };
  window._onCloneLog = (msg) => appendLog('clone-log', msg);
  window._onCloneState = (dataStr) => {
    try {
      let localSelectedTask = null;
      if (_cloneSelectedTaskId) {
        const localTask = _getSelectedCloneTask();
        if (localTask) {
          if (!_cloneFormSyncing) _collectCloneTaskForm();
          localSelectedTask = JSON.parse(JSON.stringify(localTask));
        }
      }
      _cloneTasks = JSON.parse(dataStr || '[]');
      if (_cloneSelectedTaskId && localSelectedTask) {
        const current = _cloneTasks.find(t => t.id === _cloneSelectedTaskId);
        if (current) _applyCloneTaskEditableFields(localSelectedTask, current);
      }
      renderCloneTasks();
      updateClonePageStats();
      if (_cloneSelectedTaskId) {
        const current = _cloneTasks.find(t => t.id === _cloneSelectedTaskId);
        if (current) fillCloneTaskForm(current);
      }
      if (document.getElementById('modal-clone-task-log')?.classList.contains('open')) {
        refreshCloneTaskLogs();
      }
    } catch (e) {}
  };
  window._onWebscraperLog = (msg) => {
    // 进度消息（格式：PROGRESS:已处理 100/500）单独更新进度条，不追加日志
    if (msg.startsWith('PROGRESS:')) {
      const el = document.getElementById('webscraper-progress');
      if (el) el.textContent = msg.slice(9);
    } else {
      appendLog('webscraper-log', msg);
    }
  };
  window._onWebscraperDone = () => {
    const el = document.getElementById('webscraper-progress');
    if (el) el.textContent = '';
    setWebscraperRunning(false);
  };
}

/* ── 初始化 ── */
window.addEventListener('pywebviewready', async () => {
  registerCallbacks();
  initCloneTaskEditor();
  await loadConfig();
  await refreshAccounts();
  await loadScraperConfig();
  await loadMsConfig();
  await loadMonitorConfig();
  await loadCloneTasks();
  // 显示授权到期时间
  try {
    const info = JSON.parse(await pyCall('get_license_info'));
    if (info.expire) {
      document.getElementById('license-expire').textContent = info.expire;
    }
  } catch(e) {}
});

/* ── 采集器 ── */
let _scraperKeywords = [];

async function loadScraperConfig() {
  const raw = await pyCall('get_scraper_config');
  const cfg = JSON.parse(raw);
  setVal('sc-max-jisou', cfg.max_pages_jisou || 100);
  setVal('sc-max-base', cfg.max_pages_base || 600);
  setVal('sc-captcha-retry', cfg.max_captcha_retries || 3);
  await refreshKeywords();
}

async function refreshKeywords() {
  const res = JSON.parse(await pyCall('get_keywords'));
  _scraperKeywords = res.keywords || [];
  renderKeywords();
}

// 侧边预览列表（只读，点管理按钮打开弹窗）
function renderKeywords() {
  const list = document.getElementById('sc-kw-list');
  const count = document.getElementById('sc-kw-count');
  count.textContent = _scraperKeywords.length;
  if (!_scraperKeywords.length) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">暂无关键词，点击"管理"添加</div>';
    return;
  }
  list.innerHTML = _scraperKeywords.map(kw => `
    <div class="list-item">
      <span class="list-item-text">${escHtml(kw)}</span>
    </div>`).join('');
}

// 弹窗内列表（带勾选）
function renderKwModalList() {
  const container = document.getElementById('sc-kw-modal-list');
  container.innerHTML = _scraperKeywords.map((kw, i) => `
    <div class="list-item" onclick="toggleListItem(this)">
      <input type="checkbox">
      <span class="list-item-text">${escHtml(kw)}</span>
    </div>`).join('');
}

function showScKeywordsModal() {
  renderKwModalList();
  openModal('modal-keywords');
}

async function scAddKeywords() {
  const input = document.getElementById('sc-kw-input');
  const raw = input.value.trim();
  if (!raw) return;
  const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
  let added = 0;
  for (const kw of lines) {
    if (!_scraperKeywords.includes(kw)) {
      _scraperKeywords.push(kw);
      added++;
    }
  }
  if (added) {
    input.value = '';
    await pyCall('save_keywords', JSON.stringify(_scraperKeywords));
    renderKeywords();
    renderKwModalList();
    showToast('success', `已添加 ${added} 个关键词`);
  } else {
    showToast('warning', '关键词已存在或为空');
  }
}

async function scDeleteSelectedKeywords() {
  const selected = [...document.querySelectorAll('#sc-kw-modal-list .list-item.selected')]
    .map(el => el.querySelector('.list-item-text').textContent);
  if (!selected.length) { showToast('warning', '请先选择要删除的关键词'); return; }
  _scraperKeywords = _scraperKeywords.filter(kw => !selected.includes(kw));
  await pyCall('save_keywords', JSON.stringify(_scraperKeywords));
  renderKeywords();
  renderKwModalList();
}

function scKwSelectAll() {
  document.querySelectorAll('#sc-kw-modal-list .list-item').forEach(el => {
    el.classList.add('selected');
    el.querySelector('input[type="checkbox"]').checked = true;
  });
}

function scKwDeselectAll() {
  document.querySelectorAll('#sc-kw-modal-list .list-item').forEach(el => {
    el.classList.remove('selected');
    el.querySelector('input[type="checkbox"]').checked = false;
  });
}

async function scClearKeywords() {
  if (!_scraperKeywords.length) return;
  const ok = await showConfirm('确定清空所有关键词？', '清空关键词');
  if (!ok) return;
  _scraperKeywords = [];
  await pyCall('save_keywords', JSON.stringify([]));
  renderKeywords();
  renderKwModalList();
  showToast('success', '关键词已清空');
}

async function startScraper() {
  const cfg = {
    max_pages_jisou: parseInt(getVal('sc-max-jisou')) || 100,
    max_pages_base: parseInt(getVal('sc-max-base')) || 600,
    max_captcha_retries: parseInt(getVal('sc-captcha-retry')) || 3,
  };
  const selected = _getSelectedSessions('scraper');
  const res = JSON.parse(await pyCall('start_scraper', JSON.stringify(cfg), JSON.stringify(selected)));
  if (res.ok) {
    setScraperRunning(true);
    appendLog('scraper-log', '采集任务已启动');
  } else {
    showToast('error', res.error);
  }
}

async function stopScraper() {
  const res = JSON.parse(await pyCall('stop_scraper'));
  if (res.ok) {
    setBadge('scraper-status-badge', 'stopping', '正在停止...');
    document.getElementById('scraper-stop-btn').disabled = true;
  } else {
    showToast('error', res.error);
  }
}

function setScraperRunning(running) {
  document.getElementById('scraper-start-btn').disabled = running;
  document.getElementById('scraper-stop-btn').disabled = !running;
  setBadge('scraper-status-badge', running ? 'running' : '', running ? '运行中' : '空闲');
}

async function viewScraperResults() {
  const res = JSON.parse(await pyCall('get_scraper_results'));
  if (!res.ok) { showToast('error', res.error); return; }
  document.getElementById('modal-sc-count').textContent = res.count;
  const list = document.getElementById('sc-result-list');
  if (!res.lines.length) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px">暂无结果</div>';
  } else {
    list.innerHTML = res.lines.map(l => `
      <div class="list-item">
        <span class="list-item-text">${escHtml(l)}</span>
      </div>`).join('');
  }
  openModal('modal-scraper-results');
}

async function openScraperResultFile() {
  await pyCall('export_results_to_sessions');
}

/* ── 账号选择弹窗（群发/私信/采集器共用） ── */
// 各功能独立的选中集合
const _selectedAccountsMap = {
  broadcast: new Set(),
  dm: new Set(),
  scraper: new Set(),
  verifier: new Set(),
  checker: new Set(),
  inviter: new Set(),
  'member-scraper': new Set(),
  monitor: new Set(),
};

const _accountModalTitles = {
  broadcast: '选择群发账号',
  dm: '选择私信账号',
  scraper: '选择采集账号',
  verifier: '选择账号',
  checker: '选择检测账号',
  inviter: '选择强拉账号',
  'member-scraper': '选择采集账号',
  monitor: '选择监听账号',
};
const _accountCountIds = {
  broadcast: 'bc-account-count',
  dm: 'dm-account-count',
  scraper: 'sc-account-count',
  verifier: 'vf-account-count',
  checker: 'checker-account-count',
  inviter: 'inviter-account-count',
  'member-scraper': 'ms-account-count',
  monitor: 'monitor-account-count',
};

async function showSelectAccountModal(target) {
  _currentAccountModalTarget = target;
  document.getElementById('modal-sc-accounts-title').textContent = _accountModalTitles[target] || '选择账号';
  await _renderScAccountList();
  openModal('modal-sc-accounts');
}

// 兼容旧的采集器调用
function showScAccountModal() { showSelectAccountModal('scraper'); }

async function _renderScAccountList() {
  const target = _currentAccountModalTarget;
  const selected = _selectedAccountsMap[target];
  const raw = await pyCall('get_accounts_json');
  const accounts = JSON.parse(raw);
  const list = document.getElementById('sc-account-list');
  if (!list) return;
  if (!accounts.length) {
    list.innerHTML = '<div class="empty-state" style="padding:8px">暂无账号</div>';
    return;
  }
  list.innerHTML = accounts.map(a => {
    const checked = selected.has(a.session) ? 'checked' : '';
    return `
    <div class="sc-account-row">
      <input type="checkbox" ${checked} onchange="toggleScAccount('${a.session}', this)">
      <span class="sc-account-name">${a.username || a.session}</span>
    </div>`;
  }).join('');
}

function _updateAccountCount(target) {
  const countEl = document.getElementById(_accountCountIds[target]);
  if (!countEl) return;
  const size = _selectedAccountsMap[target].size;
  countEl.textContent = size > 0 ? size + ' 个' : '全部';
}

function toggleScAccount(session, cb) {
  const selected = _selectedAccountsMap[_currentAccountModalTarget];
  if (cb.checked) selected.add(session);
  else selected.delete(session);
  _updateAccountCount(_currentAccountModalTarget);
}

function scSelectAllAccounts() {
  const selected = _selectedAccountsMap[_currentAccountModalTarget];
  document.querySelectorAll('#sc-account-list .sc-account-row input[type="checkbox"]').forEach(cb => {
    const match = cb.getAttribute('onchange').match(/'([^']+)'/);
    if (match) { selected.add(match[1]); cb.checked = true; }
  });
  _updateAccountCount(_currentAccountModalTarget);
}

function scDeselectAllAccounts() {
  _selectedAccountsMap[_currentAccountModalTarget].clear();
  document.querySelectorAll('#sc-account-list .sc-account-row input[type="checkbox"]').forEach(cb => cb.checked = false);
  _updateAccountCount(_currentAccountModalTarget);
}

// 获取某功能的选中账号列表（空数组=全部）
function _getSelectedSessions(target) {
  return [..._selectedAccountsMap[target]];
}

/* ── 过验证 ── */
async function startVerifier() {
  const groups = document.getElementById('vf-groups-input').value.trim()
    .split('\n').map(s => s.trim()).filter(Boolean);
  if (!groups.length) { showToast('warning', '请输入群组链接'); return; }
  const cfg = {
    group_interval_min: parseInt(getVal('vf-interval-min')) || 3,
    group_interval_max: parseInt(getVal('vf-interval-max')) || 8,
    test_speak: document.getElementById('vf-test-speak').checked,
    all_join: document.getElementById('vf-all-join').checked,
    auto_start_broadcast: document.getElementById('vf-auto-start-broadcast').checked,
    greeting_texts: (_cfg.vf_greeting_texts || []).slice(),
    ai_enabled: document.getElementById('vf-ai-enable').checked,
    ai_api_key: getVal('vf-ai-api-key'),
    ai_base_url: getVal('vf-ai-base-url') || DEFAULT_AI_BASE_URL,
    ai_proxy_scheme: getVal('vf-ai-proxy-scheme') || 'auto',
    ai_proxy_url: getVal('vf-ai-proxy-url'),
    ai_model: 'gemini-2.5-flash',
    ai_timeout_sec: Math.max(1, parseFloat(getVal('vf-ai-timeout')) || 3),
  };
  const savePatch = {
    vf_interval_min: cfg.group_interval_min,
    vf_interval_max: cfg.group_interval_max,
    vf_test_speak: cfg.test_speak,
    vf_all_join: cfg.all_join,
    vf_auto_start_broadcast: cfg.auto_start_broadcast,
    vf_greeting_texts: cfg.greeting_texts,
    vf_ai_enabled: cfg.ai_enabled,
    vf_ai_api_key: cfg.ai_api_key,
    vf_ai_model: cfg.ai_model,
    vf_ai_base_url: cfg.ai_base_url,
    vf_ai_proxy_scheme: cfg.ai_proxy_scheme,
    vf_ai_proxy_url: cfg.ai_proxy_url,
    vf_ai_timeout_sec: cfg.ai_timeout_sec,
  };
  if (cfg.auto_start_broadcast) {
    Object.assign(savePatch, _collectBroadcastPatch());
  }
  await pyCall('save_config', JSON.stringify(savePatch));
  const res = JSON.parse(await pyCall('start_verifier',
    JSON.stringify(groups),
    JSON.stringify(_getSelectedSessions('verifier')),
    JSON.stringify(cfg)
  ));
  if (res.ok) {
    setVerifierRunning(true);
    document.getElementById('vf-joined-num').textContent = '0';
    document.getElementById('vf-success-num').textContent = '0';
    document.getElementById('vf-failed-num').textContent = '0';
    appendLog('verifier-log', '批量进群验证任务已启动');
  } else showToast('error', res.error);
}

async function stopVerifier() {
  await pyCall('stop_verifier');
  setBadge('verifier-status-badge', 'stopping', '正在停止...');
  document.getElementById('verifier-stop-btn').disabled = true;
}

async function leaveAllGroups() {
  const leaveChannels = document.getElementById('vf-leave-channels')?.checked || false;
  const msg = leaveChannels
    ? '确定要退出所有账号的群组和频道吗？\n（文件夹也会被移除）'
    : '确定要退出所有账号的群组吗？\n（频道不受影响，文件夹也会被移除）';
  const ok = await showConfirm(msg, '退出所有群组');
  if (!ok) return;
  const res = JSON.parse(await pyCall('leave_all_groups', JSON.stringify(_getSelectedSessions('verifier')), JSON.stringify(leaveChannels)));
  if (res.ok) {
    appendLog('verifier-log', '▶ 开始退出群组，请查看日志...');
  } else {
    showToast('error', res.error || '退出失败');
  }
}

function setVerifierRunning(running) {
  document.getElementById('verifier-start-btn').disabled = running;
  document.getElementById('verifier-stop-btn').disabled = !running;
  setBadge('verifier-status-badge', running ? 'running' : '', running ? '运行中' : '空闲');
}

/* ── 强拉 ── */
async function startInviter() {
  const targetRaw = document.getElementById('inviter-target').value.trim();
  if (!targetRaw) { showToast('warning', '请输入目标群组'); return; }

  // 支持多群，一行一个
  const groups = targetRaw.split('\n').map(s => s.trim()).filter(Boolean);

  const users = document.getElementById('inviter-users-input').value.trim()
    .split('\n').map(s => s.trim()).filter(Boolean);
  if (!users.length) { showToast('warning', '请输入用户列表'); return; }

  const maxPerAccountRaw = parseInt(getVal('inviter-max-per'), 10);
  const cfg = {
    target_groups: groups,
    interval_min: parseInt(getVal('inviter-interval-min')) || 30,
    interval_max: parseInt(getVal('inviter-interval-max')) || 60,
    max_per_account: Number.isNaN(maxPerAccountRaw) ? 3 : Math.max(0, maxPerAccountRaw),
    max_concurrent_per_group: parseInt(getVal('inviter-concurrent')) || 1,
    max_per_group_daily: parseInt(getVal('inviter-daily-limit')) || 0,
  };

  document.getElementById('inviter-success-num').textContent = '0';
  document.getElementById('inviter-skipped-num').textContent = '0';
  document.getElementById('inviter-failed-num').textContent = '0';

  const res = JSON.parse(await pyCall('start_inviter',
    JSON.stringify(cfg),
    JSON.stringify(users),
    JSON.stringify(_getSelectedSessions('inviter'))
  ));
  if (res.ok) {
    setInviterRunning(true);
    appendLog('inviter-log', `强拉任务已启动 | 群组: ${groups.length} | 用户: ${users.length}`);
  } else {
    showToast('error', res.error);
  }
}

async function stopInviter() {
  await pyCall('stop_inviter');
  setBadge('inviter-status-badge', 'stopping', '正在停止...');
  document.getElementById('inviter-stop-btn').disabled = true;
}

function setInviterRunning(running) {
  document.getElementById('inviter-start-btn').disabled = running;
  document.getElementById('inviter-stop-btn').disabled = !running;
  setBadge('inviter-status-badge', running ? 'running' : '', running ? '运行中' : '空闲');
}

/* ── Bot 验证调试抓取 ── */
async function startGroupPacker() {
  const btn = document.getElementById('packer-start-btn');
  btn.disabled = true;
  btn.textContent = '⏳ 打包中...';
  appendLog('verifier-log', '▶ 开始群组打包任务...');
  const res = JSON.parse(await pyCall('start_group_packer', JSON.stringify(_getSelectedSessions('verifier'))));
  if (!res.ok) {
    showToast('error', res.error);
    btn.disabled = false;
    btn.textContent = '📦 一键打包群组';
  }
}

async function exportGroupLinks() {
  showToast('info', '正在导出群组链接，请稍候...');
  await pyCall('export_group_links', JSON.stringify(_getSelectedSessions('verifier')));
}

async function stopGroupPacker() {
  await pyCall('stop_group_packer');
}

/* ── 工具箱 ── */

// 综合工具 tab 切换
function switchToolsTab(tab) {
  const tabs = ['dedup', 'webscraper', 'shuffle', 'proxy'];
  tabs.forEach(t => {
    document.getElementById(`tools-tab-${t}`).classList.toggle('active', t === tab);
    const panel = document.getElementById(`tools-panel-${t}`);
    panel.style.display = t === tab ? 'flex' : 'none';
    panel.style.flexDirection = 'column';
  });
  document.getElementById('tools-dedup-actions').style.display = tab === 'dedup' ? '' : 'none';
  document.getElementById('tools-webscraper-actions').style.display = tab === 'webscraper' ? '' : 'none';
  document.getElementById('tools-shuffle-actions').style.display = tab === 'shuffle' ? '' : 'none';
  document.getElementById('tools-proxy-actions').style.display = tab === 'proxy' ? '' : 'none';
}

// 文本行打乱
let _shuffledLines = [];

function runShuffle() {
  const input = document.getElementById('shuffle-input').value;
  const lines = input.split('\n').map(l => l.trimEnd()).filter(l => l.length > 0);
  if (!lines.length) { showToast('warning', '请输入内容'); return; }

  // Fisher-Yates 洗牌（在内存中完成）
  _shuffledLines = [...lines];
  for (let i = _shuffledLines.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [_shuffledLines[i], _shuffledLines[j]] = [_shuffledLines[j], _shuffledLines[i]];
  }

  // 前端只显示前1000行预览
  const preview = _shuffledLines.slice(0, 1000).join('\n');
  document.getElementById('shuffle-output').value = preview;
  const total = _shuffledLines.length;
  document.getElementById('shuffle-stats').textContent =
    total > 1000 ? `共 ${total} 行，预览前 1000 行` : `共 ${total} 行`;
  showToast('success', `已打乱 ${total} 行`);
}

function copyShuffle() {
  if (!_shuffledLines.length) { showToast('warning', '没有结果可复制'); return; }
  navigator.clipboard.writeText(_shuffledLines.join('\n'))
    .then(() => showToast('success', `已复制全部 ${_shuffledLines.length} 行`));
}

function clearShuffle() {
  _shuffledLines = [];
  document.getElementById('shuffle-input').value = '';
  document.getElementById('shuffle-output').value = '';
  document.getElementById('shuffle-stats').textContent = '';
}

// 链接去重
async function runDedup() {
  const input = document.getElementById('dedup-input').value;
  if (!input.trim()) { showToast('warning', '请输入链接'); return; }
  const res = JSON.parse(await pyCall('run_deduplicator', input));
  if (res.ok) {
    document.getElementById('dedup-output').value = res.result;
    document.getElementById('dedup-stats').textContent =
      `原始 ${res.original} 条 → 去重后 ${res.deduped} 条，删除 ${res.removed} 条重复`;
  } else {
    showToast('error', res.error);
  }
}

function copyDedup() {
  const val = document.getElementById('dedup-output').value;
  if (!val) { showToast('warning', '没有结果可复制'); return; }
  navigator.clipboard.writeText(val).then(() => showToast('success', '已复制'));
}

// 群组活跃度检测
async function startChecker() {
  const links = document.getElementById('checker-input').value.trim()
    .split('\n').map(s => s.trim()).filter(Boolean);
  if (!links.length) { showToast('warning', '请输入群组链接'); return; }
  const cfg = {
    active_hours: parseInt(getVal('checker-hours')) || 24,
    interval_min: parseInt(getVal('checker-interval-min')) || 3,
    interval_max: parseInt(getVal('checker-interval-max')) || 8,
  };
  await pyCall('save_config', JSON.stringify({
    checker_active_hours: cfg.active_hours,
    checker_interval_min: cfg.interval_min,
    checker_interval_max: cfg.interval_max,
  }));
  document.getElementById('checker-output').value = '';
  const res = JSON.parse(await pyCall('start_activity_checker',
    JSON.stringify(links),
    JSON.stringify(_getSelectedSessions('checker')),
    JSON.stringify(cfg)
  ));
  if (res.ok) {
    setCheckerRunning(true);
    appendLog('checker-log', '活跃度检测已启动');
  } else showToast('error', res.error);
}

async function stopChecker() {
  await pyCall('stop_activity_checker');
  setBadge('checker-status-badge', 'stopping', '正在停止...');
  document.getElementById('checker-stop-btn').disabled = true;
}

function setCheckerRunning(running) {
  document.getElementById('checker-start-btn').disabled = running;
  document.getElementById('checker-stop-btn').disabled = !running;
  setBadge('checker-status-badge', running ? 'running' : '', running ? '运行中' : '空闲');
}

function copyCheckerResult() {
  const val = document.getElementById('checker-output').value;
  if (!val) { showToast('warning', '没有结果可复制'); return; }
  navigator.clipboard.writeText(val).then(() => showToast('success', '已复制'));
}

// 网页爬虫
async function startWebScraper() {
  const cfg = {
    threads: parseInt(getVal('ws-threads')) || 1,
    min_public: parseInt(getVal('ws-public-min')) || 0,
    min_private: parseInt(getVal('ws-private-min')) || 0,
    exclude_keywords: getVal('ws-exclude'),
  };
  // 持久化配置
  await pyCall('save_config', JSON.stringify({
    ws_threads: cfg.threads,
    ws_public_min: cfg.min_public,
    ws_private_min: cfg.min_private,
    ws_exclude_keywords: cfg.exclude_keywords,
  }));
  const res = JSON.parse(await pyCall('start_web_scraper', JSON.stringify(cfg)));
  if (res.ok) {
    setWebscraperRunning(true);
    appendLog('webscraper-log', '网页爬虫已启动');
  } else showToast('error', res.error);
}

async function stopWebScraper() {
  await pyCall('stop_web_scraper');
  setBadge('webscraper-status-badge', 'stopping', '正在停止...');
  document.getElementById('webscraper-stop-btn').disabled = true;
}

function setWebscraperRunning(running) {
  document.getElementById('webscraper-start-btn').disabled = running;
  document.getElementById('webscraper-stop-btn').disabled = !running;
  setBadge('webscraper-status-badge', running ? 'running' : '', running ? '运行中' : '空闲');
}


/* ══ 群成员采集 ══ */

let _msSelectedSessions = [];

function _getMsSelectedSessions() { return _msSelectedSessions; }

function setMsRunning(running) {
  document.getElementById('ms-start-btn').disabled = running;
  document.getElementById('ms-stop-btn').disabled = !running;
  setBadge('ms-status-badge', running ? 'running' : '', running ? '运行中' : '空闲');
}

// 回调：日志
window._onMsLog = function(msg) { appendLog('ms-log', msg); };

// 回调：统计更新
window._onMsStats = function(dataJson) {
  const d = JSON.parse(dataJson);
  document.getElementById('ms-total-num').textContent = d.total || 0;
  document.getElementById('ms-groups-num').textContent = d.groups || 0;
};

// 回调：任务结束
window._onMsDone = function() {
  setMsRunning(false);
  showToast('info', '群成员采集已结束');
};

// 回调：单个群组采集完成，从输入框删除
window._onMsGroupDone = function(groupLink) {
  const ta = document.getElementById('ms-groups-input');
  if (!ta) return;
  const lines = ta.value.split('\n');
  const filtered = lines.filter(l => l.trim() !== groupLink.trim());
  ta.value = filtered.join('\n');
};

async function startMemberScraper() {
  const raw = document.getElementById('ms-groups-input').value.trim();
  const groups = raw.split('\n').map(s => s.trim()).filter(Boolean);
  if (!groups.length) { showToast('error', '请输入至少一个群组链接'); return; }

  const cfg = {
    limit: parseInt(document.getElementById('ms-limit').value) || 0,
    filter_premium: document.getElementById('ms-filter-premium').checked,
    filter_online: document.getElementById('ms-filter-online').checked,
    online_days: parseInt(document.getElementById('ms-online-days').value) || 1,
    filter_photo: document.getElementById('ms-filter-photo').checked,
    fallback_msg: document.getElementById('ms-fallback-msg').checked,
    msg_limit: parseInt(document.getElementById('ms-msg-limit').value) || 3000,
    interval_min: parseInt(document.getElementById('ms-interval-min').value) || 3,
    interval_max: parseInt(document.getElementById('ms-interval-max').value) || 8,
  };
  saveMsConfig(cfg);

  const res = JSON.parse(await pyCall('start_member_scraper',
    JSON.stringify(groups),
    JSON.stringify(_getSelectedSessions('member-scraper')),
    JSON.stringify(cfg)
  ));
  if (res.ok) {
    setMsRunning(true);
    document.getElementById('ms-total-num').textContent = '0';
    document.getElementById('ms-groups-num').textContent = '0';
    appendLog('ms-log', '群成员采集任务已启动');
  } else {
    showToast('error', res.error || '启动失败');
  }
}

async function stopMemberScraper() {
  await pyCall('stop_member_scraper');
  setBadge('ms-status-badge', 'stopping', '正在停止...');
  document.getElementById('ms-stop-btn').disabled = true;
}

function saveMsConfig(cfg) {
  // 配置在 startMemberScraper 时由 bridge 持久化到 config.json，此处保留 localStorage 作为备用
  try { localStorage.setItem('ms_config', JSON.stringify(cfg)); } catch(e) {}
}

async function loadMsConfig() {
  try {
    // 优先从 bridge config.json 读取
    const raw = await pyCall('get_ms_config');
    const cfg = JSON.parse(raw);
    if (cfg && Object.keys(cfg).length > 0) {
      if (cfg.limit !== undefined) setVal('ms-limit', cfg.limit);
      if (cfg.filter_premium !== undefined) document.getElementById('ms-filter-premium').checked = cfg.filter_premium;
      if (cfg.filter_online !== undefined) document.getElementById('ms-filter-online').checked = cfg.filter_online;
      if (cfg.online_days !== undefined) setVal('ms-online-days', cfg.online_days);
      if (cfg.filter_photo !== undefined) document.getElementById('ms-filter-photo').checked = cfg.filter_photo;
      if (cfg.fallback_msg !== undefined) document.getElementById('ms-fallback-msg').checked = cfg.fallback_msg;
      if (cfg.msg_limit !== undefined) setVal('ms-msg-limit', cfg.msg_limit);
      return;
    }
  } catch(e) {}
  // 回退到 localStorage
  try {
    const raw = localStorage.getItem('ms_config');
    if (!raw) return;
    const cfg = JSON.parse(raw);
    if (cfg.limit !== undefined) setVal('ms-limit', cfg.limit);
    if (cfg.filter_premium !== undefined) document.getElementById('ms-filter-premium').checked = cfg.filter_premium;
    if (cfg.filter_online !== undefined) document.getElementById('ms-filter-online').checked = cfg.filter_online;
    if (cfg.online_days !== undefined) setVal('ms-online-days', cfg.online_days);
    if (cfg.filter_photo !== undefined) document.getElementById('ms-filter-photo').checked = cfg.filter_photo;
    if (cfg.fallback_msg !== undefined) document.getElementById('ms-fallback-msg').checked = cfg.fallback_msg;
    if (cfg.msg_limit !== undefined) setVal('ms-msg-limit', cfg.msg_limit);
  } catch(e) {}
}

async function openMsResultFile() {
  const res = JSON.parse(await pyCall('open_member_scraper_result'));
  if (!res.ok) showToast('error', res.error || '文件不存在');
}

/* ── 监听私信 ── */
let _monitorDmSessions = new Set();

function toggleMonitorDm(chk) {
  // 更新状态文字
  const statusEl = document.getElementById('monitor-dm-status-text');
  if (statusEl) statusEl.textContent = chk.checked ? '已开启' : '未开启';
}

function toggleMonitorPrivateReply(chk) {
  const statusEl = document.getElementById('monitor-private-reply-status-text');
  if (statusEl) statusEl.textContent = chk.checked ? '已开启' : '未开启';
}

function switchMonitorDmMode(mode, btn) {
  document.querySelectorAll('#monitor-dm-mode-tabs .mode-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#modal-monitor-dm-cfg .mode-panel').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const panel = document.getElementById(`monitor-dm-panel-${mode}`);
  if (panel) panel.classList.add('active');
}

function toggleMonitorReply(chk) {
  const statusEl = document.getElementById('monitor-reply-status-text');
  if (statusEl) statusEl.textContent = chk.checked ? '已开启' : '未开启';
}

function switchMonitorReplyMode(mode, btn) {
  document.querySelectorAll('#monitor-reply-mode-tabs .mode-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#modal-monitor-reply-cfg .mode-panel').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const panel = document.getElementById(`monitor-reply-panel-${mode}`);
  if (panel) panel.classList.add('active');
}

function toggleMonitorBot(chk) {
  const statusEl = document.getElementById('monitor-bot-status-text');
  if (statusEl) statusEl.textContent = chk.checked ? '已开启' : '未开启';
}

function toggleMonitorReact(chk) {
  const statusEl = document.getElementById('monitor-react-status-text');
  if (statusEl) statusEl.textContent = chk.checked ? '已开启' : '未开启';
}

async function loadMonitorConfig() {
  try {
    const raw = await pyCall('get_monitor_config');
    const cfg = JSON.parse(raw);
    if (!cfg || !Object.keys(cfg).length) return;
    if (cfg.keywords) document.getElementById('monitor-keywords').value = cfg.keywords;
    if (cfg.blacklist) document.getElementById('monitor-blacklist').value = cfg.blacklist;
    if (cfg.filter_forward !== undefined) document.getElementById('filter-forward').checked = cfg.filter_forward;
    if (cfg.filter_link !== undefined) document.getElementById('filter-link').checked = cfg.filter_link;
    if (cfg.filter_mention !== undefined) document.getElementById('filter-mention').checked = cfg.filter_mention;
    if (cfg.filter_reply !== undefined) document.getElementById('filter-reply').checked = cfg.filter_reply;
    if (cfg.filter_long !== undefined) document.getElementById('filter-long').checked = cfg.filter_long;
    if (cfg.filter_long_len !== undefined) setVal('filter-long-len', cfg.filter_long_len);
    if (cfg.filter_non_premium !== undefined) document.getElementById('filter-non-premium').checked = cfg.filter_non_premium;
    const dmEnable = !!cfg.dm_enable;
    document.getElementById('monitor-dm-enable').checked = dmEnable;
    toggleMonitorDm({ checked: dmEnable });
    if (cfg.dm_mode) switchMonitorDmMode(cfg.dm_mode, document.querySelector(`#monitor-dm-mode-tabs .mode-tab[data-mode="${cfg.dm_mode}"]`));
    if (cfg.dm_cooldown_sec !== undefined) setVal('monitor-dm-cooldown', cfg.dm_cooldown_sec);
    if (cfg.dm_direct_random !== undefined) document.getElementById('monitor-dm-direct-random').checked = cfg.dm_direct_random;
    if (cfg.dm_random_send !== undefined) document.getElementById('monitor-dm-random-send').checked = cfg.dm_random_send;
    if (cfg.dm_forward_hide_sender !== undefined) document.getElementById('monitor-dm-fwd-hide').checked = cfg.dm_forward_hide_sender;
    if (cfg.dm_forward_random !== undefined) document.getElementById('monitor-dm-fwd-random').checked = cfg.dm_forward_random;
    if (cfg.dm_post_random !== undefined) document.getElementById('monitor-dm-post-random').checked = cfg.dm_post_random;
    if (cfg.dm_contact_random !== undefined) document.getElementById('monitor-dm-contact-random').checked = cfg.dm_contact_random;
    const privateReplyEnable = !!cfg.private_reply_enable;
    document.getElementById('monitor-private-reply-enable').checked = privateReplyEnable;
    toggleMonitorPrivateReply({ checked: privateReplyEnable });
    if (cfg.private_reply_random !== undefined) document.getElementById('monitor-private-reply-random').checked = cfg.private_reply_random;
    if (cfg.private_reply_cooldown_sec !== undefined) setVal('monitor-private-reply-cooldown', cfg.private_reply_cooldown_sec);
    if (cfg.private_reply_delay_min !== undefined) setVal('monitor-private-reply-delay-min', cfg.private_reply_delay_min);
    if (cfg.private_reply_delay_max !== undefined) setVal('monitor-private-reply-delay-max', cfg.private_reply_delay_max);
    const botEnable = !!cfg.bot_push_enable;
    document.getElementById('monitor-bot-enable').checked = botEnable;
    toggleMonitorBot({ checked: botEnable });
    if (cfg.bot_token) setVal('monitor-bot-token', cfg.bot_token);
    if (cfg.bot_chat_id) setVal('monitor-bot-chat-id', cfg.bot_chat_id);
    // 群内回复
    const replyEnable = !!cfg.reply_enable;
    document.getElementById('monitor-reply-enable').checked = replyEnable;
    toggleMonitorReply({ checked: replyEnable });
    if (cfg.reply_mode) switchMonitorReplyMode(cfg.reply_mode, document.querySelector(`#monitor-reply-mode-tabs .mode-tab[data-mode="${cfg.reply_mode}"]`));
    if (cfg.reply_cooldown_sec !== undefined) setVal('monitor-reply-cooldown', cfg.reply_cooldown_sec);
    if (cfg.reply_delay_min !== undefined) setVal('monitor-reply-delay-min', cfg.reply_delay_min);
    if (cfg.reply_delay_max !== undefined) setVal('monitor-reply-delay-max', cfg.reply_delay_max);
    if (cfg.reply_direct_random !== undefined) document.getElementById('monitor-reply-direct-random').checked = cfg.reply_direct_random;

    // 表情反应
    const reactEnable = !!cfg.react_enable;
    document.getElementById('monitor-react-enable').checked = reactEnable;
    toggleMonitorReact({ checked: reactEnable });
    if (cfg.react_emojis !== undefined) setVal('monitor-react-emojis', cfg.react_emojis);
    if (cfg.react_big !== undefined) document.getElementById('monitor-react-big').checked = cfg.react_big;
    if (cfg.react_cooldown_sec !== undefined) setVal('monitor-react-cooldown', cfg.react_cooldown_sec);
    if (cfg.react_delay_min !== undefined) setVal('monitor-react-delay-min', cfg.react_delay_min);
    if (cfg.react_delay_max !== undefined) setVal('monitor-react-delay-max', cfg.react_delay_max);
  } catch(e) {}
}

async function saveMonitorConfig() {
  const cfg = _buildMonitorCfg();
  await pyCall('save_monitor_config', JSON.stringify(cfg));
  showToast('success', '配置已保存');
}

function _buildMonitorCfg() {
  const dmMode = document.querySelector('#monitor-dm-mode-tabs .mode-tab.active')?.dataset.mode || '直发';
  return {
    keywords: document.getElementById('monitor-keywords').value,
    blacklist: document.getElementById('monitor-blacklist').value,
    filter_forward: document.getElementById('filter-forward').checked,
    filter_link: document.getElementById('filter-link').checked,
    filter_mention: document.getElementById('filter-mention').checked,
    filter_reply: document.getElementById('filter-reply').checked,
    filter_long: document.getElementById('filter-long').checked,
    filter_long_len: parseInt(getVal('filter-long-len')) || 500,
    filter_non_premium: document.getElementById('filter-non-premium').checked,
    dm_enable: document.getElementById('monitor-dm-enable').checked,
    dm_mode: dmMode,
    dm_cooldown_sec: parseInt(getVal('monitor-dm-cooldown')) || 300,
    dm_direct_random: document.getElementById('monitor-dm-direct-random').checked,
    dm_random_send: document.getElementById('monitor-dm-random-send').checked,
    dm_forward_hide_sender: document.getElementById('monitor-dm-fwd-hide').checked,
    dm_forward_random: document.getElementById('monitor-dm-fwd-random').checked,
    dm_post_random: document.getElementById('monitor-dm-post-random').checked,
    dm_contact_random: document.getElementById('monitor-dm-contact-random').checked,
    // 收到私信自动回复
    private_reply_enable: document.getElementById('monitor-private-reply-enable').checked,
    private_reply_random: document.getElementById('monitor-private-reply-random').checked,
    private_reply_cooldown_sec: parseInt(getVal('monitor-private-reply-cooldown')) || 300,
    private_reply_delay_min: parseFloat(getVal('monitor-private-reply-delay-min')) || 3,
    private_reply_delay_max: parseFloat(getVal('monitor-private-reply-delay-max')) || 8,
    monitor_private_reply_texts: _cfg.monitor_private_reply_texts || [],
    bot_push_enable: document.getElementById('monitor-bot-enable').checked,
    bot_token: getVal('monitor-bot-token'),
    bot_chat_id: getVal('monitor-bot-chat-id'),
    // 群内回复
    reply_enable: document.getElementById('monitor-reply-enable').checked,
    reply_mode: document.querySelector('#monitor-reply-mode-tabs .mode-tab.active')?.dataset.mode || '直发',
    reply_cooldown_sec: parseInt(getVal('monitor-reply-cooldown')) || 60,
    reply_delay_min: parseFloat(getVal('monitor-reply-delay-min')) || 3,
    reply_delay_max: parseFloat(getVal('monitor-reply-delay-max')) || 8,
    reply_direct_random: document.getElementById('monitor-reply-direct-random').checked,
    monitor_reply_direct_texts: _cfg.monitor_reply_direct_texts || [],
    monitor_reply_sticker_packs: _cfg.monitor_reply_sticker_packs || [],
    // 表情反应
    react_enable: document.getElementById('monitor-react-enable').checked,
    react_emojis: getVal('monitor-react-emojis'),
    react_big: document.getElementById('monitor-react-big').checked,
    react_cooldown_sec: parseInt(getVal('monitor-react-cooldown')) || 600,
    react_delay_min: parseFloat(getVal('monitor-react-delay-min')) || 2,
    react_delay_max: parseFloat(getVal('monitor-react-delay-max')) || 8,
    // 复用批量私信的内容配置
    dm_direct_texts: _cfg.dm_direct_texts || [],
    dm_links: _cfg.dm_links || [],
    dm_reply_texts: _cfg.dm_reply_texts || [],
    dm_forward_links: _cfg.dm_forward_links || [],
    dm_post_codes: _cfg.dm_post_codes || [],
    dm_sticker_packs: _cfg.dm_sticker_packs || [],
    dm_contact_cards: _cfg.dm_contact_cards || [],
  };
}

function showMonitorDmAccountModal() {
  const list = document.getElementById('monitor-dm-account-list');
  const accounts = Object.keys(_accountsCache);
  const monitorSessions = new Set(_getSelectedSessions('monitor'));
  list.innerHTML = accounts.map(sn => {
    const info = _accountsCache[sn] || {};
    const disabled = monitorSessions.has(sn) ? 'disabled title="已被选为监听账号"' : '';
    const checked = _monitorDmSessions.has(sn) ? 'checked' : '';
    return `<div class="sc-account-row">
      <input type="checkbox" ${checked} ${disabled} onchange="toggleMonitorDmSession('${sn}', this)">
      <span class="sc-account-name">${info.username || sn}</span>
    </div>`;
  }).join('') || '<div class="empty-state">暂无账号</div>';
  openModal('modal-monitor-dm-accounts');
}

function toggleMonitorDmSession(sn, cb) {
  if (cb.checked) _monitorDmSessions.add(sn);
  else _monitorDmSessions.delete(sn);
  document.getElementById('monitor-dm-account-count').textContent = _monitorDmSessions.size;
}

function monitorDmSelectAll() {
  const monitorSessions = new Set(_getSelectedSessions('monitor'));
  document.querySelectorAll('#monitor-dm-account-list input[type="checkbox"]:not(:disabled)').forEach(cb => {
    cb.checked = true;
    const match = cb.getAttribute('onchange').match(/'([^']+)'/);
    if (match && !monitorSessions.has(match[1])) _monitorDmSessions.add(match[1]);
  });
  document.getElementById('monitor-dm-account-count').textContent = _monitorDmSessions.size;
}

function monitorDmDeselectAll() {
  _monitorDmSessions.clear();
  document.querySelectorAll('#monitor-dm-account-list input[type="checkbox"]').forEach(cb => cb.checked = false);
  document.getElementById('monitor-dm-account-count').textContent = 0;
}

async function startMonitor() {
  const monitorSessions = _getSelectedSessions('monitor');
  const dmSessions = [..._monitorDmSessions];

  const overlap = monitorSessions.filter(s => dmSessions.includes(s));
  if (overlap.length) {
    showToast('error', `账号 ${overlap[0]} 同时被选为监听和私信账号，请重新选择`);
    return;
  }

  const cfg = _buildMonitorCfg();

  if (cfg.dm_enable && dmSessions.length === 0) {
    showToast('warning', '已开启自动私信，请选择私信账号');
    return;
  }
  if (cfg.private_reply_enable && !cfg.monitor_private_reply_texts.length) {
    showToast('warning', '已开启收到私信自动回复，请先添加回复内容');
    return;
  }

  // 自动保存配置
  await pyCall('save_monitor_config', JSON.stringify(cfg));

  const res = JSON.parse(await pyCall('start_monitor',
    JSON.stringify(cfg),
    JSON.stringify(monitorSessions),
    JSON.stringify(dmSessions)
  ));
  if (res.ok) {
    document.getElementById('monitor-start-btn').disabled = true;
    document.getElementById('monitor-stop-btn').disabled = false;
    setBadge('monitor-status-badge', 'running', '监听中');
    ['monitor-matched-num', 'monitor-dm-num', 'monitor-bot-num', 'monitor-reply-num', 'monitor-react-num', 'monitor-private-reply-num']
      .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '0'; });
    appendLog('monitor-log', '▶ 监听已启动');
  } else {
    showToast('error', res.error);
  }
}

async function stopMonitor() {
  await pyCall('stop_monitor');
  document.getElementById('monitor-stop-btn').disabled = true;
  setBadge('monitor-status-badge', 'stopping', '正在停止...');
}

// 后端回调
window._onMonitorLog = (msg) => appendLog('monitor-log', msg);
window._onMonitorStats = (dataStr) => {
  const d = JSON.parse(dataStr);
  document.getElementById('monitor-matched-num').textContent = d.matched ?? 0;
  document.getElementById('monitor-dm-num').textContent = d.dm_sent ?? 0;
  document.getElementById('monitor-bot-num').textContent = d.bot_sent ?? 0;
  document.getElementById('monitor-reply-num').textContent = d.reply_sent ?? 0;
  document.getElementById('monitor-react-num').textContent = d.react_sent ?? 0;
  document.getElementById('monitor-private-reply-num').textContent = d.private_reply_sent ?? 0;
};
window._onMonitorDone = () => {
  document.getElementById('monitor-start-btn').disabled = false;
  document.getElementById('monitor-stop-btn').disabled = true;
  setBadge('monitor-status-badge', '', '空闲');
};

/* ── 代理检测 ── */
// 记录每行代理的检测结果，key=代理行，value=true/false
/* ── 群组克隆 ───────────────────────────────────────────── */
let _cloneTasks = [];
let _cloneSelectedTaskId = null;
let _cloneAccountModalRole = 'reader';

function _getSelectedCloneTask() {
  return _cloneTasks.find(t => t.id === _cloneSelectedTaskId) || null;
}

function _cloneRoleKey(role) {
  return `${role}_sessions`;
}

function _collectCloneTaskForm() {
  const task = _getSelectedCloneTask();
  if (!task) return null;
  task.name = getVal('clone-task-name').trim() || '未命名任务';
  task.mode = getVal('clone-task-mode') || 'history_realtime';
  task.enabled = document.getElementById('clone-task-enabled').checked;
  task.source_chats_text = getVal('clone-source-chats');
  task.target_chats_text = getVal('clone-target-chats');
  task.history_limit = parseInt(getVal('clone-history-limit')) || 300;
  task.history_hours = parseInt(getVal('clone-history-hours')) || 24;
  delete task.block_window_sec;
  task.playback_mode = getVal('clone-playback-mode') || 'compressed';
  task.filter_bots = document.getElementById('clone-filter-bots').checked;
  task.filter_channels = document.getElementById('clone-filter-channels').checked;
  task.filter_service = document.getElementById('clone-filter-service').checked;
  task.filter_forwards = document.getElementById('clone-filter-forwards').checked;
  task.filter_links = document.getElementById('clone-filter-links').checked;
  task.filter_media = document.getElementById('clone-filter-media').checked;
  return task;
}

function _updateCloneRoleCounts(task) {
  document.getElementById('clone-reader-count').textContent = (task.reader_sessions || []).length;
  document.getElementById('clone-sender-count').textContent = (task.sender_sessions || []).length;
  document.getElementById('clone-standby-count').textContent = (task.standby_sessions || []).length;
}

function _applyCloneTaskEditableFields(source, target) {
  if (!source || !target) return;
  const keys = [
    'name',
    'enabled',
    'mode',
    'source_chats_text',
    'target_chats_text',
    'history_limit',
    'history_hours',
    'playback_mode',
    'filter_bots',
    'filter_channels',
    'filter_service',
    'filter_forwards',
    'filter_links',
    'filter_media',
    'reader_sessions',
    'sender_sessions',
    'standby_sessions',
  ];
  keys.forEach(key => {
    if (!(key in source)) return;
    const value = source[key];
    target[key] = Array.isArray(value) ? [...value] : value;
  });
}

let _cloneAutosaveTimer = null;
let _cloneEditorInitialized = false;
let _cloneFormSyncing = false;

function initCloneTaskEditor() {
  if (_cloneEditorInitialized) return;
  _cloneEditorInitialized = true;
  const ids = [
    'clone-task-name',
    'clone-task-mode',
    'clone-task-enabled',
    'clone-source-chats',
    'clone-target-chats',
    'clone-history-limit',
    'clone-history-hours',
    'clone-playback-mode',
    'clone-filter-bots',
    'clone-filter-channels',
    'clone-filter-service',
    'clone-filter-forwards',
    'clone-filter-links',
    'clone-filter-media',
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', _onCloneTaskFormEdited);
    el.addEventListener('change', _onCloneTaskFormEdited);
  });
}

function _queueCloneTaskAutosave() {
  clearTimeout(_cloneAutosaveTimer);
  _cloneAutosaveTimer = setTimeout(() => {
    saveCloneTask(false).catch(() => {});
  }, 450);
}

function _onCloneTaskFormEdited() {
  if (_cloneFormSyncing) return;
  const task = _collectCloneTaskForm();
  if (!task) return;
  _updateCloneRoleCounts(task);
  _updateCloneTaskSummary(task);
  _updateCloneActionButtons(task);
  renderCloneTasks();
  _queueCloneTaskAutosave();
}

function _newCloneTask() {
  return {
    id: `clone_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    name: '未命名任务',
    enabled: true,
    mode: 'history_realtime',
    source_chats_text: '',
    target_chats_text: '',
    history_limit: 300,
    history_hours: 24,
    playback_mode: 'compressed',
    filter_bots: true,
    filter_channels: true,
    filter_service: true,
    filter_forwards: true,
    filter_links: false,
    filter_media: false,
    reader_sessions: [],
    sender_sessions: [],
    standby_sessions: [],
    runtime_status: 'idle',
    runtime_phase: '',
    runtime_last_error: '',
    runtime_stats: { processed: 0, skipped: 0, sent: 0, errors: 0 },
  };
}

function fillCloneTaskForm(task) {
  if (!task) return;
  _cloneSelectedTaskId = task.id;
  _cloneFormSyncing = true;
  setVal('clone-task-name', task.name || '');
  setVal('clone-task-mode', task.mode || 'history_realtime');
  setChk('clone-task-enabled', task.enabled !== false);
  setVal('clone-source-chats', task.source_chats_text || '');
  setVal('clone-target-chats', task.target_chats_text || '');
  setVal('clone-history-limit', task.history_limit ?? 300);
  setVal('clone-history-hours', task.history_hours ?? 24);
  setVal('clone-playback-mode', task.playback_mode || 'compressed');
  setChk('clone-filter-bots', task.filter_bots !== false);
  setChk('clone-filter-channels', task.filter_channels !== false);
  setChk('clone-filter-service', task.filter_service !== false);
  setChk('clone-filter-forwards', task.filter_forwards !== false);
  setChk('clone-filter-links', !!task.filter_links);
  setChk('clone-filter-media', !!task.filter_media);
  _cloneFormSyncing = false;
  _updateCloneRoleCounts(task);
  _updateCloneTaskSummary(task);
  _updateCloneActionButtons(task);
  renderCloneTasks();
}

function _updateCloneActionButtons(task) {
  const running = ['starting', 'running'].includes(task?.runtime_status || '');
  document.getElementById('clone-start-btn').disabled = running || !task;
  document.getElementById('clone-stop-btn').disabled = !running;
}

function _updateCloneTaskSummary(task) {
  const summary = document.getElementById('clone-task-summary');
  if (!summary) return;
  if (!task) {
    summary.textContent = '暂未选择任务';
    return;
  }
  const sources = (task.source_chats_text || '').split('\n').map(s => s.trim()).filter(Boolean).length;
  const targets = (task.target_chats_text || '').split('\n').map(s => s.trim()).filter(Boolean).length;
  const status = task.runtime_status || 'idle';
  const phase = task.runtime_phase ? ` / ${task.runtime_phase}` : '';
  const stats = task.runtime_stats || {};
  const lastError = task.runtime_last_error ? escHtml(task.runtime_last_error) : '无';
  summary.innerHTML = `
    <div>状态：<strong>${escHtml(status)}${escHtml(phase)}</strong></div>
    <div>源群：${sources} 个，目标群：${targets} 个</div>
    <div>采集账号：${(task.reader_sessions || []).length} 个，发送账号：${(task.sender_sessions || []).length} 个，备用账号：${(task.standby_sessions || []).length} 个</div>
    <div>处理：${stats.processed || 0}，跳过：${stats.skipped || 0}，发送：${stats.sent || 0}，错误：${stats.errors || 0}</div>
    <div>最近错误：${lastError}</div>
  `;
}

function renderCloneTasks() {
  const list = document.getElementById('clone-task-list');
  if (!list) return;
  if (!_cloneTasks.length) {
    list.innerHTML = '<div class="empty-state" style="padding:20px">暂无任务，点击“新建任务”开始配置</div>';
    _updateCloneTaskSummary(null);
    _updateCloneActionButtons(null);
    return;
  }
  list.innerHTML = _cloneTasks.map(task => {
    const active = task.id === _cloneSelectedTaskId ? ' active' : '';
    const status = task.runtime_status || 'idle';
    const stats = task.runtime_stats || {};
    const sources = (task.source_chats_text || '').split('\n').map(s => s.trim()).filter(Boolean).length;
    const targets = (task.target_chats_text || '').split('\n').map(s => s.trim()).filter(Boolean).length;
    return `
      <div class="clone-task-item${active}" onclick="selectCloneTask('${task.id}')">
        <div class="clone-task-title">
          <span class="clone-task-name">${escHtml(task.name || '未命名任务')}</span>
          <span class="status-badge${status === 'running' ? ' running' : ['error', 'stopping'].includes(status) ? ' stopping' : ''}">${escHtml(status)}</span>
        </div>
        <div class="clone-task-meta">
          <div>${escHtml(task.mode || 'history_realtime')} · 源 ${sources} / 目标 ${targets}</div>
          <div>发 ${stats.sent || 0} · 处 ${stats.processed || 0} · 错 ${stats.errors || 0}</div>
        </div>
      </div>
    `;
  }).join('');
}

function updateClonePageStats() {
  const total = _cloneTasks.length;
  const running = _cloneTasks.filter(t => ['starting', 'running'].includes(t.runtime_status)).length;
  const stopping = _cloneTasks.filter(t => t.runtime_status === 'stopping').length;
  const errors = _cloneTasks.filter(t => t.runtime_status === 'error').length;
  document.getElementById('clone-task-total').textContent = total;
  document.getElementById('clone-task-running').textContent = running;
  document.getElementById('clone-task-errors').textContent = errors;
  if (running > 0) setBadge('clone-status-badge', 'running', `运行中 ${running}`);
  else if (stopping > 0) setBadge('clone-status-badge', 'stopping', `停止中 ${stopping}`);
  else if (errors > 0) setBadge('clone-status-badge', 'stopping', `异常 ${errors}`);
  else setBadge('clone-status-badge', '', '空闲');
}

async function loadCloneTasks() {
  const raw = await pyCall('get_clone_tasks');
  _cloneTasks = JSON.parse(raw || '[]');
  if (!_cloneTasks.length) {
    const task = _newCloneTask();
    _cloneTasks = [task];
    _cloneSelectedTaskId = task.id;
    await pyCall('save_clone_tasks', JSON.stringify(_cloneTasks));
  }
  if (!_cloneSelectedTaskId || !_cloneTasks.some(t => t.id === _cloneSelectedTaskId)) {
    _cloneSelectedTaskId = _cloneTasks[0]?.id || null;
  }
  renderCloneTasks();
  updateClonePageStats();
  const current = _getSelectedCloneTask();
  if (current) fillCloneTaskForm(current);
}

async function selectCloneTask(taskId) {
  if (_cloneSelectedTaskId && _cloneSelectedTaskId !== taskId) {
    await saveCloneTask(false);
  }
  _cloneSelectedTaskId = taskId;
  const task = _getSelectedCloneTask();
  if (task) fillCloneTaskForm(task);
}

async function saveCloneTask(showSuccess = true) {
  const task = _collectCloneTaskForm();
  if (!task) {
    showToast('warning', '请先创建或选择一个任务');
    return false;
  }
  const res = JSON.parse(await pyCall('save_clone_tasks', JSON.stringify(_cloneTasks)));
  if (!res.ok) {
    showToast('error', res.error || '保存失败');
    return false;
  }
  renderCloneTasks();
  updateClonePageStats();
  _updateCloneTaskSummary(task);
  if (showSuccess) showToast('success', '群组克隆任务已保存');
  return true;
}

async function createCloneTask() {
  if (_cloneTasks.length) {
    await saveCloneTask(false);
  }
  const task = _newCloneTask();
  _cloneTasks.push(task);
  _cloneSelectedTaskId = task.id;
  fillCloneTaskForm(task);
  const res = JSON.parse(await pyCall('save_clone_tasks', JSON.stringify(_cloneTasks)));
  if (!res.ok) {
    showToast('error', res.error || '保存失败');
    return;
  }
  renderCloneTasks();
  updateClonePageStats();
  showToast('success', '已新建群组克隆任务');
}

async function duplicateCloneTask() {
  const current = _collectCloneTaskForm();
  if (!current) {
    showToast('warning', '请先选择任务');
    return;
  }
  const cloned = JSON.parse(JSON.stringify(current));
  cloned.id = `clone_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  cloned.name = `${current.name || '未命名任务'} - 副本`;
  cloned.runtime_status = 'idle';
  cloned.runtime_phase = '';
  cloned.runtime_last_error = '';
  _cloneTasks.push(cloned);
  _cloneSelectedTaskId = cloned.id;
  await saveCloneTask(false);
  fillCloneTaskForm(cloned);
  showToast('success', '任务副本已创建');
}

async function deleteCloneTask() {
  const current = _getSelectedCloneTask();
  if (!current) {
    showToast('warning', '请先选择任务');
    return;
  }
  const ok = await showConfirm(`确认删除任务“${current.name || current.id}”吗？`, '删除任务');
  if (!ok) return;
  _cloneTasks = _cloneTasks.filter(t => t.id !== current.id);
  if (!_cloneTasks.length) {
    _cloneTasks.push(_newCloneTask());
  }
  _cloneSelectedTaskId = _cloneTasks[0].id;
  await saveCloneTask(false);
  fillCloneTaskForm(_getSelectedCloneTask());
  showToast('success', '任务已删除');
}

function showCloneSessionModal(role) {
  const task = _collectCloneTaskForm();
  if (!task) {
    showToast('warning', '请先选择任务');
    return;
  }
  _cloneAccountModalRole = role;
  const titleMap = { reader: '选择采集账号', sender: '选择发送账号', standby: '选择备用账号' };
  document.getElementById('clone-account-modal-title').textContent = titleMap[role] || '选择账号';
  const currentKey = _cloneRoleKey(role);
  const selected = new Set(task[currentKey] || []);
  const blocked = new Set([
    ...((role !== 'reader' ? task.reader_sessions : []) || []),
    ...((role !== 'sender' ? task.sender_sessions : []) || []),
    ...((role !== 'standby' ? task.standby_sessions : []) || []),
  ]);
  const list = document.getElementById('clone-account-list');
  const accounts = Object.keys(_accountsCache || {});
  if (!accounts.length) {
    list.innerHTML = '<div class="empty-state" style="padding:8px">暂无账号</div>';
    openModal('modal-clone-accounts');
    return;
  }
  list.innerHTML = accounts.map(sn => {
    const info = _accountsCache[sn] || {};
    const checked = selected.has(sn) ? 'checked' : '';
    const disabled = blocked.has(sn) ? 'disabled' : '';
    const hint = blocked.has(sn) ? '（已被其他角色占用）' : '';
    return `
      <div class="sc-account-row">
        <input type="checkbox" data-session="${escHtml(sn)}" ${checked} ${disabled} onchange="toggleCloneRoleSession(this)">
        <span class="sc-account-name">${escHtml(info.username || sn)} ${escHtml(hint)}</span>
      </div>
    `;
  }).join('');
  openModal('modal-clone-accounts');
}

function toggleCloneRoleSession(cb) {
  const task = _getSelectedCloneTask();
  if (!task) return;
  const key = _cloneRoleKey(_cloneAccountModalRole);
  const selected = new Set(task[key] || []);
  const session = cb.dataset.session;
  if (!session) return;
  if (cb.checked) selected.add(session);
  else selected.delete(session);
  task[key] = [...selected];
  _updateCloneRoleCounts(task);
  _updateCloneTaskSummary(task);
  renderCloneTasks();
  _queueCloneTaskAutosave();
}

function cloneAccountSelectAll() {
  document.querySelectorAll('#clone-account-list input[type="checkbox"]:not(:disabled)').forEach(cb => {
    cb.checked = true;
    toggleCloneRoleSession(cb);
  });
}

function cloneAccountDeselectAll() {
  document.querySelectorAll('#clone-account-list input[type="checkbox"]:not(:disabled)').forEach(cb => {
    cb.checked = false;
    toggleCloneRoleSession(cb);
  });
}

async function startCloneTask() {
  const ok = await saveCloneTask(false);
  if (!ok) return;
  const task = _getSelectedCloneTask();
  if (!task) return;
  const res = JSON.parse(await pyCall('start_clone_task', task.id));
  if (!res.ok) {
    showToast('error', res.error || '启动失败');
    await loadCloneTasks();
    return;
  }
  showToast('success', '群组克隆任务已启动');
  await loadCloneTasks();
}

async function stopCloneTask() {
  const task = _getSelectedCloneTask();
  if (!task) {
    showToast('warning', '请先选择任务');
    return;
  }
  const res = JSON.parse(await pyCall('stop_clone_task', task.id));
  if (!res.ok) {
    showToast('error', res.error || '停止失败');
    return;
  }
  showToast('success', '群组克隆任务已停止');
  await loadCloneTasks();
}

async function openCloneTaskLogModal() {
  const task = _getSelectedCloneTask();
  if (!task) {
    showToast('warning', '请先选择任务');
    return;
  }
  openModal('modal-clone-task-log');
  await refreshCloneTaskLogs();
}

async function refreshCloneTaskLogs() {
  const task = _getSelectedCloneTask();
  const box = document.getElementById('clone-task-log-box');
  const title = document.getElementById('clone-task-log-title');
  const meta = document.getElementById('clone-task-log-meta');
  if (!task) {
    box.textContent = '';
    title.textContent = '任务完整日志';
    meta.textContent = '请选择任务查看日志';
    return;
  }
  const res = JSON.parse(await pyCall('get_clone_task_logs', task.id));
  title.textContent = `任务完整日志 - ${task.name || task.id}`;
  meta.textContent = `状态：${task.runtime_status || 'idle'} | 阶段：${task.runtime_phase || '-'} | 共 ${res.lines?.length || 0} 条`;
  box.textContent = res.text || '';
  box.scrollTop = box.scrollHeight;
}

const _proxyCheckResults = {};

function removeFailedProxies() {
  const ta = document.getElementById('proxy-check-input');
  if (!ta) return;
  const lines = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
  const kept = lines.filter(l => _proxyCheckResults[l] !== false);
  ta.value = kept.join('\n');
  showToast('success', `已移除 ${lines.length - kept.length} 个不可用代理，剩余 ${kept.length} 个`);
}

async function runProxyCheck() {
  const input = document.getElementById('proxy-check-input').value.trim();
  if (!input) { showToast('warning', '请先输入代理列表'); return; }
  const lines = input.split('\n').map(s => s.trim()).filter(Boolean);
  if (!lines.length) { showToast('warning', '没有有效的代理'); return; }

  const proxyType = document.getElementById('proxy-check-type')?.value || 'socks5';
  const resultsEl = document.getElementById('proxy-check-results');
  const statsEl   = document.getElementById('proxy-check-stats');

  // 清空结果和上次记录
  resultsEl.innerHTML = '';
  statsEl.textContent = `检测中 0/${lines.length}...`;
  lines.forEach(l => delete _proxyCheckResults[l]);

  // 为每行代理创建一个占位行
  const rowEls = lines.map((line, i) => {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg-input);border-radius:6px;font-size:12px;font-family:Consolas,monospace';
    el.innerHTML = `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${line}</span><span style="color:var(--text-muted)">检测中...</span>`;
    resultsEl.appendChild(el);
    return el;
  });

  let ok = 0, fail = 0;

  const sem = { n: 0, max: 5, queue: [] };
  const acquire = () => new Promise(res => {
    if (sem.n < sem.max) { sem.n++; res(); }
    else sem.queue.push(res);
  });
  const release = () => {
    sem.n--;
    if (sem.queue.length) { sem.n++; sem.queue.shift()(); }
  };

  await Promise.all(lines.map(async (line, i) => {
    await acquire();
    try {
      const res = JSON.parse(await pyCall('check_proxy', line, proxyType));
      const rowEl = rowEls[i];
      if (res.ok) {
        ok++;
        _proxyCheckResults[line] = true;
        rowEl.innerHTML = `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${line}</span><span style="color:var(--success);font-weight:600">✓ ${res.latency}ms</span>`;
      } else {
        fail++;
        _proxyCheckResults[line] = false;
        rowEl.innerHTML = `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted)">${line}</span><span style="color:var(--danger)">✗ ${res.error || '超时'}</span>`;
      }
    } catch(e) {
      fail++;
      _proxyCheckResults[line] = false;
      rowEls[i].innerHTML = `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted)">${line}</span><span style="color:var(--danger)">✗ 出错</span>`;
    } finally {
      release();
      statsEl.textContent = `✓ ${ok} 可用  ✗ ${fail} 不可用  共 ${lines.length}`;
    }
  }));

  // 检测完成后自动移除不可用代理
  if (fail > 0) {
    removeFailedProxies();
    showToast('info', `检测完成，已自动移除 ${fail} 个不可用代理`);
  } else {
    showToast('success', `检测完成，全部 ${ok} 个代理可用`);
  }
}
