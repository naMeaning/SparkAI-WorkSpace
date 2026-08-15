# Deployment

This Compose project deploys only the SparkAI extension. It does not deploy or fork New API.

1. Copy `.env.example` to `.env` and generate independent random values for the admin token and HMAC secret.
2. Set `SPARKAI_NEW_API_UPSTREAM` to the existing New API private origin. A loopback address, Docker service name, or private network address is preferred; do not use the Cloudflare public hostname.
3. Start the extension:

   ```bash
   docker compose -f deploy/sparkai-extension/compose.yaml up -d --build
   ```

4. Merge `Caddyfile.example` into the existing public site's routing before its New API catch-all.
5. Check `https://sparkapi.org/healthz` only if you explicitly expose that route, and verify `GET /api/naimage/license` through the public hostname.

Back up the `sparkai-extension-data` volume. `SPARKAI_EXTENSION_HASH_SECRET` must remain stable: changing it invalidates existing redemption codes, licenses, and task ownership hashes.

Run one replica. Image credentials exist only in that process memory, and interrupted tasks intentionally fail without replay to avoid duplicate upstream billing.
