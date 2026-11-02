import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication
} from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function launch(directory: string) {
  const app = await electron.launch({
    executablePath: process.env.NOOK_TEST_EXECUTABLE,
    args: process.env.NOOK_TEST_EXECUTABLE
      ? ['--no-sandbox']
      : ['out/main/index.js', '--no-sandbox'],
    env: { ...process.env, NOOK_DATA_DIR: directory }
  })
  const page = await app.firstWindow()
  await expect(
    page.getByRole('heading', { name: 'Assistant', exact: true })
  ).toBeVisible()
  return { app, page }
}
async function mockOpenAI(
  app: ElectronApplication,
  options: { automaticCallback?: boolean; denyExchange?: boolean } = {}
) {
  await app.evaluate(async ({ shell, safeStorage }, options) => {
    const crypto = process.getBuiltinModule('crypto')
    const originalFetch: typeof fetch = ((
      globalThis as any
    ).oauthOriginalFetch ||= globalThis.fetch)
    const data = { url: '', requests: [] as any[], refreshes: 0, exchanges: 0 }
    ;(globalThis as any).oauthTest = data
    // CI Linux has no desktop keychain. Inject a test vault only from the test process.
    // No test-mode credential storage or authentication endpoints exist in production code.
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' &&
        safeStorage.getSelectedStorageBackend() === 'basic_text')
    ) {
      const key = crypto
        .createHash('sha256')
        .update('nook-test-vault-only')
        .digest()
      safeStorage.isEncryptionAvailable = () => true
      safeStorage.getSelectedStorageBackend = () => 'gnome_libsecret'
      safeStorage.encryptString = (text) => {
        const iv = crypto.randomBytes(12)
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
        const encrypted = Buffer.concat([
          cipher.update(text, 'utf8'),
          cipher.final()
        ])
        return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
      }
      safeStorage.decryptString = (encrypted) => {
        const decipher = crypto.createDecipheriv(
          'aes-256-gcm',
          key,
          encrypted.subarray(0, 12)
        )
        decipher.setAuthTag(encrypted.subarray(12, 28))
        return Buffer.concat([
          decipher.update(encrypted.subarray(28)),
          decipher.final()
        ]).toString('utf8')
      }
    }
    const token = (version: string) =>
      `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'test-account' }, version })).toString('base64')}.signature`
    shell.openExternal = async (raw) => {
      data.url = raw
      if (options.automaticCallback !== false) {
        setTimeout(() => {
          const auth = new URL(raw)
          const callback = new URL(auth.searchParams.get('redirect_uri')!)
          callback.searchParams.set('state', auth.searchParams.get('state')!)
          callback.searchParams.set('code', 'test-authorization-code')
          void originalFetch(callback).catch(() => {})
        }, 100)
      }
    }
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (url === 'https://auth.openai.com/oauth/token') {
        const body = new URLSearchParams(String(init?.body))
        if (body.get('grant_type') === 'authorization_code') {
          data.exchanges++
          if (options.denyExchange)
            return new Response(
              JSON.stringify({
                error: 'denied',
                secret: 'upstream-secret-must-not-leak'
              }),
              { status: 400 }
            )
          const challenge = crypto
            .createHash('sha256')
            .update(body.get('code_verifier')!)
            .digest('base64url')
          if (
            challenge !== new URL(data.url).searchParams.get('code_challenge')
          )
            throw new Error('PKCE mismatch')
          if (body.get('code') !== 'test-authorization-code')
            throw new Error('Unexpected code')
          return Response.json({
            access_token: token('initial-secret'),
            refresh_token: 'initial-refresh-secret',
            expires_in: 0
          })
        }
        data.refreshes++
        if (body.get('refresh_token') !== 'initial-refresh-secret')
          throw new Error('Unexpected refresh token')
        return Response.json({
          access_token: token('refreshed-secret'),
          refresh_token: 'rotated-refresh-secret',
          expires_in: 3600
        })
      }
      if (url === 'https://chatgpt.com/backend-api/codex/responses') {
        const headers = Object.fromEntries(new Headers(init?.headers))
        const text =
          headers['content-encoding'] === 'zstd'
            ? process
                .getBuiltinModule('zlib')
                .zstdDecompressSync(Buffer.from(init!.body as Uint8Array))
                .toString('utf8')
            : String(init?.body)
        const request = { headers, body: JSON.parse(text) }
        data.requests.push(request)
        const status = (globalThis as any).oauthChatStatus
        if (status)
          return new Response(
            JSON.stringify({
              error: {
                code: status === 429 ? 'usage_limit_reached' : 'unauthorized',
                message: 'provider-private-detail'
              }
            }),
            { status }
          )
        if (
          request.headers['chatgpt-account-id'] !== 'test-account' ||
          !request.headers.authorization?.includes(token('refreshed-secret'))
        )
          throw new Error('Missing refreshed auth')
        const item = {
          id: 'message_test',
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'output_text', text: 'Bonjour via votre abonnement.' }
          ]
        }
        const events = [
          { type: 'response.created', response: { id: 'response_test' } },
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: { ...item, content: [] }
          },
          {
            type: 'response.output_text.delta',
            output_index: 0,
            delta: 'Bonjour via votre abonnement.'
          },
          { type: 'response.output_item.done', output_index: 0, item },
          {
            type: 'response.completed',
            response: {
              id: 'response_test',
              status: 'completed',
              output: [item],
              usage: { input_tokens: 28, output_tokens: 7, total_tokens: 35 }
            }
          }
        ]
        return new Response(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
          { headers: { 'Content-Type': 'text/event-stream' } }
        )
      }
      throw new Error(
        `Unexpected network request in OAuth test: ${new URL(url).origin}`
      )
    }
  }, options)
}

