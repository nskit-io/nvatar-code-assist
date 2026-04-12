# NVatar Code Assist

AI Avatar + Claude Code Channel integration.
Your 3D avatar becomes a code assistant that executes tasks and briefs you in character.

## How It Works

```
You (Browser)  →  NVatar Room  →  Avatar speaks results
                      ↕
              Claude Code Channel  →  Executes code tasks
                      ↕
              Your local Claude Code session
```

1. Avatar receives your code commands
2. Claude Code executes them on your machine
3. Avatar briefs you with character-wrapped results + voice (TTS)
4. Raw results appear in the Code Assist panel

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/nskit-io/nvatar-code-assist.git
cd nvatar-code-assist/channel
bun install
```

### 2. Open the Lobby

Visit: [https://nskit-io.github.io/nvatar-code-assist/](https://nskit-io.github.io/nvatar-code-assist/)

- Set **NVatar Server** URL (default: `https://nvatar.nskit.io`, or `http://localhost:54444` for local)
- Click **Gen** to generate a Channel UUID
- Copy the channel start command shown below

### 3. Start Claude Code Channel

```bash
NVATAR_CHANNEL_UUID=<your-uuid> claude --dangerously-load-development-channels server:nvatar
```

### 4. Select Avatar & Enter Room

- Browse avatars with thumbnail cards, filter by gender or source
- Choose your avatar and enter the room
- The room auto-connects to your Claude Code session
- Start giving code commands!

## Server Configuration

The lobby page lets you set the NVatar server URL. This is persisted in localStorage.

| Mode | Server URL | Notes |
|------|-----------|-------|
| **Cloud** | `https://nvatar.nskit.io` | Default, hosted service |
| **Local** | `http://localhost:54444` | Self-hosted NVatar server |

### CORS (Self-Hosting)

If hosting the lobby on GitHub Pages and connecting to your own NVatar server, ensure CORS is configured:

```python
# FastAPI example
app.add_middleware(CORSMiddleware,
    allow_origins=["https://your-username.github.io"],
    allow_methods=["*"], allow_headers=["*"])
```

## SDK Modes

| URL Param | Default | Description |
|-----------|---------|-------------|
| `ctx=1` | OFF | Save code conversations to avatar memory |
| `wrap=0` | ON | Skip character wrapping (raw results only) |
| `channel=UUID` | - | Bind to specific Claude Code channel |
| `server=URL` | - | Override NVatar server URL |

## NVatarSDK API

The room exposes `window.NVatarSDK` for external integration:

```javascript
NVatarSDK.onLookupResult = (data) => { /* new result */ };
NVatarSDK.getLookupResults();    // all stored results
NVatarSDK.getUnreadCount();      // unread count
NVatarSDK.clearLookupResults();  // clear all
```

## Channel Environment Variables

Set in `channel/.env` or pass as environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `NVATAR_SERVER_URL` | `http://localhost:54444` | NVatar server endpoint |
| `NVATAR_CHANNEL_PORT` | `8789` | Channel HTTP server port |
| `NVATAR_CHANNEL_UUID` | auto-generated | Channel identifier |

## Architecture

```
Browser (code-assist.html)
    ↓ WebSocket
NVatar Server (FastAPI + Gemma)
    ↓ HTTP POST :8789
Channel MCP Server (Bun)
    ↓ MCP stdio
Claude Code Session (local)
    ↓ reply tool
Channel → NVatar Server → Gemma wrap → Avatar speech
```

## Project Structure

```
nvatar-code-assist/
├── index.html          # Lobby — avatar selection + server config
├── code-assist.html    # Room — 3D avatar + chat + code panel
├── js/room/            # Modular room JS (18 files)
│   ├── state.js        # Shared state + API_BASE resolution
│   ├── main-assist.js  # Code assist entry point
│   ├── chat.js         # WebSocket chat + code panel
│   ├── lookup.js       # NVatarSDK public API
│   └── ...             # scene, animation, tts, stt, i18n, etc.
├── vrm/
│   ├── models.json     # Static model list (GitHub Pages fallback)
│   └── thumbnails/     # VRM avatar thumbnails (256x256)
├── channel/
│   ├── server.ts       # MCP channel server (Bun)
│   └── package.json    # Channel dependencies
└── README.md
```

## Requirements

- [Claude Code](https://claude.com/claude-code) v2.1.80+
- [Bun](https://bun.sh/) runtime
- NVatar Server access (nvatar.nskit.io or self-hosted)

## License

Apache-2.0

---

Built with [NVatar](https://github.com/nskit-io/nvatar-demo) — AI Avatar Chat Platform
