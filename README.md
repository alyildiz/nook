# Nook

A personal desktop home for your agents. A calm messenger interface, with an explicit model and instructions for each agent. Windows and macOS clients run locally; GPU services can live on another machine.

## Status: 0.2.0, embedded ChatGPT subscription connection

Implemented:

- Electron + React + TypeScript application, with an isolated renderer and narrow IPC bridge.
- Agent creation and editing: name, avatar color, instructions, connection and model.
- One local conversation per agent, persisted across restarts.
- Direct ChatGPT/Codex subscription login in the system browser, with protected credentials, automatic refresh, reconnect and local logout.
- Per-agent selection from the connector's ChatGPT model catalog, plus per-model context metadata.
- OpenAI-compatible model discovery and streaming chat, including optional LiteLLM gateways and vLLM endpoints.
- Cancellation, incomplete-response markers, provider errors and last-request token usage.
- YAML agent definitions and OS-encrypted API credentials, separate from conversation data.
- Windows NSIS installer, Apple Silicon DMG and Linux AppImage build configuration.
- End-to-end tests launching the actual Electron application against a controlled model server.

**Not implemented yet:** direct Anthropic protocol, MCP/tool execution, skill execution, transcription, long-term memory, context compaction, multiple conversations per agent, cross-device sync and automatic updates. The interface explicitly marks upcoming capabilities. There are no simulated agent responses.

ChatGPT access uses the embedded `@earendil-works/pi-ai` TypeScript connector, not an external LiteLLM process or the Codex CLI. No Python, API key or additional installation is required for this connection. Plus is not an OpenAI API key: subscription usage has its own model access, quotas and provider conditions. Real account access must be verified by the user; automated tests use a controlled OpenAI transport.

## Development

Node.js 22.19+ and npm:

```sh
npm ci
npm run dev
```

### Connect ChatGPT

1. Open **Settings → Se connecter avec ChatGPT**.
2. Authorize in the system browser. Nook receives the OAuth callback on port 1455 on the same computer; no account password is entered into Nook.
3. Choose **Modèle ChatGPT**, then **Utiliser avec [agent]**. You can also select the connection and model when creating or editing any agent.
4. Send a message. The list is the bundled connector catalog, **not an entitlement query**: a model may be unavailable to your plan or workspace. Try another model if access is refused. It does not mirror every model shown in the ChatGPT app.

If another Codex login holds port 1455, finish/cancel that login or use the manual callback fallback in Nook. Nook validates its origin, path and OAuth state. Login is cancellable and times out after ten minutes. Closing the settings dialog cancels pending login. After expiry or revocation, reconnect from settings. **Déconnecter ChatGPT** forgets the local credential; it does not revoke the upstream session. Revoke sessions in your OpenAI account's security settings if needed. One ChatGPT account per Nook installation is supported.

### Other model connections

Add a connection using its full API base URL, including `/v1` where required. For a service on cluster, for example `http://100.74.103.34:8000/v1`. Discover models or enter their exact identifiers, save, then assign a connection and model to an agent.

HTTPS is recommended. HTTP is available for local or trusted networks such as Tailscale. The application contacts configured endpoints from the main process, not the renderer. Do not configure untrusted endpoints or import untrusted configuration. Connecting a remote model sends the agent's instructions and conversation to that provider; there is no silent fallback to another provider.

Changing an existing connection's URL clears its saved credential unless a replacement is supplied. API credentials and OAuth tokens are encrypted through Electron `safeStorage`; saving a credential fails rather than falling back to plaintext when a secure OS backend is unavailable. Local conversation and YAML files themselves are **not encrypted**.

## Data

Under Electron's user-data directory (`%APPDATA%/nook` on Windows and `~/Library/Application Support/nook` on macOS):

- `agents/<uuid>.yaml`: authoritative agent definitions, loaded on startup and before operations. Edit while the app is closed.
- `state.json`: connections, conversation history, reported token usage and agent ordering.
- `credentials.json`: encrypted API secrets and rotating ChatGPT OAuth tokens, never returned to the renderer. The YAML and connection state contain no tokens.

`NOOK_DATA_DIR` overrides the location for tests and development. Do not sync the credentials file between computers; it is encrypted for the local OS account. There is currently no deletion UI or import/export UI; back up the data directory while the app is closed.

Agent configuration changes affect future requests. Existing conversations are retained, and a model change sends that conversation to the newly selected provider. Context windows are informational: configured per compatible connection, and read per model from the bundled catalog for ChatGPT. They are not token counts. Token usage displays the provider's last reported input count, **not** an exact current context meter or a subscription quota. Long conversations are not compacted yet.

## Verification

```sh
npm run build
npm run format:check
npm run test:e2e
# On a headless Linux host:
xvfb-run -a npm run test:e2e
```

Tests cover settings, model discovery, distinct model assignment, SSE streaming, stop, cut streams, HTTP failures, YAML persistence, restart, renderer isolation, the real connector's browser OAuth/PKCE flow, encrypted credential persistence, rotating-token refresh, callback validation, cancellation, error redaction and logout. OpenAI network calls and browser opening are intercepted only by the test process; on keychain-less Linux CI, the test process injects a temporary encrypted vault. Production has no mock auth endpoints or insecure-storage switch. They do not authenticate real provider accounts or certify transcription quality. The `--no-sandbox` flag is used only by the test launcher for Linux CI compatibility; the production window keeps renderer sandboxing enabled.

## Installers

```sh
npm run package -- --win --x64 --publish never
npm run package -- --mac --arm64 --publish never
```

Build each platform on its native OS. The active [GitHub Actions workflow](.github/workflows/build.yml) builds installers on pushes to `main`, pull requests and manual dispatches. Download them from the workflow's **Artifacts**. Pushing a version tag such as `v0.2.0` publishes a prerelease only after all platform builds and desktop tests succeed. The initial Windows installer was built successfully and opened on the user's PC; each new version still needs real-device verification.

Installers bundle the application and Electron: end users do not need Node.js. No Python/LiteLLM runtime is needed or bundled; LiteLLM remains an optional external compatible endpoint. Unsigned development installers may trigger Windows SmartScreen or macOS Gatekeeper. Signing, notarization, an application icon and real-device verification are release milestones, not completed claims.

See [ROADMAP.md](ROADMAP.md) for the remaining scope and [SECURITY.md](SECURITY.md) for security limitations.
