import { useEffect, useState } from 'react'
import { Check, ExternalLink, LoaderCircle, LogOut } from 'lucide-react'
import type { Agent, Connection, State } from '../../shared/contracts'
import './chatgpt.css'

const message = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        ''
      )
    : 'La connexion a échoué.'

export function ChatGPTConnection({
  connection,
  agent,
  onState,
  onClose
}: {
  connection?: Connection
  agent?: Agent
  onState: (state: State) => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [callback, setCallback] = useState('')
  const [model, setModel] = useState('')
  const connected = connection?.authenticated
  useEffect(() => {
    const unsubscribe = window.nook.onChatGPTAuth((event) => {
      setProgress(event.message)
      setWaiting(event.status === 'waiting')
    })
    return () => {
      unsubscribe()
      void window.nook.cancelChatGPTLogin()
    }
  }, [])
  const selectedModel =
    model ||
    (agent?.connectionId === connection?.id ? agent?.model : '') ||
    connection?.models.at(-1) ||
    ''
  async function connect() {
    setBusy(true)
    setWaiting(false)
    setError('')
    setProgress('Préparation de la connexion…')
    setCallback('')
    try {
      onState(await window.nook.loginChatGPT())
      setProgress('Compte connecté. Choisissez le modèle de votre agent.')
    } catch (error) {
      setError(message(error))
      setProgress('')
    } finally {
      setBusy(false)
      setWaiting(false)
    }
  }
  return (
    <section className="chatgpt-card" aria-label="Abonnement ChatGPT">
      <div className="chatgpt-title">
        <div>
          <h3>ChatGPT</h3>
          <p>Votre abonnement, sans clé API ni installation supplémentaire.</p>
        </div>
        {connected && (
          <span className="connected-badge">
            <Check size={13} /> Connecté
          </span>
        )}
      </div>
      <p className="muted">
        Connexion via ChatGPT/Codex. Les modèles et quotas dépendent de votre
        abonnement et des autorisations de votre compte.
      </p>
      {!busy && !connected && (
        <button className="primary" onClick={connect}>
          <ExternalLink size={16} /> Se connecter avec ChatGPT
        </button>
      )}
      {busy && (
        <div className="auth-progress" role="status">
          <LoaderCircle size={16} />
          {progress}
        </div>
      )}
      {busy && (
        <div className="auth-actions">
          {waiting && (
            <button
              className="secondary"
              onClick={async () => {
                try {
                  await window.nook.reopenChatGPTLogin()
                } catch (e) {
                  setError(message(e))
                }
              }}
            >
              Rouvrir le navigateur
            </button>
          )}
          <button
            className="secondary"
            onClick={() => window.nook.cancelChatGPTLogin()}
          >
            Annuler la connexion
          </button>
        </div>
      )}
      {busy && waiting && (
        <details className="auth-fallback">
          <summary>Le navigateur ne revient pas dans Nook ?</summary>
          <p className="muted">
            Si la page de retour ne s’ouvre pas après l’autorisation, collez son
            adresse complète ici. Ne la partagez pas ailleurs.
          </p>
          <input
            aria-label="Adresse de retour ChatGPT"
            type="password"
            autoComplete="off"
            placeholder="Adresse complète après autorisation"
            value={callback}
            onChange={(e) => setCallback(e.target.value)}
          />
          <button
            className="secondary"
            disabled={!callback}
            onClick={async () => {
              try {
                await window.nook.submitChatGPTCallback(callback)
                setCallback('')
              } catch (e) {
                setError(message(e))
              }
            }}
          >
            Terminer la connexion
          </button>
        </details>
      )}
      {connected && !busy && (
        <>
          <label className="oauth-model-label">
            Modèle ChatGPT
            <select
              aria-label="Modèle ChatGPT"
              value={selectedModel}
              onChange={(e) => setModel(e.target.value)}
            >
              {connection.models.map((id) => (
                <option key={id}>{id}</option>
              ))}
            </select>
          </label>
          <p className="muted">
            Catalogue du connecteur. L’accès effectif à chaque modèle sera
            confirmé au premier message.
          </p>
          <div className="auth-actions">
            {agent && (
              <button
                className="primary"
                onClick={async () => {
                  try {
                    onState(
                      await window.nook.saveAgent({
                        ...agent,
                        connectionId: connection.id,
                        model: selectedModel
                      })
                    )
                    onClose()
                  } catch (e) {
                    setError(message(e))
                  }
                }}
              >
                Utiliser avec {agent.name}
              </button>
            )}
            <button className="secondary" onClick={connect}>
              Reconnecter
            </button>
            <button
              className="icon"
              aria-label="Déconnecter ChatGPT"
              title="Oublier la connexion sur cet appareil, sans supprimer les conversations"
              onClick={async () => {
                try {
                  onState(await window.nook.logoutChatGPT())
                  setProgress('')
                } catch (e) {
                  setError(message(e))
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