test('ChatGPT: browser OAuth, PKCE, encrypted persistence, refresh, chat and logout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nook-oauth-'))
  let app: ElectronApplication | undefined
  try {
    let desktop = await launch(directory)
    app = desktop.app
    await mockOpenAI(app)
    const page = desktop.page
    await page.getByRole('button', { name: 'Paramètres', exact: true }).click()
    await page
      .getByRole('button', { name: 'Se connecter avec ChatGPT' })
      .click()
    await expect(page.getByText('Connecté', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Modèle ChatGPT')).toBeVisible()
    const model = await page.getByLabel('Modèle ChatGPT').inputValue()
    expect(model).not.toBe('')
    await page.getByRole('button', { name: 'Utiliser avec Assistant' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByLabel('Message', { exact: true }).fill('Bonjour ChatGPT')
    await page.getByRole('button', { name: 'Envoyer', exact: true }).click()
    await expect(
      page
        .getByRole('region', { name: 'Conversation' })
        .getByText('Bonjour via votre abonnement.', { exact: true })
    ).toBeVisible()
    await expect(page.getByText(/Dernière entrée : 28 tokens/)).toBeVisible()
    const stats = await app.evaluate(() => {
      const data = (globalThis as any).oauthTest
      return {
        exchanges: data.exchanges,
        refreshes: data.refreshes,
        model: data.requests[0]?.body.model,
        store: data.requests[0]?.body.store
      }
    })
    expect(stats).toEqual({ exchanges: 1, refreshes: 1, model, store: false })
    const state = await page.evaluate(() => window.nook.load())
    expect(JSON.stringify(state)).not.toMatch(
      /refresh-secret|access_token|authorization-code/
    )
    expect(
      await readFile(join(directory, 'credentials.json'), 'utf8')
    ).not.toMatch(/refresh-secret|test-account/)
    await app.close()
    app = undefined
    desktop = await launch(directory)
    app = desktop.app
    await mockOpenAI(app)
    await desktop.page
      .getByLabel('Message', { exact: true })
      .fill('Encore un message')
    await desktop.page
      .getByRole('button', { name: 'Envoyer', exact: true })
      .click()
    await expect(
      desktop.page
        .getByRole('region', { name: 'Conversation' })
        .getByText('Bonjour via votre abonnement.', { exact: true })
    ).toHaveCount(2)
    expect(
      await app.evaluate(() => (globalThis as any).oauthTest.refreshes)
    ).toBe(0)
    for (const status of [429, 401]) {
      await app.evaluate((_electron, value) => {
        ;(globalThis as any).oauthChatStatus = value
      }, status)
      await desktop.page
        .getByLabel('Message', { exact: true })
        .fill(`Erreur ${status}`)
      await desktop.page
        .getByRole('button', { name: 'Envoyer', exact: true })
        .click()
      await expect(desktop.page.getByRole('alert')).toContainText(
        status === 429
          ? 'limite de votre abonnement'
          : 'Reconnectez votre compte'
      )
      await expect(
        desktop.page.getByText('provider-private-detail')
      ).toHaveCount(0)
    }
    await desktop.page
      .getByRole('button', { name: 'Paramètres', exact: true })
      .click()
    await desktop.page
      .getByRole('button', { name: 'Déconnecter ChatGPT' })
      .click()
    await expect(
      desktop.page.getByRole('button', { name: 'Se connecter avec ChatGPT' })
    ).toBeVisible()
    expect(
      await readFile(join(directory, 'credentials.json'), 'utf8')
    ).not.toContain('chatgpt-oauth')
  } finally {
    await app?.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('ChatGPT: cancel, reject invalid manual callback and redact token exchange failures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nook-oauth-'))
  let app: ElectronApplication | undefined
  try {
    const desktop = await launch(directory)
    app = desktop.app
    const page = desktop.page
    await mockOpenAI(app, { automaticCallback: false })
    await page.getByRole('button', { name: 'Paramètres', exact: true }).click()
    await page
      .getByRole('button', { name: 'Se connecter avec ChatGPT' })
      .click()
    await expect(
      page.getByRole('button', { name: 'Rouvrir le navigateur' })
    ).toBeVisible()
    await page.getByText('Le navigateur ne revient pas dans Nook ?').click()
    await page
      .getByLabel('Adresse de retour ChatGPT')
      .fill('http://localhost:1455/auth/callback?code=wrong&state=wrong')
    await page.getByRole('button', { name: 'Terminer la connexion' }).click()
    await expect(page.getByRole('alert')).toContainText('ne correspond pas')
    await page.getByRole('button', { name: 'Annuler la connexion' }).click()
    await expect(page.getByRole('alert')).toContainText('annulée')
    await mockOpenAI(app, { denyExchange: true })
    await page
      .getByRole('button', { name: 'Se connecter avec ChatGPT' })
      .click()
    await expect(page.getByRole('alert')).toContainText('a échoué')
    await expect(page.getByText('upstream-secret-must-not-leak')).toHaveCount(0)
    expect(
      (await page.evaluate(() => window.nook.load())).connections
    ).toHaveLength(0)
  } finally {
    await app?.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('ChatGPT: manual browser fallback completes without exposing the callback in saved state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nook-oauth-'))
  let app: ElectronApplication | undefined
  try {
    const desktop = await launch(directory)
    app = desktop.app
    const page = desktop.page
    await mockOpenAI(app, { automaticCallback: false })
    await page.getByRole('button', { name: 'Paramètres', exact: true }).click()
    await page
      .getByRole('button', { name: 'Se connecter avec ChatGPT' })
      .click()
    await expect(
      page.getByRole('button', { name: 'Rouvrir le navigateur' })
    ).toBeVisible()
    const callback = await app.evaluate(() => {
      const auth = new URL((globalThis as any).oauthTest.url)
      const result = new URL(auth.searchParams.get('redirect_uri')!)
      result.searchParams.set('state', auth.searchParams.get('state')!)
      result.searchParams.set('code', 'test-authorization-code')
      return result.toString()
    })
    await page.getByText('Le navigateur ne revient pas dans Nook ?').click()
    await page.getByLabel('Adresse de retour ChatGPT').fill(callback)
    await page.getByRole('button', { name: 'Terminer la connexion' }).click()
    await expect(page.getByText('Connecté', { exact: true })).toBeVisible()
    expect(await readFile(join(directory, 'state.json'), 'utf8')).not.toContain(
      'test-authorization-code'
    )
  } finally {
    await app?.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('ChatGPT: refuses to log in without an OS-backed secure vault', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nook-oauth-'))
  let app: ElectronApplication | undefined
  try {
    const desktop = await launch(directory)
    app = desktop.app
    await app.evaluate(({ safeStorage }) => {
      safeStorage.isEncryptionAvailable = () => false
    })
    const page = desktop.page
    await page.getByRole('button', { name: 'Paramètres', exact: true }).click()
    await page
      .getByRole('button', { name: 'Se connecter avec ChatGPT' })
      .click()
    await expect(page.getByRole('alert')).toContainText(
      'coffre-fort système est indisponible'
    )
    expect(
      (await page.evaluate(() => window.nook.load())).connections
    ).toHaveLength(0)
  } finally {
    await app?.close()
    await rm(directory, { recursive: true, force: true })
  }
})
