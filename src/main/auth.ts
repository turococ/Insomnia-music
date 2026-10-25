import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserWindow, session, shell, type Session } from 'electron'
import type { AuthEnvironment, AuthMode } from '@shared/types'

const AUTH_PARTITION = 'persist:toneglass-auth'
const AUTH_COOKIE_URL = 'https://music.youtube.com/'
const SIGN_IN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F&hl=en'
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000
const COOKIE_POLL_MS = 800
const BROWSER_START_TIMEOUT_MS = 20_000
const BROWSER_TARGET_TIMEOUT_MS = 15_000
const BROWSER_CLOSE_TIMEOUT_MS = 3_000

// Google blocks embedded Chromium sessions from its account flow with
// "This browser or app may not be secure". Presenting a Firefox user agent
// reduces that risk in the fallback window. The primary flow uses the user's
// real browser, which Google treats as a supported client.
function loginUserAgent(): string {
  const platform =
    process.platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : process.platform === 'linux'
        ? 'X11; Linux x86_64'
        : 'Macintosh; Intel Mac OS X 10.15'
  return `Mozilla/5.0 (${platform}; rv:142.0) Gecko/20100101 Firefox/142.0`
}

const AUTH_COOKIE_NAMES = new Set([
  'SID',
  'HSID',
  'SSID',
  'APISID',
  'SAPISID',
  '__Secure-1PSID',
  '__Secure-3PSID',
  '__Secure-1PAPISID',
  '__Secure-3PAPISID'
])

interface CookieLike {
  name?: string
  value?: string
}

interface BrowserCandidate {
  name: string
  path: string
}

interface CdpCookie {
  name?: string
  value?: string
  domain?: string
  path?: string
  expires?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: string
  partitionKey?: unknown
}

interface ImportableCookie extends CdpCookie {
  name: string
  value: string
  domain: string
}

interface CdpTarget {
  type?: string
  url?: string
  webSocketDebuggerUrl?: string
}

interface SignInTarget extends CdpTarget {
  webSocketDebuggerUrl: string
}

interface BrowserSocket {
  onopen: (() => void) | null
  onerror: ((event: unknown) => void) | null
  onclose: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  send(data: string): void
  close(): void
}

type BrowserSocketConstructor = new (url: string) => BrowserSocket

interface CdpPending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

interface CdpMessage {
  id?: number
  result?: unknown
  error?: {
    message?: string
  }
}

function hasAuthCookies(cookies: CookieLike[]): boolean {
  return cookies.some(
    (cookie) =>
      Boolean(cookie.value) && Boolean(cookie.name) && AUTH_COOKIE_NAMES.has(cookie.name as string)
  )
}

function cookieFingerprint(cookies: CookieLike[]): string {
  return cookies
    .filter((cookie) => Boolean(cookie.name) && AUTH_COOKIE_NAMES.has(cookie.name as string))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .sort()
    .join(';')
}

function normalizedDomain(domain: string | undefined): string {
  return (domain ?? '').replace(/^\./, '').toLowerCase()
}

function isYoutubeCookie(cookie: { domain?: string }): boolean {
  const domain = normalizedDomain(cookie.domain)
  return domain === 'youtube.com' || domain.endsWith('.youtube.com')
}

function isImportableCookie(cookie: CdpCookie): cookie is ImportableCookie {
  if (!cookie.name || !cookie.value || !cookie.domain || cookie.partitionKey) return false
  if (!isYoutubeCookie(cookie)) return false
  if (typeof cookie.expires === 'number' && cookie.expires > 0) {
    return cookie.expires > Date.now() / 1000
  }
  return true
}

function cookieUrl(domain: string, secure: boolean, path: string | undefined): string {
  const host = normalizedDomain(domain)
  const cookiePath = path?.startsWith('/') ? path : '/'
  return `${secure ? 'https' : 'http'}://${host}${cookiePath}`
}

function mapSameSite(
  value: string | undefined
): 'unspecified' | 'no_restriction' | 'lax' | 'strict' {
  switch (value) {
    case 'Strict':
      return 'strict'
    case 'Lax':
      return 'lax'
    case 'None':
      return 'no_restriction'
    default:
      return 'unspecified'
  }
}

function isSignInUrl(url: string | undefined): boolean {
  if (!url) return false
  try {
    const host = new URL(url).hostname
    return host === 'google.com' || host.endsWith('.google.com') || isYoutubeHost(host)
  } catch {
    return false
  }
}

