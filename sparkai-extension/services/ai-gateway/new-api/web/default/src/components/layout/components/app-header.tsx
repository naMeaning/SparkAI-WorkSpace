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
import { useNavigate } from '@tanstack/react-router'
import { Home, LayoutDashboard, Menu, Store } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTopNavLinks } from '@/hooks/use-top-nav-links'

import { defaultTopNavLinks } from '../config/top-nav.config'
import { type TopNavLink } from '../types'
import { Header } from './header'
import { SystemBrand } from './system-brand'
import { TopNav } from './top-nav'

/**
 * General application Header component
 * Integrates navigation bar, theme switch and profile functions
 *
 * @example
 * // Basic usage
 * <AppHeader />
 *
 * @example
 * // Custom navigation links
 * <AppHeader navLinks={customLinks} />
 *
 * @example
 * // Hide navigation bar
 * <AppHeader showTopNav={false} />
 *
 * @example
 * // Fully customize left and right content
 * <AppHeader
 *   leftContent={<CustomLeft />}
 *   rightContent={<CustomRight />}
 * />
 */
type AppHeaderProps = {
  /**
   * Custom navigation links, uses default global navigation or dynamically generated from backend if not provided
   */
  navLinks?: TopNavLink[]
  /**
   * Whether to show top navigation bar
   * @default true
   */
  showTopNav?: boolean
  /**
   * Left content, overrides TopNav if provided
   */
  leftContent?: React.ReactNode
  /**
   * Custom right content, overrides default right content if provided
   */
  rightContent?: React.ReactNode
  /**
   * Whether to show theme switch
   * @default true
   */
  showThemeSwitch?: boolean
  /**
   * Whether to show profile dropdown
   * @default true
   */
  showProfileDropdown?: boolean
}

const mobilePrimaryLinks = [
  { title: 'Home', to: '/', icon: Home },
  { title: 'Console', to: '/dashboard', icon: LayoutDashboard },
  { title: 'Model Square', to: '/pricing', icon: Store },
] as const

export function AppHeader({
  navLinks = defaultTopNavLinks,
  showTopNav = true,
  leftContent,
  rightContent,
  showThemeSwitch = true,
  showProfileDropdown = true,
}: AppHeaderProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  // Prioritize dynamically generated links from backend
  const dynamicLinks = useTopNavLinks()
  const links = showTopNav
    ? dynamicLinks.length > 0
      ? dynamicLinks
      : navLinks
    : []

  return (
    <>
      <Header>
        <SystemBrand variant='inline' to={showTopNav ? '/' : null} />

        {leftContent ? (
          <div className='ms-2 flex items-center'>{leftContent}</div>
        ) : null}

        {rightContent ?? (
          <div className='ms-auto flex items-center gap-1 sm:gap-2'>
            {showTopNav && (
              <div className='me-1 hidden lg:block'>
                <TopNav links={links} />
              </div>
            )}
            {showThemeSwitch && <ThemeSwitch />}
            {showProfileDropdown && <ProfileDropdown />}
            {showTopNav && (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant='ghost'
                      size='icon'
                      className='size-10 sm:size-8 lg:hidden'
                    />
                  }
                >
                  <Menu className='size-4' />
                  <span className='sr-only'>{t('Toggle navigation menu')}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align='end'
                  sideOffset={8}
                  className='w-44'
                >
                  {mobilePrimaryLinks.map((item) => {
                    const Icon = item.icon
                    return (
                      <DropdownMenuItem
                        key={item.to}
                        className='h-9'
                        onClick={() => navigate({ to: item.to })}
                      >
                        <Icon className='size-4' />
                        {t(item.title)}
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </Header>
    </>
  )
}
