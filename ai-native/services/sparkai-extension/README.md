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

The built-in administration page is available at:

```text
https://<your-api-domain>/api/naimage/license/admin
```

Enter `SPARKAI_EXTENSION_ADMIN_TOKEN` in the page. The token stays in page memory and is sent only in the `Authorization` header; it is cleared by refresh or logout. The page supports:

- Creating 1 to 100 codes per batch.
- Limiting each code to 1 to 100 activated devices and showing `used / maximum`.
- Permanent licenses or licenses valid for a fixed number of days after activation.
- An optional redemption deadline after which new devices cannot activate.
- Disabling a code and immediately revoking all device licenses issued by it.
- Copying or downloading newly generated plaintext codes.

Plain redemption codes are visible only once after creation. The database retains an HMAC and a short display hint, so losing the creation result requires issuing a new code.

The CLI remains available for server-side operation. Set `SPARKAI_EXTENSION_URL` and the same admin token used by the service, then run:

```powershell
corepack pnpm run license:create -- --name "Pro permanent" --count 10 --valid-days 0 --max-devices 3
corepack pnpm run license:list -- --page 1 --size 20
corepack pnpm run license:disable -- --id 12
```
