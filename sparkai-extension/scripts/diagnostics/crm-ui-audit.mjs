import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..', '..')
const outputRoot = resolve(
  process.env.CRM_UI_AUDIT_OUTPUT ||
    join(
      repoRoot,
      '.diagnostics',
      'crm-ui-audit',
      new Date().toISOString().replaceAll(':', '-')
    )
)
const profileDir = join(outputRoot, 'chrome-profile')
const chromePath =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const webBaseUrl = process.env.CRM_UI_WEB_URL || 'http://127.0.0.1:17862'
const apiBaseUrl = process.env.CRM_UI_API_URL || 'http://127.0.0.1:17860'
const username = process.env.CRM_UI_USERNAME
const password = process.env.CRM_UI_PASSWORD
const remoteDebuggingPort = Number(process.env.CRM_UI_CDP_PORT || 19331)
const colorScheme = process.env.CRM_UI_COLOR_SCHEME || 'dark'

const adminSections = [
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
]
const agentSections = [
  'agent-overview',
  'agent-customers',
  'agent-team',
  'agent-commissions',
  'agent-withdrawals',
  'agent-offline-recharges',
  'agent-usage',
]

if (!username || !password) {
  throw new Error('CRM_UI_USERNAME and CRM_UI_PASSWORD are required')
}
if (!['light', 'dark'].includes(colorScheme)) {
  throw new Error('CRM_UI_COLOR_SCHEME must be light or dark')
}

const configuredSections = process.env.CRM_UI_SECTIONS
  ? process.env.CRM_UI_SECTIONS.split(',')
      .map((section) => section.trim())
      .filter(Boolean)
  : null
const configuredAuthenticatedPaths = process.env.CRM_UI_AUTHENTICATED_PATHS
  ? process.env.CRM_UI_AUTHENTICATED_PATHS.split(',')
      .map((path) => path.trim())
      .filter((path) => path.startsWith('/'))
  : null

const viewports = [
  { name: 'desktop-1280', width: 1280, height: 900, deviceScaleFactor: 1 },
  { name: 'desktop-1440', width: 1440, height: 1000, deviceScaleFactor: 1 },
  { name: 'mobile-360', width: 360, height: 800, deviceScaleFactor: 1 },
  { name: 'mobile-375', width: 375, height: 812, deviceScaleFactor: 1 },
  { name: 'mobile-390', width: 390, height: 844, deviceScaleFactor: 1 },
  { name: 'mobile-430', width: 430, height: 932, deviceScaleFactor: 1 },
]
const evidenceViewportNames = new Set(['desktop-1440', 'mobile-390'])

await mkdir(outputRoot, { recursive: true })
await rm(profileDir, { recursive: true, force: true })

const chrome = spawn(
  chromePath,
  [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${remoteDebuggingPort}`,
    `--user-data-dir=${profileDir}`,
    '--window-size=1440,1000',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }
)

let chromeErrors = ''
chrome.stderr.setEncoding('utf8')
chrome.stderr.on('data', (chunk) => {
  chromeErrors += chunk
})

async function waitForJsonVersion() {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${remoteDebuggingPort}/json/version`
      )
      if (response.ok) return response.json()
    } catch {
      // Chrome has not opened the debugging socket yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150))
  }
  throw new Error('Timed out waiting for Chrome DevTools Protocol')
}

function createCdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl)
  const pending = new Map()
  let nextId = 1

  const opened = new Promise((resolvePromise, rejectPromise) => {
    socket.addEventListener('open', resolvePromise, { once: true })
    socket.addEventListener(
      'error',
      () =>
        rejectPromise(
          new Error('Could not connect to Chrome DevTools Protocol')
        ),
      { once: true }
    )
  })

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (!message.id) return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) {
      request.reject(new Error(`${request.method}: ${message.error.message}`))
    } else request.resolve(message.result)
  })

  return {
    async send(method, params = {}) {
      await opened
      const id = nextId++
      const result = new Promise((resolvePromise, rejectPromise) => {
        pending.set(id, {
          method,
          resolve: resolvePromise,
          reject: rejectPromise,
        })
      })
      socket.send(JSON.stringify({ id, method, params }))
      return result
    },
    close() {
      socket.close()
    },
  }
}

