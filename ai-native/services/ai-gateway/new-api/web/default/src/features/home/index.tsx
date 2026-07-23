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
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { Download } from 'lucide-react'
import { useEffect, useState } from 'react'

import { PublicLayout } from '@/components/layout'
import { SiteLogoMark } from '@/components/layout/components/site-logo-mark'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'

import { ClientDownloadDialog } from './components/client-download-dialog'

export function Home() {
  const { auth } = useAuthStore()
  const isAuthenticated = !!auth.user
  const navigate = useNavigate()
  const search = useSearch({ from: '/' })
  const [downloadOpen, setDownloadOpen] = useState(false)

  useEffect(() => {
    if (!isAuthenticated || search.download !== '1') return
    setDownloadOpen(true)
    void navigate({ to: '/', search: {}, replace: true })
  }, [isAuthenticated, navigate, search.download])

  return (
    <PublicLayout showMainContainer={false} siteName='naimage'>
      <main className='flex min-h-svh items-center justify-center px-6 pt-20 pb-12'>
        <section className='mx-auto flex w-full max-w-5xl flex-col items-center text-center'>
          <SiteLogoMark
            className='mb-8 size-16 rounded-lg'
            textClassName='text-2xl'
          />
          <h1 className='text-foreground w-full max-w-full text-4xl leading-none font-semibold tracking-normal break-words sm:text-6xl md:text-7xl lg:text-8xl'>
            naimage
          </h1>
          <p className='text-muted-foreground mt-6 max-w-2xl text-base leading-7 sm:text-lg'>
            专注图像创作与模型接入的 AI 工作台。
          </p>
          <div className='mt-9 flex flex-wrap items-center justify-center gap-3'>
            {isAuthenticated ? (
              <Button
                className='h-11 rounded-lg px-6 text-sm font-medium'
                onClick={() => setDownloadOpen(true)}
              >
                <Download className='size-4' />
                下载 Windows 客户端
              </Button>
            ) : (
              <Button
                className='h-11 rounded-lg px-6 text-sm font-medium'
                render={
                  <Link to='/sign-in' search={{ redirect: '/?download=1' }} />
                }
              >
                <Download className='size-4' />
                登录并下载
              </Button>
            )}
            <Button
              variant='outline'
              className='h-11 rounded-lg px-6 text-sm font-medium'
              render={<Link to={isAuthenticated ? '/dashboard' : '/sign-in'} />}
            >
              进入控制台
            </Button>
          </div>
        </section>
      </main>
      {isAuthenticated && (
        <ClientDownloadDialog
          open={downloadOpen}
          onOpenChange={setDownloadOpen}
        />
      )}
    </PublicLayout>
  )
}
