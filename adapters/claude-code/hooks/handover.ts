import type { EngineInterface } from 'claude-code'
import { atom, read, update } from 'claude-code'
import type { PendingShift, WaitNote } from '../types'
import { afterTurn, type Loop, type LoopState, renderSessionFiles, sessionFiles } from './core/index'
import { projectOf } from './disk'

// The engine lists a module's state from atoms declared in the same file, so each file declares the ones it touches.
const pending = atom({ plugin: 'shift', key: 'pending' } as const, null)
const waitNote = atom({ plugin: 'shift', key: 'waitNote' } as const, null)
const files = atom({ plugin: 'shift', key: 'files' } as const, null)

// The shift loop's state in the plugin's atoms; rows in the transcript.
export function loopOf($: EngineInterface): Loop {
  const current = async (): Promise<LoopState> => {
    const shift: PendingShift | null = await read($, pending)
    const note: WaitNote | null = await read($, waitNote)

    return { pending: shift, note }
  }

  return {
    read: current,
    update: async change => {
      const before = await current()
      const after = change(before)
      if (after.pending !== before.pending) await update($, pending, () => after.pending)
      if (after.note !== before.note) await update($, waitNote, () => after.note)
    },
    tell: row => $.ui.log(row),
  }
}

// After the turn: the pending shift lets the history go, and the session's files come back as the shift left them.
export async function handOver($: EngineInterface, aborted: boolean): Promise<void> {
  const project = await projectOf($)
  await afterTurn(
    project,
    loopOf($),
    {
      fill: async () => (await $.session.usage()).context.tokens,
      letGo: async instructions => {
        const done = await $.session.compact({ instructions })
        if (done.messages === undefined) return { skip: done.skip ?? 'the harness did not let the history go' }

        return { messages: done.messages, before: done.tokensBefore, after: (await $.session.usage()).context.tokens ?? done.tokensAfter }
      },
      continueWith: async prompt => {
        await $.prompt.submit({ text: prompt })
      },
      afterLetGo: async () => {
        const loaded = renderSessionFiles(await sessionFiles(project))
        await update($, files, () => loaded)
      },
    },
    aborted,
  )
}
