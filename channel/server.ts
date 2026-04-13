#!/usr/bin/env bun
/**
 * NVatar Channel for Claude Code.
 *
 * MCP server that bridges NVatar room chat to Claude Code sessions.
 * NVatar Server POSTs code commands here → Channel pushes notification to Claude Code
 * → Claude Code executes → calls reply tool → Channel POSTs callback to NVatar Server.
 *
 * State: ~/.claude/channels/nvatar/
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'

const STATE_DIR = process.env.NVATAR_STATE_DIR ?? join(homedir(), '.claude', 'channels', 'nvatar')
const ENV_FILE = join(STATE_DIR, '.env')

// Load .env
try {
  chmodSync(ENV_FILE, 0o600)
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^(\w+)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
} catch {}

const CHANNEL_SECRET = process.env.NVATAR_CHANNEL_SECRET || (() => {
  const generated = randomBytes(16).toString('hex')
  process.stderr.write(`nvatar channel: WARNING — no NVATAR_CHANNEL_SECRET set, generated ephemeral: ${generated}\n`)
  return generated
})()
const CHANNEL_PORT = parseInt(process.env.NVATAR_CHANNEL_PORT || '8789', 10)
const NVATAR_SERVER = process.env.NVATAR_SERVER_URL || 'http://localhost:54444'
// UUID: passed via env (from user's index page) or auto-generated
const CHANNEL_UUID = process.env.NVATAR_CHANNEL_UUID || randomBytes(4).toString('hex')

// Safety nets
process.on('unhandledRejection', err => {
  process.stderr.write(`nvatar channel: unhandled rejection: ${err}\n`)
})
process.on('uncaughtException', err => {
  process.stderr.write(`nvatar channel: uncaught exception: ${err}\n`)
})

// --- MCP Server ---
const mcp = new Server(
  { name: 'nvatar', version: '0.0.1' },
  {
    capabilities: { tools: {}, experimental: { 'claude/channel': {} } },
    instructions: [
      'NVatar 룸의 아바타 캐릭터를 통해 코드 작업 명령이 도착합니다.',
      '',
      'Messages arrive as <channel source="nvatar" avatar_id="..." user="owner">.',
      'The user is the project owner — they control the NVatar room and this Claude Code session.',
      '',
      '## Execution',
      'Execute the requested task, then use the reply tool to send back the result.',
      'Keep replies concise — the avatar character will wrap your response in conversational form.',
      'Focus on: what was done, key results, and any follow-up suggestions.',
      '',
      '## Progress Updates (IMPORTANT)',
      'The user watches the avatar while waiting. Long silences feel broken.',
      'For any task that takes more than ~15 seconds:',
      '- Send a reply with status="progress" BEFORE starting heavy work (e.g. "분석 시작할게요" / "Looking into it...")',
      '- Send progress updates every 20-30 seconds during long operations',
      '- Examples: "파일 3개 수정 중...", "테스트 실행 중...", "빌드 확인 중..."',
      '- Final reply uses status="success" or status="error"',
      'The avatar will speak each progress update, keeping the user engaged.',
      '',
      'You have full access to the codebase. The working directory is the nskit-v1 project root.',
      'All NSKit project conventions in CLAUDE.md apply.',
    ].join('\n'),
  },
)

// --- Tools ---
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description:
        'Send the result back to the NVatar room. The avatar will character-wrap your response before showing it to the user. Keep it factual and concise.',
      inputSchema: {
        type: 'object',
        properties: {
          avatar_id: {
            type: 'string',
            description: 'The avatar_id from the inbound <channel> meta.',
          },
          text: {
            type: 'string',
            description: 'The result text. Plain text, concise summary of what was done.',
          },
          status: {
            type: 'string',
            enum: ['success', 'error', 'progress'],
            description: 'Result status. success=task complete, error=task failed, progress=interim update.',
          },
        },
        required: ['avatar_id', 'text'],
      },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>
  try {
    switch (req.params.name) {
      case 'reply': {
        const avatar_id = args.avatar_id as string
        const text = args.text as string
        const status = (args.status as string) || 'success'

        const parsedId = parseInt(avatar_id, 10)
        if (isNaN(parsedId) || parsedId <= 0) {
          throw new Error(`invalid avatar_id: ${avatar_id}`)
        }

        // POST callback to NVatar Server
        const res = await fetch(`${NVATAR_SERVER}/api/v1/channel/callback`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Channel-Token': CHANNEL_SECRET,
          },
          body: JSON.stringify({ avatar_id: parsedId, text, status, channel_uuid: CHANNEL_UUID }),
        })

        if (!res.ok) {
          const body = await res.text()
          throw new Error(`callback failed: ${res.status} ${body}`)
        }

        return { content: [{ type: 'text', text: `Reply sent to avatar ${avatar_id} (${status})` }] }
      }
      default:
        throw new Error(`unknown tool: ${req.params.name}`)
    }
  } catch (err: any) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }
  }
})

// --- HTTP Server: receives messages from NVatar Server ---
const httpServer = Bun.serve({
  port: CHANNEL_PORT,
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url)

    if (req.method === 'POST' && url.pathname === '/message') {
      try {
        const body = await req.json() as { avatar_id: number; text: string; token: string }

        // Verify token
        if (body.token !== CHANNEL_SECRET) {
          return new Response('unauthorized', { status: 401 })
        }

        // Push notification to Claude Code
        await mcp.notification({
          method: 'notifications/claude/channel',
          params: {
            content: body.text,
            meta: {
              avatar_id: String(body.avatar_id),
              user: 'owner',
              source: 'nvatar-room',
              ts: new Date().toISOString(),
            },
          },
        })

        return Response.json({ ok: true })
      } catch (err: any) {
        process.stderr.write(`nvatar channel: message error: ${err.message}\n`)
        return new Response(`error: ${err.message}`, { status: 500 })
      }
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true, channel: 'nvatar', port: CHANNEL_PORT, uuid: CHANNEL_UUID })
    }

    return new Response('not found', { status: 404 })
  },
})

// --- Startup: register with NVatar Server ---
async function registerWithServer() {
  try {
    const res = await fetch(`${NVATAR_SERVER}/api/v1/channel/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Channel-Token': CHANNEL_SECRET,
      },
      body: JSON.stringify({ port: CHANNEL_PORT, token: CHANNEL_SECRET, uuid: CHANNEL_UUID }),
    })
    if (res.ok) {
      process.stderr.write(`nvatar channel: registered (port ${CHANNEL_PORT}, uuid ${CHANNEL_UUID})\n`)
      process.stderr.write(`\n  ⚡ Code Assist URL:\n  ${NVATAR_SERVER}/static/code-assist.html?channel=${CHANNEL_UUID}\n\n`)
    } else {
      process.stderr.write(`nvatar channel: registration failed: ${res.status}\n`)
    }
  } catch (err: any) {
    process.stderr.write(`nvatar channel: server not reachable: ${err.message}\n`)
  }
}

async function unregisterFromServer() {
  try {
    await fetch(`${NVATAR_SERVER}/api/v1/channel/unregister`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Channel-Token': CHANNEL_SECRET },
      body: JSON.stringify({ uuid: CHANNEL_UUID }),
    })
  } catch {}
}

// --- Heartbeat: re-register periodically (survives NVatar server restarts) ---
const HEARTBEAT_MS = 30_000 // 30 seconds
setInterval(async () => {
  if (stopping) return
  try {
    const res = await fetch(`${NVATAR_SERVER}/api/v1/channel/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Channel-Token': CHANNEL_SECRET },
      body: JSON.stringify({ port: CHANNEL_PORT, token: CHANNEL_SECRET, uuid: CHANNEL_UUID }),
    })
    if (!res.ok) process.stderr.write(`nvatar channel: heartbeat failed: ${res.status}\n`)
  } catch {}
}, HEARTBEAT_MS)

// --- Graceful shutdown ---
let stopping = false
async function shutdown() {
  if (stopping) return
  stopping = true
  process.stderr.write('nvatar channel: shutting down\n')
  await unregisterFromServer()
  httpServer.stop()
  setTimeout(() => process.exit(0), 1000)
}

process.stdin.on('end', shutdown)
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

// --- Connect MCP + register ---
async function main() {
  const transport = new StdioServerTransport()
  await mcp.connect(transport)
  process.stderr.write(`nvatar channel: MCP connected, HTTP on localhost:${CHANNEL_PORT}\n`)
  await registerWithServer()
}

main().catch(err => {
  process.stderr.write(`nvatar channel: startup failed: ${err}\n`)
  process.exit(1)
})
