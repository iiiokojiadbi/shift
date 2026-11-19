import { projectAt } from '../npm/store'
import { fields, type Packet, Requests } from './protocol'
import { namespace, Session, toolSpec } from './session'

// One connection to a stock app server. Client approvals and server requests always stay on that connection.
export class Bridge {
  private readonly rpc: Requests
  private readonly sessions = new Map<string, Session>()

  constructor(
    private readonly toServer: (packet: Packet) => void,
    private readonly toClient: (packet: Packet) => void,
    private readonly cwd: string,
    private readonly tell: (text: string) => void,
  ) {
    this.rpc = new Requests(toServer)
  }

  async client(packet: Packet) {
    const { method, id } = packet
    const params = packet.params ?? {}
    try {
      if (method === 'thread/start' || method === 'thread/resume' || method === 'thread/fork') {
        let args = params
        if (method === 'thread/start') {
          const project = await projectAt(typeof params.cwd === 'string' ? params.cwd : this.cwd)
          if (project.settings.enabled) {
            const existing = Array.isArray(params.dynamicTools) ? params.dynamicTools : []
            if (existing.some(tool => fields(tool).name === namespace)) throw new Error('The shift tool namespace is already registered.')
            args = { ...params, dynamicTools: [...existing, toolSpec(project)] }
          }
        }
        const result = await this.rpc.call(method, args)
        const thread = fields(result.thread)
        if (
          typeof thread.id === 'string' &&
          typeof thread.cwd === 'string' &&
          !this.sessions.has(thread.id) &&
          !fields(thread.source).subAgent &&
          !thread.parentThreadId
        ) {
          this.sessions.set(
            thread.id,
            new Session(thread.id, thread.cwd, typeof thread.path === 'string' ? thread.path : undefined, this.rpc.call, this.tell),
          )
        }
        this.toClient({ id, result })
        return
      }
      const session = this.sessions.get(String(params.threadId))
      if (session && (method === 'turn/start' || method === 'turn/steer')) {
        this.toClient({ id, result: await session.ownerRequest(method, params) })
        return
      }
      if (session && method && ['thread/compact/start', 'thread/queue/start', 'thread/queue/add'].includes(method)) {
        this.toClient({ id, result: await session.afterShift(method, params) })
        return
      }
      this.toServer(packet)
    } catch (error) {
      this.toClient({ id, error: (fields(error).rpcError as Packet['error']) ?? { code: -32603, message: String(error) } })
    }
  }

  async server(packet: Packet) {
    if (this.rpc.take(packet)) return
    const { id, method } = packet
    const params = packet.params ?? {}
    const session = this.sessions.get(String(params.threadId))
    if (method === 'item/tool/call' && params.namespace === namespace) {
      let text: string
      let success = true
      try {
        if (!session) throw new Error('Only a thread opened by this adapter can use its shift tools.')
        text = await session.tool(String(params.tool), fields(params.arguments), String(params.turnId))
      } catch (error) {
        text = error instanceof Error ? error.message : String(error)
        success = false
      }
      this.toServer({ id, result: { success, contentItems: [{ type: 'inputText', text }] } })
      return
    }
    if (method) session?.event(method, params)
    this.toClient(packet)
  }

  close() {
    this.rpc.close()
    for (const session of this.sessions.values()) session.close()
  }
}
