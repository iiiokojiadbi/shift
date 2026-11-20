import { CLOSED, NAME, RECENT_CLOSED_ITEMS } from './layout'
import type { Project } from './project'
import type { ArchiveInput, OpenInput, TrackInput } from './types'

type GraphItem = { id: number; name: string; status: string; note: string | null; created: number; closed: number | null }
type Relation = { id: string; title: string; status: string; dependency_type: string }
export type GraphTask = {
  id: string
  title: string
  status: string
  issue_type: string
  revision?: string
  design?: string
  notes?: string
  description?: string
  acceptance_criteria?: string
  assignee?: string
  labels?: string[]
  comment_count?: number
  dependencies?: Relation[]
  metadata?: { items?: GraphItem[]; about?: string; links?: OpenInput['links'] }
}
export const graphPath = (project: Project) => `${project.root}/.shift/beads/.beads/metadata.json`

export function taskId(raw: unknown): string {
  if (typeof raw !== 'string' || !NAME.test(raw)) throw new Error('Pass a task ID or its short name.')
  return raw.startsWith('shift-') ? raw : `shift-${raw}`
}

function labels(raw: unknown): string[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.some(each => typeof each !== 'string' || !each.trim() || /[,\r\n]/.test(each)))
    throw new Error('Pass labels as an array of nonempty names without commas.')
  return [...new Set(raw.map(each => each.trim()))]
}

export async function graphCommand(project: Project, args: string[], actor?: string, expected: GraphTask[] = []): Promise<string> {
  if (!project.store.beads) throw new Error('The private task runtime is unavailable.')
  const invocation = actor ? [...args.slice(0, 1), `--actor=${actor}`, ...args.slice(1)] : args
  if (!expected.length) return project.store.beads(project.root, invocation)
  const revisions = expected.map(task => {
    if (!task.revision) throw new Error(`Missing revision for ${task.id}.`)
    return { id: task.id, revision: task.revision }
  })
  return project.store.beads(project.root, ['shift-checked', JSON.stringify(revisions), ...invocation])
}

export async function graphTask(project: Project, id: string): Promise<GraphTask> {
  if (!(await project.store.exists(graphPath(project)))) throw new Error('No task workspace yet.')
  const rows = JSON.parse(await graphCommand(project, ['show', taskId(id), '--brief-deps', '--json'])) as GraphTask[]
  if (rows.length !== 1 || rows[0]?.id !== taskId(id)) throw new Error(`No exact task ${taskId(id)}.`)
  return rows[0]
}

function line(task: GraphTask): string {
  return `${task.id} [${task.status}] ${task.title}${task.assignee ? ` · ${task.assignee}` : ''}${task.labels?.length ? ` · ${task.labels.join(', ')}` : ''}`
}

export function taskCard(task: GraphTask): string {
  const items = task.metadata?.items ?? []
  const closed = items.filter(item => CLOSED.has(item.status)).sort((a, b) => (b.closed ?? 0) - (a.closed ?? 0) || b.id - a.id)
  const links = task.metadata?.links ?? []
  return [
    line(task),
    task.description && `Goal: ${task.description}`,
    task.acceptance_criteria && `Done when: ${task.acceptance_criteria}`,
    task.design && `Decisions: ${task.design}`,
    task.notes && `Evidence: ${task.notes}`,
    task.metadata?.about,
    ...(task.dependencies ?? []).map(edge => {
      const link = links.find(each => taskId(each.name) === edge.id)
      return `${link?.kind ?? edge.dependency_type}: ${edge.id} [${edge.status}] ${edge.title}${link?.why ? ` — ${link.why}` : ''}`
    }),
    ...[...items.filter(item => !CLOSED.has(item.status)), ...closed.slice(0, RECENT_CLOSED_ITEMS)].map(
      item => `#${item.id} [${item.status}] ${item.name}${item.note ? ` — ${item.note}` : ''}`,
    ),
    `${closed.length} closed items · ${task.comment_count ?? 0} comments`,
  ]
    .filter(Boolean)
    .join('\n')
}