function isYoutubeHost(host: string): boolean {
  return host === 'youtube.com' || host.endsWith('.youtube.com')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return true

  return new Promise<boolean>((resolve) => {
    let done = false
    const finish = (exited: boolean): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      child.off('exit', onExit)
      resolve(exited)
    }
    const onExit = (): void => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)

    child.once('exit', onExit)
  })
}

function browserCandidates(): BrowserCandidate[] {
  const candidates: BrowserCandidate[] = []
  const add = (name: string, path: string): void => {
    if (!candidates.some((candidate) => candidate.path === path)) {
      candidates.push({ name, path })
    }
  }

  if (process.platform === 'darwin') {
    const appDirs = ['/Applications']
    if (process.env.HOME) appDirs.push(join(process.env.HOME, 'Applications'))

    for (const appDir of appDirs) {
      add('Google Chrome', join(appDir, 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'))
      add(
        'Microsoft Edge',
        join(appDir, 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge')
      )
      add('Brave Browser', join(appDir, 'Brave Browser.app', 'Contents', 'MacOS', 'Brave Browser'))
      add('Chromium', join(appDir, 'Chromium.app', 'Contents', 'MacOS', 'Chromium'))
      add('Vivaldi', join(appDir, 'Vivaldi.app', 'Contents', 'MacOS', 'Vivaldi'))
    }
  } else if (process.platform === 'win32') {
    const roots = [
      process.env.LOCALAPPDATA,
      process.env.PROGRAMFILES,
      process.env['PROGRAMFILES(X86)']
    ].filter((root): root is string => Boolean(root))

    for (const root of roots) {
      add('Google Chrome', join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))
      add('Microsoft Edge', join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
      add('Brave Browser', join(root, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'))
      add('Chromium', join(root, 'Chromium', 'Application', 'chrome.exe'))
    }
  } else {
    add('Google Chrome', '/usr/bin/google-chrome')
    add('Google Chrome', '/usr/bin/google-chrome-stable')
    add('Chromium', '/usr/bin/chromium')
    add('Chromium', '/usr/bin/chromium-browser')
    add('Microsoft Edge', '/usr/bin/microsoft-edge')
    add('Brave Browser', '/usr/bin/brave-browser')
  }

  return candidates
}

function findBrowser(): BrowserCandidate | null {
  return browserCandidates().find((candidate) => existsSync(candidate.path)) ?? null
}

class CdpClient {
  private nextId = 0
  private pending = new Map<number, CdpPending>()
  private closed = false

  private constructor(private readonly socket: BrowserSocket) {
    socket.onmessage = (event) => this.handleMessage(event.data)
    socket.onclose = () => this.failPending(new Error('The browser connection closed.'))
    socket.onerror = () => undefined
  }

  static async connect(url: string): Promise<CdpClient> {
    const Socket = (globalThis as { WebSocket?: BrowserSocketConstructor }).WebSocket
    if (!Socket) throw new Error('Browser automation is unavailable in this build.')

    const socket = new Socket(url)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          socket.close()
        } catch {
          // Ignore a close failure while reporting the timeout.
        }
        reject(new Error('Timed out connecting to the browser.'))
      }, 8000)

      socket.onopen = () => {
        clearTimeout(timer)
        resolve()
      }
      socket.onerror = () => {
        clearTimeout(timer)
        try {
          socket.close()
        } catch {
          // Ignore a close failure while reporting the connection error.
        }
        reject(new Error('Could not connect to the browser.'))
      }
    })

    return new CdpClient(socket)
  }

  call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.closed) return Promise.reject(new Error('The browser connection is closed.'))

    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`The browser did not answer the ${method} request.`))
      }, 10_000)

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      })

      try {
        this.socket.send(JSON.stringify({ id, method, params }))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error('Could not message the browser.'))
      }
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.failPending(new Error('The browser connection closed.'))
    this.socket.onclose = null
    this.socket.onmessage = null
    this.socket.onerror = null
    try {
      this.socket.close()
    } catch {
      // The browser may already have exited.
    }
  }

  private handleMessage(raw: unknown): void {
    let message: CdpMessage
    try {
      message = JSON.parse(String(raw)) as CdpMessage
    } catch {
      return
    }

    if (typeof message.id !== 'number') return
    const pending = this.pending.get(message.id)
    if (!pending) return

    this.pending.delete(message.id)
    clearTimeout(pending.timer)

    if (message.error) {
      pending.reject(new Error(message.error.message ?? 'The browser rejected the request.'))
      return
    }

    pending.resolve(message.result)
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

async function waitForDevToolsPort(
  profileDir: string,
  child: ChildProcess,
  spawnError: () => Error | null
): Promise<number> {
  const deadline = Date.now() + BROWSER_START_TIMEOUT_MS

  while (Date.now() < deadline) {
    const error = spawnError()
    if (error) throw new Error(`Could not start the browser: ${error.message}`)
    if (hasExited(child)) throw new Error('The browser closed before sign-in started.')

    try {
      const raw = await readFile(join(profileDir, 'DevToolsActivePort'), 'utf8')
      const port = Number(raw.split(/\r?\n/, 1)[0])
      if (Number.isInteger(port) && port > 0 && port <= 65535) return port
    } catch {
      // Chrome writes this file a moment after it starts.
    }

    await delay(200)
  }

  throw new Error('The browser did not start in time.')
}

async function waitForSignInTarget(
  port: number,
  child: ChildProcess,
  spawnError: () => Error | null
): Promise<SignInTarget> {
  const deadline = Date.now() + BROWSER_TARGET_TIMEOUT_MS

  while (Date.now() < deadline) {
    const error = spawnError()
    if (error) throw new Error(`Could not start the browser: ${error.message}`)
    if (hasExited(child)) throw new Error('The browser closed before sign-in started.')

    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const data = (await response.json()) as unknown
        if (Array.isArray(data)) {
          const targets = (data as CdpTarget[]).filter(
            (target) => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string'
          )
          const target =
            targets.find((candidate) => isSignInUrl(candidate.url)) ??
            targets.find((candidate) => candidate.url?.startsWith('http')) ??
            targets[0]

          if (target?.webSocketDebuggerUrl) {
            return { ...target, webSocketDebuggerUrl: target.webSocketDebuggerUrl }
          }
        }
      }
    } catch {
      // The remote debugging endpoint is not ready yet.
    }

    await delay(250)
  }

  throw new Error('Could not connect to the browser sign-in window.')
}

