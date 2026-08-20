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
// ============================================================================
// Home Page Types
// ============================================================================

/**
 * Response from home page content API
 */
export interface HomePageContentResponse {
  success: boolean
  message?: string
  data?: string
}

/**
 * Home page content result from hook
 */
export interface HomePageContentResult {
  content: string
  isLoaded: boolean
  isUrl: boolean
}

export interface DesktopInstallerManifest {
  filename: string
  version: string
  sha256: string
  size: number
}

export interface DesktopDownloadCaptcha {
  challenge_id: string
  image_data_url: string
  expires_in: number
  installer: DesktopInstallerManifest
}

export interface DesktopDownloadAuthorization {
  download_url: string
  expires_in: number
  installer: DesktopInstallerManifest
}

export interface DesktopDownloadResponse<T> {
  success: boolean
  message?: string
  code?: string
  data?: T
}
