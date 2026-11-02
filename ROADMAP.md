# Roadmap

## 1. Desktop foundation

- [x] Messenger layout inspired by the supplied reference.
- [x] Settings and local provider connections.
- [x] Agents with independent instructions and model selection.
- [x] Persistent YAML definitions and local conversations.
- [x] Real streaming chat through OpenAI-compatible endpoints.
- [x] Actual Electron end-to-end tests.
- [x] Installer configuration and cross-platform CI workflow.
- [ ] Verify CI installers on the user's Windows PC and M2 Mac.
- [ ] Agent deletion, connection deletion, conversation reset and export.
- [ ] Application identity: icon, signing and macOS notarization.

## 2. Standalone provider access

- [x] Use the embedded pi-ai TypeScript connector for ChatGPT/Codex; keep LiteLLM as an optional external gateway rather than bundling Python.
- [x] Browser OAuth login with PKCE, cancellation, protected rotating credentials, refresh, local logout and readable authorization/quota errors.
- [x] No manual Python installation or external gateway required for subscription login.
- [x] Bundled connector model catalog and per-model context metadata; clearly distinguish catalog entries from account entitlements.
- [ ] Verify login and a real subscription response on the user's Windows PC.
- [ ] Account-specific model discovery, if the provider exposes a supported entitlement endpoint.
- [ ] Direct Anthropic connection and real-provider smoke tests.
- [x] Per-model context windows for ChatGPT.
- [ ] Per-model capabilities and context windows for other providers, not connection-level assumptions.
- [ ] Prevent inadvertent provider changes from sending private conversation history to a different destination without confirmation.

## 3. Agent capabilities

- [ ] Define the supported skill format and discovery locations.
- [ ] Local stdio and remote HTTP MCP clients.
- [ ] Tool allowlists assigned per agent.
- [ ] Agent loop with tool calls, cancellation and execution limits.
- [ ] Backend-enforced permissions and confirmation for side effects.
- [ ] Present tool progress without exposing noisy logs by default.
- [ ] Explicit handling of malicious instructions from tools and documents.

## 4. YouTube as the first complete workflow

- [ ] Independent transcription service on cluster, reachable through Tailscale.
- [ ] Compare the existing Parakeet pipeline with faster-whisper/WhisperX.
- [ ] Optional alignment and diarization; anonymous speaker labels unless identified explicitly.
- [ ] GPU worker queue, persistent job IDs and reconnectable status.
- [ ] Cache source metadata, timestamped transcript and processing options.
- [ ] Transcript search and passage retrieval tools.
- [ ] Answers with timestamps and clear source attribution.
- [ ] Continue remote transcription when the desktop app is closed.
- [ ] Treat visual video understanding as a separate feature from audio transcription.

## 5. Context and memory

- [ ] Multiple conversations per agent with simple navigation.
- [ ] Reliable context estimation, output reserve and usage from providers.
- [ ] Automatic compaction that preserves the original history.
- [ ] Explicit per-agent memories with provenance, inspection, editing and deletion.
- [ ] Sensitive-data controls and retention policies, including fiscal documents.
- [ ] Evaluate cross-device synchronization separately from multiplatform installation.

## Later, only when justified by use

Routines, background desktop execution, notifications, voice, multi-agent collaboration and automatic model routing. No silent provider fallback.
