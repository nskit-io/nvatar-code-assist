// NVatar Code Assist — Entry Point (SDK Mode)
// Normal avatar mode by default. Code Assist activated via toolbar toggle.
import S from './state.js';
import { getUiLang, applyI18nUI } from './i18n.js';
import { init, toggleLight, resetView, addFurniture } from './scene.js';
import { loadVRM, loadLocalVRM } from './vrm-loader.js';
import { setMood } from './mood.js';
import { sendChat, addChatMsg } from './chat.js';
import { toggleMic } from './stt.js';
import { changeVoice, loadVoices, TTS_CONFIG } from './tts.js';
import { NVatarSDK } from './lookup.js';
import { mobileToggleLookupPanel, mobileChangeLang, mobileToggleTTS, openMobileLookup, closeMobileLookup, initMobile } from './mobile.js';

// Expose to window
window.toggleLight = toggleLight;
window.resetView = resetView;
window.addFurniture = addFurniture;
window.loadVRM = (url, index = 0) => loadVRM(url, index);
window.loadLocalVRM = loadLocalVRM;
window.setMood = setMood;
window.sendChat = sendChat;
window.toggleMic = toggleMic;
window._changeLang = mobileChangeLang;
window._toggleTTS = mobileToggleTTS;
window._changeVoice = changeVoice;
window.toggleLookupPanel = mobileToggleLookupPanel;
window.openMobileLookup = openMobileLookup;
window.closeMobileLookup = closeMobileLookup;
window.NVatarSDK = NVatarSDK;

// Init
init();
initMobile();
applyI18nUI();

const uiLang = getUiLang();
const langSel = document.getElementById('langSelect');
if (langSel) langSel.value = uiLang;
const mobileLangSel = document.getElementById('mobileLangSelect');
if (mobileLangSel) mobileLangSel.value = uiLang;

loadVoices();

// URL params
const urlParams = new URLSearchParams(window.location.search);
S.paramAvatarId = urlParams.get('avatar');
const vrmUid = urlParams.get('vrm');

// SDK options from URL
const contextAppend = urlParams.get('ctx') === '1';
const characterWrap = urlParams.get('wrap') !== '0'; // default ON
const channelUUID = urlParams.get('channel') || '';
const autoAssist = urlParams.get('assist') === '1';

// UID-based VRM resolution
async function resolveAndLoadVRM(uid) {
  if (!uid) { loadFallbackVRM(); return; }
  // Backward compat: direct URL passthrough
  if (uid.startsWith('http') || uid.startsWith('/')) {
    loadVRM(uid, 0);
    return;
  }
  try {
    const resp = await fetch(`${S.RES_BASE}/api/v1/vrm/resolve/${encodeURIComponent(uid)}`);
    if (resp.ok) {
      const data = await resp.json();
      loadVRM(S.RES_BASE + data.model.url, 0);
      return;
    }
  } catch (e) {
    console.warn('[Main] VRM resolve failed:', e);
  }
  loadFallbackVRM();
}

async function loadFallbackVRM() {
  try {
    const resp = await fetch(`${S.RES_BASE}/api/v1/vrm/models`);
    if (resp.ok) {
      const data = await resp.json();
      const vic = (data.models || []).find(m => m.name === 'Victoria');
      if (vic) { resolveAndLoadVRM(vic.uid); return; }
    }
  } catch (e) { /* fall through */ }
  console.error('[Main] All VRM loading failed');
}

resolveAndLoadVRM(vrmUid);

// ─── Code Assist Toggle ───────────────────────────────────────
let _assistActive = false;
let _sdkConnected = false;

function _updateAssistUI(active) {
  const btn = document.getElementById('btnAssist');
  const mobileBtn = document.getElementById('mobileAssist');
  const panel = document.getElementById('codePanel');
  const h1 = document.querySelector('.top-bar h1');

  if (btn) {
    btn.style.background = active ? 'rgba(99,102,241,0.3)' : '';
    btn.style.borderColor = active ? '#6366f1' : '#334155';
    btn.style.color = active ? '#a5b4fc' : '#94a3b8';
  }
  if (mobileBtn) {
    mobileBtn.style.background = active ? 'rgba(99,102,241,0.3)' : '';
    mobileBtn.style.borderColor = active ? '#6366f1' : '#334155';
  }
  if (panel && window.innerWidth > 768) {
    panel.style.display = active ? 'flex' : 'none';
  }
  if (h1) {
    h1.innerHTML = active ? '<span>NVatar</span> Code Assist' : '<span>NVatar</span> Virtual Room';
  }
}

async function _sdkConnect() {
  if (_sdkConnected || !S.paramAvatarId) return;
  try {
    const res = await fetch(S.API_BASE + '/api/v1/sdk/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        avatar_id: parseInt(S.paramAvatarId, 10),
        context_append: contextAppend,
        character_wrap: characterWrap,
        channel_uuid: channelUUID,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _sdkConnected = true;
  } catch (e) {
    addChatMsg('system', `SDK connect failed: ${e.message}`);
  }

  // Load previous results
  if (channelUUID) {
    try {
      const res = await fetch(S.API_BASE + `/api/v1/sdk/results/${channelUUID}`);
      if (res.ok) {
        const data = await res.json();
        if (data.results && data.results.length > 0) {
          const { addCodeResult } = await import('./chat.js');
          data.results.forEach(r => addCodeResult({
            id: r.id, request: r.request, response: r.response, status: r.status, ts: r.ts,
          }));
        }
      }
    } catch (e) { /* non-critical */ }
  }
}

async function _sdkDisconnect() {
  if (!S.paramAvatarId || !channelUUID) return;
  try {
    await fetch(S.API_BASE + '/api/v1/sdk/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar_id: parseInt(S.paramAvatarId, 10), channel_uuid: channelUUID }),
    });
  } catch (e) { /* non-critical */ }
  _sdkConnected = false;
}

