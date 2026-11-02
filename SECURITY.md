# Security status

Nook is an early, personal-use desktop application, not a hardened multi-user service.

- Renderer: sandboxed, no Node.js integration, context isolation, no remote HTML or arbitrary navigation, and no generic IPC access.
- IPC: only the application's main frame can invoke registered handlers; values are validated in the main process.
- Provider credentials: encrypted with the OS-backed Electron safeStorage facility; no plaintext fallback is allowed. API keys and ChatGPT OAuth access/refresh tokens are not part of agent YAML or renderer state.
- ChatGPT login: uses pi-ai's browser OAuth/PKCE flow. Nook opens only the fixed HTTPS OpenAI authorization host/path; it does not accept arbitrary external links from the renderer. The manual callback must match this login's redirect origin, path and state. Raw token exchange errors are never forwarded to the renderer.
- Refresh: serialized within the process, with a single-instance application lock to prevent two Nook processes rotating the same refresh token. A subscription request never falls back to ambient API keys. Closing settings or the app cancels pending authentication. Local logout deletes credentials, but does not revoke the OpenAI session; account-side revocation remains available in OpenAI security settings.
- Conversation history and instructions: stored locally in plaintext. Backups contain private data.
- Remote models: receive instructions and conversation history. The app does not switch providers automatically.
- Tools: no shell, skill execution or MCP execution is enabled in this initial slice.
- HTTP: supported for trusted networks, but the app does not encrypt that connection. Prefer HTTPS or Tailscale.
- Errors: raw HTTP provider response bodies are not displayed, reducing accidental secret disclosure.

The dependency audit must be checked before releases. At initial verification, `npm audit --omit=dev` reported zero vulnerabilities; the complete audit reported moderate advisories in transitive installer tooling (including minimatch). Electron was upgraded to the current release to remove reported high-severity advisories. Do not use `npm audit fix --force` blindly: its proposed electron-builder downgrade is not a safe remediation. Track upstream fixes, review development-tool exposure and rerun installer tests when changing dependencies.

Production distribution still requires code signing, macOS notarization, dependency review, OS-device testing, and a review of the OAuth and future tool-execution boundaries.