/**
 * Keeps the YouTube Music session in a dedicated Chromium partition. The
 * browser-assisted flow uses the user's real Chrome installation with a
 * throwaway profile and copies only YouTube cookies into this partition. The
 * embedded fallback uses the same partition.
 */
class AuthService {
  private loginWindow: BrowserWindow | null = null
  private signInTask: Promise<boolean> | null = null
  private browserProcess: ChildProcess | null = null
  private browserProfileDir: string | null = null

  environment(): AuthEnvironment {
    const browser = findBrowser()
    return { browser: browser ? { name: browser.name } : null }
  }

  private authSession(): Session {
    return session.fromPartition(AUTH_PARTITION)
  }

  async cookieHeader(): Promise<string | undefined> {
    const cookies = await this.authSession().cookies.get({ url: AUTH_COOKIE_URL })
    if (!hasAuthCookies(cookies)) return undefined

    return cookies
      .filter((cookie) => cookie.name && cookie.value)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ')
  }

  async isAuthenticated(): Promise<boolean> {
    const cookies = await this.authSession().cookies.get({ url: AUTH_COOKIE_URL })
    return hasAuthCookies(cookies)
  }

  async signIn(mode: AuthMode = 'browser', parent?: BrowserWindow | null): Promise<boolean> {
    if (this.signInTask) {
      this.loginWindow?.focus()
      return this.signInTask
    }

    const browser = mode === 'browser' ? findBrowser() : null
    const task = (async () => {
      // Always begin with an empty auth partition. Stale YouTube cookies can
      // leave the login page in a broken half-signed-in state, and starting
      // clean also guarantees the cookie watcher only sees the new session.
      await this.clearSessionData()

      if (browser) return this.signInInBrowser(browser)

      if (mode === 'browser') {
        console.info('[auth] no supported browser found; opening the built-in sign-in window')
      }
      return this.signInEmbedded(parent)
    })()

    this.signInTask = task
    try {
      return await task
    } finally {
      if (this.signInTask === task) this.signInTask = null
    }
  }

  async signOut(): Promise<void> {
    await this.cancelSignIn()
    await this.clearSessionData()
  }

  shutdown(): void {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) this.loginWindow.close()
    this.loginWindow = null

    const child = this.browserProcess
    this.browserProcess = null
    if (child?.pid && !hasExited(child)) {
      try {
        child.kill('SIGTERM')
      } catch {
        // The browser may already be gone.
      }
    }

