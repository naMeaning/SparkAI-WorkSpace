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
import { readFileSync } from 'node:fs'

const crmSourceFiles = [
  'section-config.ts',
  'shared-ui.tsx',
  'form-controls.tsx',
  'user-picker.tsx',
  'query-controls.tsx',
  'data-section.tsx',
  'agent-overview.tsx',
  'admin-dashboard.tsx',
  'admin-columns.tsx',
  'agent-columns.tsx',
  'action-columns.tsx',
  'admin-editors.tsx',
  'admin-data-sections.tsx',
  'admin-forms.tsx',
  'agent-section.tsx',
  'admin-section.tsx',
  'settings-section.tsx',
  'index.tsx',
] as const

export const crmFeatureSource = crmSourceFiles
  .map((fileName) => readFileSync(new URL(fileName, import.meta.url), 'utf8'))
  .join('\n')
