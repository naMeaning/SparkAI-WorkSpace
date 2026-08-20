export interface ServiceStatus {
  ok: boolean;
  service: string;
  checkedAt: string;
}

export function createServiceStatus(service: string, ok?: boolean): ServiceStatus;
