import { z } from 'zod'
import { load, save, getKey } from './store'
import type { ChatEvent, Conversation } from '../shared/contracts'

const runs = new Map<string, AbortController>()
const busyAgents = new Set<string>()
const DeltaSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({ content: z.string().nullable().optional() })
          .optional(),
        finish_reason: z.string().nullable().optional()
      })
    )
    .optional(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional()
    })
    .nullable()
    .optional(),
  error: z.object({ message: z.string() }).optional()
})
export const endpoint = (base: string, path: string) =>
  `${base.replace(/\/+$/, '')}/${path}`
export function stop(runId: string) {
  runs.get(runId)?.abort()
}
export async function send(
  agentId: string,
  content: string,
  runId: string,
  emit: (event: ChatEvent) => void
) {
  if (runs.has(runId) || busyAgents.has(agentId))
    throw new Error('Cet agent répond déjà.')
  const state = load()
  const agent = state.agents.find((a) => a.id === agentId)
  const connection = state.connections.find((c) => c.id === agent?.connectionId)
  if (!agent || !connection || !agent.model)
    throw new Error(
      'Choisissez une connexion et un modèle dans les paramètres de cet agent.'
    )
  let conversation = state.conversations.find((c) => c.agentId === agentId)
  if (!conversation) {
    conversation = { id: crypto.randomUUID(), agentId, messages: [] }
    state.conversations.push(conversation)
  }
  const current = conversation
  const now = new Date().toISOString()
  current.messages.push({
    id: crypto.randomUUID(),
    role: 'user',
    content,
    createdAt: now
  })
  const messages = [
    { role: 'system', content: agent.instructions },
    ...current.messages.map((m) => ({ role: m.role, content: m.content }))
  ]
  const reply = {
    id: crypto.randomUUID(),
    role: 'assistant' as const,
    content: '',
    createdAt: now,
    incomplete: true
  }
  current.messages.push(reply)
  save(state)
  const controller = new AbortController()
  runs.set(runId, controller)
  busyAgents.add(agentId)
  emit({ runId, state })
  let receivedEnd = false
  const persist = () => {
    const latest = load()
    const index = latest.conversations.findIndex((c) => c.id === current.id)
    if (index >= 0) latest.conversations[index] = current
    save(latest)
    return latest
  }
  try {
    const key = getKey(connection.id)
    const response = await fetch(
      endpoint(connection.baseUrl, 'chat/completions'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { Authorization: `Bearer ${key}` } : {})
        },
        body: JSON.stringify({
          model: agent.model,
          messages,
          stream: true,
          stream_options: { include_usage: true }
        }),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(180000)
        ])
      }
    )
    if (!response.ok)
      throw new Error(
        `Le fournisseur a retourné HTTP ${response.status}. Vérifiez la connexion, le modèle et vos droits d’accès.`
      )
    if (!response.body)
      throw new Error('Le fournisseur n’a pas renvoyé de flux.')
    let buffer = ''
    const processEvent = (event: string) => {
      const data = event
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n')
        .trim()
      if (!data) return
      if (data === '[DONE]') {
        receivedEnd = true
        return
      }
      const parsed = DeltaSchema.parse(JSON.parse(data))
      if (parsed.error)
        throw new Error(
          'Le fournisseur a interrompu la réponse. Vérifiez votre connexion et vos quotas.'
        )
      const choice = parsed.choices?.[0]
      if (choice?.finish_reason) receivedEnd = true
      const delta = choice?.delta?.content
      if (delta) {
        reply.content += delta
        emit({ runId, delta })
      }
      if (parsed.usage) {
        current.inputTokens = parsed.usage.prompt_tokens
        current.outputTokens = parsed.usage.completion_tokens
      }
    }
    for await (const chunk of response.body.pipeThrough(
      new TextDecoderStream()
    )) {
      buffer += chunk
      // SSE boundaries may be split across network chunks, including CRLF pairs.
      let match: RegExpExecArray | null
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        processEvent(buffer.slice(0, match.index).replace(/\r\n/g, '\n'))
        buffer = buffer.slice(match.index + match[0].length)
      }
    }
    if (buffer.trim()) processEvent(buffer.replace(/\r\n/g, '\n'))
    if (!receivedEnd)
      throw new Error('La connexion a été coupée avant la fin de la réponse.')
    reply.incomplete = false
    emit({ runId, done: true, state: persist() })
  } catch (error) {
    emit({
      runId,
      done: true,
      error: controller.signal.aborted
        ? 'Réponse arrêtée.'
        : error instanceof Error
          ? error.message
          : 'La réponse a échoué.',
      state: persist()
    })
  } finally {
    runs.delete(runId)
    busyAgents.delete(agentId)
  }
}
