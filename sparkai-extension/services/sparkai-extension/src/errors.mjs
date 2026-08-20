export class ServiceError extends Error {
  constructor(status, code, message, options = {}) {
    super(message, options);
    this.name = "ServiceError";
    this.status = Number(status) || 500;
    this.code = String(code || "extension_error");
  }
}

export function serviceError(status, code, message) {
  return new ServiceError(status, code, message);
}

export function publicError(error) {
  if (error instanceof ServiceError) return error;
  return new ServiceError(503, "extension_unavailable", "SparkAI 扩展服务暂时不可用。", { cause: error });
}
