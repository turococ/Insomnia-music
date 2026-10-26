import { spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, unlinkSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SignInOutcome } from '@shared/types'
import { app, BrowserWindow, session, shell, type Session } from 'electron'

const AUTH_PARTITION = 'persist:toneglass-auth'
const AUTH_COOKIE_URL = 'https://music.youtube.com/'
const SIGN_IN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F&hl=en'
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000
const COOKIE_POLL_MS = 600
const BROWSER_SETTLE_MS = 1500
const LOGIN_INFO_GRACE_MS = 15_000
const BROWSER_START_TIMEOUT_MS = 20_000
const BROWSER_TARGET_TIMEOUT_MS = 15_000
const BROWSER_CLOSE_TIMEOUT_MS = 3_000
const BROWSER_PROFILE_DIR = 'auth-browser'
// The in-app sign-in window needs a complete Google session before it can be
// handed to YouTube Music. A settle delay lets the last cookies arrive.
const EMBEDDED_SETTLE_MS = 2_500
// Once Google redirects to YouTube Music the login is done; hide the window.
// If the session still is not complete after this, show it again.
const EMBEDDED_REVEAL_MS = 20_000
// Google's interstitial ("This browser or app may not be secure") is rendered
// as plain page text. Match a few of its common variants.
const BLOCK_MESSAGE_PATTERNS = [
  /may not be secure/i,
  /try using a different browser/i,
  /небезопас/i,
  /другой браузер/i
]
// Chrome stores cookie expiry as microseconds since 1601-01-01. Session
// cookies (including YouTube's SAPISID) are not restored when Chrome reopens
// the profile, so mark them persistent before reading them through CDP.
const CHROME_EPOCH_OFFSET_US = 11_644_473_600_000_000n
const SESSION_COOKIE_LIFETIME_US = 730n * 24n * 60n * 60n * 1_000_000n

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

const REQUIRED_AUTH_COOKIES = [
  'SID',
  'HSID',
  'SSID',
  'APISID',
  'SAPISID',
  '__Secure-1PSID',
  '__Secure-3PSID',
  '__Secure-1PAPISID',
  '__Secure-3PAPISID'
]

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

interface PageTarget extends CdpTarget {
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

/**
 * A session is only usable once Google has issued the cookies YouTube Music
 * actually authenticates with. Any single auth cookie is not enough; partial
 * sessions get rejected and must not be treated as success.
 */
function hasCompleteAuthSession(cookies: CookieLike[]): boolean {
  const names = new Set(
    cookies
      .filter((cookie) => Boolean(cookie.value) && Boolean(cookie.name))
      .map((cookie) => cookie.name as string)
  )
  if (!names.has('SAPISID')) return false
  return names.has('__Secure-1PSID') || names.has('__Secure-3PSID')
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

function isSecureCookie(cookie: CdpCookie): boolean {
  return (
    Boolean(cookie.secure) ||
    Boolean(cookie.sameSite === 'None') ||
    Boolean(cookie.name?.startsWith('__Secure-')) ||
    Boolean(cookie.name?.startsWith('__Host-'))
  )
}

function isAuthHostUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return (
      host === 'google.com' ||
      host.endsWith('.google.com') ||
      host === 'youtube.com' ||
      host.endsWith('.youtube.com') ||
      host === 'gstatic.com' ||
      host.endsWith('.gstatic.com')
    )
  } catch {
    return false
  }
}

function isMusicYouTubeUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === 'music.youtube.com'
  } catch {
    return false
  }
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

function terminateProcessTree(child: ChildProcess, force = false): void {
  if (!child.pid) return

  if (process.platform === 'win32') {
    try {
      const killer = spawn(
        'taskkill',
        ['/pid', String(child.pid), '/T', ...(force ? ['/F'] : [])],
        { stdio: 'ignore', windowsHide: true }
      )
      killer.once('error', () => {
        try {
          child.kill()
        } catch {
          // The browser may already be gone.
        }
      })
    } catch {
      try {
        child.kill()
      } catch {
        // The browser may already be gone.
      }
    }
    return
  }

  try {
    child.kill(force ? 'SIGKILL' : 'SIGTERM')
  } catch {
    // The browser may already be gone.
  }
}

