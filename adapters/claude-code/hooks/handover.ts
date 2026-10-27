import type { EngineInterface } from 'claude-code'
import { atom, read, update } from 'claude-code'
import type { LetGo, PendingShift, WaitNote } from '../types'
import { afterTurn, type Loop, type LoopState, renderSessionFiles, sessionDoctrine, sessionFiles } from './core/index'
import { projectOf } from './disk'

// The engine lists a module's state from atoms declared in the same file, so each file declares the ones it touches.
const pending = atom({ plugin: 'shift', key: 'pending' } as const, null)
const waitNote = atom({ plugin: 'shift', key: 'waitNote' } as const, null)
const files = atom({ plugin: 'shift', key: 'files' } as const, null)
const letting = atom({ plugin: 'shift', key: 'letting' } as const, null)
const doctrineText = atom({ plugin: 'shift', key: 'doctrine' } as const, null)

// The shift loop's state in the plugin's atoms; rows in the transcript.
export function loopOf($: EngineInterface): Loop {
  const current = async (): Promise<LoopState> => {
    const shift: PendingShift | null = await read($, pending)
    const note: WaitNote | null = await read($, waitNote)
    const going: LetGo | null = await read($, letting)

    return { pending: shift, note, letting: going }
  }

  return {
    read: current,
    // The pending shift changes in one update of its atom, so a change that claims it is atomic.
    update: async change => {
      const note: WaitNote | null = await read($, waitNote)
      const going: LetGo | null = await read($, letting)
      const next: { note?: WaitNote | null; letting?: LetGo | null } = {}
      await update($, pending, (shift: PendingShift | null) => {
        const after = change({ pending: shift, note, letting: going })
        next.note = after.note
        next.letting = after.letting ?? null
        return after.pending
      })
      if (next.note !== undefined && next.note !== note) await update($, waitNote, () => next.note ?? null)
      if (next.letting !== undefined && JSON.stringify(next.letting) !== JSON.stringify(going))
        await update($, letting, () => next.letting ?? null)
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

        // Let go already: a reading that fails after it must not make the shift look not made.
        const after = await $.session.usage().then(
          usage => usage.context.tokens,
          () => undefined,
        )

        return { messages: done.messages, before: done.tokensBefore, after: after ?? done.tokensAfter }
      },
      continueWith: async prompt => {
        const submitted = await $.prompt.submit({ text: prompt })
        if ('drop' in submitted) throw new Error(`the message was dropped: ${submitted.drop}`)
      },
      // The session's files and the doctrine as the shift left them: the settings may have moved a record.
      afterLetGo: async () => {
        // The tocs are not refreshed here: a document a script changed gets its toc with the next prompt's note.
        const loaded = renderSessionFiles(await sessionFiles(project, { refresh: false }))
        await update($, files, () => loaded)
        await update($, doctrineText, () => sessionDoctrine(project.settings).doctrine)
      },
    },
    aborted,
  )
}
