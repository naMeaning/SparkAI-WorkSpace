/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import type {
  AccountEventDto,
  AgentCustomerDto,
  AgentDto,
  AuditLogEntryDto,
  CommissionDto,
  CrmAgentDashboardDto,
  CrmApiPayload,
  CrmSessionDto,
  CrmSettingsDto,
  CrmUserDto,
  EffectiveCustomerDto,
  EnterpriseMonthlySettlementDto,
  LedgerEntryDto,
  OfflineRechargeRequestDto,
  PageResult,
  RiskCaseDto,
  WithdrawalDto,
} from '@ai-native/crm-contracts'

import { api } from '@/lib/api'

export class CrmApiError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'CrmApiError'
    this.code = code
  }
}

type QueryValue = string | number | boolean | null | undefined

export interface NewApiUsageLogDto {
  id: string
  modelName: string
  quota: number
  promptTokens: number
  completionTokens: number
  content: string
  createdAt: string
}

interface NewApiPagePayload<T> {
  page?: number
  page_size?: number
  total?: number
  items?: T[]
}

interface NewApiUsageLogRecord {
  id?: string | number
  model_name?: string
  model?: string
  quota?: number
  prompt_tokens?: number
  completion_tokens?: number
  content?: string
  created_at?: number | string
}

export function buildCrmPath(
  path: string,
  params: Record<string, QueryValue> = {}
) {
  const searchParams = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === false) return
    const text = String(value).trim()
    if (text) searchParams.set(key, text)
  })
  const query = searchParams.toString()
  return query ? `${path}?${query}` : path
}

export async function crmRequest<T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const response = await api.request<CrmApiPayload<T>>({
    url: `/api${path}`,
    method: options.method || 'GET',
    data: options.body,
    skipBusinessError: true,
  })
  const payload = response.data
  if (payload?.ok === false) {
    throw new CrmApiError(
      payload.error_code || 'crm_request_failed',
      payload.err_msg || '分销中心请求失败'
    )
  }
  return (payload?.ok === true ? payload.data : payload) as T
}

function newApiTimestampToIso(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString()
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) {
      return new Date(numeric * 1000).toISOString()
    }
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return ''
}

function toNewApiUsageLog(record: NewApiUsageLogRecord): NewApiUsageLogDto {
  return {
    id: String(record.id ?? ''),
    modelName: String(record.model_name || record.model || '-'),
    quota: Number(record.quota || 0),
    promptTokens: Number(record.prompt_tokens || 0),
    completionTokens: Number(record.completion_tokens || 0),
    content: String(record.content || ''),
    createdAt: newApiTimestampToIso(record.created_at),
  }
}

async function newApiUsageLogs(
  params: Record<string, QueryValue>
): Promise<PageResult<NewApiUsageLogDto>> {
  const path = buildCrmPath('/api/log/self', {
    p: params.page,
    page_size: params.pageSize,
  })
  const response = await api.get<{
    success?: boolean
    message?: string
    data?: NewApiPagePayload<NewApiUsageLogRecord>
  }>(path, { skipBusinessError: true })
  if (response.data?.success === false) {
    throw new CrmApiError(
      'new_api_usage_logs_failed',
      response.data.message || '用量流水请求失败'
    )
  }
  const data = response.data?.data || {}
  return {
    items: (data.items || []).map(toNewApiUsageLog),
    total: Number(data.total || 0),
    page: Number(data.page || params.page || 1),
    pageSize: Number(data.page_size || params.pageSize || 20),
  }
}

