import type { EngineInterface, PromptSubmitArgs } from 'claude-code'
import { atom, read, update } from 'claude-code'
import type { LetGoDone } from '../types/index'
import { afterTurn, FRESH_LOOP, type Loop, type Project, renderSessionFiles, sessionDoctrine, sessionFiles } from './core/index'
import { projectOf } from './disk'

// The engine lists a module's state from atoms declared in the same file, so each file declares the ones it touches.
const loop = atom({ plugin: 'shift', key: 'loop' } as const, FRESH_LOOP)
const files = atom({ plugin: 'shift', key: 'files' } as const, null)
const doctrineText = atom({ plugin: 'shift', key: 'doctrine' } as const, null)
// The message the compaction's replacement history takes, and what that compaction gave back: the compact hook reads
// the first and writes the second while this let-go runs.
const carry = atom({ plugin: 'shift', key: 'carry' } as const, null as { text: string; instructions: string } | null)
const letGoDone = atom({ plugin: 'shift', key: 'letGoDone' } as const, null as LetGoDone | null)

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
      letGo: async (instructions, message) => {
        // A message that can ride in the compaction's replacement history goes there, and the turn starts from one
        // line. The engine raises this plugin's own `session.compact` hook only when the compaction is not the
        // plugin's own call, so with a message to carry the let-go runs the built-in /compact as a command
        // (register.ts appends it); otherwise, or when the command is refused, the history is let go directly.
        if (message !== undefined) {
          // The session block reads the records before the letter is in the history: a turn admitted right after the
          // compaction has no other moment to get it, and the letter says the block was read again.
          await refresh($, project)
          const carried = await compactWithMessage($, instructions, message)
          if (carried !== null) {
            // Let go already: a reading that fails after it must not make the shift look not made.
            const after = await $.session.usage().then(
              usage => usage.context.tokens,
              () => undefined,
            )

            return { messages: carried.messages, before: carried.tokensBefore, after: after ?? carried.tokensAfter ?? 0, carried: true }
          }
        }
        const done = await $.session.compact({ instructions })
        if (done.messages === undefined) return { skip: done.skip ?? 'the harness did not let the history go' }

        // Let go already: a reading that fails after it must not make the shift look not made.
        const after = await $.session.usage().then(
          usage => usage.context.tokens,
          () => undefined,
        )

        return { messages: done.messages, before: done.tokensBefore, after: after ?? done.tokensAfter }
      },
      continueWith: async (prompt, attachments) => {
        // What the owner's held messages carried goes as they gave it.
        const carried = attachments as PromptSubmitArgs['attachments']
        const submitted = await $.prompt.submit(carried === undefined ? { text: prompt } : { text: prompt, attachments: carried })
        if ('drop' in submitted) throw new Error(`the message was dropped: ${submitted.drop}`)
      },
      // The session's files and the doctrine as the shift left them: the settings may have moved a record.
      afterLetGo: async () => refresh($, project),
    },
    aborted,
  )
}

// The let-go with a message to carry: the built-in /compact run as a command, its hook (register.ts) appending the
// message, and what the engine gave back — null when the command was refused or the compaction was skipped, so the
// caller lets the history go the plain way.
async function compactWithMessage($: EngineInterface, instructions: string, message: string): Promise<LetGoDone | null> {
  await update($, carry, () => ({ text: message, instructions }))
  await update($, letGoDone, () => null)
  const ran = await $.command.run({ command: 'compact', args: instructions }).then(
    () => true,
    () => false,
  )
  // Cleared whatever happened: a compaction later must append nothing.
  await update($, carry, () => null)

  return ran ? read($, letGoDone) : null
}

// The session's files and the doctrine as the records are now: read at the session's start, before a carried message
// is exposed to queued turns, and again once the shift settled.
async function refresh($: EngineInterface, project: Project): Promise<void> {
  // The tocs are not refreshed here: a document a script changed gets its toc with the next prompt's note.
  const loaded = renderSessionFiles(await sessionFiles(project, { refresh: false }))
  await update($, files, () => loaded)
  await update($, doctrineText, () => sessionDoctrine(project.settings).doctrine)
}