function trackBrowserError(child: ChildProcess): { error: Error | null } {
  const status: { error: Error | null } = { error: null }
  child.once('error', (error) => {
    status.error = error
  })
  return status
}

function readCookieNames(cookiesPath: string): string[] {
  let database: DatabaseSync | null = null
  try {
    database = new DatabaseSync(cookiesPath, { readOnly: true })
    database.exec('PRAGMA busy_timeout = 250')
    const rows = database
      .prepare(
        "SELECT name FROM cookies WHERE host_key = 'youtube.com' OR host_key LIKE '%.youtube.com'"
      )
      .all() as Array<{ name?: unknown }>

    return rows.map((row) => row.name).filter((name): name is string => typeof name === 'string')
  } finally {
    try {
      database?.close()
    } catch {
      // The database may already be closed.
    }
  }
}

function profileCookieNames(profileDir: string): Set<string> {
  const names = new Set<string>()
  const candidates = [
    join(profileDir, 'Default', 'Cookies'),
    join(profileDir, 'Default', 'Network', 'Cookies')
  ]

  for (const cookiesPath of candidates) {
    if (!existsSync(cookiesPath)) continue

    try {
      for (const name of readCookieNames(cookiesPath)) names.add(name)
    } catch {
      // Windows Chrome can hold the cookie database with an exclusive lock.
      // A byte copy lets SQLite read the last committed state while Chrome runs.
      const copyPath = `${cookiesPath}.toneglass-read`
      try {
        copyFileSync(cookiesPath, copyPath)
        for (const name of readCookieNames(copyPath)) names.add(name)
      } catch {
        // Chrome may be mid-write. The next poll retries.
      } finally {
        try {
          unlinkSync(copyPath)
        } catch {
          // The copy may not have been created.
        }
      }
    }
  }

  return names
}

function hasAuthCookieNames(names: Set<string>): boolean {
  for (const name of names) {
    if (AUTH_COOKIE_NAMES.has(name)) return true
  }
  return false
}

function profileHasAuthCookies(profileDir: string): boolean {
  return hasAuthCookieNames(profileCookieNames(profileDir))
}

function preserveSessionCookies(profileDir: string): number {
  const candidates = [
    join(profileDir, 'Default', 'Cookies'),
    join(profileDir, 'Default', 'Network', 'Cookies')
  ]
  const expiresUtc =
    BigInt(Date.now()) * 1_000n + CHROME_EPOCH_OFFSET_US + SESSION_COOKIE_LIFETIME_US
  let updated = 0

  for (const cookiesPath of candidates) {
    if (!existsSync(cookiesPath)) continue

    let database: DatabaseSync | null = null
    try {
      database = new DatabaseSync(cookiesPath)
      database.exec('PRAGMA busy_timeout = 2000')
      const result = database
        .prepare(
          "UPDATE cookies SET is_persistent = 1, has_expires = 1, expires_utc = ? WHERE is_persistent = 0 AND (host_key = 'youtube.com' OR host_key LIKE '%.youtube.com')"
        )
        .run(expiresUtc)
      updated += Number(result.changes)
    } catch (error) {
      console.warn(
        '[auth] could not preserve browser session cookies:',
        error instanceof Error ? error.message : error
      )
    } finally {
      try {
        database?.close()
      } catch {
        // The database may already be closed.
      }
    }
  }

  if (updated > 0) {
    console.info(`[auth] preserved ${updated} browser session cookie${updated === 1 ? '' : 's'}`)
  }

  return updated
}

async function clearBrowserSingletonFiles(profileDir: string): Promise<void> {
  for (const name of [
    'SingletonLock',
    'SingletonSocket',
    'SingletonCookie',
    'DevToolsActivePort'
  ]) {
    try {
      await rm(join(profileDir, name), { force: true })
    } catch {
      // Chrome may have already removed the file.
    }
  }
}

