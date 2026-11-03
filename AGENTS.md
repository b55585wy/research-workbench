# Research workbench: first component integration

This is our own research application, separate from workbench-web. User authorized
the PDF reading / source-linked notes slice on 2026-10-30. ChatGPT plans; Codex owns
engineering tasks, contracts, integration and acceptance; DeepSeek implements specified
backend logic; actual Kimi via OMP owns frontend HTML/JS/CSS. Follow the global policy
in C:/Users/wangyi/.codex/AGENTS.md, including authorized quota fallback:
backend DeepSeek official -> Codex; frontend Kimi -> DeepSeek official.
Do not modify tFUS source, staging, live services, user data or global routing.

Frontend target is React + TypeScript + Vite, explicitly chosen by the user on
2026-11-03. Existing native JavaScript is the deployed implementation, retained
until each scoped migration is complete; do not treat it as a permanent stack rule.
Keep Python/FastAPI. React owns migrated UI state and DOM; isolate PDF.js/editor/
chart imperative DOM behind explicit lifecycle adapters, never dual ownership.
Preserve existing URLs, saved data, source coordinates, drafts and API semantics.
Agent orchestration, RAG literature QA and Python/R analysis are committed product
capabilities, not optional add-ons. See ARCHITECTURE.md for current versus target.
The latest user decision is standalone-first, single-machine with a default local
guest workspace. No registration/login or password/user tables in the first slice;
formal data stays in the local backend's SQLite/files, not solely browser cache.
Guest means unverified local context, never an authenticated actor or fake token.
Multi-account management comes later; preserve source IDs and explicitly migrate
guest ownership without assigning all history to the first account. Later isolated
authentication and tFUS integration use verified external identity mapping/APIs,
not shared databases, copied passwords or automatic email/name account merges.
There is no dependency on tFUS identity or release progress.
This supersedes this workbench's older tFUS-directory-first planning, without
changing tFUS's own identity policy. The default local mode remains single-user.
2026-11-04 authorization adds a separate opt-in server guest mode: password-free
per-guest data isolation and recovery, each guest supplies its own model key.
Keep the local default and existing owner service/data unchanged. Stable guest
space IDs permit later explicit verified-account binding; no registration or
fake authenticated actor is introduced now. See GUEST-SPACES.md for acceptance.
Reuse PDF.js locally; no external CDN, whole ELN deployment, notebook server,
shared workspace schema or tFUS queue.
Read API.md and ACCEPTANCE.md. Implement actual persistence, not mocked success.
Keep ordinary UI free of implementation details. Neutral product styling, Chinese
and English, keyboard access and mobile operation are required.

Current user testing instruction (2026-11-02): default to scoped smoke tests for
the changed workflow. Historical full-regression matrices are reference only;
do not routinely run the full suites. Report the actual verification scope.
