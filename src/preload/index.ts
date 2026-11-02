import { contextBridge, ipcRenderer } from 'electron'
import type { NookAPI, ChatEvent, ChatGPTAuthEvent } from '../shared/contracts'

const api: NookAPI = {
  load: () => ipcRenderer.invoke('state:load'),
  loginChatGPT: () => ipcRenderer.invoke('chatgpt:login'),
  cancelChatGPTLogin: () => ipcRenderer.invoke('chatgpt:cancel'),
  reopenChatGPTLogin: () => ipcRenderer.invoke('chatgpt:reopen'),
  submitChatGPTCallback: (url) => ipcRenderer.invoke('chatgpt:callback', url),
  logoutChatGPT: () => ipcRenderer.invoke('chatgpt:logout'),
  onChatGPTAuth: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      event: ChatGPTAuthEvent
    ) => listener(event)
    ipcRenderer.on('chatgpt:auth', handler)
    return () => ipcRenderer.removeListener('chatgpt:auth', handler)
  },
  saveAgent: (agent) => ipcRenderer.invoke('agent:save', agent),
  saveConnection: (connection, key) =>
    ipcRenderer.invoke('connection:save', connection, key),
  discoverModels: (base, key, id) =>
    ipcRenderer.invoke('models:discover', base, key, id),
  send: (id, content, runId) =>
    ipcRenderer.invoke('chat:send', id, content, runId),
  stop: (runId) => ipcRenderer.invoke('chat:stop', runId),
  onChat: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, event: ChatEvent) =>
      listener(event)
    ipcRenderer.on('chat:event', handler)
    return () => ipcRenderer.removeListener('chat:event', handler)
  }
}
contextBridge.exposeInMainWorld('nook', api)
