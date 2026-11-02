import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let server: Server, baseUrl: string
let requests: any[] = []
let mode: 'normal' | 'slow' | 'broken' | 'error' = 'normal'
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    if (req.url === '/v1/models') {
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({ data: [{ id: 'local-test' }, { id: 'second-model' }] })
      )
      return
    }
    if (req.url === '/v1/chat/completions') {
      let body = ''
      for await (const chunk of req) body += chunk
      requests.push(JSON.parse(body))
      if (mode === 'error') {
        res.writeHead(401)
        res.end('secret upstream error')
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const event = (data: unknown) => `data: ${JSON.stringify(data)}\r\n\r\n`
      res.write(event({ choices: [{ delta: { content: 'Bonjour ' } }] }))
      if (mode === 'slow') {
        const timer = setTimeout(() => res.end(), 30000)
        res.on('close', () => clearTimeout(timer))
        return
      }
      if (mode === 'broken') {
        res.end()
        return
      }
      // Deliberately split CRLF and UTF-8 data across chunks.
      const rest = Buffer.from(
        event({
          choices: [{ delta: { content: 'depuis le modèle local. Été.' } }]
        }) +
          event({
            choices: [],
            usage: { prompt_tokens: 42, completion_tokens: 9 }
          }) +
          'data: [DONE]\r\n\r\n'
      )
      res.write(rest.subarray(0, 30))
      setTimeout(() => res.end(rest.subarray(30)), 30)
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
})
test.afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})
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
async function connect(page: Page) {
  await page.getByRole('button', { name: 'Paramètres', exact: true }).click()
  await page.getByLabel('Nom de la connexion').fill('Cluster')
  await page.getByLabel('Adresse de l’API compatible OpenAI').fill(baseUrl)
  await page.getByRole('button', { name: 'Tester et découvrir' }).click()
  await expect(page.getByLabel('Modèles disponibles')).toHaveValue(
    'local-test\nsecond-model'
  )
  await page.getByRole('button', { name: 'Enregistrer la connexion' }).click()
  await expect(page.getByRole('status')).toHaveText('Connexion enregistrée.')
  await page.getByRole('button', { name: 'Fermer', exact: true }).last().click()
  await page.getByRole('button', { name: 'Paramètres de l’agent' }).click()
  await page
    .getByLabel('Connexion', { exact: true })
    .selectOption({ label: 'Cluster' })
  await page.getByLabel('Modèle', { exact: true }).selectOption('local-test')
  await page
    .getByLabel('Quel est son rôle ?')
    .fill('Reply in French. You are my local assistant.')
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('desktop: connections, model choice, streaming, YAML and restart persistence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nook-test-'))
  let app: ElectronApplication | undefined
  try {
    let desktop = await launch(directory)
    app = desktop.app
    const page = desktop.page
    await connect(page)
    mode = 'normal'
    requests = []
    await page.getByLabel('Message', { exact: true }).fill('Salut !')
    await page.getByRole('button', { name: 'Envoyer', exact: true }).click()
    await expect(
      page
        .getByRole('region', { name: 'Conversation' })
        .getByText('Bonjour depuis le modèle local. Été.', { exact: true })
    ).toBeVisible()
    await expect(page.getByText(/Dernière entrée : 42 tokens/)).toBeVisible()
    expect(requests[0].model).toBe('local-test')
    expect(requests[0].messages[0].content).toContain('Reply in French')
    expect(requests[0].messages[1].content).toBe('Salut !')
    const files = await readdir(join(directory, 'agents'))
    expect(files).toHaveLength(1)
    expect(
      await readFile(join(directory, 'agents', files[0]), 'utf8')
    ).toContain('model: local-test')
    await page
      .getByRole('button', { name: 'Créer un agent', exact: true })
      .click()
    await page.getByLabel('Nom', { exact: true }).fill('Vidéos')
    await page
      .getByLabel('Connexion', { exact: true })
      .selectOption({ label: 'Cluster' })
    await page
      .getByLabel('Modèle', { exact: true })
      .selectOption('second-model')
    await page
      .getByRole('button', { name: 'Créer l’agent', exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: 'Vidéos', exact: true })
    ).toBeVisible()
    await expect(page.locator('.model-label')).toHaveText('second-model')
    await page.screenshot({ path: 'test-results/nook-desktop.png' })
    await app.close()
    app = undefined
    desktop = await launch(directory)
    app = desktop.app
    await expect(
      desktop.page
        .getByRole('region', { name: 'Conversation' })
        .getByText('Bonjour depuis le modèle local. Été.', { exact: true })
    ).toBeVisible()
    await expect(
      desktop.page
        .getByRole('navigation', { name: 'Agents' })
        .getByRole('button')
    ).toHaveCount(2)
    // Renderer has no Node.js access, secrets, or unrestricted IPC.
    expect(
      await desktop.page.evaluate(() => typeof (window as any).require)
    ).toBe('undefined')
    expect(
      await desktop.page.evaluate(() => Object.keys(window.nook))
    ).not.toContain('getKey')
  } finally {
    await app?.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('desktop: stop, interrupted streams and provider failures remain visible', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nook-test-'))
  let app: ElectronApplication | undefined
  try {
    const desktop = await launch(directory)
    app = desktop.app
    const page = desktop.page
    await connect(page)
    mode = 'slow'
    await page.getByLabel('Message', { exact: true }).fill('Une réponse lente')
    await page.getByRole('button', { name: 'Envoyer', exact: true }).click()
    await expect(page.getByText('Bonjour', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Arrêter la réponse' }).click()
    await expect(page.getByRole('alert')).toContainText('Réponse arrêtée.')
    await expect(page.getByText('Réponse incomplète')).toBeVisible()
    mode = 'broken'
    await page
      .getByLabel('Message', { exact: true })
      .fill('Une réponse interrompue')
    await page.getByRole('button', { name: 'Envoyer', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('coupée avant la fin')
    mode = 'error'
    await page
      .getByLabel('Message', { exact: true })
      .fill('Une erreur fournisseur')
    await page.getByRole('button', { name: 'Envoyer', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('HTTP 401')
    await expect(page.getByText('secret upstream error')).toHaveCount(0)
  } finally {
    await app?.close()
    await rm(directory, { recursive: true, force: true })
    mode = 'normal'
  }
})