async function waitForPage(client, url, requireApplication = true) {
  const expected = new URL(url)
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const state = await client.send('Runtime.evaluate', {
        expression: `(() => ({
          readyState: document.readyState,
          href: location.href,
          appRootMounted: Boolean(document.querySelector('#root')?.children.length),
          bodyTextLength: document.body.textContent?.trim().length || 0,
        }))()`,
        returnByValue: true,
      })
      const value = state.result?.value
      if (value?.href) {
        const current = new URL(value.href)
        const expectedPathPrefix = expected.pathname.endsWith('/')
          ? expected.pathname
          : `${expected.pathname}/`
        const pathMatched =
          current.origin === expected.origin &&
          (current.pathname === expected.pathname ||
            current.pathname.startsWith(expectedPathPrefix)) &&
          (!expected.search || current.search === expected.search)
        if (
          pathMatched &&
          value.readyState === 'complete' &&
          (!requireApplication ||
            (value.appRootMounted && value.bodyTextLength > 0))
        ) {
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
          return
        }
      }
    } catch {
      // The previous execution context can disappear while navigation commits.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function navigate(client, url, requireApplication = true) {
  const response = await client.send('Page.navigate', { url })
  if (response.errorText) {
    throw new Error(`Could not navigate to ${url}: ${response.errorText}`)
  }
  await waitForPage(client, url, requireApplication)
}

async function evaluateValue(client, expression) {
  const response = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.text || 'Browser evaluation failed'
    )
  }
  return response.result?.value
}

async function auditCurrentPage(client) {
  return evaluateValue(
    client,
    `(() => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0' &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight;
      };
      const describe = (element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          slot: element.getAttribute('data-slot') || '',
          role: element.getAttribute('role') || '',
          label: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 80) || '',
          className: typeof element.className === 'string' ? element.className.slice(0, 240) : '',
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      };
      const all = [...document.querySelectorAll('body *')]
        .filter((element) => element instanceof HTMLElement)
        .filter(visible);
      const overflow = all
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < -1 || rect.right > window.innerWidth + 1;
        })
        .slice(0, 40)
        .map(describe);
      const minimumControlSize = window.innerWidth < 768 ? 40 : 24;
      const shortControls = [...document.querySelectorAll(
        'button, input:not([type="hidden"]), select, textarea, [role="button"], a[data-slot="button"]'
      )]
        .filter((element) => element instanceof HTMLElement)
        .filter(visible)
        .filter((element) => !element.classList.contains('sr-only'))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 1 || rect.height > 1;
        })
        .filter((element) => element.getAttribute('data-slot') !== 'sidebar-rail')
        .filter(
          (element) =>
            !element.getAttribute('aria-label')?.includes('TanStack Router Devtools')
        )
        .filter((element) => {
          if (!(element instanceof HTMLInputElement)) return true;
          if (!['checkbox', 'radio'].includes(element.type)) return true;
          const label = element.closest('label');
          if (!(label instanceof HTMLElement) || !visible(label)) return true;
          const rect = label.getBoundingClientRect();
          return rect.width < minimumControlSize || rect.height < minimumControlSize;
        })
        .map(describe)
        .filter(
          (control) =>
            control.height < minimumControlSize || control.width < minimumControlSize
        )
        .slice(0, 40);
      const surfaces = [...document.querySelectorAll(
        '[data-slot="dialog-content"], [data-slot="drawer-content"], [role="dialog"]'
      )]
        .filter((element) => element instanceof HTMLElement)
        .filter(visible)
        .map(describe);
      const clippedSurfaces = surfaces.filter(
        (surface) =>
          surface.left < -1 ||
          surface.right > window.innerWidth + 1 ||
          surface.top < -1 ||
          surface.bottom > window.innerHeight + 1
      );
      return {
        path: location.pathname,
        pageHealth: {
          title: document.title,
          appRootMounted: Boolean(document.querySelector('#root')?.children.length),
          bodyTextLength: document.body.textContent?.trim().length || 0,
          resolvedTheme: document.documentElement.classList.contains('light')
            ? 'light'
            : document.documentElement.classList.contains('dark')
              ? 'dark'
              : 'unknown',
          runtimeErrors: Array.isArray(window.__crmUiAuditErrors)
            ? window.__crmUiAuditErrors.slice(-20)
            : [],
        },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        document: {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          scrollHeight: document.documentElement.scrollHeight,
          clientHeight: document.documentElement.clientHeight,
        },
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        overflow,
        minimumControlSize,
        shortControls,
        surfaces,
        clippedSurfaces,
      };
    })()`
  )
}

function assertAuditHealthy(audit, label) {
  const failures = []
  if (audit.horizontalOverflow) failures.push('document horizontal overflow')
  if (audit.shortControls.length > 0) {
    const controls = audit.shortControls.slice(0, 3).map((control) => ({
      label: control.label,
      slot: control.slot,
      width: control.width,
      height: control.height,
    }))
    failures.push(
      `${audit.shortControls.length} undersized visible controls ${JSON.stringify(controls)}`
    )
  }
  if (audit.clippedSurfaces.length > 0) {
    failures.push(
      `${audit.clippedSurfaces.length} clipped dialog/drawer surfaces`
    )
  }
  if (audit.pageHealth.runtimeErrors.length > 0) {
    failures.push(
      `${audit.pageHealth.runtimeErrors.length} browser runtime errors`
    )
  }
  if (failures.length > 0) {
    throw new Error(`${label}: ${failures.join(', ')}`)
  }
}