// Google's account flow punishes embedded browsers that impersonate Chrome:
// a plain Chrome user agent produced "This browser or app may not be secure"
// (the same behaviour was confirmed for Electron apps in 2026). What Google
// accepts is the native Electron user agent with only the Electron token
// removed, so the app identifies itself and matches its embedded engine.
function loginUserAgent(): string {
  return app.userAgentFallback.replace(/Electron\/\S+\s?/, '')
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
      add('Arc', join(appDir, 'Arc.app', 'Contents', 'MacOS', 'Arc'))
      add('Opera', join(appDir, 'Opera.app', 'Contents', 'MacOS', 'Opera'))
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
      add('Opera', join(root, 'Programs', 'Opera', 'opera.exe'))
      add('Opera', join(root, 'Opera', 'opera.exe'))
    }
  } else {
    add('Google Chrome', '/usr/bin/google-chrome')
    add('Google Chrome', '/usr/bin/google-chrome-stable')
    add('Google Chrome', '/opt/google/chrome/chrome')
    add('Chromium', '/usr/bin/chromium')
    add('Chromium', '/usr/bin/chromium-browser')
    add('Chromium', '/snap/bin/chromium')
    add('Chromium', '/snap/bin/chromium-browser')
    add('Microsoft Edge', '/usr/bin/microsoft-edge')
    add('Microsoft Edge', '/opt/microsoft/msedge/msedge')
    add('Brave Browser', '/usr/bin/brave-browser')
    add('Brave Browser', '/snap/bin/brave')
    add('Vivaldi', '/usr/bin/vivaldi')
    add('Vivaldi', '/usr/bin/vivaldi-stable')
    add('Opera', '/usr/bin/opera')
    add('Opera', '/usr/bin/opera-stable')
    add('Opera', '/opt/opera/opera')
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
    socket.onclose = () => {
      this.closed = true
      this.failPending(new Error('The browser connection closed.'))
    }
    socket.onerror = () => undefined
  }

  get isClosed(): boolean {
    return this.closed
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

  call<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<T> {
    if (this.closed) return Promise.reject(new Error('The browser connection is closed.'))

    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`The browser did not answer the ${method} request.`))
      }, timeoutMs)

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
    const alreadyClosed = this.closed
    this.closed = true
    this.failPending(new Error('The browser connection closed.'))
    this.socket.onclose = null
    this.socket.onmessage = null
    this.socket.onerror = null
    if (alreadyClosed) return

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

async function waitForPageTarget(
  port: number,
  child: ChildProcess,
  spawnError: () => Error | null
): Promise<PageTarget> {
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
          const target = (data as CdpTarget[]).find(
            (candidate) =>
              candidate.type === 'page' && typeof candidate.webSocketDebuggerUrl === 'string'
          )

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

  throw new Error('Could not connect to the browser session.')
}

/**
 * Keeps the YouTube Music session in a dedicated Chromium partition. The
 * primary flow signs in inside a ToneGlass window that shares this partition,
 * so no cookie handoff is needed. A real Chromium browser is only used as an
 * explicit fallback for the rare case where Google refuses the in-app window.
 */
class AuthService {
  private loginWindow: BrowserWindow | null = null
  private signInTask: Promise<SignInOutcome> | null = null
  private browserProcess: ChildProcess | null = null
  private profileDirCache: string | null = null
  private cancelRequested = false

  private authSession(): Session {
    return session.fromPartition(AUTH_PARTITION)
  }

