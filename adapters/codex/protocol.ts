// Only the fields the adapter consumes. All other messages and fields pass through unchanged.
export type Fields = Record<string, unknown>
export type Packet = Fields & { id?: string | number; method?: string; params?: Fields; error?: Fields; result?: unknown }
export type Request = (method: string, params: Fields) => Promise<Fields>

export function fields(value: unknown): Fields {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Fields) : {}
}

export function textInput(text: string) {
  return { type: 'text', text, text_elements: [] }
}

// Codex recognizes external context in a user-role item and omits it from the
// user messages retained at the next shift. Keep the original owner input separate.
const contextStart = '<external_shift>\n'
const contextEnd = '\n</external_shift>'

export function shiftContext(text: string) {
  return contextStart + text + contextEnd
}

export function contextBody(text: string) {
  return text.startsWith(contextStart) && text.endsWith(contextEnd) ? text.slice(contextStart.length, -contextEnd.length) : text
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

// Internal calls share the client's connection, so they use a private id space. A server request can use
// the same id as a client request: only a response can settle one.
export class Requests {
  private readonly prefix = crypto.randomUUID()
  private serial = 0
  private closed = false
  private readonly pending = new Map<string, ReturnType<typeof deferred<Fields>>>()

  constructor(private readonly send: (packet: Packet) => void) {}

  call: Request = async (method, params) => {
    if (this.closed) throw new Error('The app server disconnected.')
    const id = `${this.prefix}:${++this.serial}`
    const result = deferred<Fields>()
    this.pending.set(id, result)
    try {
      this.send({ id, method, params })
      return await result.promise
    } finally {
      this.pending.delete(id)
    }
  }

  take(packet: Packet): boolean {
    const pending = packet.method === undefined && typeof packet.id === 'string' ? this.pending.get(packet.id) : undefined
    if (!pending) return false
    if (packet.error) pending.reject(Object.assign(new Error(String(packet.error.message)), { rpcError: packet.error }))
    else pending.resolve(fields(packet.result))
    return true
  }

  close(): void {
    this.closed = true
    for (const pending of this.pending.values()) pending.reject(new Error('The app server disconnected.'))
  }
}
