# Research workbench: first component integration

This is our own research application, separate from workbench-web. User authorized
the PDF reading / source-linked notes slice on 2026-10-30. ChatGPT plans; Codex owns
engineering tasks, contracts, implementation coordination, integration and acceptance.
OMP's latest selected profile is deepseek-kimi: DeepSeek official API is the
default backend client and Kimi is the default frontend client. Codex owns
architecture, decomposition, coordination and acceptance. This supersedes the
earlier all-codex default. Read C:/Users/wangyi/.omp/agent/role-routing.json
before dispatch. Follow the global policy
in C:/Users/wangyi/.codex/AGENTS.md, including authorized quota fallback:
backend Codex -> DeepSeek official; frontend Codex/Kimi -> DeepSeek official.
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
The original standalone mode stores formal data in its backend's SQLite/files.
The 2026-11-04 cost decision adds a true browser-device storage mode: IndexedDB
for formal PDF/image/note records, explicit local/server choice, no silent file
uploads or data moves. Existing backend/server records remain accessible and
unchanged. Device storage is not a fake authenticated actor. This supersedes
the older backend-only local-storage restriction. See LOCAL-STORAGE-PLAN.md.
Guest means unverified local context, never an authenticated actor or fake token.
Multi-account management comes later; preserve source IDs and explicitly migrate
guest ownership without assigning all history to the first account. Later isolated
authentication and tFUS integration use verified external identity mapping/APIs,
not shared databases, copied passwords or automatic email/name account merges.
There is no dependency on tFUS identity or release progress.
This supersedes this workbench's older tFUS-directory-first planning, without
changing tFUS's own identity policy. The default local mode remains single-user.
2026-11-04 authorization adds a separate opt-in server guest mode: password-free
per-guest data isolation and recovery. The 2026-11-05 user authorization supersedes
BYOK-only for both public sites: platform DeepSeek is the default, a guest's valid
personal key takes priority, and explicit return to platform is supported. Keep the
operator credential outside guest roots and all browser responses/bundles; invalid
personal configuration must not silently fall back or spend platform credit.
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

2026-11-04 integration slice based on main0.54 adds a passive source summary for the selected one-row tFUS CSV, within the existing analysis preview. All source fields are unverified file claims; no source access, identity mapping, fetch, Agent sharing or analysis action is inferred. Keep the original CSV/table, null/zero, units/scoring timing and owner-bound lifecycle. This slice does not overwrite other workspaces or public services. See TFUS-INTEGRATION.md.
