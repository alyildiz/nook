import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowUp,
  Check,
  CircleHelp,
  Cpu,
  LoaderCircle,
  MessageCircle,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Square,
  X
} from 'lucide-react'
import type { Agent, Connection, NookAPI, State } from '../../shared/contracts'
import './styles.css'

declare global {
  interface Window {
    nook: NookAPI
  }
}
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        ''
      )
    : 'Une erreur est survenue.'
const uid = () => crypto.randomUUID()
function Avatar({
  color = 'mint',
  small = false
}: {
  color?: string
  small?: boolean
}) {
  return (
    <span
      className={`avatar ${color} ${small ? 'small' : ''}`}
      aria-hidden="true"
    >
      <i />
      <i />
    </span>
  )
}
function App() {
  const [state, setState] = useState<State>({
    agents: [],
    connections: [],
    conversations: []
  })
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [modal, setModal] = useState<'settings' | 'agent' | null>(null)
  const [editing, setEditing] = useState<Agent | undefined>()
  const [running, setRunning] = useState<{
    id: string
    agentId: string
    text: string
  } | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => {
    window.nook
      .load()
      .then((value) => {
        setState(value)
        setSelected(value.agents[0]?.id || '')
      })
      .catch((e) => setError(errorText(e)))
    return window.nook.onChat((event) => {
      if (event.state) setState(event.state)
      if (event.delta)
        setRunning((run) =>
          run?.id === event.runId
            ? { ...run, text: run.text + event.delta }
            : run
        )
      if (event.done) {
        setRunning((run) => (run?.id === event.runId ? null : run))
        if (event.error) setError(event.error)
      }
    })
  }, [])
  const agent = state.agents.find((a) => a.id === selected)
  const conversation = state.conversations.find((c) => c.agentId === selected)
  const connection = state.connections.find((c) => c.id === agent?.connectionId)
  const activeRun = running?.agentId === selected ? running : null
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation?.messages.length, activeRun?.text])
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!draft.trim() || !agent || running) return
    const content = draft.trim(),
      runId = uid()
    setError('')
    setDraft('')
    setRunning({ id: runId, agentId: agent.id, text: '' })
    try {
      await window.nook.send(agent.id, content, runId)
    } catch (e) {
      setError(errorText(e))
      setRunning(null)
      setDraft(content)
    }
  }
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-heading">
          <span className="wordmark">
            nook<span>.</span>
          </span>
          <button
            className="icon"
            aria-label="Créer un agent"
            onClick={() => {
              setEditing(undefined)
              setModal('agent')
            }}
          >
            <Plus />
          </button>
        </div>
        <label className="search">
          <Search size={19} />
          <input
            aria-label="Rechercher un agent"
            placeholder="Rechercher"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="section-label">
          MES AGENTS <span>{state.agents.length}</span>
        </div>
        <nav aria-label="Agents">
          {state.agents
            .filter((a) => a.name.toLowerCase().includes(query.toLowerCase()))
            .map((a) => {
              const history = state.conversations.find(
                (c) => c.agentId === a.id
              )
              const last = history?.messages.at(-1)
              return (
                <button
                  key={a.id}
                  className={`agent-row ${a.id === selected ? 'selected' : ''}`}
                  onClick={() => {
                    setSelected(a.id)
                    setError('')
                  }}
                >
                  <Avatar color={a.color} />
                  <span className="agent-copy">
                    <span className="agent-name">{a.name}</span>
                    <span className="preview">
                      {last?.content || 'Une conversation à commencer'}
                    </span>
                  </span>
                  {last && (
                    <time>
                      {new Date(last.createdAt).toLocaleDateString('fr', {
                        day: 'numeric',
                        month: 'short'
                      })}
                    </time>
                  )}
                </button>
              )
            })}
        </nav>
        <div className="sidebar-footer">
          <div className="profile">B</div>
          <span>
            Mon espace<span className="local-label">Sur cet appareil</span>
          </span>
          <button
            className="icon"
            aria-label="Paramètres"
            onClick={() => setModal('settings')}
          >
            <Settings size={21} />
          </button>
        </div>
      </aside>
      <main>
        <header>
          <div className="header-agent">
            <Avatar color={agent?.color} small />
            <div>
              <h1>{agent?.name || 'Nook'}</h1>
              <span className="model-label">
                <span
                  className={`status-dot ${connection ? 'connected' : ''}`}
                />
                {agent?.model || 'Aucun modèle connecté'}
              </span>
            </div>
          </div>
          <button
            className="icon"
            aria-label="Paramètres de l’agent"
            disabled={!agent}
            onClick={() => {
              setEditing(agent)
              setModal('agent')
            }}
          >
            <SlidersHorizontal size={21} />
          </button>
        </header>
        <section
          className="messages"
          aria-label="Conversation"
          aria-live="polite"
        >
          {!conversation?.messages.length && (
            <div className="empty">
              <Avatar color={agent?.color} />
              <h2>Un peu de place pour vos idées.</h2>
              <p>
                {connection
                  ? `Commencez une conversation avec ${agent?.name}.`
                  : 'Connectez un modèle, puis donnez un rôle à votre agent.'}
              </p>
              <button
                className="secondary"
                onClick={() => setModal('settings')}
              >
                <Cpu size={17} />{' '}
                {connection ? 'Gérer mes connexions' : 'Connecter un modèle'}
              </button>
            </div>
          )}
          {conversation?.messages.map((message, i) => (
            <div key={message.id} className={`message ${message.role}`}>
              <div className="bubble">
                {message.role === 'assistant' &&
                activeRun &&
                i === conversation.messages.length - 1
                  ? activeRun.text || (
                      <span className="working">
                        <LoaderCircle size={16} /> Réfléchit…
                      </span>
                    )
                  : message.content ||
                    (message.incomplete ? 'Réponse interrompue.' : '')}
              </div>
              {message.incomplete && !activeRun && (
                <span className="message-note">Réponse incomplète</span>
              )}
            </div>
          ))}
          <div ref={bottom} />
        </section>
        <div className="composer-area">
          {error && (
            <div role="alert" className="error">
              {error}
              <button
                className="icon"
                aria-label="Fermer l’erreur"
                onClick={() => setError('')}
              >
                <X size={15} />
              </button>
            </div>
          )}
          <form className="composer" onSubmit={submit}>
            <MessageCircle className="composer-mark" size={22} />
            <textarea
              aria-label="Message"
              rows={1}
              placeholder={`Message à ${agent?.name || 'votre agent'}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault()
                  e.currentTarget.form?.requestSubmit()
                }
              }}
            />
            {activeRun ? (
              <button
                type="button"
                className="send"
                aria-label="Arrêter la réponse"
                onClick={() => window.nook.stop(activeRun.id)}
              >
                <Square size={17} />
              </button>
            ) : (
              <button
                className="send"
                aria-label="Envoyer"
                disabled={!draft.trim() || !!running}
              >
                <ArrowUp size={22} />
              </button>
            )}
          </form>
          <div className="composer-foot">
            <span>{connection?.name || 'Votre espace, vos agents.'}</span>
            <span title="Tokens du dernier appel, pas une mesure exacte du contexte actuel">
              {conversation?.inputTokens !== undefined
                ? `Dernière entrée : ${conversation.inputTokens.toLocaleString('fr')} tokens · fenêtre ${connection?.contextWindow.toLocaleString('fr')}`
                : 'Historique enregistré sur cet appareil'}
            </span>
          </div>
        </div>
      </main>
      {modal === 'agent' && (
        <AgentDialog
          agent={editing}
          connections={state.connections}
          onClose={() => setModal(null)}
          onSave={async (value) => {
            const next = await window.nook.saveAgent(value)
            setState(next)
            setSelected(value.id)
            setModal(null)
          }}
        />
      )}
      {modal === 'settings' && (
        <SettingsDialog
          connections={state.connections}
          onClose={() => setModal(null)}
          onSave={async (value, key) => {
            setState(await window.nook.saveConnection(value, key))
          }}
        />
      )}
    </div>
  )
}
function Dialog({
  title,
  onClose,
  children
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button className="icon" aria-label="Fermer" onClick={onClose}>
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  )
}
function AgentDialog({
  agent,
  connections,
  onSave,
  onClose
}: {
  agent?: Agent
  connections: Connection[]
  onSave: (value: Agent) => Promise<void>
  onClose: () => void
}) {
  const [value, setValue] = useState<Agent>(
    agent || {
      version: 1,
      id: uid(),
      name: '',
      color: 'mint',
      instructions: '',
      connectionId: null,
      model: '',
      skills: [],
      tools: []
    }
  )
  const [error, setError] = useState(''),
    [saving, setSaving] = useState(false)
  const connection = connections.find((c) => c.id === value.connectionId)
  return (
    <Dialog
      title={agent ? 'Votre agent' : 'Un nouvel interlocuteur'}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setSaving(true)
          try {
            await onSave(value)
          } catch (e) {
            setError(errorText(e))
            setSaving(false)
          }
        }}
      >
        <div className="agent-identity">
          <Avatar color={value.color} />
          <div className="swatches">
            {(['mint', 'amber', 'violet', 'blue', 'coral'] as const).map(
              (color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Couleur ${color}`}
                  aria-pressed={value.color === color}
                  className={`swatch ${color}`}
                  onClick={() => setValue({ ...value, color })}
                >
                  {value.color === color && <Check size={15} />}
                </button>
              )
            )}
          </div>
        </div>
        <label>
          Nom
          <input
            required
            maxLength={80}
            autoFocus
            placeholder="Ex. Fiscalité, Vidéos, Assistant…"
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
          />
        </label>
        <label>
          Quel est son rôle ?
          <textarea
            rows={4}
            placeholder="Décrivez ce que cet agent doit faire et comment il doit vous répondre."
            value={value.instructions}
            onChange={(e) =>
              setValue({ ...value, instructions: e.target.value })
            }
          />
        </label>
        <div className="form-columns">
          <label>
            Connexion
            <select
              aria-label="Connexion"
              value={value.connectionId || ''}
              onChange={(e) =>
                setValue({
                  ...value,
                  connectionId: e.target.value || null,
                  model: ''
                })
              }
            >
              <option value="">Choisir une connexion</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Modèle
            <select
              aria-label="Modèle"
              value={value.model}
              disabled={!connection}
              onChange={(e) => setValue({ ...value, model: e.target.value })}
            >
              <option value="">Choisir un modèle</option>
              {[
                ...new Set([
                  ...(connection?.models || []),
                  ...(value.model ? [value.model] : [])
                ])
              ].map((model) => (
                <option key={model}>{model}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="notice">
          <CircleHelp size={18} />
          <span>
            Les skills et outils MCP arrivent dans une prochaine étape. Cet
            agent peut actuellement converser avec le modèle choisi.
          </span>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="primary" disabled={saving}>
            {saving
              ? 'Enregistrement…'
              : agent
                ? 'Enregistrer'
                : 'Créer l’agent'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
function SettingsDialog({
  connections,
  onSave,
  onClose
}: {
  connections: Connection[]
  onSave: (value: Connection, key?: string) => Promise<void>
  onClose: () => void
}) {
  const fresh = (): Connection => ({
    id: uid(),
    name: '',
    baseUrl: '',
    models: [],
    contextWindow: 32768
  })
  const [value, setValue] = useState<Connection>(connections[0] || fresh())
  const [key, setKey] = useState(''),
    [keyChanged, setKeyChanged] = useState(false)
  const [models, setModels] = useState(value.models.join('\n'))
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const choose = (connection: Connection) => {
    setValue(connection)
    setModels(connection.models.join('\n'))
    setKey('')
    setKeyChanged(false)
    setError('')
    setNotice('')
  }
  return (
    <Dialog title="Connexions et modèles" onClose={onClose}>
      <p className="dialog-description">
        Connectez vos modèles une fois. Choisissez ensuite celui de chaque
        agent.
      </p>
      <div className="connection-tabs">
        {connections.map((c) => (
          <button
            className={`secondary ${value.id === c.id ? 'active' : ''}`}
            key={c.id}
            onClick={() => choose(c)}
          >
            {c.name}
          </button>
        ))}
        <button className="secondary" onClick={() => choose(fresh())}>
          <Plus size={16} /> Ajouter
        </button>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError('')
          setNotice('')
          try {
            await onSave(
              {
                ...value,
                models: models
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean)
              },
              keyChanged ? key : undefined
            )
            setKey('')
            setKeyChanged(false)
            setNotice('Connexion enregistrée.')
          } catch (e) {
            setError(errorText(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <label>
          Nom de la connexion
          <input
            required
            placeholder="Ex. Cluster · vLLM"
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
          />
        </label>
        <label>
          Adresse de l’API compatible OpenAI
          <input
            type="url"
            required
            placeholder="http://100.74.103.34:8000/v1"
            value={value.baseUrl}
            onChange={(e) => setValue({ ...value, baseUrl: e.target.value })}
          />
        </label>
        <label>
          Clé API{' '}
          <span className="optional">facultative pour un serveur local</span>
          <input
            type="password"
            autoComplete="off"
            placeholder="Laisser vide pour conserver la clé existante"
            value={key}
            onChange={(e) => {
              setKey(e.target.value)
              setKeyChanged(true)
            }}
          />
        </label>
        {value.baseUrl.startsWith('http:') && (
          <p className="muted">
            HTTP n’est pas chiffré par l’application. Utilisez HTTPS ou un
            réseau de confiance comme Tailscale.
          </p>
        )}
        <div className="label-row">
          <span>Modèles disponibles</span>
          <button
            type="button"
            className="text-button"
            disabled={busy || !value.baseUrl}
            onClick={async () => {
              setBusy(true)
              setError('')
              setNotice('')
              try {
                const found = await window.nook.discoverModels(
                  value.baseUrl,
                  keyChanged ? key : undefined,
                  value.id
                )
                setModels(found.join('\n'))
                setNotice(
                  `${found.length} modèle(s) trouvé(s). Enregistrez pour les conserver.`
                )
              } catch (e) {
                setError(errorText(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            Tester et découvrir
          </button>
        </div>
        <textarea
          aria-label="Modèles disponibles"
          rows={3}
          placeholder="Un identifiant de modèle par ligne"
          value={models}
          onChange={(e) => setModels(e.target.value)}
        />
        <label>
          Fenêtre de contexte{' '}
          <span className="optional">
            tokens, à vérifier pour le modèle servi
          </span>
          <input
            type="number"
            min={1024}
            max={10000000}
            required
            value={value.contextWindow}
            onChange={(e) =>
              setValue({ ...value, contextWindow: Number(e.target.value) })
            }
          />
        </label>
        <div className="notice">
          <Cpu size={19} />
          <span>
            <strong>Abonnement ChatGPT</strong>
            <br />
            La connexion directe par navigateur n’est pas encore intégrée. Un
            abonnement Plus n’est pas une clé API. Cette version peut utiliser
            une passerelle LiteLLM déjà authentifiée.
          </span>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="success" role="status">
            {notice}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Fermer
          </button>
          <button className="primary" disabled={busy}>
            {busy ? 'Patientez…' : 'Enregistrer la connexion'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
