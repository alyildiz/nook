import { app, safeStorage } from 'electron'
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync
} from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import {
  AgentSchema,
  StateSchema,
  type State,
  type Agent
} from '../shared/contracts'

const directory = () => process.env.NOOK_DATA_DIR || app.getPath('userData')
function writeAtomic(path: string, value: string) {
  writeFileSync(`${path}.tmp`, value, { mode: 0o600 })
  renameSync(`${path}.tmp`, path)
}
export function load(): State {
  mkdirSync(join(directory(), 'agents'), { recursive: true })
  const path = join(directory(), 'state.json')
  if (!existsSync(path)) {
    const agent: Agent = {
      version: 1,
      id: crypto.randomUUID(),
      name: 'Assistant',
      color: 'mint',
      instructions:
        'You are a helpful personal assistant. Reply in the user’s language. Be clear about uncertainty.',
      connectionId: null,
      model: '',
      skills: [],
      tools: []
    }
    const state = { agents: [agent], connections: [], conversations: [] }
    save(state)
    return state
  }
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const order: string[] = Array.isArray(data.agentOrder) ? data.agentOrder : []
  const agents = readdirSync(join(directory(), 'agents'))
    .filter((name) => name.endsWith('.yaml'))
    .map((name) =>
      parseAgentYaml(readFileSync(join(directory(), 'agents', name), 'utf8'))
    )
    .sort((a, b) => {
      const ai = order.indexOf(a.id),
        bi = order.indexOf(b.id)
      return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi)
    })
  return StateSchema.parse({ ...data, agents })
}
export function save(state: State) {
  mkdirSync(directory(), { recursive: true })
  const validated = StateSchema.parse(state)
  mkdirSync(join(directory(), 'agents'), { recursive: true })
  for (const agent of validated.agents) {
    writeAtomic(
      join(directory(), 'agents', `${agent.id}.yaml`),
      stringify(agent)
    )
  }
  const { agents: _agents, ...data } = validated
  writeAtomic(
    join(directory(), 'state.json'),
    JSON.stringify(
      { ...data, agentOrder: validated.agents.map((a) => a.id) },
      null,
      2
    )
  )
}
export function saveAgent(agent: Agent) {
  const value = AgentSchema.parse(agent)
  const state = load()
  const index = state.agents.findIndex((a) => a.id === value.id)
  if (index < 0) state.agents.push(value)
  else state.agents[index] = value
  save(state)
  return state
}
export function getKey(id: string): string {
  const path = join(directory(), 'credentials.json')
  if (!existsSync(path)) return ''
  const keys = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>
  return keys[id]
    ? safeStorage.decryptString(Buffer.from(keys[id], 'base64'))
    : ''
}
export function setKey(id: string, key: string) {
  const path = join(directory(), 'credentials.json')
  const keys: Record<string, string> = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8'))
    : {}
  if (key) {
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' &&
        safeStorage.getSelectedStorageBackend() === 'basic_text')
    ) {
      throw new Error(
        'Le coffre-fort système est indisponible. La clé ne sera pas enregistrée en clair.'
      )
    }
    keys[id] = safeStorage.encryptString(key).toString('base64')
  } else delete keys[id]
  writeAtomic(path, JSON.stringify(keys))
}
export const parseAgentYaml = (text: string) => AgentSchema.parse(parse(text))