  private profileDir(): string {
    if (!this.profileDirCache) {
      this.profileDirCache = join(app.getPath('userData'), BROWSER_PROFILE_DIR)
    }
    return this.profileDirCache
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

  async signIn(parent?: BrowserWindow | null): Promise<SignInOutcome> {
    if (this.signInTask) {
      this.loginWindow?.focus()
      return this.signInTask
    }

    const task = (async () => {
      this.cancelRequested = false
      // Always begin with an empty Electron session. Stale cookies can leave
      // the app in a broken half-signed-in state.
      await this.clearSessionData()
      return this.signInEmbedded(parent)
    })()

    this.signInTask = task
    try {
      return await task
    } finally {
      if (this.signInTask === task) this.signInTask = null
    }
  }

  /**
   * Fallback for when Google refuses the in-app window. Runs the whole
   * sign-in in a real Chromium browser and imports the resulting session.
   */
  async signInWithBrowser(): Promise<SignInOutcome> {
    if (this.signInTask) {
      this.loginWindow?.focus()
      return this.signInTask
    }

    const task = (async () => {
      this.cancelRequested = false
      await this.clearSessionData()

      const browser = findBrowser()
      if (!browser) {
        throw new Error(
          'No supported browser was found. Install Google Chrome or Microsoft Edge to use this sign-in option.'
        )
      }

      const signedIn = await this.signInInBrowser(browser)
      return signedIn ? 'signed-in' : 'canceled'
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
    await this.removeBrowserProfile()
  }

  async resetBrowserProfile(): Promise<void> {
    await this.stopBrowserProcess()
    await this.removeBrowserProfile()
  }

  private async removeBrowserProfile(): Promise<void> {
    const profileDir = this.profileDir()
    if (!existsSync(profileDir)) return

    try {
      await rm(profileDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200
      })
      return
    } catch (error) {
      console.warn(
        '[auth] could not remove the browser profile:',
        error instanceof Error ? error.message : error
      )
    }

    // If the profile directory cannot be removed, at least delete its cookie
    // databases so a signed-out session cannot be imported again.
    for (const cookiesPath of [
      join(profileDir, 'Default', 'Network', 'Cookies'),
      join(profileDir, 'Default', 'Cookies')
    ]) {
      for (const path of [
        cookiesPath,
        `${cookiesPath}-journal`,
        `${cookiesPath}-wal`,
        `${cookiesPath}-shm`
      ]) {
        try {
          await rm(path, { force: true })
        } catch {
          // Keep trying the remaining cookie files.
        }
      }
    }

    if (profileHasAuthCookies(profileDir)) {
      console.warn('[auth] the browser profile still contains sign-in cookies after reset')
    }
  }

  shutdown(): void {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) this.loginWindow.close()
    this.loginWindow = null

    const child = this.browserProcess
    this.browserProcess = null
    if (child?.pid && !hasExited(child)) terminateProcessTree(child)
  }

  private launchBrowser(
    browser: BrowserCandidate,
    profileDir: string,
    args: string[]
  ): ChildProcess {
    const child = spawn(browser.path, [`--user-data-dir=${profileDir}`, ...args], {
      stdio: 'ignore',
      detached: false
    })
    this.browserProcess = child
    return child
  }

  private async signInInBrowser(browser: BrowserCandidate): Promise<boolean> {
    const profileDir = this.profileDir()
    console.info(`[auth] using ${browser.name} (${browser.path})`)
    console.info(`[auth] browser profile: ${profileDir}`)
    await this.stopBrowserProcess()
    await clearBrowserSingletonFiles(profileDir)

    // Reuse the persistent browser session when possible. This is the common
    // path after the first sign-in and avoids talking to Google altogether.
    if (existsSync(profileDir)) {
      let existing: CdpCookie[] | null = null
      try {
        console.info('[auth] checking the saved browser session')
        existing = await this.readCookiesFromProfile(browser, profileDir)
      } catch (error) {
        console.warn(
          '[auth] could not read the saved browser session:',
          error instanceof Error ? error.message : error
        )
      }

      if (existing && hasAuthCookies(existing)) {
        console.info(`[auth] found ${existing.length} saved browser cookies`)
        try {
          await this.importYoutubeCookies(existing)
          return true
        } catch (error) {
          console.warn(
            '[auth] the saved browser session could not be imported; starting a fresh sign-in:',
            error instanceof Error ? error.message : error
          )
        }
      }

      // The profile is dedicated to ToneGlass, so discarding a profile without
      // a usable session is safe. It also guarantees the cookie watcher cannot
      // mistake an old session for a new sign-in.
      await this.resetBrowserProfile()
    }

    if (this.cancelRequested) return false

    if (profileHasAuthCookies(profileDir)) {
      throw new Error(
        'Could not reset the saved browser session. Close any open ToneGlass browser windows and try again.'
      )
    }

    console.info(`[auth] opening ${browser.name} for Google sign-in`)

    let child: ChildProcess
    try {
      child = this.launchBrowser(browser, profileDir, [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        '--disable-session-crashed-bubble',
        '--hide-crash-restore-bubble',
        SIGN_IN_URL
      ])
    } catch (error) {
      throw new Error(
        `Could not start ${browser.name}: ${error instanceof Error ? error.message : 'unknown error'}`,
        { cause: error }
      )
    }

    const browserStatus = trackBrowserError(child)
    let signedIn: boolean
    try {
      signedIn = await this.waitForBrowserSignIn(child, profileDir, browserStatus)
    } finally {
      // Stop the sign-in window on success, cancellation, and timeout alike.
      await this.stopBrowserProcess()
      await clearBrowserSingletonFiles(profileDir)
    }

    if (!signedIn || this.cancelRequested) {
      console.info('[auth] browser sign-in was cancelled')
      return false
    }

    console.info('[auth] browser sign-in complete; importing cookies')
    let cookies: CdpCookie[]
    try {
      cookies = await this.readCookiesFromProfile(browser, profileDir)
    } catch (error) {
      if (this.cancelRequested) return false
      throw error
    }

    if (!hasAuthCookies(cookies)) {
      throw new Error('The browser session did not include YouTube Music sign-in cookies.')
    }

    try {
      await this.importYoutubeCookies(cookies)
      return true
    } catch (error) {
      // Do not leave a profile that will be re-imported forever if the cookie
      // handoff fails. The next attempt should start with a fresh Google login.
      console.warn(
        '[auth] could not import the browser session; resetting the browser profile:',
        error instanceof Error ? error.message : error
      )
      await this.resetBrowserProfile()
      throw error
    }
  }

  private async waitForBrowserSignIn(
    child: ChildProcess,
    profileDir: string,
    browserStatus: { error: Error | null }
  ): Promise<boolean> {
    const deadline = Date.now() + LOGIN_TIMEOUT_MS
    let authCookiesFirstSeenAt: number | null = null

    while (Date.now() < deadline) {
      if (this.cancelRequested) return false

      if (browserStatus.error) {
        throw new Error(`Could not start the browser: ${browserStatus.error.message}`)
      }

      const names = profileCookieNames(profileDir)
      if (hasAuthCookieNames(names)) {
        if (authCookiesFirstSeenAt === null) {
          authCookiesFirstSeenAt = Date.now()
          console.info('[auth] detected YouTube cookies; waiting for the session to finish')
        }

        const loginInfoReady = names.has('LOGIN_INFO')
        const waitedForLoginInfo = Date.now() - authCookiesFirstSeenAt
        if (loginInfoReady || waitedForLoginInfo >= LOGIN_INFO_GRACE_MS) {
          console.info(
            loginInfoReady
              ? '[auth] detected a complete YouTube session'
              : '[auth] YouTube login cookie was not found; continuing with the available session'
          )
          await delay(BROWSER_SETTLE_MS)
          return true
        }
      }

      if (hasExited(child)) {
        // Cookies may be flushed just before the browser closes.
        await delay(500)
        if (profileHasAuthCookies(profileDir)) {
          await delay(BROWSER_SETTLE_MS)
          return true
        }
        return false
      }

      await delay(COOKIE_POLL_MS)
    }

    throw new Error('Browser sign-in timed out. Please try again.')
  }

  private async withCdp<T>(
    browser: BrowserCandidate,
    profileDir: string,
    run: (cdp: CdpClient) => Promise<T>
  ): Promise<T> {
    await this.stopBrowserProcess()
    await clearBrowserSingletonFiles(profileDir)
    // Chrome drops session-only cookies when it restarts. Promote them to
    // persistent first so the headless read still sees SAPISID and friends.
    preserveSessionCookies(profileDir)

    const child = this.launchBrowser(browser, profileDir, [
      '--remote-debugging-port=0',
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-session-crashed-bubble',
      '--hide-crash-restore-bubble',
      'about:blank'
    ])
    const browserStatus = trackBrowserError(child)
    let cdp: CdpClient | null = null

    try {
      const port = await waitForDevToolsPort(profileDir, child, () => browserStatus.error)
      const target = await waitForPageTarget(port, child, () => browserStatus.error)
      cdp = await CdpClient.connect(target.webSocketDebuggerUrl)
      return await run(cdp)
    } finally {
      cdp?.close()
      await this.stopBrowserProcess()
      await clearBrowserSingletonFiles(profileDir)
    }
  }

  private async readCookiesFromProfile(
    browser: BrowserCandidate,
    profileDir: string
  ): Promise<CdpCookie[]> {
    return this.withCdp(browser, profileDir, async (cdp) => {
      await cdp.call('Network.enable')
      const result = await cdp.call<{ cookies?: CdpCookie[] }>('Network.getAllCookies')
      const cookies = result.cookies ?? []
      const youtubeCookies = cookies.filter((cookie) => isYoutubeCookie(cookie))
      console.info(
        `[auth] read ${cookies.length} browser cookies (${youtubeCookies.length} for YouTube)`
      )
      return youtubeCookies
    })
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

    let imported = 0
    for (const cookie of importable) {
      try {
        const secure = isSecureCookie(cookie)
        const details: Electron.CookiesSetDetails = {
          url: cookieUrl(cookie.domain, secure, cookie.path),
          name: cookie.name,
          value: cookie.value,
          path: cookie.path?.startsWith('/') ? cookie.path : '/',
          secure,
          httpOnly: Boolean(cookie.httpOnly),
          sameSite: mapSameSite(cookie.sameSite)
        }

        // Keep the browser's domain scope. In particular, a leading-dot
        // youtube.com cookie must remain available to music.youtube.com.
        details.domain = cookie.domain
        if (typeof cookie.expires === 'number' && cookie.expires > 0) {
          details.expirationDate = cookie.expires
        }

        await ses.cookies.set(details)
        imported += 1
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
    const missing = REQUIRED_AUTH_COOKIES.filter((name) => !storedNames.has(name))
    if (missing.length > 0) {
      console.warn(`[auth] imported session is missing cookies: ${missing.join(', ')}`)
    }

    const present = [...storedNames].filter((name) => AUTH_COOKIE_NAMES.has(name))
    console.info(
      `[auth] auth cookies: ${present.join(', ')}${storedNames.has('LOGIN_INFO') ? ', LOGIN_INFO' : ''}`
    )
    console.info(
      `[auth] imported ${imported} YouTube cookies; ${stored.length} are visible to music.youtube.com`
    )
  }

  /**
   * Signs in inside a ToneGlass-owned window. Cookies land directly in the
   * auth partition, so there is no browser automation or cookie handoff. The
   * window hides itself once Google redirects to YouTube Music and reports
   * whether the resulting session was complete.
   */
  private async signInEmbedded(parent?: BrowserWindow | null): Promise<SignInOutcome> {
    const ses = this.authSession()
    const userAgent = loginUserAgent()
    ses.setUserAgent(userAgent)

    const initialCookies = await ses.cookies.get({ url: AUTH_COOKIE_URL })
    const initialFingerprint = cookieFingerprint(initialCookies)

    return new Promise<SignInOutcome>((resolve) => {
      let settled = false
      let retryLoad: NodeJS.Timeout | undefined
      let settleTimer: NodeJS.Timeout | undefined
      let revealTimer: NodeJS.Timeout | undefined
      let blocked = false

      const finish = (outcome: SignInOutcome): void => {
        if (settled) return
        settled = true
        clearInterval(poll)
        clearInterval(blockScanner)
        clearTimeout(timeout)
        if (retryLoad) clearTimeout(retryLoad)
        if (settleTimer) clearTimeout(settleTimer)
        if (revealTimer) clearTimeout(revealTimer)
        this.loginWindow = null
        if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close()
        resolve(outcome)
      }

      const loginWindow = new BrowserWindow({
        width: 460,
        height: 720,
        minWidth: 400,
        minHeight: 560,
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
      loginWindow.webContents.setUserAgent(userAgent)

      loginWindow.once('ready-to-show', () => loginWindow.show())

      loginWindow.on('closed', () => {
        void ses.cookies
          .get({ url: AUTH_COOKIE_URL })
          .then((cookies) => {
            if (this.cancelRequested) {
              finish('canceled')
              return
            }
            finish(
              hasCompleteAuthSession(cookies) && cookieFingerprint(cookies) !== initialFingerprint
                ? 'signed-in'
                : 'canceled'
            )
          })
          .catch(() => finish('canceled'))
      })

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

      // Google accepted the login once it redirects to YouTube Music. Stop
      // showing the web app immediately; the cookie watcher closes the window
      // a moment later.
      loginWindow.webContents.on('did-navigate', (_event, url) => {
        if (retryLoad && url.startsWith('http')) {
          clearTimeout(retryLoad)
          retryLoad = undefined
        }

        if (settled || !isMusicYouTubeUrl(url)) return
        if (loginWindow.isDestroyed() || !loginWindow.isVisible()) return

        loginWindow.hide()
        revealTimer = setTimeout(() => {
          revealTimer = undefined
          if (!settled && !loginWindow.isDestroyed()) loginWindow.show()
        }, EMBEDDED_REVEAL_MS)
      })

      // The block interstitial can arrive long after the initial load and
      // inside a child frame, so scan repeatedly instead of hooking a single
      // load event.
      let scanInFlight = false
      const scanForBlockPage = async (): Promise<void> => {
        if (settled || blocked || scanInFlight || loginWindow.isDestroyed()) return

        try {
          const { hostname } = new URL(loginWindow.webContents.getURL())
          if (!hostname.endsWith('.google.com')) return
        } catch {
          return
        }

        scanInFlight = true
        try {
          const texts = await Promise.all(
            loginWindow.webContents.mainFrame.framesInSubtree.map((frame) =>
              frame
                .executeJavaScript('document.body ? document.body.innerText : ""')
                .catch(() => '')
            )
          )
          const isBlocked = texts.some(
            (text) => typeof text === 'string' && BLOCK_MESSAGE_PATTERNS.some((p) => p.test(text))
          )
          if (settled || blocked || !isBlocked) return

          blocked = true
          console.warn('[auth] Google refused sign-in in the in-app window')
          finish('blocked')
        } finally {
          scanInFlight = false
        }
      }

      const blockScanner = setInterval(() => void scanForBlockPage(), 1_200)

      // Google's flow sometimes opens a popup (account chooser, security
      // prompts). Keep those inside the auth session instead of throwing the
      // user to an external browser.
      loginWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isAuthHostUrl(url)) {
          return {
            action: 'allow',
            overrideBrowserWindowOptions: {
              parent: loginWindow,
              autoHideMenuBar: true,
              width: 480,
              height: 640
            }
          }
        }
        void shell.openExternal(url)
        return { action: 'deny' }
      })

      loginWindow.webContents.on('did-create-window', (childWindow) => {
        childWindow.webContents.setUserAgent(userAgent)
        childWindow.webContents.setWindowOpenHandler(({ url }) => {
          void shell.openExternal(url)
          return { action: 'deny' }
        })
      })

      // Keep the user inside Google's flow; anything else goes to the system
      // browser.
      loginWindow.webContents.on('will-navigate', (event, url) => {
        if (isAuthHostUrl(url)) return
        event.preventDefault()
        void shell.openExternal(url)
      })

      const poll = setInterval(() => {
        if (settled) return

        void ses.cookies
          .get({ url: AUTH_COOKIE_URL })
          .then((cookies) => {
            if (settled || !hasCompleteAuthSession(cookies)) return
            if (cookieFingerprint(cookies) === initialFingerprint) return
            if (settleTimer) return

            void ses.cookies.flushStore().catch(() => undefined)
            settleTimer = setTimeout(() => finish('signed-in'), EMBEDDED_SETTLE_MS)
          })
          .catch(() => undefined)
      }, COOKIE_POLL_MS)

      const timeout = setTimeout(() => finish('canceled'), LOGIN_TIMEOUT_MS)

      // The loadURL promise can reject even when Chromium retries the request
      // and ultimately succeeds, so keep the window open and rely on the
      // timeout, the cookie watcher, and the user closing the window.
      void loginWindow.loadURL(SIGN_IN_URL).catch(() => undefined)
    })
  }

  async cancelSignIn(): Promise<void> {
    this.cancelRequested = true
    if (this.loginWindow && !this.loginWindow.isDestroyed()) this.loginWindow.close()
    this.loginWindow = null
    await this.stopBrowserProcess()
  }

  private async clearSessionData(): Promise<void> {
    const ses = this.authSession()

    await ses.clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage']
    })
    await ses.clearCache()
  }

  private async stopBrowserProcess(): Promise<void> {
    const child = this.browserProcess
    this.browserProcess = null

    if (!child?.pid || hasExited(child)) return

    terminateProcessTree(child)

    if (!(await waitForExit(child, BROWSER_CLOSE_TIMEOUT_MS))) {
      terminateProcessTree(child, true)
      await waitForExit(child, 1000)
    }
  }
}

export const authService = new AuthService()
