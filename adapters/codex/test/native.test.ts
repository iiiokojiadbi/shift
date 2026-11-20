import { afterAll, expect, test } from 'bun:test'
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { BOARD, LETTER } from '../../../core/test/data'
import { cleanup, scratch } from '../../npm/test/scratch'
import { deferred, fields, type Packet, Requests, textInput } from '../protocol'

afterAll(cleanup)
for (const mode of ['continue', 'wait'])
  test.skipIf(!Bun.which('codex'))(
    `installed marketplace plugin returns the map and letter on ${mode}`,
    async () => {
      const home = await scratch('plugin-profile')
      const root = await scratch('plugin-project')
      const records = join(root, '.shift')
      const socket = join(home, 'app-server-control', 'app-server-control.sock')
      await Promise.all([mkdir(records), mkdir(join(root, 'docs')), mkdir(join(home, 'app-server-control'))])
      const requests: string[] = []
      const end = deferred<void>()
      let hintSeen = false
      const mock = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request) {
          if (request.method !== 'POST') return Response.json({ data: [] })
          const body = await request.json()
          const step = requests.push(JSON.stringify(body.input))
          const id = `response${step}`
          // Tool hooks can see the preceding usage sample. Keep taking readings through
          // one tool after the reminder, then check the actual retained model input.
          const hasHint = requests[step - 1]?.includes('Shift hint: ') === true
          const finished = step >= 4 && (hintSeen || step >= 16)
          hintSeen ||= hasHint
          const item =
            step === 1 || (step >= 4 && !finished)
              ? {
                  type: 'function_call',
                  call_id: `fixture-call-${step}`,
                  namespace: 'mcp__shift',
                  name: step === 1 ? 'shift' : 'shift_status',
                  arguments: JSON.stringify(
                    step === 1 ? { after: mode, about: 'Checked plugin installation', letter: '.shift/letter.md' } : {},
                  ),
                }
              : {
                  type: 'message',
                  role: 'assistant',
                  id,
                  content: [{ type: 'output_text', text: step === 3 ? 'The shift kept the fixture.' : 'Done.' }],
                }
          if (finished) end.resolve()
          const tokens = step >= 5 ? 200000 : 200
          const events = [
            { type: 'response.created', response: { id } },
            { type: 'response.output_item.done', item },
            { type: 'response.completed', response: { id, usage: { input_tokens: tokens, output_tokens: 1, total_tokens: tokens + 1 } } },
          ]
          return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
            headers: { 'content-type': 'text/event-stream' },
          })
        },
      })
      const env = { ...process.env, CODEX_HOME: home, NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' }
      await Promise.all([
        writeFile(join(records, 'board.md'), BOARD),
        writeFile(join(records, 'letter.md'), LETTER.replace('fixing tests', 'Unique fixture letter body')),
        writeFile(join(records, 'TASKS.md'), '# Tasks\n'),
        writeFile(join(records, 'OWNER.md'), 'none'),
        writeFile(join(records, 'settings.toml'), '[docs]\ndirs = ["docs"]\n'),
        writeFile(join(root, 'docs', 'work.md'), '---\ndescription: Map fixture.\n---\n# Work\n\n## Acceptance marker\n'),
        writeFile(
          join(home, 'config.toml'),
          `model = "fixture"
model_provider = "fixture"
model_context_window = 272000
[features]
untrusted_as_tool_output = true
[model_providers.fixture]
name = "fixture"
base_url = "${mock.url}v1"
wire_api = "responses"
[projects.${JSON.stringify(root)}]
trust_level = "trusted"
`,
        ),
      ])
      const install = (args: string[]) => execFileSync('codex', args, { env, cwd: root, stdio: 'pipe' })
      install(['plugin', 'marketplace', 'add', resolve(import.meta.dir, '../../..')])
      install(['plugin', 'add', 'shift@shift'])
      const server = spawn('codex', ['app-server', '--listen', `unix://${socket}`], { env, cwd: root, stdio: 'ignore' })
      const exited = new Promise<void>(done => server.once('exit', () => done()))
      let ws: WebSocket | undefined
      try {
        for (let attempt = 0; attempt < 50 && !ws; attempt++) {
          ws = await new Promise<WebSocket | undefined>(done => {
            const found = new WebSocket(`ws+unix://${socket}:/rpc`)
            found.onopen = () => done(found)
            found.onerror = () => done(undefined)
          })
          if (!ws) await Bun.sleep(50)
        }
        if (!ws) throw new Error('The stock server did not start.')
        const rpc = new Requests(packet => ws?.send(JSON.stringify(packet)))
        const notices: string[] = []
        const reportDone = deferred<void>()
        ws.onmessage = e => {
          const packet: Packet = JSON.parse(String(e.data))
          if (rpc.take(packet)) return
          if (packet.method === 'turn/completed') reportDone.resolve()
          if (packet.id !== undefined && packet.method === 'mcpServer/elicitation/request' && packet.params?.serverName === 'shift') {
            ws?.send(JSON.stringify({ id: packet.id, result: { action: 'accept', content: {}, _meta: null } }))
            return
          }
          if (packet.id !== undefined) notices.push(JSON.stringify(packet))
          if (packet.method === 'error' || packet.method === 'hook/completed' || packet.method === 'item/completed')
            notices.push(JSON.stringify(packet))
        }
        await rpc.call('initialize', { clientInfo: { name: 'shift_test', version: '1' }, capabilities: { experimentalApi: true } })
        ws.send(JSON.stringify({ method: 'initialized' }))
        const inventory = await rpc.call('hooks/list', { cwds: [root] })
        const hooks = fields((inventory.data as unknown[])[0]).hooks as FieldsForHook[]
        expect(hooks).toHaveLength(4)
        // Review the fixture hooks in this disposable profile just as /hooks does.
        const value = Object.fromEntries(hooks.map(h => [h.key, { trusted_hash: h.currentHash }]))
        await rpc.call('config/batchWrite', { edits: [{ keyPath: 'hooks.state', value, mergeStrategy: 'upsert' }], reloadUserConfig: true })
        const started = await rpc.call('thread/start', { cwd: root, approvalPolicy: 'on-request' })
        const threadId = fields(started.thread).id
        const catalog = await rpc.call('skills/list', { cwds: [root] })
        const skills = (fields((catalog.data as unknown[])[0]).skills as { name: string; path: string; enabled: boolean }[]).filter(
          skill => skill.enabled && skill.name.startsWith('shift:'),
        )
        expect(skills.map(skill => skill.name).sort()).toEqual(['shift:shift', 'shift:sizes', 'shift:tasks', 'shift:unshift'])
        const pick = (action: string) => {
          const skill = skills.find(skill => skill.name === `shift:${action}`)
          if (!skill) throw new Error(`Missing skill: ${action}`)
          return [textInput(`$${skill.name}`), { type: 'skill', name: skill.name, path: skill.path }]
        }
        const sizes = mode === 'continue'
        await rpc.call('turn/start', { threadId, input: pick(sizes ? 'sizes' : 'tasks') })
        await reportDone.promise
        expect(requests).toHaveLength(0)
        expect(notices.join('\n')).toContain(sizes ? 'Session + continue' : 'no open tasks')
        await rpc.call('turn/start', { threadId, input: pick('shift') })
        if (mode === 'wait') {
          const deadline = Date.now() + 6000
          let waiting = false
          while (!waiting && Date.now() < deadline) {
            const dirs = await readdir(join(records, 'shifts')).catch(() => [] as string[])
            if (dirs[0]) {
              const about = await readFile(join(records, 'shifts', dirs[0], 'about.md'), 'utf8').catch(error => {
                if (error.code === 'ENOENT') return ''
                throw error
              })
              waiting = about.includes('waiting for the owner')
            }
            if (!waiting) await Bun.sleep(25)
          }
          expect(waiting).toBe(true)
          expect(requests).toHaveLength(3)
          await rpc.call('turn/start', { threadId, input: [textInput('Owner reply.')] })
        }
        await Promise.race([
          end.promise,
          Bun.sleep(8000).then(() => {
            throw new Error(`Received ${requests.length} model requests: ${requests[1]?.slice(-1100)}; ${notices.join('\n').slice(-900)}`)
          }),
        ])
        expect(requests[0]).toContain('The owner asks you to shift now')
        expect(requests[0]).not.toContain('Estimated text tokens (4 characters per token).')
        expect(requests[0]).not.toContain('no open tasks in .shift/TASKS.md')
        expect(requests[0]?.split('Acceptance marker').length).toBe(2)
        expect(requests[0]?.split('how the shift mod works:').length).toBe(2)
        expect(requests[2]).toContain('HOLD-THIS')
        expect(requests[3]?.split('Unique fixture letter body').length).toBe(2)
        expect(requests[3]?.split('how the shift mod works:').length).toBe(2)
        expect(requests[3]?.split('Acceptance marker').length).toBe(2)
        expect(requests.at(-1)?.match(/Shift hint: /g)).toHaveLength(1)
        const [snapshot] = await readdir(join(records, 'shifts'))
        expect(await readFile(join(records, 'shifts', snapshot ?? '', 'about.md'), 'utf8')).toContain('result: shifted')
      } finally {
        ws?.close()
        server.kill()
        await exited
        mock.stop(true)
      }
    },
    18000,
  )

