import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { z } from 'zod'
import { AgentSchema, ConnectionSchema } from '../shared/contracts'
import * as store from './store'
import { send, stop, endpoint } from './chat'
import {
  loginChatGPT,
  logoutChatGPT,
  cancelLogin,
  reopenLogin,
  submitCallback
} from './chatgpt'

let window: BrowserWindow
const connectionsInUse = new Map<string, number>()
function register() {
  const handle = (channel: string, callback: (...args: any[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error('Unauthorized IPC')
      return callback(...args)
    })
  }
  handle('state:load', () => store.load())
  handle('chatgpt:login', () =>
    loginChatGPT((event) => {
      if (!window.isDestroyed()) window.webContents.send('chatgpt:auth', event)
    })
  )
  handle('chatgpt:cancel', () => cancelLogin())
  handle('chatgpt:reopen', () => reopenLogin())
  handle('chatgpt:callback', (raw) =>
    submitCallback(z.string().max(20000).parse(raw))
  )
  handle('chatgpt:logout', () => {
    const active = store.load().connections.find((c) => c.kind === 'chatgpt')
    if (active && connectionsInUse.has(active.id))
      throw new Error('Arrêtez la réponse ChatGPT avant de vous déconnecter.')
    return logoutChatGPT()
  })
  handle('agent:save', (value) => store.saveAgent(AgentSchema.parse(value)))
  handle('connection:save', (value, rawKey) => {
    const connection = ConnectionSchema.parse(value)
    const key = z.string().max(10000).optional().parse(rawKey)
    if (connectionsInUse.has(connection.id))
      throw new Error(
        'Attendez la fin de la réponse avant de modifier cette connexion.'
      )
    const state = store.load()
    const old = state.connections.find((c) => c.id === connection.id)
    if (connection.kind === 'chatgpt' || old?.kind === 'chatgpt')
      throw new Error(
        'Utilisez le bouton de connexion ChatGPT pour gérer cet abonnement.'
      )
    // Never forward an existing credential to a newly configured host.
    if (key !== undefined) store.setKey(connection.id, key)
    else if (old && old.baseUrl !== connection.baseUrl)
      store.setKey(connection.id, '')
    const index = state.connections.findIndex((c) => c.id === connection.id)
    if (index >= 0) state.connections[index] = connection
    else state.connections.push(connection)
    store.save(state)
    return state
  })
  handle('models:discover', async (rawBase, rawKey, rawId) => {
    const base = ConnectionSchema.shape.baseUrl.parse(rawBase)
    const id = z.string().uuid().optional().parse(rawId)
    const supplied = z.string().max(10000).optional().parse(rawKey)
    const connection = store.load().connections.find((c) => c.id === id)
    const key =
      supplied ?? (connection?.baseUrl === base && id ? store.getKey(id) : '')
    const response = await fetch(endpoint(base, 'models'), {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(15000)
    })
    if (!response.ok)
      throw new Error(`Connexion refusée (HTTP ${response.status}).`)
    const data = z
      .object({ data: z.array(z.object({ id: z.string() })) })
      .parse(await response.json())
    return data.data.map((m) => m.id)
  })
  handle('chat:send', async (rawId, rawContent, rawRunId) => {
    const id = z.string().uuid().parse(rawId)
    const runId = z.string().uuid().parse(rawRunId)
    const content = z.string().trim().min(1).max(200000).parse(rawContent)
    const connectionId = store
      .load()
      .agents.find((a) => a.id === id)?.connectionId
    if (connectionId)
      connectionsInUse.set(
        connectionId,
        (connectionsInUse.get(connectionId) || 0) + 1
      )
    try {
      await send(id, content, runId, (event) => {
        if (!window.isDestroyed()) window.webContents.send('chat:event', event)
      })
    } finally {
      if (connectionId) {
        const remaining = (connectionsInUse.get(connectionId) || 1) - 1
        if (remaining) connectionsInUse.set(connectionId, remaining)
        else connectionsInUse.delete(connectionId)
      }
    }
  })
  handle('chat:stop', (rawId) => stop(z.string().uuid().parse(rawId)))
}
if (!app.requestSingleInstanceLock()) app.quit()
else
  app.whenReady().then(() => {
    register()
    const createWindow = () => {
      window = new BrowserWindow({
        width: 1380,
        height: 920,
        minWidth: 800,
        minHeight: 600,
        backgroundColor: '#222222',
        title: 'Nook',
        autoHideMenuBar: true,
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      })
      window.on('closed', () => cancelLogin())
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', (event) => event.preventDefault())
      if (process.env.ELECTRON_RENDERER_URL)
        window.loadURL(process.env.ELECTRON_RENDERER_URL)
      else window.loadFile(join(__dirname, '../renderer/index.html'))
    }
    createWindow()
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) createWindow()
    })
  })
app.on('second-instance', () => {
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
})
app.on('before-quit', () => cancelLogin())
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
