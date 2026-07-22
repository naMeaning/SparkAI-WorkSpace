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
import { api } from '@/lib/api'

import type {
  DesktopDownloadAuthorization,
  DesktopDownloadCaptcha,
  DesktopDownloadResponse,
  HomePageContentResponse,
} from './types'

// ============================================================================
// Home Page APIs
// ============================================================================

/**
 * Get custom home page content
 * Returns Markdown/HTML content or iframe URL
 */
export async function getHomePageContent(): Promise<HomePageContentResponse> {
  const res = await api.get('/api/home_page_content')
  return res.data
}

export async function createDesktopDownloadCaptcha(): Promise<
  DesktopDownloadResponse<DesktopDownloadCaptcha>
> {
  const res = await api.post('/api/desktop-download/captcha', undefined, {
    skipBusinessError: true,
    skipErrorHandler: true,
  })
  return res.data
}

export async function authorizeDesktopDownload(input: {
  challengeId: string
  code: string
}): Promise<DesktopDownloadResponse<DesktopDownloadAuthorization>> {
  const res = await api.post(
    '/api/desktop-download/authorize',
    { challenge_id: input.challengeId, code: input.code },
    { skipBusinessError: true, skipErrorHandler: true }
  )
  return res.data
}