function _sendAssistCommand(text) {
  if (S.chatWs && S.chatWs.readyState === 1) {
    S.chatWs.send(JSON.stringify({ type: 'message', text }));
    return true;
  }
  return false;
}

function _waitForWsAndSend(text) {
  if (_sendAssistCommand(text)) return;
  const check = setInterval(() => {
    if (S.chatWs && S.chatWs.readyState === 1) {
      clearInterval(check);
      _sendAssistCommand(text);
    }
  }, 500);
  setTimeout(() => {
    clearInterval(check);
    if (!S.chatWs || S.chatWs.readyState !== 1) {
      addChatMsg('system', '⚠ WebSocket connection timeout — please refresh');
    }
  }, 30000);
}

function _showChannelSetup() {
  const lang = getUiLang();
  const txt = {
    ko: { title: 'Claude Code 채널이 필요합니다', desc: '채널 UUID를 로비에서 생성하고, 터미널에서 채널을 시작한 뒤 다시 입장해주세요.', ok: '확인' },
    en: { title: 'Claude Code channel required', desc: 'Generate a Channel UUID in the lobby, start the channel in terminal, then re-enter.', ok: 'OK' },
    ja: { title: 'Claude Code チャンネルが必要です', desc: 'ロビーでチャンネルUUIDを生成し、ターミナルでチャンネルを起動してから再入室してください。', ok: 'OK' },
    zh: { title: '需要 Claude Code 频道', desc: '请在大厅生成频道UUID，在终端启动频道后重新进入。', ok: '确认' },
  }[lang] || { title: 'Channel required', desc: 'Set up channel UUID in the lobby first.', ok: 'OK' };

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:200;';
  const dialog = document.createElement('div');
  dialog.style.cssText = 'background:#1e293b;border:1px solid #334155;border-radius:16px;padding:24px;max-width:380px;width:90%;text-align:center;';
  dialog.innerHTML = `
    <div style="font-size:24px;margin-bottom:12px;">⚡</div>
    <h2 style="font-size:16px;color:#e2e8f0;margin-bottom:8px;">${txt.title}</h2>
    <p style="font-size:12px;color:#94a3b8;margin-bottom:16px;line-height:1.6;">${txt.desc}</p>
    <button style="padding:10px 24px;border:none;border-radius:8px;background:#6366f1;color:#fff;font-size:13px;cursor:pointer;">${txt.ok}</button>
  `;
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  dialog.querySelector('button').onclick = () => overlay.remove();
}

window.toggleCodeAssist = function() {
  _assistActive = !_assistActive;
  _updateAssistUI(_assistActive);

  if (_assistActive) {
    // Need channel UUID for code assist
    if (!channelUUID) {
      _assistActive = false;
      _updateAssistUI(false);
      _showChannelSetup();
      return;
    }
    _sdkConnect().then(() => {
      if (!_sdkConnected) {
        _assistActive = false;
        _updateAssistUI(false);
        return;
      }
      _waitForWsAndSend('코드 비서모드 온');
      addChatMsg('system', '⚡ Code Assist ON');
    });

    // Update URL for refresh persistence
    const url = new URL(location.href);
    url.searchParams.set('assist', '1');
    history.replaceState(null, '', url.toString());
  } else {
    _sdkDisconnect();
    _sendAssistCommand('코드 비서모드 오프');
    addChatMsg('system', '⚡ Code Assist OFF');

    const url = new URL(location.href);
    url.searchParams.delete('assist');
    history.replaceState(null, '', url.toString());
  }
};

// ─── Entry: restore state ─────────────────────────────────────
const _entryCheck = setInterval(() => {
  if (S.chatWs && S.chatWs.readyState === 1) {
    clearInterval(_entryCheck);

    // Debounced assist restore — prevents double execution on quick reconnects
    let _assistRestoring = false;
    function _restoreAssist(label) {
      if (_assistRestoring) return;
      _assistRestoring = true;
      _sdkConnected = false;
      _sdkConnect();
      _sendAssistCommand('코드 비서모드 온');
      addChatMsg('system', `⚡ Code Assist ${label}`);
      setTimeout(() => { _assistRestoring = false; }, 5000);
    }

    if (autoAssist && channelUUID) {
      // ?assist=1 — restore assist mode (refresh persistence)
      // Mute TTS for auto-restore (browser autoplay policy blocks it anyway)
      const wasTTSEnabled = TTS_CONFIG.enabled;
      TTS_CONFIG.enabled = false;
      _assistActive = true;
      _updateAssistUI(true);
      _restoreAssist('ON (auto)');
      setTimeout(() => { TTS_CONFIG.enabled = wasTTSEnabled; }, 5000);
    } else {
      // No assist — reset server state silently (no Gemma response)
      _sdkDisconnect();
    }

    // Register reconnect hook — restore assist mode after server restart
    S.hooks.onReconnect = () => {
      if (_assistActive && channelUUID) {
        _restoreAssist('reconnected');
      }
    };
  }
}, 500);
setTimeout(() => clearInterval(_entryCheck), 30000);
