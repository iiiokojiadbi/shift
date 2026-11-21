import { afterAll, beforeAll, expect, test } from 'bun:test'
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { BOARD, LETTER } from '../../../core/test/data'
import { historyRuntime } from '../../npm/test/native-history'
import { cleanup, scratch } from '../../npm/test/scratch'
import { deferred, fields, type Packet, Requests, textInput } from '../protocol'

let launcher: string
let archive: Awaited<ReturnType<typeof historyRuntime>>
beforeAll(async () => {
  archive = await historyRuntime()
  launcher = await archive.sourceLauncher()
}, 60000)
afterAll(cleanup)

// An isolated real app server with deterministic model responses. Inspect the actual model inputs.
for (const scenario of ['continue', 'continue with steering', 'wait', 'wait with owner input'])
  test.skipIf(!Bun.which('codex'))(
    `app server returns the map and letter on ${scenario}`,
    async () => {
      const mode = scenario.startsWith('continue') ? 'continue' : 'wait'
      const dir = await scratch('codex')
      const project = join(dir, 'project')
      const home = join(dir, 'config')
      const records = join(project, '.shift')
      await Promise.all([mkdir(records, { recursive: true }), mkdir(home), mkdir(join(project, 'docs'), { recursive: true })])
      await Promise.all([
        writeFile(join(records, 'letter.md'), LETTER),
        writeFile(join(records, 'OWNER.md'), 'none'),
        writeFile(join(records, 'board.md'), BOARD),
        writeFile(join(records, 'SHIFT.md'), '# Shift\n\nKeep lessons here.\n'),
        writeFile(join(records, 'settings.toml'), '[docs]\ndirs = ["docs"]\n'),
        writeFile(join(project, 'docs', 'guide.md'), '---\ndescription: Fixture document.\n---\n# Guide\n\n## First section\n'),
      ])
      const inputs: string[] = []
      const received = deferred<void>()
      const compacting = deferred<void>()
      const release = deferred<void>()
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request) {
          if (request.method !== 'POST') return Response.json({ data: [] })
          const body = await request.json()
          const step = inputs.push(JSON.stringify(body.input))
          if (step === 3) {
            compacting.resolve()
            await release.promise
          }
          const id = `r${step}`
          const item =
            step === 1
              ? {
                  type: 'function_call',
                  call_id: 'call-shift',
                  namespace: 'shift',
                  name: 'shift',
                  arguments: JSON.stringify({ letter: '.shift/letter.md', after: mode, about: 'Fixture checked' }),
                }
              : {
                  type: 'message',
                  role: 'assistant',
                  id,
                  content: [{ type: 'output_text', text: step === 3 ? 'Fixture digest.' : 'Finished.' }],
                }
          const events = [
            { type: 'response.created', response: { id } },
            { type: 'response.output_item.done', item },
            { type: 'response.completed', response: { id, usage: { input_tokens: 200, output_tokens: 10, total_tokens: 210 } } },
          ]
          if (step >= 4) received.resolve()
          return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
            headers: { 'content-type': 'text/event-stream' },
          })
        },
      })
      await writeFile(
        join(home, 'config.toml'),
        `model = "fixture"
model_provider = "fixture"
[model_providers.fixture]
name = "fixture"
base_url = "${server.url}v1"
wire_api = "responses"
[projects.${JSON.stringify(project)}]
trust_level = "trusted"
`,
      )
      const env = { ...process.env, CODEX_HOME: home, NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' }
      if (scenario === 'continue') {
        const options = { cwd: project, env, stdio: 'pipe' as const }
        execFileSync('codex', ['plugin', 'marketplace', 'add', archive.marketplace], options)
        execFileSync('codex', ['plugin', 'add', 'shift@shift'], options)
      }
      const child = spawn(process.execPath, [launcher, '--stdio'], {
        cwd: project,
        env,
        stdio: 'pipe',
      })
      const rpc = new Requests(packet => child.stdin.write(`${JSON.stringify(packet)}\n`))
      const errors: string[] = []
      child.stderr.on('data', chunk => errors.push(chunk.toString()))
      const messages: string[] = []
      createInterface({ input: child.stdout }).on('line', line => {
        const packet: Packet = JSON.parse(line)
        if (!rpc.take(packet)) messages.push(JSON.stringify(packet))
      })
      const stopped = new Promise<void>(done =>
        child.once('exit', () => {
          rpc.close()
          done()
        }),
      )
      try {
        await rpc.call('initialize', { clientInfo: { name: 'shift_test', version: '1' }, capabilities: { experimentalApi: true } })
        child.stdin.write('{"method":"initialized"}\n')
        if (scenario === 'continue') {
          const inventory = await rpc.call('hooks/list', { cwds: [project] })
          expect(fields((inventory.data as unknown[])[0]).hooks).toEqual([])
        }
        const started = await rpc.call('thread/start', { cwd: project, approvalPolicy: 'never' })
        const threadId = fields(started.thread).id
        const initial = await rpc.call('turn/start', { threadId, input: [textInput('Run the fixture.')] })
        await Promise.race([
          compacting.promise,
          Bun.sleep(10000).then(() => {
            throw new Error(`No shift: ${inputs.length} requests; ${messages.join('\n').slice(-1600)}; ${errors.join('').slice(-600)}`)
          }),
        ])
        await writeFile(join(project, 'docs', 'guide.md'), '---\ndescription: Fixture document.\n---\n# Guide\n\n## Revised section\n')
        const ownerInput = { threadId, input: [textInput('Owner follow-up.')] }
        let owner: ReturnType<typeof rpc.call> | undefined
        if (scenario === 'continue with steering')
          owner = rpc.call('turn/steer', { ...ownerInput, expectedTurnId: fields(initial.turn).id })
        if (scenario === 'wait with owner input') owner = rpc.call('turn/start', ownerInput)
        release.resolve()
        if (scenario === 'wait') {
          const until = Date.now() + 3000
          while (Date.now() < until && !errors.join('').includes('waiting')) await Bun.sleep(20)
          expect(inputs).toHaveLength(3)
          owner = rpc.call('turn/start', ownerInput)
        }
        await owner
        await Promise.race([
          received.promise,
          Bun.sleep(5000).then(() => {
            throw new Error(`Missing hand-back: ${messages.join('\n').slice(-1700)}; ${errors.join('').slice(-800)}`)
          }),
        ])
        expect(inputs[0]).toContain('First section')
        expect(inputs[2]).toContain('HOLD-THIS')
        expect(inputs[3]).toContain('Revised section')
        expect(inputs[3]).toContain('fixing tests')
        if (owner) {
          expect(inputs[3]).toContain('Owner follow-up.')
          expect(inputs[3]?.indexOf('fixing tests')).toBeLessThan(inputs[3]?.indexOf('Owner follow-up.') ?? -1)
        }
        const snapshot = archive.latest(project)
        expect(snapshot?.state).toBe('complete')
        expect(snapshot?.files['summary.md']).toContain('Fixture digest.')
      } finally {
        release.resolve()
        child.stdin.end()
        child.kill()
        server.stop(true)
        await stopped
      }
    },
    22000,
  )
