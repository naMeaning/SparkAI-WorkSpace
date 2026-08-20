# Runtime State

Runtime state is local generated data and must not be committed.

Ignored runtime state includes:

- `services/ai-gateway/config/`
- `services/ai-gateway/.diagnostics/`
- `services/crm-api/data/`
- `services/ai-gateway/new-api/logs/`
- `services/ai-gateway/new-api/data/`
- `services/ai-gateway/new-api/upload/`

These paths can contain local settings, tokens, cookies, SQLite databases, usage logs, uploaded files, generated images, and diagnostics. Keep them out of commits and regenerate them locally through the standard pnpm scripts.

If a checkout still has previously tracked runtime files such as `services/ai-gateway/config/new-api/one-api.db` or `services/ai-gateway/config/new-api/one-api.sql`, treat them as legacy tracked artifacts. Remove them from version control without deleting local copies, then keep relying on `.gitignore` for future local churn.