export async function createGraphTask(project: Project, input: OpenInput, raw: Record<string, unknown>, actor: string, now: number) {
  const tags = labels(raw.labels)
  const id = taskId(input.name)
  const kind = raw.kind ?? 'task'
  if (kind !== 'task' && kind !== 'epic') throw new Error('kind must be task or epic.')
  const parent = raw.parent === undefined ? null : taskId(raw.parent)
  const names = input.items.map(each => each.name.toLowerCase())
  if (names.length !== new Set(names).size) throw new Error('Each initial item needs a distinct name.')
  if (!(await project.store.exists(graphPath(project))))
    await graphCommand(project, ['init', '--init-if-missing', '--non-interactive', '--skip-hooks', '--skip-agents', '--prefix', 'shift'])
  const deps: string[] = []
  const expected: GraphTask[] = []
  for (const link of input.links) {
    const target = await graphTask(project, link.name)
    if ((link.kind === 'needs') === (target.status === 'closed')) throw new Error(`${link.kind}: ${target.id} is ${target.status}.`)
    expected.push(target)
    deps.push(`${link.kind === 'needs' ? 'blocked-by' : 'related'}:${target.id}`)
  }
  if (parent) {
    const epic = await graphTask(project, parent)
    if (epic.issue_type !== 'epic' || epic.status === 'closed') throw new Error(`Parent ${parent} must be an open epic.`)
    expected.push(epic)
    deps.push(`parent-child:${parent}`)
  }
  const items: GraphItem[] = input.items.map((each, i) => ({ ...each, id: i + 1, status: 'open', created: now, closed: null }))
  const status = input.status === 'in progress' ? 'in_progress' : input.status === 'waiting for owner' ? 'blocked' : input.status
  const args = [
    'create',
    `--id=${id}`,
    `--title=${input.title}`,
    `--description=${input.goal}`,
    `--acceptance=${input.doneWhen}`,
    `--type=${kind}`,
    `--status=${status}`,
    `--metadata=${JSON.stringify({ items, about: input.about, links: input.links })}`,
    '--json',
  ]
  if (status === 'in_progress') args.push(`--assignee=${actor}`)
  if (tags.length) args.push(`--labels=${tags.join(',')}`)
  if (deps.length) args.push(`--deps=${deps.join(',')}`)
  const task = JSON.parse(await graphCommand(project, args, actor, expected)) as GraphTask
  return `${line(task)}${items.length ? `\n${items.map(each => `#${each.id} ${each.name}`).join('\n')}` : ''}`
}

export async function queryGraph(project: Project, raw: Record<string, unknown>, actor: string) {
  const view = raw.view ?? 'mine'
  if (view === 'show') return taskCard(await graphTask(project, taskId(raw.task)))
  if (view === 'history' || view === 'comments') {
    const text = await graphCommand(project, [view, taskId(raw.task), '--json'])
    return text.trim()
  }
  if (!['mine', 'ready', 'open', 'closed', 'cards'].includes(String(view)))
    throw new Error('Choose mine, ready, open, closed, show, comments or history.')
  const tags = labels(raw.labels)
  if (!(await project.store.exists(graphPath(project)))) return 'No tasks.'
  const args = [view === 'ready' ? 'ready' : 'list', '--json', '--brief', '--limit=0']
  if (view === 'closed') args.push('--status=closed', '--all')
  if (view === 'mine' || view === 'cards') args.push(`--assignee=${actor}`)
  if (tags.length) args.push(`--label=${tags.join(',')}`)
  const tasks = JSON.parse(await graphCommand(project, args)) as GraphTask[]
  if (view === 'cards') {
    if (!tasks.length) return 'No tasks claimed by this chat.'
    const full = JSON.parse(
      await graphCommand(project, ['show', '--brief-deps', '--json', ...tasks.map(t => `--id=${t.id}`)]),
    ) as GraphTask[]
    return full.map(taskCard).join('\n\n')
  }
  return tasks.map(line).join('\n') || 'No tasks.'
}

function editable(task: GraphTask, actor: string) {
  if (task.status === 'closed') throw new Error(`Reopen ${task.id} before editing it.`)
  if (task.assignee && task.assignee !== actor) throw new Error(`${task.id} belongs to ${task.assignee}. Take over explicitly to edit it.`)
}

export async function trackGraph(project: Project, input: TrackInput, actor: string, now: number) {
  const task = await graphTask(project, input.task)
  editable(task, actor)
  const items = (task.metadata?.items ?? []).map(each => ({ ...each }))
  const receipts: string[] = []
  let next = items.reduce((max, item) => Math.max(item.id, max), 0) + 1
  for (const change of input.items) {
    let item: GraphItem
    if ('id' in change) {
      const found = items.find(each => each.id === change.id)
      if (!found) throw new Error(`${task.id} has no item #${change.id}. Nothing written.`)
      item = found
    } else {
      if (items.some(each => each.name.toLowerCase() === change.item.toLowerCase()))
        throw new Error(`Duplicate item: ${change.item}. Nothing written.`)
      item = { id: next++, name: change.item, status: change.status, created: now, closed: null, note: null }
      items.push(item)
    }
    item.status = change.status
    item.note = change.note ?? item.note
    item.closed = CLOSED.has(change.status) ? (item.closed ?? now) : null
    receipts.push(`#${item.id} [${item.status}]`)
  }
  const args = [
    'update',
    task.id,
    `--metadata=${JSON.stringify({ ...task.metadata, items, ...(input.own?.note ? { about: input.own.note } : {}) })}`,
  ]
  if (input.own) {
    const status = input.own.status === 'in progress' ? 'in_progress' : input.own.status === 'deferred' ? 'deferred' : 'blocked'
    args.push(`--status=${status}`, `--assignee=${status === 'in_progress' ? actor : ''}`)
    receipts.push(status)
  }
  await graphCommand(project, args, actor, [task])
  return `${task.id}: ${receipts.join(', ')}`
}

