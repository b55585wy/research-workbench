# Research workbench: first component integration

This is our own research application, separate from workbench-web. User authorized
the PDF reading / source-linked notes slice on 2026-10-30. Codex owns backend,
contracts, integration and acceptance; actual Kimi via OMP owns frontend HTML/JS/CSS.
Do not modify tFUS source, staging, live services, user data or global routing.

Keep native JavaScript and Python/FastAPI. Reuse PDF.js locally; no external CDN,
whole ELN deployment, notebook server, shared workspace schema or tFUS queue.
Read API.md and ACCEPTANCE.md. Implement actual persistence, not mocked success.
Keep ordinary UI free of implementation details. Neutral product styling, Chinese
and English, keyboard access and mobile operation are required.
