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
import { Download, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

import { authorizeDesktopDownload, createDesktopDownloadCaptcha } from '../api'
import type { DesktopDownloadCaptcha } from '../types'

interface ClientDownloadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function errorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback
  const response = (error as { response?: { data?: { message?: unknown } } })
    .response
  return typeof response?.data?.message === 'string'
    ? response.data.message
    : fallback
}

export function ClientDownloadDialog({
  open,
  onOpenChange,
}: ClientDownloadDialogProps) {
  const [captcha, setCaptcha] = useState<DesktopDownloadCaptcha | null>(null)
  const [code, setCode] = useState('')
  const [loadingCaptcha, setLoadingCaptcha] = useState(false)
  const [authorizing, setAuthorizing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const loadCaptcha = useCallback(async () => {
    setLoadingCaptcha(true)
    setCode('')
    try {
      const response = await createDesktopDownloadCaptcha()
      if (!response.success || !response.data) {
        throw new Error(response.message || '验证码生成失败')
      }
      setCaptcha(response.data)
      window.setTimeout(() => inputRef.current?.focus(), 50)
    } catch (error) {
      setCaptcha(null)
      const message = errorMessage(error, '')
      toast.error(
        message ||
          (error instanceof Error
            ? error.message
            : '验证码生成失败，请稍后重试。')
      )
    } finally {
      setLoadingCaptcha(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      void loadCaptcha()
    } else {
      setCaptcha(null)
      setCode('')
      setAuthorizing(false)
    }
  }, [loadCaptcha, open])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!captcha || code.length !== 6 || authorizing) return
    setAuthorizing(true)
    try {
      const response = await authorizeDesktopDownload({
        challengeId: captcha.challenge_id,
        code,
      })
      if (!response.success || !response.data?.download_url) {
        throw new Error(response.message || '下载授权失败')
      }
      toast.success('验证成功，安装包即将开始下载。')
      window.location.assign(response.data.download_url)
      window.setTimeout(() => onOpenChange(false), 350)
    } catch (error) {
      const message = errorMessage(error, '')
      toast.error(
        message ||
          (error instanceof Error
            ? error.message
            : '验证失败，请刷新验证码后重试。')
      )
      await loadCaptcha()
    } finally {
      setAuthorizing(false)
    }
  }

  let captchaView: ReactNode = (
    <span className='text-muted-foreground text-xs'>点击重新获取验证码</span>
  )
  if (loadingCaptcha) {
    captchaView = (
      <Loader2 className='text-muted-foreground size-5 animate-spin' />
    )
  } else if (captcha) {
    captchaView = (
      <img
        src={captcha.image_data_url}
        alt='下载验证码'
        className='h-full w-full object-contain'
        draggable={false}
      />
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <div className='bg-primary/10 text-primary mb-1 flex size-10 items-center justify-center rounded-xl'>
            <Download className='size-5' />
          </div>
          <DialogTitle>下载 naimage</DialogTitle>
          <DialogDescription>
            输入图片中的 6 位验证码，验证成功后开始下载 Windows 安装包。
          </DialogDescription>
        </DialogHeader>

        <form className='grid gap-4' onSubmit={handleSubmit}>
          {captcha && (
            <div className='bg-muted/35 grid gap-2 rounded-lg px-3 py-2.5'>
              <div className='flex items-center justify-between gap-3 text-sm'>
                <span className='min-w-0 truncate font-medium'>
                  {captcha.installer.filename}
                </span>
                <span className='text-muted-foreground shrink-0 text-xs'>
                  {formatBytes(captcha.installer.size)}
                </span>
              </div>
              <div className='text-muted-foreground flex items-center gap-1.5 text-xs'>
                <ShieldCheck className='size-3.5' />
                <span>版本 {captcha.installer.version}</span>
                <span aria-hidden>·</span>
                <span className='truncate font-mono'>
                  SHA-256 {captcha.installer.sha256.slice(0, 12)}…
                </span>
              </div>
            </div>
          )}

          <div className='grid gap-2'>
            <Button
              type='button'
              variant='outline'
              className='h-auto min-h-16 w-full min-w-0 justify-between gap-3 overflow-hidden px-3 py-2'
              onClick={() => void loadCaptcha()}
              disabled={loadingCaptcha || authorizing}
              aria-label='刷新验证码'
              aria-busy={loadingCaptcha}
            >
              <span className='flex h-full min-w-0 flex-1 items-center justify-center overflow-hidden'>
                {captchaView}
              </span>
              <span className='text-muted-foreground inline-flex shrink-0 items-center gap-1.5 text-xs'>
                <RefreshCw
                  className={loadingCaptcha ? 'animate-spin' : undefined}
                />
                <span className='hidden sm:inline'>换一张</span>
              </span>
            </Button>
            <Input
              ref={inputRef}
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replaceAll(/\D/g, '').slice(0, 6))
              }
              inputMode='numeric'
              autoComplete='off'
              maxLength={6}
              placeholder='请输入 6 位验证码'
              className='text-center font-mono text-base tracking-[0.35em]'
              disabled={!captcha || loadingCaptcha || authorizing}
              aria-label='下载验证码'
            />
          </div>

          <DialogFooter>
            <Button
              type='submit'
              className='w-full sm:w-auto'
              disabled={!captcha || code.length !== 6 || authorizing}
            >
              {authorizing ? (
                <Loader2 className='animate-spin' />
              ) : (
                <Download />
              )}
              验证并下载
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