export const crmApi = {
  session: () => crmRequest<CrmSessionDto>('/crm/session/self'),
  agentDashboard: () =>
    crmRequest<CrmAgentDashboardDto>('/crm/agent/dashboard'),
  agentCustomers: (params: Record<string, QueryValue>) =>
    crmRequest<PageResult<AgentCustomerDto>>(
      buildCrmPath('/crm/agent/customers', params)
    ),
  agentSubAgents: (params: Record<string, QueryValue>) =>
    crmRequest<PageResult<AgentDto>>(
      buildCrmPath('/crm/agent/sub-agents', params)
    ),
  agentCommissions: (params: Record<string, QueryValue>) =>
    crmRequest<PageResult<CommissionDto>>(
      buildCrmPath('/crm/agent/commissions', params)
    ),
  agentWithdrawals: (params: Record<string, QueryValue>) =>
    crmRequest<PageResult<WithdrawalDto>>(
      buildCrmPath('/crm/agent/withdrawals', params)
    ),
  agentOfflineRecharges: (params: Record<string, QueryValue>) =>
    crmRequest<PageResult<OfflineRechargeRequestDto>>(
      buildCrmPath('/crm/agent/offline-recharge-requests', params)
    ),
  offlineRechargeSettings: () =>
    crmRequest<{ accounts: CrmSettingsDto['offlineRechargeAccounts'] }>(
      '/crm/agent/offline-recharge-settings'
    ),
  createOfflineRecharge: (body: unknown) =>
    crmRequest<OfflineRechargeRequestDto>(
      '/crm/agent/offline-recharge-requests',
      { method: 'POST', body }
    ),
  createWithdrawal: (body: unknown) =>
    crmRequest<WithdrawalDto>('/crm/agent/withdrawals', {
      method: 'POST',
      body,
    }),
  usageLogs: newApiUsageLogs,

  dashboardSummary: () =>
    crmRequest<{
      paidTopupRmb: number
      frozenCommissionRmb: number
      releasableCommissionRmb: number
      releasedCommissionRmb: number
      pendingWithdrawalRmb: number
      reconcileRequiredAccountEvents: number
      pendingOfflineRecharges: number
      pendingWithdrawals: number
      approvedWithdrawals: number
      openRiskCases: number
      userCount: number
      agentCount: number
    }>('/crm/admin/dashboard/summary'),
  users: (params: Record<string, QueryValue>) =>
    crmRequest<PageResult<CrmUserDto>>(
      buildCrmPath('/crm/admin/users', params)
    ),
  agents: (params: Record<string, QueryValue>) =>
    crmRequest<PageResult<AgentDto>>(buildCrmPath('/crm/admin/agents', params)),
  accountEvents: (params: Record<string, QueryValue>) =>
    crmRequest<PageResult<AccountEventDto>>(
      buildCrmPath('/crm/admin/account-events', params)
    ),
  ledger: (params: Record<string, QueryValue>) =>
    crmRequest<PageResult<LedgerEntryDto>>(
      buildCrmPath('/crm/admin/ledger', params)
    ),
  commissions: (params: Record<string, QueryValue>) =>
    crmRequest<PageResult<CommissionDto>>(
      buildCrmPath('/crm/admin/commissions', params)
    ),
  offlineRecharges: (params: Record<string, QueryValue>) =>
    crmRequest<PageResult<OfflineRechargeRequestDto>>(
      buildCrmPath('/crm/admin/offline-recharge-requests', params)
    ),
  withdrawals: (params: Record<string, QueryValue>) =>
    crmRequest<PageResult<WithdrawalDto>>(
      buildCrmPath('/crm/admin/withdrawals', params)
    ),
  effectiveCustomers: (params: Record<string, QueryValue>) =>
    crmRequest<PageResult<EffectiveCustomerDto>>(
      buildCrmPath('/crm/admin/effective-customers', params)
    ),
  enterpriseSettlements: (params: Record<string, QueryValue>) =>
    crmRequest<PageResult<EnterpriseMonthlySettlementDto>>(
      buildCrmPath('/crm/admin/enterprise/monthly-settlements', params)
    ),
  riskCases: (params: Record<string, QueryValue>) =>
    crmRequest<PageResult<RiskCaseDto>>(
      buildCrmPath('/crm/admin/risk-cases', params)
    ),
  auditLogs: (params: Record<string, QueryValue>) =>
    crmRequest<PageResult<AuditLogEntryDto>>(
      buildCrmPath('/crm/admin/audit-logs', params)
    ),
  settings: () => crmRequest<CrmSettingsDto>('/crm/admin/settings'),
  updateSettings: (body: unknown) =>
    crmRequest<CrmSettingsDto>('/crm/admin/settings', {
      method: 'PATCH',
      body,
    }),
  patchAction: <T = unknown>(path: string, body: unknown = {}) =>
    crmRequest<T>(path, { method: 'PATCH', body }),
  postAction: <T = unknown>(path: string, body: unknown = {}) =>
    crmRequest<T>(path, { method: 'POST', body }),
}
