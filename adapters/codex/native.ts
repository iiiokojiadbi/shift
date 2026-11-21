import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { TASKS_DESCRIPTION, TOOLS } from '../../core/src'
import { projectAt } from '../npm/store'
import { status } from './gauge'
import { runHook, sessionState } from './hooks'
import manifest from './plugin/.codex-plugin/plugin.json'
import { deferred, fields, type Packet, Requests } from './protocol'
import { Session } from './session'

function stateFile(id: string) {
  const dir = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'plugins', 'data', 'shift-sessions')
  if (!id) throw new Error('Missing plugin data directory or session identity.')
  return { dir, file: join(dir, `session-${createHash('sha256').update(id).digest('hex')}.json`) }
}

class Daemon {
  readonly rpc: Requests
  private readonly ready: Promise<unknown>
  private readonly socket: WebSocket
  readonly sessions = new Map<string, Session>()

  constructor() {
    const home = process.env.CODEX_HOME ?? join(homedir(), '.codex')
    const path = join(home, 'app-server-control', 'app-server-control.sock')
    const socket = new WebSocket(`ws+unix://${path}:/rpc`)
    this.socket = socket
    this.rpc = new Requests(packet => socket.send(JSON.stringify(packet)))
    const connected = deferred<void>()
    const timer = setTimeout(() => {
      connected.reject(new Error('Timed out connecting to the local app server.'))
      socket.close()
    }, 5000)
    socket.onopen = () => connected.resolve()
    socket.onerror = () =>
      connected.reject(new Error('Start the local server with codex app-server daemon start, then open the project with codex.'))
    socket.onclose = () => {
      this.rpc.close()
      for (const session of this.sessions.values()) session.close()
      this.sessions.clear()
    }
    socket.onmessage = event => {
      const packet: Packet = JSON.parse(String(event.data))
      if (this.rpc.take(packet) || !packet.method || packet.id !== undefined) return
      const params = packet.params ?? {}
      this.sessions.get(String(params.threadId))?.event(packet.method, params)
    }
    this.ready = connected.promise
      .finally(() => clearTimeout(timer))
      .then(async () => {
        await this.rpc.call('initialize', {
          clientInfo: { name: manifest.name, version: manifest.version },
          capabilities: { experimentalApi: true },
        })
        socket.send(JSON.stringify({ method: 'initialized' }))
      })
  }

  get disconnected() {
    return this.socket.readyState === WebSocket.CLOSED
  }

  async attach(id: string, root: string, file: string) {
    await this.ready
    const existing = this.sessions.get(id)
    if (existing) return existing
    const thread = fields((await this.rpc.call('thread/read', { threadId: id })).thread)
    if (thread.cwd !== root || thread.parentThreadId || fields(thread.source).subAgent || fields(thread.status).type !== 'active')
      throw new Error('Only the active main thread on the local server can shift.')
    // Resuming a loaded thread subscribes this connection to its lifecycle.
    const session = new Session(
      id,
      root,
      typeof thread.path === 'string' ? thread.path : undefined,
      this.rpc.call,
      text => console.error(text),
      file,
    )
    await this.rpc.call('thread/resume', { threadId: id, excludeTurns: true })
    this.sessions.set(id, session)
    return session
  }

  close() {
    this.socket.close()
  }
}

const extras = [
  { name: 'unshift', description: 'Resume from the latest letter.' },
  { name: 'shift_tasks', description: TASKS_DESCRIPTION },
]
const tools = [
  ...TOOLS.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.schema,
    annotations: { readOnlyHint: !tool.writes },
  })),
  ...extras.map(tool => ({ ...tool, inputSchema: { type: 'object', properties: {} } })),
]

async function serve() {
  let daemon: Daemon | undefined
  const sessions = new Map<string, Session>()
  const reply = (id: Packet['id'], result: unknown) => console.log(JSON.stringify({ jsonrpc: '2.0', id, result }))
  async function handle(packet: Packet) {
    if (packet.id === undefined) return
    const params = packet.params ?? {}
    switch (packet.method) {
      case 'initialize':
        return reply(packet.id, {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: manifest.name, version: manifest.version },
        })
      case 'ping':
        return reply(packet.id, {})
      case 'tools/list':
        return reply(packet.id, { tools })
      case 'tools/call': {
        try {
          const meta = fields(params._meta)
          const id = String(meta.threadId ?? '')
          const { file } = stateFile(String(meta.sessionId ?? id))
          const state = await sessionState(file)
          if (!state) throw new Error('Enable the shift session hooks in /hooks, then start a new session.')
          if (!id || typeof state.root !== 'string') throw new Error('Missing thread or project from the session hook.')
          const name = String(params.name)
          if (name === 'shift_status') {
            if (!(await projectAt(state.root)).settings.enabled) throw new Error('Shift is disabled in this project.')
            return reply(packet.id, { content: [{ type: 'text', text: status(state.usage) }] })
          }
          let session = daemon?.sessions.get(id) ?? sessions.get(id)
          let turn = ''
          if (name === 'shift') {
            if (!daemon || daemon.disconnected) daemon = new Daemon()
            try {
              session = await daemon.attach(id, state.root, file)
              const turns = await daemon.rpc.call('thread/turns/list', { threadId: id, limit: 1 })
              const active = Array.isArray(turns.data) ? fields(turns.data[0]) : {}
              if (active.status !== 'inProgress' || typeof active.id !== 'string')
                throw new Error('The accepting turn is no longer active.')
              turn = active.id
              session.event('turn/started', { turn: active })
            } catch (error) {
              if (!daemon.sessions.size) {
                daemon.close()
                daemon = undefined
              }
              throw error
            }
          }
          if (!session) {
            session = new Session(
              id,
              state.root,
              undefined,
              async () => {
                throw new Error('No app server attached.')
              },
              text => console.error(text),
            )
            sessions.set(id, session)
          }
          const text = await session.tool(name, fields(params.arguments), turn)
          return reply(packet.id, { content: [{ type: 'text', text }] })
        } catch (error) {
          return reply(packet.id, { isError: true, content: [{ type: 'text', text: String(error) }] })
        }
      }
      default:
        console.log(JSON.stringify({ jsonrpc: '2.0', id: packet.id, error: { code: -32601, message: 'Unknown method' } }))
    }
  }
  try {
    for await (const line of createInterface({ input: process.stdin })) {
      try {
        await handle(JSON.parse(line))
      } catch (error) {
        console.error(String(error))
      }
    }
  } finally {
    daemon?.close()
  }
}

if (process.argv[2] === 'hook') {
  const input = await Bun.stdin.json()
  const { file, dir } = stateFile(String(input.session_id ?? ''))
  console.log(JSON.stringify(await runHook(input, dir, file)))
} else if (process.argv[2] === 'mcp') await serve()