async function captureUrl(
  client,
  viewport,
  name,
  url,
  captureNavigation = false
) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    mobile: viewport.name.startsWith('mobile'),
  })
  await navigate(client, url)

  const audit = await auditCurrentPage(client)

  const expectedPath = new URL(url).pathname
  const routeMatched =
    audit.path === expectedPath || audit.path.startsWith(`${expectedPath}/`)
  if (!routeMatched) {
    throw new Error(`Expected ${expectedPath}, received ${audit.path}`)
  }
  if (
    !audit.pageHealth.appRootMounted ||
    audit.pageHealth.bodyTextLength === 0
  ) {
    throw new Error(`Application did not render at ${expectedPath}`)
  }
  if (audit.pageHealth.resolvedTheme !== colorScheme) {
    throw new Error(
      `Expected ${colorScheme} theme at ${expectedPath}, received ${audit.pageHealth.resolvedTheme}`
    )
  }

  const screenshot = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
  await writeFile(
    join(outputRoot, `${name}.png`),
    Buffer.from(screenshot.data, 'base64')
  )
  assertAuditHealthy(audit, name)

  let navigationScreenshot = null
  if (captureNavigation) {
    await evaluateValue(
      client,
      `(() => {
        const trigger = document.querySelector('[data-slot="sidebar-trigger"]');
        if (!(trigger instanceof HTMLElement)) return false;
        trigger.click();
        return true;
      })()`
    )
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 350))
    audit.navigationAudit = await auditCurrentPage(client)
    const navigation = await client.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    })
    navigationScreenshot = `${name}-navigation.png`
    await writeFile(
      join(outputRoot, navigationScreenshot),
      Buffer.from(navigation.data, 'base64')
    )
    assertAuditHealthy(audit.navigationAudit, `${name} navigation`)
  }

  return { name, navigationScreenshot, ...audit }
}

async function captureCrmPage(client, viewport, section, firstSection) {
  const result = await captureUrl(
    client,
    viewport,
    `${viewport.name}-${section}`,
    `${webBaseUrl}/crm/${section}`,
    viewport.name.startsWith('mobile') && section === firstSection
  )

  const dialogLabels = {
    users: '编辑资料',
    agents: '编辑代理',
    'offline-recharges': '通过',
  }
  const dialogLabel = dialogLabels[section]
  if (viewport.name === 'mobile-390' && dialogLabel) {
    const opened = await evaluateValue(
      client,
      `(() => {
        const label = ${JSON.stringify(dialogLabel)};
        const button = [...document.querySelectorAll('button')]
          .find((candidate) => candidate.textContent?.trim().includes(label));
        if (!(button instanceof HTMLElement)) return false;
        button.click();
        return true;
      })()`
    )
    if (opened) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 350))
      result.dialogAudit = await auditCurrentPage(client)
      const dialog = await client.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      })
      result.dialogScreenshot = `${result.name}-dialog.png`
      await writeFile(
        join(outputRoot, result.dialogScreenshot),
        Buffer.from(dialog.data, 'base64')
      )
      assertAuditHealthy(result.dialogAudit, `${result.name} dialog`)
      await client.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Escape',
        code: 'Escape',
      })
      await client.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Escape',
        code: 'Escape',
      })
    }
  }

  return result
}

