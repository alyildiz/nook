# Nook

A personal desktop home for your agents. A calm messenger interface, with an explicit model and instructions for each agent. Windows and macOS clients run locally; GPU services can live on another machine.

## Status: first working desktop slice

Implemented:

- Electron + React + TypeScript application, with an isolated renderer and narrow IPC bridge.
- Agent creation and editing: name, avatar color, instructions, connection and model.
- One local conversation per agent, persisted across restarts.
- OpenAI-compatible model discovery and streaming chat, including LiteLLM gateways and vLLM endpoints.
- Cancellation, incomplete-response markers, provider errors and last-request token usage.
- YAML agent definitions and OS-encrypted API credentials, separate from conversation data.
- Windows NSIS installer, Apple Silicon DMG and Linux AppImage build configuration.
- End-to-end tests launching the actual Electron application against a controlled model server.

**Not implemented yet:** direct ChatGPT subscription login, an embedded LiteLLM runtime, direct Anthropic protocol, MCP/tool execution, skill execution, transcription, long-term memory, context compaction, multiple conversations per agent, cross-device sync and automatic updates. The interface explicitly marks upcoming capabilities. There are no simulated agent responses.

For now, ChatGPT subscription access requires an **existing, separately authenticated LiteLLM gateway**. Plus is not an OpenAI API key. The end goal is a standalone installer that also handles the subscription connection; the current slice does not meet that milestone yet.

## Development

Node.js 22.19+ and npm:

```sh
npm ci
npm run dev
```

Add a connection using its full API base URL, including `/v1` where required. For a service on cluster, for example `http://100.74.103.34:8000/v1`. Discover models or enter their exact identifiers, save, then assign a connection and model to an agent.

HTTPS is recommended. HTTP is available for local or trusted networks such as Tailscale. The application contacts configured endpoints from the main process, not the renderer. Do not configure untrusted endpoints or import untrusted configuration. Connecting a remote model sends the agent's instructions and conversation to that provider; there is no silent fallback to another provider.

Changing an existing connection's URL clears its saved credential unless a replacement is supplied. API credentials are encrypted through Electron `safeStorage`; saving a key fails rather than falling back to plaintext when a secure OS backend is unavailable. Local conversation and YAML files themselves are **not encrypted**.

## Data

Under Electron's user-data directory (`%APPDATA%/nook` on Windows and `~/Library/Application Support/nook` on macOS):

- `agents/<uuid>.yaml`: authoritative agent definitions, loaded on startup and before operations. Edit while the app is closed.
- `state.json`: connections, conversation history, reported token usage and agent ordering.
- `credentials.json`: encrypted API secrets, never returned to the renderer.

`NOOK_DATA_DIR` overrides the location for tests and development. Do not sync the credentials file between computers; it is encrypted for the local OS account. There is currently no deletion UI or import/export UI; back up the data directory while the app is closed.

Agent configuration changes affect future requests. Existing conversations are retained, and a model change sends that conversation to the newly selected provider. The current context-window value is configured per connection and informational; it is not automatic model discovery or token counting. Token usage displays the provider's last reported input count, **not** an exact current context meter or a subscription quota. Long conversations are not compacted yet.

## Verification

```sh
npm run build
npm run format:check
npm run test:e2e
# On a headless Linux host:
xvfb-run -a npm run test:e2e
```

Tests cover settings, model discovery, distinct model assignment, SSE streaming, stop, cut streams, HTTP failures, YAML persistence, restart and renderer isolation. They do not authenticate real provider accounts or certify transcription quality. The `--no-sandbox` flag is used only by the test launcher for Linux CI compatibility; the production window keeps renderer sandboxing enabled.

## Installers

```sh
npm run package -- --win --x64 --publish never
npm run package -- --mac --arm64 --publish never
```

Build each platform on its native OS. A ready-to-enable GitHub Actions workflow is stored at [docs/workflows/build.yml](docs/workflows/build.yml). It is **not active yet**: the current GitHub credential lacks the `workflow` scope needed to publish files under `.github/workflows/`. After authorizing workflow access, move the template to `.github/workflows/build.yml` and push it.

Once enabled, Actions will build installers on pushes to `main`, pull requests and manual dispatches. Download them from the workflow's **Artifacts**. Pushing a version tag such as `v0.1.0` will publish a prerelease only after all platform builds and desktop tests succeed. No Windows or macOS installer has been generated or verified yet.

Installers bundle the application and Electron: end users do not need Node.js. There is currently no bundled Python/LiteLLM runtime. Unsigned development installers may trigger Windows SmartScreen or macOS Gatekeeper. Signing, notarization, an application icon and real-device verification are release milestones, not completed claims.

See [ROADMAP.md](ROADMAP.md) for the remaining scope and [SECURITY.md](SECURITY.md) for security limitations.
