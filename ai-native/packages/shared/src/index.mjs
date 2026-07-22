export function createServiceStatus(service, ok = true) {
  return {
    ok: Boolean(ok),
    service: String(service),
    checkedAt: new Date().toISOString()
  };
}
