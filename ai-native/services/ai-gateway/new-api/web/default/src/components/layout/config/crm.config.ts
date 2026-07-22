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
  BadgeDollarSign,
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  Coins,
  Gauge,
  GitBranch,
  Landmark,
  Network,
  Settings,
  ShieldAlert,
  UsersRound,
  WalletCards,
} from 'lucide-react'

import { ROLE } from '@/lib/roles'

import type { SidebarView } from '../types'

export const CRM_AGENT_SECTIONS = [
  'agent-overview',
  'agent-customers',
  'agent-team',
  'agent-commissions',
  'agent-withdrawals',
  'agent-offline-recharges',
  'agent-usage',
] as const

export const CRM_ADMIN_SECTIONS = [
  'admin-dashboard',
  'users',
  'agents',
  'relationships',
  'effective-customers',
  'account-events',
  'ledger',
  'commissions',
  'offline-recharges',
  'withdrawals',
  'risk',
  'enterprise',
  'audit',
  'settings',
] as const

export type CrmAgentSection = (typeof CRM_AGENT_SECTIONS)[number]
export type CrmAdminSection = (typeof CRM_ADMIN_SECTIONS)[number]
export type CrmSection = CrmAgentSection | CrmAdminSection

export const CRM_DEFAULT_AGENT_SECTION: CrmAgentSection = 'agent-overview'
export const CRM_DEFAULT_ADMIN_SECTION: CrmAdminSection = 'admin-dashboard'

export const CRM_VIEW: SidebarView = {
  id: 'crm',
  pathPattern: /^\/crm(?:\/|$)/,
  parent: {
    to: '/dashboard',
    label: '返回控制台',
  },
  showParentLink: false,
  getNavGroups: (t, context) => {
    if (context.role !== undefined && context.role >= ROLE.SUPER_ADMIN) {
      return [
        {
          id: 'crm-admin-platform',
          title: t('平台管理'),
          items: [
            { title: '经营概览', url: '/crm/admin-dashboard', icon: Gauge },
            { title: '分销档案', url: '/crm/users', icon: UsersRound },
            { title: '代理管理', url: '/crm/agents', icon: GitBranch },
            { title: '客户归属', url: '/crm/relationships', icon: Network },
            {
              title: '有效客户',
              url: '/crm/effective-customers',
              icon: ClipboardCheck,
            },
          ].map((item) => ({ ...item, title: t(item.title) })),
        },
        {
          id: 'crm-admin-finance',
          title: t('资金与结算'),
          items: [
            {
              title: '线下充值审核',
              url: '/crm/offline-recharges',
              icon: WalletCards,
            },
            {
              title: '入账事件',
              url: '/crm/account-events',
              icon: BadgeDollarSign,
            },
            { title: '账本流水', url: '/crm/ledger', icon: BookOpen },
            { title: '佣金管理', url: '/crm/commissions', icon: Coins },
            {
              title: '提现审核',
              url: '/crm/withdrawals',
              icon: WalletCards,
            },
            { title: '大客户', url: '/crm/enterprise', icon: Landmark },
          ].map((item) => ({ ...item, title: t(item.title) })),
        },
        {
          id: 'crm-admin-governance',
          title: t('风控与治理'),
          items: [
            { title: '风控', url: '/crm/risk', icon: ShieldAlert },
            { title: '审计日志', url: '/crm/audit', icon: ClipboardList },
            { title: '分销规则', url: '/crm/settings', icon: Settings },
          ].map((item) => ({ ...item, title: t(item.title) })),
        },
      ]
    }

    return [
      {
        id: 'crm-agent-distribution',
        title: t('我的分销'),
        items: [
          { title: '经营概览', url: '/crm/agent-overview', icon: Gauge },
          {
            title: '我的客户',
            url: '/crm/agent-customers',
            icon: UsersRound,
          },
          { title: '团队代理', url: '/crm/agent-team', icon: Network },
        ].map((item) => ({ ...item, title: t(item.title) })),
      },
      {
        id: 'crm-agent-finance',
        title: t('资金与用量'),
        items: [
          {
            title: '佣金明细',
            url: '/crm/agent-commissions',
            icon: Coins,
          },
          {
            title: '提现记录',
            url: '/crm/agent-withdrawals',
            icon: WalletCards,
          },
          {
            title: '线下充值',
            url: '/crm/agent-offline-recharges',
            icon: BadgeDollarSign,
          },
          { title: '用量流水', url: '/crm/agent-usage', icon: BookOpen },
        ].map((item) => ({ ...item, title: t(item.title) })),
      },
    ]
  },
}