type FieldsForHook = { key: string; currentHash: string }

test.skipIf(!Bun.which('codex'))(
  'resuming a persisted thread preserves the model request prefix and delivers only changes',
  async () => {
    const root = await scratch('resume-project')
    const home = await scratch('resume-profile')
    const requests: { input: unknown[]; prompt_cache_key?: string; instructions: string; tools: unknown[] }[] = []
    const mock = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        if (request.method !== 'POST') return Response.json({ data: [] })
        requests.push(await request.json())
        const id = `response${requests.length}`
        const events = [
          { type: 'response.created', response: { id } },
          {
            type: 'response.output_item.done',
            item: { type: 'message', role: 'assistant', id, content: [{ type: 'output_text', text: 'Done.' }] },
          },
          { type: 'response.completed', response: { id, usage: { input_tokens: 200, output_tokens: 1, total_tokens: 201 } } },
        ]
        return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
          headers: { 'content-type': 'text/event-stream' },
        })
      },
    })
    const env = { ...process.env, CODEX_HOME: home, NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' }
    try {
      const folder = join(root, '.shift/shifts/20260101-010101')
      await mkdir(folder, { recursive: true })
      const body = `Unique restored letter body. ${'Long fixture line. '.repeat(3000)}End of restored letter.`
      await writeFile(join(folder, 'letter.md'), LETTER.replace('fixing tests', body))
      const owner = join(root, '.shift/OWNER.md')
      await writeFile(owner, 'Session fixture marker.')
      await writeFile(
        join(home, 'config.toml'),
        `model = "fixture"
model_provider = "fixture"
[features]
untrusted_as_tool_output = true
[model_providers.fixture]
name = "fixture"
base_url = "${mock.url}v1"
wire_api = "responses"
[projects.${JSON.stringify(root)}]
trust_level = "trusted"
`,
      )
      for (const args of [
        ['plugin', 'marketplace', 'add', resolve(import.meta.dir, '../../..')],
        ['plugin', 'add', 'shift@shift'],
      ])
        execFileSync('codex', args, { env, cwd: root, stdio: 'pipe' })
      for (const args of [[], ['resume', '--last'], ['resume', '--last']]) {
        if (requests.length === 2) await writeFile(owner, 'Updated fixture decision.')
        const child = Bun.spawn(
          [
            'codex',
            'exec',
            ...args,
            '--dangerously-bypass-hook-trust',
            '--skip-git-repo-check',
            args.length ? 'Read the fixture.' : '$shift:unshift Review this project.',
          ],
          { cwd: root, env, stdout: 'ignore', stderr: 'pipe' },
        )
        const [code, errors] = await Promise.all([child.exited, new Response(child.stderr).text()])
        if (code) throw new Error(errors)
      }
      expect(requests).toHaveLength(3)
      const [first, resumed, changed] = requests
      if (!first || !resumed || !changed) throw new Error('Missing model request')
      const restored = JSON.stringify(first.input)
      expect(restored.split('Review this project.')).toHaveLength(2)
      expect(restored).toContain(body)
      expect(restored.split('Unique restored letter body')).toHaveLength(2)
      expect(restored.split('End of restored letter.')).toHaveLength(2)
      expect(first.prompt_cache_key).toBeTruthy()
      for (const [before, after] of [
        [first, resumed],
        [resumed, changed],
      ] as const) {
        expect(after.prompt_cache_key).toBe(before.prompt_cache_key)
        expect(after.tools).toEqual(before.tools)
        expect(after.instructions).toEqual(before.instructions)
        expect(after.input.slice(0, before.input.length)).toEqual(before.input)
        expect(JSON.stringify(after.input).split('Session fixture marker.')).toHaveLength(2)
      }
      expect(JSON.stringify(changed.input.slice(resumed.input.length))).toContain('OWNER.md` changed outside your tools')
    } finally {
      mock.stop(true)
    }
  },
  20000,
)