    const profile = this.browserProfileDir
    this.browserProfileDir = null
    if (profile) void this.removeBrowserProfile(profile)
  }

  private async signInInBrowser(browser: BrowserCandidate): Promise<boolean> {
    const profileDir = await mkdtemp(join(tmpdir(), 'toneglass-auth-'))
    console.info(`[auth] starting ${browser.name} with a temporary profile`)

    let child: ChildProcess
    try {
      child = spawn(
        browser.path,
        [
          `--user-data-dir=${profileDir}`,
          '--remote-debugging-port=0',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-sync',
          '--new-window',
          SIGN_IN_URL
        ],
        {
          stdio: 'ignore',
          detached: false
        }
      )
    } catch (error) {
      await this.removeBrowserProfile(profileDir)
      throw new Error(
        `Could not start ${browser.name}: ${error instanceof Error ? error.message : 'unknown error'}`,
        { cause: error }
      )
    }

    this.browserProcess = child
    this.browserProfileDir = profileDir

    const browserStatus: { error: Error | null } = { error: null }
    child.once('error', (error) => {
      browserStatus.error = error
    })

    let cdp: CdpClient | null = null
    try {
      const port = await waitForDevToolsPort(profileDir, child, () => browserStatus.error)
      const target = await waitForSignInTarget(port, child, () => browserStatus.error)

      cdp = await CdpClient.connect(target.webSocketDebuggerUrl)
      if (!isSignInUrl(target.url)) {
        await cdp.call('Page.navigate', { url: SIGN_IN_URL }).catch(() => undefined)
      }
      // getAllCookies works without the Network domain, but enabling it makes
      // Chrome keep the target session in the same mode as a normal page.
      await cdp.call('Network.enable').catch(() => undefined)

      const deadline = Date.now() + LOGIN_TIMEOUT_MS
      let pollWarningShown = false

      while (Date.now() < deadline) {
        if (browserStatus.error) {
          throw new Error(`Could not start the browser: ${browserStatus.error.message}`)
        }
        if (hasExited(child)) return false

        try {
          const result = await cdp.call<{ cookies?: CdpCookie[] }>('Network.getAllCookies')
          const youtubeCookies = (result.cookies ?? []).filter((cookie) => isYoutubeCookie(cookie))

          if (hasAuthCookies(youtubeCookies)) {
            await this.importYoutubeCookies(youtubeCookies)
            return true
          }
        } catch (error) {
          if (hasExited(child)) return false
          if (!pollWarningShown) {
            pollWarningShown = true
            console.warn(
              '[auth] could not read cookies from the browser:',
              error instanceof Error ? error.message : error
            )
          }
        }

        await delay(COOKIE_POLL_MS)
      }

      throw new Error('Browser sign-in timed out. Please try again.')
    } finally {
      cdp?.close()
      await this.stopBrowser()
    }
  }

  private async importYoutubeCookies(cookies: CdpCookie[]): Promise<void> {
    const importable = cookies.filter(isImportableCookie)
    if (!hasAuthCookies(importable)) {
      throw new Error('The browser session did not include YouTube Music sign-in cookies.')
    }

    const ses = this.authSession()
    const existing = await ses.cookies.get({})

    for (const cookie of existing) {
      if (!cookie.domain || !isYoutubeCookie(cookie)) continue
      try {
        await ses.cookies.remove(
          cookieUrl(cookie.domain, Boolean(cookie.secure), cookie.path),
          cookie.name
        )
      } catch {
        // A cookie that cannot be removed will not prevent the import.
      }
    }

    for (const cookie of importable) {
      try {
        const details: Electron.CookiesSetDetails = {
          url: cookieUrl(cookie.domain, Boolean(cookie.secure), cookie.path),
          name: cookie.name,
          value: cookie.value,
          path: cookie.path?.startsWith('/') ? cookie.path : '/',
          secure: Boolean(cookie.secure),
          httpOnly: Boolean(cookie.httpOnly),
          sameSite: mapSameSite(cookie.sameSite)
        }

        if (cookie.domain.startsWith('.')) details.domain = cookie.domain
        if (typeof cookie.expires === 'number' && cookie.expires > 0) {
          details.expirationDate = cookie.expires
        }

        await ses.cookies.set(details)
      } catch (error) {
        console.warn(
          `[auth] could not import the ${cookie.name} cookie:`,
          error instanceof Error ? error.message : error
        )
      }
    }

    await ses.cookies.flushStore().catch(() => undefined)
    const stored = await ses.cookies.get({ url: AUTH_COOKIE_URL })
    if (!hasAuthCookies(stored)) {
      throw new Error('The browser session could not be imported. Please try signing in again.')
    }

    const storedNames = new Set(stored.map((cookie) => cookie.name))
    const missing = importable
      .filter((cookie) => AUTH_COOKIE_NAMES.has(cookie.name) && !storedNames.has(cookie.name))
      .map((cookie) => cookie.name)

    if (missing.length > 0) {
      throw new Error(
        `The browser session is incomplete (missing ${missing.join(', ')}). Please try again.`
      )
    }
  }

  private async signInEmbedded(parent?: BrowserWindow | null): Promise<boolean> {
    const ses = this.authSession()
    const initialCookies = await ses.cookies.get({ url: AUTH_COOKIE_URL })
    const initialFingerprint = cookieFingerprint(initialCookies)

    return new Promise<boolean>((resolve) => {
      let settled = false
      let retryLoad: NodeJS.Timeout | undefined

      const finish = (signedIn: boolean): void => {
        if (settled) return
        settled = true
        clearInterval(poll)
        clearTimeout(timeout)
        if (retryLoad) clearTimeout(retryLoad)
        this.loginWindow = null
        if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close()
        resolve(signedIn)
      }

      const loginWindow = new BrowserWindow({
        width: 560,
        height: 760,
        minWidth: 440,
        minHeight: 580,
        show: false,
        title: 'Sign in to YouTube Music',
        parent: parent ?? undefined,
        autoHideMenuBar: true,
        backgroundColor: '#ffffff',
        webPreferences: {
          partition: AUTH_PARTITION,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      })

      this.loginWindow = loginWindow
      ses.setUserAgent(loginUserAgent())
      loginWindow.webContents.setUserAgent(loginUserAgent())

      loginWindow.once('ready-to-show', () => loginWindow.show())
      loginWindow.on('closed', () => finish(false))

      loginWindow.webContents.on(
        'did-fail-load',
        (_event, errorCode, _description, _url, isMainFrame) => {
          if (settled || !isMainFrame || errorCode === -3) return
          if (retryLoad) return

          // Chromium occasionally reports a transient TLS/DNS failure for the
          // first request and immediately recovers with the next one. Give it
          // a moment instead of tearing down the sign-in window.
          retryLoad = setTimeout(() => {
            retryLoad = undefined
            if (!settled && !loginWindow.isDestroyed()) {
              void loginWindow.loadURL(SIGN_IN_URL).catch(() => undefined)
            }
          }, 1500)
        }
      )

      loginWindow.webContents.on('did-finish-load', () => {
        const loadedUrl = loginWindow.webContents.getURL()
        if (retryLoad && loadedUrl.startsWith('http')) {
          clearTimeout(retryLoad)
          retryLoad = undefined
        }
      })

      loginWindow.webContents.setWindowOpenHandler(({ url }) => {
        void shell.openExternal(url)
        return { action: 'deny' }
      })

      const poll = setInterval(() => {
        if (settled) return

        void ses.cookies
          .get({ url: AUTH_COOKIE_URL })
          .then((cookies) => {
            if (settled || !hasAuthCookies(cookies)) return
            if (cookieFingerprint(cookies) === initialFingerprint) return

            void ses.cookies.flushStore().catch(() => undefined)
            finish(true)
          })
          .catch(() => undefined)
      }, COOKIE_POLL_MS)

      const timeout = setTimeout(() => finish(false), LOGIN_TIMEOUT_MS)

      // The loadURL promise can reject even when Chromium retries the request
      // and ultimately succeeds, so keep the window open and rely on the
      // timeout, the cookie watcher, and the user closing the window.
      void loginWindow.loadURL(SIGN_IN_URL).catch(() => undefined)
    })
  }

  private async cancelSignIn(): Promise<void> {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) this.loginWindow.close()
    this.loginWindow = null
    await this.stopBrowser()
  }

  private async clearSessionData(): Promise<void> {
    const ses = this.authSession()

    await ses.clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage']
    })
    await ses.clearCache()
  }

  private async stopBrowser(): Promise<void> {
    const child = this.browserProcess
    const profile = this.browserProfileDir
    this.browserProcess = null
    this.browserProfileDir = null

    if (child?.pid && !hasExited(child)) {
      try {
        child.kill('SIGTERM')
      } catch {
        // The browser may already be gone.
      }

      if (!(await waitForExit(child, BROWSER_CLOSE_TIMEOUT_MS))) {
        try {
          child.kill('SIGKILL')
        } catch {
          // The browser may already be gone.
        }
        await waitForExit(child, 1000)
      }
    }

    if (profile) await this.removeBrowserProfile(profile)
  }

  private async removeBrowserProfile(profile: string): Promise<void> {
    try {
      await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200
      })
    } catch (error) {
      console.warn(
        '[auth] could not remove the temporary browser profile:',
        error instanceof Error ? error.message : error
      )
    }
  }
}

export const authService = new AuthService()
