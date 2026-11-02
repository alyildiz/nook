import { shell } from 'electron'
import { z } from 'zod'
import type { CredentialStore, Context } from '@earendil-works/pi-ai'
import type { ChatGPTAuthEvent, Connection, Message } from '../shared/contracts'
import {
  assertSecureStorage,
  getKey,
  hasKey,
  setKey,
  load,
  save
} from './store'

const PROVIDER = 'openai-codex'
const BASE_URL = 'https://chatgpt.com/backend-api'
const SECRET_ID = 'chatgpt-oauth'
const CredentialSchema = z
  .object({
    type: z.literal('oauth'),
    access: z.string().min(1),
    refresh: z.string().min(1),
    expires: z.number().finite(),
    accountId: z.string().min(1)
  })
  .passthrough()
let lock: Promise<unknown> = Promise.resolve()
const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
  const result = lock.then(fn, fn)
  lock = result.catch(() => {})
  return result
}
const readCredential = () => {
  const value = getKey(SECRET_ID)
  return value ? CredentialSchema.parse(JSON.parse(value)) : undefined
}
const credentials: CredentialStore = {
  read: async (id) => (id === PROVIDER ? readCredential() : undefined),
  list: async () =>
    hasKey(SECRET_ID) ? [{ providerId: PROVIDER, type: 'oauth' as const }] : [],
  modify: async (id, fn) =>
    serialized(async () => {
      if (id !== PROVIDER) throw new Error('Unsupported credential provider')
      const current = readCredential()
      const next = await fn(current)
      if (next) setKey(SECRET_ID, JSON.stringify(CredentialSchema.parse(next)))
      return next || current
    }),
  delete: async (id) =>
    serialized(async () => {
      if (id === PROVIDER) setKey(SECRET_ID, '')
    })
}
let runtime: ReturnType<typeof createRuntime> | undefined
async function createRuntime() {
  const [{ createModels }, { openaiCodexProvider }] = await Promise.all([
    import('@earendil-works/pi-ai/models'),
    import('@earendil-works/pi-ai/providers/openai-codex')
  ])
  const models = createModels({
    credentials,
    // A subscription connection must never fall back to a paid API key from the environment.
    authContext: { env: async () => undefined, fileExists: async () => false },
    identity: { userAgent: { custom: 'Nook' }, attribution: null }
  })
  models.setProvider(openaiCodexProvider())
  return models
}
const getRuntime = () => (runtime ||= createRuntime())
type LoginSession = {
  controller: AbortController
  url?: string
  manual?: (value: string) => void
}
let login: LoginSession | undefined

