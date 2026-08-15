# SparkAI Extension

This is the only active service owned by `ai-native`. It extends an independently deployed, unmodified New API installation without copying its account, token, channel, quota, billing, or admin implementation.

It owns exactly two contracts:

- `/api/naimage/license/*`: Pro redemption codes and device licenses.
- `/v1/image-tasks/*`: short create/poll requests around the stock synchronous `/v1/images/generations` endpoint.

The image worker forwards the caller's Bearer API key only in memory to `SPARKAI_NEW_API_UPSTREAM`. SQLite stores an HMAC owner identity, never the API key. On restart, queued/running tasks fail and are not replayed. Completed rows and result files are removed by the configured retention policy during startup and every 15 minutes while the service is running.

## Local commands

```powershell
Copy-Item .env.example .env
# Load the environment values using your normal secret manager.
corepack pnpm run dev
corepack pnpm run check
```

Node.js 24 or newer is required because the service uses the built-in `node:sqlite` module and has no third-party runtime dependency.

## License administration

Set `SPARKAI_EXTENSION_URL` and the same admin token used by the service, then run:

```powershell
corepack pnpm run license:create -- --name "Pro permanent" --count 10 --valid-days 0 --max-devices 3
corepack pnpm run license:list -- --page 1 --size 20
corepack pnpm run license:disable -- --id 12
```

Plain redemption codes are returned only by `create`; the database retains an HMAC and a short display hint.
