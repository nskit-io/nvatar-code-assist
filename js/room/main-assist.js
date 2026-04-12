// NVatar Code Assist — Entry Point (SDK Mode)
// Separate from main.js: auto-enters code assist mode on load
import S from './state.js';
import { getUiLang, applyI18nUI } from './i18n.js';
import { init, toggleLight, resetView, addFurniture } from './scene.js';
import { loadVRM, loadLocalVRM } from './vrm-loader.js';
import { setMood } from './mood.js';
import { sendChat, addChatMsg } from './chat.js';
import { toggleMic } from './stt.js';
import { changeVoice, loadVoices } from './tts.js';
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
const paramVRM = urlParams.get('vrm') || S.API_BASE + '/static/vrm/vroid-samples/Victoria_Rubin.vrm';

// SDK options from URL: contextAppend, characterWrap, channel UUID
const contextAppend = urlParams.get('ctx') === '1';
const characterWrap = urlParams.get('wrap') !== '0'; // default ON
const channelUUID = urlParams.get('channel') || '';

loadVRM(paramVRM, 0);

// --- SDK Auto-Connect ---
// After avatar loads, auto-configure SDK mode and show code panel
async function sdkConnect() {
  if (!S.paramAvatarId) return;

  // Configure SDK options on server
  try {
    await fetch(S.API_BASE + '/api/v1/sdk/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        avatar_id: parseInt(S.paramAvatarId, 10),
        context_append: contextAppend,
        character_wrap: characterWrap,
        channel_uuid: channelUUID,
      }),
    });
    console.log(`[SDK] Connected: channel=${channelUUID} ctx=${contextAppend} wrap=${characterWrap}`);
  } catch (e) {
    console.warn('[SDK] Connect failed:', e.message);
  }

  // Show code panel on PC
  if (window.innerWidth > 768) {
    const panel = document.getElementById('codePanel');
    if (panel) panel.style.display = 'flex';
  }

  // Load previous results from SQLite
  if (channelUUID) {
    try {
      const res = await fetch(S.API_BASE + `/api/v1/sdk/results/${channelUUID}`);
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const { addCodeResult } = await import('./chat.js');
        data.results.forEach(r => addCodeResult({
          request: r.request, response: r.response, status: r.status, ts: r.ts,
        }));
        console.log(`[SDK] Loaded ${data.results.length} previous results`);
      }
    } catch (e) {
      console.warn('[SDK] Failed to load history:', e.message);
    }
  }

  // Update header to show assist mode
  const h1 = document.querySelector('.top-bar h1');
  if (h1) h1.innerHTML = '<span>NVatar</span> Code Assist';

  // Auto-send "코드 비서모드 온" after WebSocket is ready
  _waitForWsAndActivate();
}

function _waitForWsAndActivate() {
  const check = setInterval(() => {
    if (S.chatWs && S.chatWs.readyState === 1) {
      clearInterval(check);
      // Auto-activate code assist mode
      S.chatWs.send(JSON.stringify({ type: 'message', text: '코드 비서모드 온' }));
      console.log('[SDK] Auto-sent: 코드 비서모드 온');
    }
  }, 500);
  // Timeout after 30s
  setTimeout(() => clearInterval(check), 30000);
}

// Show channel confirm dialog, then connect
function _showChannelConfirm() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:200;';
  const dialog = document.createElement('div');
  dialog.style.cssText = 'background:#1e293b;border:1px solid #334155;border-radius:16px;padding:24px;max-width:420px;width:90%;text-align:center;';
  dialog.innerHTML = `
    <div style="font-size:24px;margin-bottom:12px;">⚡</div>
    <h2 style="font-size:16px;color:#e2e8f0;margin-bottom:8px;">Claude Code 채널을 연결하셨나요?</h2>
    <p style="font-size:12px;color:#94a3b8;margin-bottom:16px;line-height:1.6;">
      터미널에서 아래 명령으로 채널을 먼저 시작해주세요.<br>
      <code style="display:block;margin-top:8px;padding:8px;background:#0f172a;border-radius:6px;color:#a5b4fc;font-size:11px;word-break:break-all;">
        NVATAR_CHANNEL_UUID=${channelUUID || '(UUID)'} claude --dangerously-load-development-channels server:nvatar
      </code>
    </p>
    <div style="display:flex;gap:8px;justify-content:center;">
      <button id="cfmYes" style="padding:10px 24px;border:none;border-radius:8px;background:#6366f1;color:#fff;font-size:13px;cursor:pointer;">연결했어요</button>
      <button id="cfmNo" style="padding:10px 24px;border:1px solid #334155;border-radius:8px;background:transparent;color:#94a3b8;font-size:13px;cursor:pointer;">아직이에요</button>
    </div>
  `;
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  dialog.querySelector('#cfmYes').onclick = () => {
    overlay.remove();
    sdkConnect();
  };
  dialog.querySelector('#cfmNo').onclick = () => {
    // Keep dialog, just highlight the command
    dialog.querySelector('code').style.border = '1px solid #6366f1';
    dialog.querySelector('#cfmNo').textContent = '확인 후 클릭';
    dialog.querySelector('#cfmNo').onclick = () => {
      overlay.remove();
      sdkConnect();
    };
  };
}

// Wait for loading to finish, then show confirm
setTimeout(_showChannelConfirm, 3000);

// Show SDK mode indicator
const modeTag = document.createElement('span');
modeTag.style.cssText = 'position:absolute;top:10px;left:50%;transform:translateX(-50%);padding:4px 12px;border-radius:12px;background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;font-size:11px;z-index:20;pointer-events:none;';
modeTag.textContent = `⚡ Code Assist${contextAppend ? ' (ctx)' : ''}${!characterWrap ? ' (raw)' : ''}`;
document.body.appendChild(modeTag);
