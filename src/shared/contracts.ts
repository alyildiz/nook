import { z } from 'zod'

export const ConnectionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  baseUrl: z
    .url()
    .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol)),
  models: z.array(z.string().trim().min(1).max(200)).max(100),
  contextWindow: z.number().int().min(1024).max(10000000).default(32768)
})
export const AgentSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  color: z.enum(['mint', 'amber', 'violet', 'blue', 'coral']),
  instructions: z.string().max(50000),
  connectionId: z.string().uuid().nullable(),
  model: z.string().max(200),
  skills: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([])
})
export const MessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string().max(2000000),
  createdAt: z.string(),
  incomplete: z.boolean().optional()
})
export const ConversationSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  messages: z.array(MessageSchema),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional()
})
export const StateSchema = z.object({
  agents: z.array(AgentSchema),
  connections: z.array(ConnectionSchema),
  conversations: z.array(ConversationSchema)
})
export type Agent = z.infer<typeof AgentSchema>
export type Connection = z.infer<typeof ConnectionSchema>
export type Conversation = z.infer<typeof ConversationSchema>
export type Message = z.infer<typeof MessageSchema>
export type State = z.infer<typeof StateSchema>
export type ChatEvent = {
  runId: string
  delta?: string
  done?: boolean
  error?: string
  state?: State
}
export interface NookAPI {
  load(): Promise<State>
  saveAgent(agent: Agent): Promise<State>
  saveConnection(connection: Connection, apiKey?: string): Promise<State>
  discoverModels(
    baseUrl: string,
    apiKey?: string,
    connectionId?: string
  ): Promise<string[]>
  send(agentId: string, content: string, runId: string): Promise<void>
  stop(runId: string): Promise<void>
  onChat(listener: (event: ChatEvent) => void): () => void
}
