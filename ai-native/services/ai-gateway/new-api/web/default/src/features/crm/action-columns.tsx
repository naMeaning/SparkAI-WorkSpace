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
import {
  accountEventStatuses,
  accountEventTypes,
  commissionStatuses,
  enterpriseMonthlySettlementStatuses,
  offlineRechargeStatuses,
  riskStatuses,
  type AccountEventDto,
  type CommissionDto,
  type EffectiveCustomerDto,
  type EnterpriseMonthlySettlementDto,
  type OfflineRechargeRequestDto,
  type RiskCaseDto,
  type WithdrawalDto,
} from '@ai-native/crm-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { StaticDataTableColumn } from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'

import { ActionGroup, Field, formValue } from './form-controls'
import { useCrmAction, useCrmPatchAction } from './query-controls'

export type ActionDialogField = {
  name: string
  label: string
  defaultValue?: string
  required?: boolean
  type?: string
}

export type ActionDialogState = {
  title: string
  path: string
  method?: 'POST' | 'PATCH'
  body?: Record<string, unknown>
  fields: ActionDialogField[]
}

export function ActionColumns() {
  const action = useCrmAction()
  const patch = useCrmPatchAction()
  const { t } = useTranslation()
  const [dialog, setDialog] = useState<ActionDialogState | null>(null)
  const submitting = action.isPending || patch.isPending
  const openActionDialog = (next: ActionDialogState) => setDialog(next)
  const confirmAction = (
    path: string,
    body: Record<string, unknown> = {},
    title = '确认操作'
  ) => {
    openActionDialog({
      title,
      path,
      method: 'POST',
      body,
      fields: [
        {
          name: 'reason',
          label: '操作原因',
          defaultValue: String(
            body.reason || body.reviewReason || body.notes || ''
          ),
          required: true,
        },
      ],
    })
  }
  const confirmPatchAction = (
    path: string,
    body: Record<string, unknown> = {},
    title = '确认操作'
  ) => {
    openActionDialog({
      title,
      path,
      method: 'PATCH',
      body,
      fields: [
        {
          name: 'notes',
          label: '处理备注',
          defaultValue: String(body.notes || body.reason || ''),
          required: true,
        },
      ],
    })
  }
  const submitDialog = async (form: FormData) => {
    if (!dialog) return
    const fieldBody: Record<string, unknown> = {}
    dialog.fields.forEach((field) => {
      fieldBody[field.name] = formValue(form, field.name)
    })
    const reason = String(fieldBody.reason || '')
    const payload = {
      path: dialog.path,
      body: {
        ...dialog.body,
        ...fieldBody,
        ...(reason ? { reason, reviewReason: reason, notes: reason } : {}),
      },
    }
    if (dialog.method === 'PATCH') {
      await patch.mutateAsync(payload)
    } else {
      await action.mutateAsync(payload)
    }
    setDialog(null)
  }
  const destructiveDialog = Boolean(
    dialog &&
    (/\/(reject|cancel|refund|block|clawback)$/.test(dialog.path) ||
      dialog.body?.action === 'cancel' ||
      dialog.body?.isRefunded === true ||
      dialog.body?.isRelatedAccount === true ||
      dialog.body?.isRisk === true)
  )
  return {
    dialog: dialog ? (
      <Dialog
        open={Boolean(dialog)}
        onOpenChange={(open) => {
          if (!open && !submitting) setDialog(null)
        }}
        title={dialog.title}
        description={t('请核对操作原因。提交后会写入 CRM 审计日志。')}
        footer={
          <>
            <Button
              variant='outline'
              disabled={submitting}
              onClick={() => setDialog(null)}
            >
              {t('取消')}
            </Button>
            <Button
              type='submit'
              form='crm-action-dialog-form'
              variant={destructiveDialog ? 'destructive' : 'default'}
              disabled={submitting}
            >
              {submitting ? t('提交中') : t('确认提交')}
            </Button>
          </>
        }
      >
        <form
          id='crm-action-dialog-form'
          className='grid gap-3'
          aria-busy={submitting}
          onSubmit={(event) => {
            event.preventDefault()
            void submitDialog(new FormData(event.currentTarget)).catch(() => {
              // The shared mutation reports the error and the dialog stays open.
            })
          }}
        >
          {dialog.fields.map((field) => (
            <Field
              key={field.name}
              label={field.label}
              name={field.name}
              type={field.type}
              required={field.required}
              defaultValue={field.defaultValue}
            />
          ))}
        </form>
      </Dialog>
    ) : null,
    offline: {
      id: 'actions',
      header: '操作',
      mobileLabel: '可用操作',
      mobileFullWidth: true,
      cell: (row: OfflineRechargeRequestDto) =>
        row.status === offlineRechargeStatuses.pending ? (
          <ActionGroup>
            <Button
              size='sm'
              variant='default'
              onClick={() =>
                confirmAction(
                  `/crm/admin/offline-recharge-requests/${row.id}/approve`,
                  { reviewReason: '已核对到账' }
                )
              }
            >
              通过
            </Button>
            <Button
              size='sm'
              variant='destructive'
              onClick={() =>
                confirmAction(
                  `/crm/admin/offline-recharge-requests/${row.id}/reject`,
                  { reviewReason: '未通过审核' }
                )
              }
            >
              驳回
            </Button>
          </ActionGroup>
        ) : (
          '-'
        ),
    } satisfies StaticDataTableColumn<OfflineRechargeRequestDto>,
    withdrawal: {
      id: 'actions',
      header: '操作',
      mobileLabel: '可用操作',
      mobileFullWidth: true,
      cell: (row: WithdrawalDto) => (
        <ActionGroup>
          {row.status === 'pending' ? (
            <>
              <Button
                size='sm'
                variant='default'
                onClick={() =>
                  confirmAction(`/crm/admin/withdrawals/${row.id}/approve`, {
                    reviewReason: '审核通过',
                  })
                }
              >
                通过
              </Button>
              <Button
                size='sm'
                variant='destructive'
                onClick={() =>
                  confirmAction(`/crm/admin/withdrawals/${row.id}/reject`, {
                    reviewReason: '审核驳回',
                  })
                }
              >
                驳回
              </Button>
            </>
          ) : null}
          {row.status === 'approved' ? (
            <Button
              size='sm'
              variant='outline'
              onClick={() =>
                openActionDialog({
                  title: '登记线下已打款',
                  path: `/crm/admin/withdrawals/${row.id}/mark-paid`,
                  body: { reviewReason: '线下已打款' },
                  fields: [
                    {
                      name: 'paidReference',
                      label: '打款凭证号',
                      required: true,
                    },
                    { name: 'paidEvidenceUrl', label: '凭证链接' },
                    {
                      name: 'reviewReason',
                      label: '处理备注',
                      defaultValue: '线下已打款',
                      required: true,
                    },
                  ],
                })
              }
            >
              已打款
            </Button>
          ) : null}
        </ActionGroup>
      ),
    } satisfies StaticDataTableColumn<WithdrawalDto>,
    commission: {
      id: 'actions',
      header: '操作',
      mobileLabel: '可用操作',
      mobileFullWidth: true,
      cell: (row: CommissionDto) =>
        row.id ? (
          <ActionGroup>
            {row.status === commissionStatuses.frozen ? (
              <Button
                size='sm'
                variant='default'
                onClick={() =>
                  confirmAction(`/crm/admin/commissions/${row.id}/release`, {
                    reason: '释放佣金',
                  })
                }
              >
                释放
              </Button>
            ) : null}
            {row.status === commissionStatuses.frozen ? (
              <Button
                size='sm'
                variant='destructive'
                onClick={() =>
                  confirmAction(`/crm/admin/commissions/${row.id}/block`, {
                    reason: '阻断佣金',
                  })
                }
              >
                阻断
              </Button>
            ) : null}
            {row.status !== commissionStatuses.clawedBack ? (
              <Button
                size='sm'
                variant='destructive'
                onClick={() =>
                  confirmAction(`/crm/admin/commissions/${row.id}/clawback`, {
                    reason: '追回佣金',
                  })
                }
              >
                追回
              </Button>
            ) : null}
          </ActionGroup>
        ) : (
          '-'
        ),
    } satisfies StaticDataTableColumn<CommissionDto>,
    accountEvent: {
      id: 'actions',
      header: '操作',
      mobileLabel: '可用操作',
      mobileFullWidth: true,
      cell: (row: AccountEventDto) => (
        <ActionGroup>
          {row.status === accountEventStatuses.quotaApplying ||
          row.status === accountEventStatuses.localApplying ||
          row.status === accountEventStatuses.reconcileRequired ? (
            <>
              <Button
                size='sm'
                variant='default'
                onClick={() =>
                  confirmAction(
                    `/crm/admin/account-events/${row.id}/reconcile`,
                    {
                      action: 'confirm_quota_applied',
                      reason: '已确认模型服务额度已入账',
                    }
                  )
                }
              >
                {row.status === accountEventStatuses.localApplying
                  ? '继续本地入账'
                  : '确认额度并入账'}
              </Button>
              {(row.status === accountEventStatuses.quotaApplying ||
                row.status === accountEventStatuses.reconcileRequired) &&
              !row.newApiResult ? (
                <Button
                  size='sm'
                  variant='destructive'
                  onClick={() =>
                    confirmAction(
                      `/crm/admin/account-events/${row.id}/reconcile`,
                      {
                        action: 'cancel',
                        reason: '已确认模型服务额度未入账',
                      }
                    )
                  }
                >
                  确认未执行并取消
                </Button>
              ) : null}
            </>
          ) : null}
          {row.status === accountEventStatuses.completed &&
          (row.eventType === accountEventTypes.adminPaidTopup ||
            row.eventType === accountEventTypes.onlineTopup) ? (
            <Button
              size='sm'
              variant='destructive'
              onClick={() =>
                confirmAction(`/crm/admin/account-events/${row.id}/refund`, {
                  reason: '人工登记退款',
                })
              }
            >
              登记退款
            </Button>
          ) : null}
        </ActionGroup>
      ),
    } satisfies StaticDataTableColumn<AccountEventDto>,
    effective: {
      id: 'actions',
      header: '操作',
      mobileLabel: '可用操作',
      mobileFullWidth: true,
      cell: (row: EffectiveCustomerDto) => (
        <ActionGroup>
          <Button
            size='sm'
            variant='outline'
            disabled={action.isPending}
            onClick={() =>
              action.mutate({
                path: '/crm/admin/effective-customers/sync-consumption',
                body: { customerCrmUserId: row.customerCrmUserId },
              })
            }
          >
            同步消耗
          </Button>
          <Button
            size='sm'
            variant='default'
            onClick={() =>
              confirmAction('/crm/admin/effective-customers/evaluate', {
                agentId: row.agentId,
                customerCrmUserId: row.customerCrmUserId,
                reason: '复核有效客户',
              })
            }
          >
            复核
          </Button>
          <Button
            size='sm'
            variant='destructive'
            onClick={() =>
              confirmAction('/crm/admin/effective-customers/evaluate', {
                agentId: row.agentId,
                customerCrmUserId: row.customerCrmUserId,
                isRefunded: true,
                reason: '客户已退款，取消有效客户资格',
              })
            }
          >
            退款
          </Button>
          <Button
            size='sm'
            variant='destructive'
            onClick={() =>
              confirmAction('/crm/admin/effective-customers/evaluate', {
                agentId: row.agentId,
                customerCrmUserId: row.customerCrmUserId,
                isRelatedAccount: true,
                reason: '关联账号，不计入有效客户',
              })
            }
          >
            关联账号
          </Button>
          <Button
            size='sm'
            variant='destructive'
            onClick={() =>
              confirmAction('/crm/admin/effective-customers/evaluate', {
                agentId: row.agentId,
                customerCrmUserId: row.customerCrmUserId,
                isRisk: true,
                reason: '风险客户，不计入有效客户',
              })
            }
          >
            风险
          </Button>
        </ActionGroup>
      ),
    } satisfies StaticDataTableColumn<EffectiveCustomerDto>,
    risk: {
      id: 'actions',
      header: '操作',
      mobileLabel: '可用操作',
      mobileFullWidth: true,
      cell: (row: RiskCaseDto) => (
        <ActionGroup>
          {[
            [riskStatuses.reviewing, '复核中'],
            [riskStatuses.resolved, '解决'],
            [riskStatuses.ignored, '忽略'],
          ].map(([status, label]) => {
            let variant: 'default' | 'destructive' | 'outline' = 'outline'
            if (status === riskStatuses.resolved) variant = 'default'
            if (status === riskStatuses.ignored) variant = 'destructive'

            return (
              <Button
                key={status}
                size='sm'
                variant={variant}
                onClick={() =>
                  confirmPatchAction(
                    `/crm/admin/risk-cases/${row.id}`,
                    { status, notes: row.notes || label },
                    '更新风控单状态'
                  )
                }
              >
                {label}
              </Button>
            )
          })}
        </ActionGroup>
      ),
    } satisfies StaticDataTableColumn<RiskCaseDto>,
    enterprise: {
      id: 'actions',
      header: '操作',
      mobileLabel: '可用操作',
      mobileFullWidth: true,
      cell: (row: EnterpriseMonthlySettlementDto) =>
        row.status === enterpriseMonthlySettlementStatuses.pending ? (
          <ActionGroup>
            <Button
              size='sm'
              variant='default'
              onClick={() =>
                openActionDialog({
                  title: '登记大客户月结已收款',
                  path: `/crm/admin/enterprise/monthly-settlements/${row.id}/mark-paid`,
                  body: {},
                  fields: [
                    {
                      name: 'paidReference',
                      label: '线下收款凭证',
                      defaultValue: row.paidReference || '',
                      required: true,
                    },
                    {
                      name: 'paidEvidenceUrl',
                      label: '凭证链接',
                      defaultValue: row.paidEvidenceUrl || '',
                    },
                    {
                      name: 'notes',
                      label: '备注',
                      defaultValue: '线下已收款',
                    },
                  ],
                })
              }
            >
              已收款
            </Button>
            <Button
              size='sm'
              variant='destructive'
              onClick={() =>
                confirmAction(
                  `/crm/admin/enterprise/monthly-settlements/${row.id}/cancel`,
                  { notes: '取消月结单' }
                )
              }
            >
              取消
            </Button>
          </ActionGroup>
        ) : (
          '-'
        ),
    } satisfies StaticDataTableColumn<EnterpriseMonthlySettlementDto>,
  }
}

export type CrmActionColumns = ReturnType<typeof ActionColumns>