let client
try {
  const version = await waitForJsonVersion()
  const pages = await fetch(
    `http://127.0.0.1:${remoteDebuggingPort}/json/list`
  ).then((response) => response.json())
  const page = pages.find((item) => item.type === 'page')
  if (!page) throw new Error('Chrome did not expose a page target')

  client = createCdpClient(page.webSocketDebuggerUrl)
  await client.send('Page.enable')
  await client.send('Network.enable')
  await client.send('Runtime.enable')
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      window.__crmUiAuditErrors = [];
      window.addEventListener('error', (event) => {
        window.__crmUiAuditErrors.push(String(event.message || 'Window error').slice(0, 500));
      });
      window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason instanceof Error
          ? event.reason.message
          : String(event.reason || 'Unhandled rejection');
        window.__crmUiAuditErrors.push(reason.slice(0, 500));
      });
    })();`,
  })
  await client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: colorScheme }],
  })
  const themeCookie = await client.send('Network.setCookie', {
    name: 'vite-ui-theme',
    value: colorScheme,
    url: webBaseUrl,
    path: '/',
  })
  if (!themeCookie.success) {
    throw new Error(`Could not set ${colorScheme} theme cookie`)
  }

  const publicCaptures = []
  for (const viewport of viewports.filter((item) =>
    evidenceViewportNames.has(item.name)
  )) {
    for (const publicPage of [
      { name: 'home', path: '/' },
      { name: 'sign-in', path: '/sign-in' },
    ]) {
      publicCaptures.push(
        await captureUrl(
          client,
          viewport,
          `public-${viewport.name}-${publicPage.name}`,
          `${webBaseUrl}${publicPage.path}`
        )
      )
    }
  }

  await navigate(client, apiBaseUrl, false)

  const loginResult = await evaluateValue(
    client,
    `(async () => {
      const response = await fetch('/api/user/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(${JSON.stringify({ username, password })}),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        return { ok: response.ok, success: Boolean(payload.success), user: null };
      }
      const userId = payload.data?.id;
      const selfResponse = await fetch('/api/user/self', {
        credentials: 'include',
        headers: userId ? { 'New-Api-User': String(userId) } : {},
      });
      const selfPayload = await selfResponse.json();
      return {
        ok: selfResponse.ok,
        success: Boolean(selfPayload.success),
        user: selfPayload.data || null,
      };
    })()`
  )
  if (!loginResult?.ok || !loginResult?.success || !loginResult.user) {
    throw new Error('CRM UI audit login failed')
  }

  const isSuperAdmin = Number(loginResult.user.role || 0) >= 100
  const sections =
    configuredSections || (isSuperAdmin ? adminSections : agentSections)
  const authenticatedPaths =
    configuredAuthenticatedPaths ||
    (isSuperAdmin
      ? [
          '/dashboard/overview',
          '/wallet',
          '/usage-logs/common',
          '/usage-logs/drawing',
          '/usage-logs/task',
          '/users',
          '/system-settings/site',
        ]
      : [])

  await navigate(client, webBaseUrl)
  await evaluateValue(
    client,
    `(() => {
      const user = ${JSON.stringify(loginResult.user)};
      localStorage.setItem('user', JSON.stringify(user));
      if (user.id) localStorage.setItem('uid', String(user.id));
      return true;
    })()`
  )

  const authenticatedCaptures = []
  for (const viewport of viewports.filter((item) =>
    evidenceViewportNames.has(item.name)
  )) {
    for (const path of authenticatedPaths) {
      const slug = path.replace(/^\//, '').replaceAll('/', '-') || 'root'
      authenticatedCaptures.push(
        await captureUrl(
          client,
          viewport,
          `authenticated-${viewport.name}-${slug}`,
          `${webBaseUrl}${path}`
        )
      )
    }
  }

  const downloadDialogCaptures = []
  for (const viewport of viewports.filter((item) =>
    evidenceViewportNames.has(item.name)
  )) {
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
      mobile: viewport.name.startsWith('mobile'),
    })
    await navigate(client, webBaseUrl)
    const opened = await evaluateValue(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')]
          .find((candidate) => candidate.textContent?.includes('下载 Windows 客户端'));
        if (!(button instanceof HTMLElement)) return false;
        button.click();
        return true;
      })()`
    )
    if (!opened) {
      throw new Error('Authenticated client download trigger was not rendered')
    }

    const dialogDeadline = Date.now() + 5_000
    let dialogVisible = false
    while (Date.now() < dialogDeadline && !dialogVisible) {
      dialogVisible = await evaluateValue(
        client,
        `Boolean(document.querySelector('[data-slot="dialog-content"]'))`
      )
      if (!dialogVisible) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
      }
    }
    if (!dialogVisible) {
      throw new Error('Client download dialog did not open')
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 350))
    const audit = await auditCurrentPage(client)
    const screenshotName = `authenticated-${viewport.name}-client-download-dialog.png`
    const screenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    })
    await writeFile(
      join(outputRoot, screenshotName),
      Buffer.from(screenshot.data, 'base64')
    )
    assertAuditHealthy(
      audit,
      `authenticated-${viewport.name}-client-download-dialog`
    )
    downloadDialogCaptures.push({
      name: `authenticated-${viewport.name}-client-download-dialog`,
      screenshot: screenshotName,
      ...audit,
    })
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
    })
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
    })
  }

  const captures = []
  for (const viewport of viewports) {
    for (const section of sections) {
      captures.push(
        await captureCrmPage(client, viewport, section, sections[0])
      )
    }
  }

  const report = {
    createdAt: new Date().toISOString(),
    browser: version.Browser,
    colorScheme,
    webBaseUrl,
    apiBaseUrl,
    role: isSuperAdmin ? 'admin' : 'agent',
    sections,
    authenticatedPaths,
    viewports,
    publicCaptures,
    authenticatedCaptures,
    downloadDialogCaptures,
    captures,
  }
  await writeFile(
    join(outputRoot, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
  process.stdout.write(`${outputRoot}\n`)
} finally {
  client?.close()
  chrome.kill()
  if (chromeErrors) {
    await writeFile(join(outputRoot, 'chrome.stderr.log'), chromeErrors)
  }
}