export async function closeGraph(project: Project, input: ArchiveInput, actor: string) {
  const task = await graphTask(project, input.name)
  editable(task, actor)
  if (input.outcome === 'done' && task.metadata?.items?.some(each => !CLOSED.has(each.status)))
    throw new Error('Close the remaining items first.')
  await graphCommand(project, ['close', task.id, `--reason=${input.outcome}: ${input.about}`], actor, [task])
  return `${task.id} closed (${input.outcome}).`
}

export async function manageGraph(project: Project, raw: Record<string, unknown>, actor: string) {
  const task = await graphTask(project, taskId(raw.task))
  const action = raw.action
  let args: string[]
  if (action === 'reopen') {
    if (task.status !== 'closed') throw new Error(`${task.id} is already open.`)
    args = ['reopen', task.id]
  } else {
    if (task.status === 'closed') throw new Error(`Reopen ${task.id} before editing it.`)
    switch (action) {
      case 'comment': {
        if (typeof raw.text !== 'string' || !raw.text.trim()) throw new Error('Pass a nonempty comment in text.')
        args = ['comments', 'add', `--author=${actor}`, '--', task.id, raw.text]
        break
      }
      case 'block':
      case 'unblock': {
        editable(task, actor)
        const target = await graphTask(project, taskId(raw.target))
        if (target.id === task.id) throw new Error('A task cannot block itself.')
        if (action === 'block' && target.status === 'closed') throw new Error(`${target.id} is already closed.`)
        if (action === 'unblock' && !task.dependencies?.some(each => each.id === target.id && each.dependency_type === 'blocks'))
          throw new Error(`${target.id} is not an active blocker of ${task.id}.`)
        args = ['dep', action === 'block' ? 'add' : 'remove', task.id, target.id]
        await graphCommand(project, args, actor, [task, target])
        return `${task.id}: ${action} ${target.id}.`
      }
      case 'takeover':
        args = ['update', task.id, '--force', `--assignee=${actor}`, '--status=in_progress']
        break
      case 'claim':
        editable(task, actor)
        args = ['update', task.id, '--claim']
        break
      case 'release':
        editable(task, actor)
        args = ['update', task.id, '--assignee=', '--status=open']
        break
      case 'edit': {
        editable(task, actor)
        args = ['update', task.id]
        for (const [key, flag] of [
          ['goal', 'description'],
          ['done_when', 'acceptance'],
          ['title', 'title'],
          ['decisions', 'design'],
          ['evidence', 'notes'],
        ] as const) {
          const value = raw[key]
          if (value !== undefined) {
            if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} needs text.`)
            args.push(`--${flag}=${value}`)
          }
        }
        if (raw.labels !== undefined) args.push(`--set-labels=${labels(raw.labels).join(',')}`)
        if (args.length === 2) throw new Error('Provide at least one field or labels to edit.')
        break
      }
      default:
        throw new Error('Choose claim, takeover, release, reopen, edit or comment.')
    }
  }
  await graphCommand(project, args, actor, [task])
  return `${task.id}: ${action} completed.`
}

// A comment advances the graph generation even when the issue's updated_at is unchanged.
export async function graphGeneration(p: Project): Promise<string> {
  if (!(await p.store.exists(graphPath(p)))) return ''
  const status = JSON.parse(await graphCommand(p, ['vc', 'status', '--json']))
  if (typeof status.commit !== 'string' || !status.commit) throw new Error('Missing private graph generation.')
  return status.commit
}

// Observe comments on claimed work. Only a changed count needs the comment bodies
// to distinguish this chat's writes from another writer's.
export async function commentChanges(project: Project, previous: Record<string, number> | undefined) {
  const actor = project.actor
  if (!actor || !(await project.store.exists(graphPath(project)))) return null
  const tasks = JSON.parse(await graphCommand(project, ['list', `--assignee=${actor}`, '--json', '--brief', '--limit=0'])) as GraphTask[]
  const counts: Record<string, number> = {}
  const notes: string[] = []
  for (const task of tasks) {
    const count = task.comment_count ?? 0
    counts[task.id] = count
    const prior = previous?.[task.id]
    if (prior === undefined || count <= prior) continue
    const comments = JSON.parse(await graphCommand(project, ['comments', task.id, '--json'])) as { author: string }[]
    const outside = comments.slice(prior, count).filter(c => c.author !== actor).length
    if (outside)
      notes.push(`${task.id}: ${outside} new external comment${outside === 1 ? '' : 's'}. Read with task_query(view="comments").`)
  }
  if (previous && Object.keys(previous).length === tasks.length && tasks.every(t => previous[t.id] === counts[t.id])) return null
  return { counts, notes }
}
