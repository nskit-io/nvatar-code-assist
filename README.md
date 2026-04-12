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

- Click **생성** to generate a Channel UUID
- Copy the channel start command shown below

### 3. Start Claude Code Channel

```bash
NVATAR_CHANNEL_UUID=<your-uuid> claude --dangerously-load-development-channels server:nvatar
```

### 4. Select Avatar & Enter Room

- Choose your avatar in the lobby
- The room auto-connects to your Claude Code session
- Start giving code commands!

## SDK Modes

| URL Param | Default | Description |
|-----------|---------|-------------|
| `ctx=1` | OFF | Save code conversations to avatar memory |
| `wrap=0` | ON | Skip character wrapping (raw results only) |
| `channel=UUID` | - | Bind to specific Claude Code channel |

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

## Requirements

- [Claude Code](https://claude.com/claude-code) v2.1.80+
- [Bun](https://bun.sh/) runtime
- NVatar Server access (nvatar.nskit.io or self-hosted)

## License

Apache-2.0

---

Built with [NVatar](https://github.com/nskit-io/nvatar-demo) — AI Avatar Chat Platform
