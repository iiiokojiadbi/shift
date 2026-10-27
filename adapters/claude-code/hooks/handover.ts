import type { EngineInterface } from 'claude-code'
import { atom, read, update } from 'claude-code'
import { afterTurn, FRESH_LOOP, type Loop, renderSessionFiles, sessionDoctrine, sessionFiles } from './core/index'
import { projectOf } from './disk'

// The engine lists a module's state from atoms declared in the same file, so each file declares the ones it touches.
const loop = atom({ plugin: 'shift', key: 'loop' } as const, FRESH_LOOP)
const files = atom({ plugin: 'shift', key: 'files' } as const, null)
const doctrineText = atom({ plugin: 'shift', key: 'doctrine' } as const, null)

// The shift loop's state in the plugin's atoms; rows in the transcript.
export function loopOf($: EngineInterface): Loop {
  return {
    read: () => read($, loop),
    // One update of one atom: a change that claims the shift, or marks the owner heard, is never split.
    update: async change => {
      await update($, loop, change)
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