async function openLoginUrl(url: string) {
  const parsed = new URL(url)
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'auth.openai.com' ||
    parsed.pathname !== '/oauth/authorize'
  ) {
    throw new Error('Adresse d’authentification OpenAI non autorisée.')
  }
  await shell.openExternal(url)
}
export function cancelLogin() {
  login?.controller.abort()
}
export async function reopenLogin() {
  if (!login?.url) throw new Error('Aucune connexion en cours.')
  await openLoginUrl(login.url)
}
export function submitCallback(raw: string) {
  if (!login?.manual || !login.url)
    throw new Error('Aucune connexion en cours.')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Collez l’adresse complète de retour du navigateur.')
  }
  const expected = new URL(login.url)
  const redirect = new URL(expected.searchParams.get('redirect_uri')!)
  if (
    url.origin !== redirect.origin ||
    url.pathname !== redirect.pathname ||
    url.searchParams.get('state') !== expected.searchParams.get('state') ||
    !url.searchParams.get('code')
  ) {
    throw new Error(
      'Cette adresse ne correspond pas à la connexion en cours. Recommencez depuis Nook.'
    )
  }
  login.manual(url.toString())
}
export async function loginChatGPT(emit: (event: ChatGPTAuthEvent) => void) {
  if (login) throw new Error('Une connexion ChatGPT est déjà en cours.')
  assertSecureStorage()
  const pending: LoginSession = { controller: new AbortController() }
  login = pending
  const timer = setTimeout(() => pending.controller.abort(), 10 * 60 * 1000)
  try {
    const models = await getRuntime()
    await models.login(
      PROVIDER,
      'oauth',
      {
        signal: pending.controller.signal,
        prompt: async (prompt) => {
          if (prompt.type === 'select') return 'browser'
          if (prompt.type !== 'manual_code')
            throw new Error('Unsupported authentication prompt')
          return new Promise<string>((resolve, reject) => {
            const signal = prompt.signal || pending.controller.signal
            const onAbort = () => {
              pending.manual = undefined
              reject(new Error('Login cancelled'))
            }
            if (signal.aborted) {
              onAbort()
              return
            }
            signal.addEventListener('abort', onAbort, { once: true })
            pending.manual = (value) => {
              signal.removeEventListener('abort', onAbort)
              pending.manual = undefined
              resolve(value)
            }
          })
        },
        notify: (event) => {
          if (event.type === 'auth_url') {
            pending.url = event.url
            emit({
              status: 'waiting',
              message: 'Autorisez Nook dans votre navigateur, puis revenez ici.'
            })
            // Browser opening can fail on headless hosts; keep the retry/manual UI usable.
            void openLoginUrl(event.url).catch(() =>
              emit({
                status: 'waiting',
                message:
                  'Le navigateur n’a pas pu s’ouvrir. Réessayez avec le bouton ci-dessous.'
              })
            )
          }
          if (event.type === 'progress')
            emit({
              status: 'exchanging',
              message: 'Finalisation de la connexion…'
            })
        }
      },
      { agentName: 'Nook' }
    )
    const state = load()
    const previous = state.connections.find((c) => c.kind === 'chatgpt')
    const catalog = models.getModels(PROVIDER)
    const connection: Connection = {
      id: previous?.id || crypto.randomUUID(),
      name: 'ChatGPT · Mon abonnement',
      kind: 'chatgpt',
      authenticated: true,
      baseUrl: BASE_URL,
      models: catalog.map((m) => m.id),
      modelContexts: Object.fromEntries(
        catalog.map((m) => [m.id, m.contextWindow])
      ),
      contextWindow: catalog[0]?.contextWindow || 272000
    }
    if (previous)
      state.connections[state.connections.indexOf(previous)] = connection
    else state.connections.push(connection)
    save(state)
    return state
  } catch (error) {
    if (pending.controller.signal.aborted)
      throw new Error(
        'Connexion annulée ou délai dépassé. Vous pouvez réessayer.'
      )
    // Provider errors may contain token responses. Never forward raw OAuth errors to the renderer.
    throw new Error(
      'La connexion ChatGPT a échoué. Vérifiez l’autorisation dans le navigateur, puis réessayez.'
    )
  } finally {
    clearTimeout(timer)
    if (login === pending) login = undefined
  }
}
export async function logoutChatGPT() {
  if (login)
    throw new Error('Annulez la connexion en cours avant de vous déconnecter.')
  const models = await getRuntime()
  await models.logout(PROVIDER)
  const state = load()
  for (const connection of state.connections)
    if (connection.kind === 'chatgpt') connection.authenticated = false
  save(state)
  return state
}
export async function streamChatGPT(
  connection: Connection,
  modelId: string,
  instructions: string,
  history: Message[],
  signal: AbortSignal,
  onDelta: (text: string) => void
): Promise<{ input: number; output: number }> {
  if (!connection.authenticated || !readCredential())
    throw new Error('Reconnectez votre abonnement ChatGPT dans les paramètres.')
  const models = await getRuntime()
  const model = models.getModel(PROVIDER, modelId)
  if (!model)
    throw new Error(
      'Ce modèle ne figure plus dans le catalogue ChatGPT. Choisissez-en un autre dans les paramètres de l’agent.'
    )
  const context: Context = {
    systemPrompt: instructions,
    messages: history
      .filter((m) => m.content)
      .map((m) =>
        m.role === 'user'
          ? {
              role: 'user',
              content: m.content,
              timestamp: Date.parse(m.createdAt)
            }
          : {
              role: 'assistant',
              content: [{ type: 'text', text: m.content }],
              api: 'openai-codex-responses',
              provider: PROVIDER,
              model: modelId,
              stopReason: m.incomplete ? 'aborted' : 'stop',
              timestamp: Date.parse(m.createdAt),
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  total: 0
                }
              }
            }
      )
  }
  let responseStatus: number | undefined
  const stream = models.stream(model, context, {
    signal,
    transport: 'sse',
    maxRetries: 0,
    onResponse: (response) => {
      responseStatus = response.status
    }
  })
  let usage: { input: number; output: number } | undefined
  for await (const event of stream) {
    if (event.type === 'text_delta') onDelta(event.delta)
    if (event.type === 'error') {
      if (signal.aborted) throw new Error('Réponse arrêtée.')
      const message = event.error.errorMessage || ''
      if (
        responseStatus === 401 ||
        responseStatus === 403 ||
        /401|403|refresh|oauth|unauthorized|expired|invalid_grant/i.test(
          message
        )
      ) {
        throw new Error(
          'La session ChatGPT a expiré ou l’accès est refusé. Reconnectez votre compte dans les paramètres.'
        )
      }
      if (
        responseStatus === 429 ||
        /429|quota|usage.limit|rate.limit/i.test(message)
      )
        throw new Error(
          'La limite de votre abonnement ChatGPT est atteinte. Réessayez plus tard.'
        )
      if (/not.supported|not.found|model/i.test(message))
        throw new Error(
          'Ce modèle n’est pas accessible avec votre compte ChatGPT. Essayez un autre modèle.'
        )
      throw new Error(
        'ChatGPT n’a pas terminé la réponse. Vérifiez votre connexion et les droits de votre abonnement, puis réessayez.'
      )
    }
    if (event.type === 'done') {
      if (event.reason !== 'stop')
        throw new Error(
          'La réponse ChatGPT est incomplète. Vous pouvez demander de poursuivre.'
        )
      usage = {
        input:
          event.message.usage.input +
          event.message.usage.cacheRead +
          event.message.usage.cacheWrite,
        output: event.message.usage.output
      }
    }
  }
  if (!usage)
    throw new Error(
      'La connexion ChatGPT a été interrompue avant la fin de la réponse.'
    )
  return usage
}
