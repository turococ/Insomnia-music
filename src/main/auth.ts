import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { BrowserWindow, session, shell, type Session } from 'electron'
import type { AuthEnvironment, AuthMode } from '@shared/types'

const AUTH_PARTITION = 'persist:toneglass-auth'
const AUTH_COOKIE_URL = 'https://music.youtube.com/'
const SIGN_IN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F&hl=en'
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000
const COOKIE_POLL_MS = 800
const BROWSER_COOKIE_DB_POLL_MS = 500
const BROWSER_LOGIN_SETTLE_MS = 500
const BROWSER_CONTROLLER_START_TIMEOUT_MS = 20_000
const BROWSER_HEARTBEAT_TIMEOUT_MS = 5_000
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

function profileHasAuthCookies(profileDir: string): boolean {
  const candidates = [
    join(profileDir, 'Default', 'Cookies'),
    join(profileDir, 'Default', 'Network', 'Cookies')
  ]

  for (const cookiesPath of candidates) {
    if (!existsSync(cookiesPath)) continue

    let database: DatabaseSync | null = null
    try {
      database = new DatabaseSync(cookiesPath, { readOnly: true })
      database.exec('PRAGMA busy_timeout = 1000')
      const rows = database
        .prepare(
          "SELECT name FROM cookies WHERE host_key = 'youtube.com' OR host_key LIKE '%.youtube.com'"
        )
        .all() as Array<{ name?: unknown }>

      if (rows.some((row) => typeof row.name === 'string' && AUTH_COOKIE_NAMES.has(row.name))) {
        return true
      }
    } catch {
      // Chrome may be writing to the cookie database. The next poll retries.
    } finally {
      try {
        database?.close()
      } catch {
        // The database may already be closed.
      }
    }
  }

  return false
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

interface BrowserSignInState {
  canceled: boolean
  lastHeartbeat: number
}

function scriptJson(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

class BrowserSignInServer {
  private readonly token = randomBytes(24).toString('hex')
  private port = 0
  private closed = false
  private readonly server: Server
  private readonly signInUrl: string
  readonly state: BrowserSignInState = { canceled: false, lastHeartbeat: 0 }

  private constructor(server: Server, signInUrl: string) {
    this.server = server
    this.signInUrl = signInUrl
  }

  static async start(signInUrl: string): Promise<BrowserSignInServer> {
    const controller = new BrowserSignInServer(createServer(), signInUrl)
    controller.server.on('request', (request, response) => {
      controller.handleRequest(request, response)
    })

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          controller.server.off('listening', onListening)
          reject(error)
        }
        const onListening = (): void => {
          controller.server.off('error', onError)
          resolve()
        }

        controller.server.once('error', onError)
        controller.server.once('listening', onListening)
        controller.server.listen(0, '127.0.0.1')
      })
    } catch (error) {
      controller.server.close()
      throw error
    }

    const address = controller.server.address()
    if (!address || typeof address === 'string') {
      controller.server.close()
      throw new Error('Could not start the browser sign-in helper.')
    }

    controller.port = address.port
    return controller
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}/auth/${this.token}`
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true

    await new Promise<void>((resolve) => {
      this.server.close(() => resolve())
      this.server.closeAllConnections()
    })
  }

  private handleRequest(request: IncomingMessage, response: ServerResponse): void {
    const base = `/auth/${this.token}`
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const method = request.method ?? 'GET'

    if (url.pathname === '/favicon.ico') {
      response.writeHead(204).end()
      return
    }

    if (method === 'GET' && url.pathname === base) {
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy':
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'",
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff'
      })
      response.end(this.pageHtml())
      return
    }

    if (method === 'POST' && url.pathname === `${base}/heartbeat`) {
      this.state.lastHeartbeat = Date.now()
      response.writeHead(204).end()
      return
    }

    if (method === 'POST' && url.pathname === `${base}/cancel`) {
      this.state.canceled = true
      response.writeHead(204).end()
      return
    }

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found')
  }

  private pageHtml(): string {
    const base = `/auth/${this.token}`
    const heartbeatUrl = `${base}/heartbeat`
    const cancelUrl = `${base}/cancel`

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>ToneGlass sign-in</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0c0d10;
        color: #f4f4f5;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main { width: min(100%, 420px); padding: 42px 34px; text-align: center; }
      .brand {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        color: #b8a6ff;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      .mark {
        width: 9px;
        height: 9px;
        border-radius: 3px;
        background: #9a7cff;
        box-shadow: 0 0 20px rgba(154, 124, 255, 0.75);
      }
      h1 { margin: 18px 0 0; font-size: 22px; letter-spacing: -0.02em; }
      p { margin: 12px 0 0; color: #9b9ca6; font-size: 13px; line-height: 1.6; }
      button {
        margin-top: 22px;
        border: 0;
        border-radius: 999px;
        padding: 11px 20px;
        background: #9a7cff;
        color: #100b20;
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }
      button:hover { background: #ad95ff; }
      .hint { margin-top: 22px; color: #5e606b; font-size: 11px; }
    </style>
  </head>
  <body>
    <main>
      <div class="brand"><span class="mark"></span>ToneGlass</div>
      <h1>Connect YouTube Music</h1>
      <p id="status">Opening the Google sign-in window…</p>
      <button id="open" type="button" hidden>Open Google sign-in</button>
      <p class="hint">Closing the Google window cancels sign-in.</p>
    </main>
    <script>
      const googleUrl = ${scriptJson(this.signInUrl)}
      const heartbeatUrl = ${scriptJson(heartbeatUrl)}
      const cancelUrl = ${scriptJson(cancelUrl)}
      const status = document.getElementById('status')
      const openButton = document.getElementById('open')
      let popup = null
      let popupWatcher = null
      let canceled = false

      function heartbeat() {
        fetch(heartbeatUrl, { method: 'POST', keepalive: true }).catch(() => undefined)
      }

      heartbeat()
      window.setInterval(heartbeat, 1000)

      function cancel() {
        if (canceled) return
        canceled = true
        if (popupWatcher !== null) window.clearInterval(popupWatcher)
        status.textContent = 'Sign-in canceled. You can close this window.'
        openButton.hidden = true
        navigator.sendBeacon(cancelUrl, 'closed')
      }

      function watchPopup() {
        if (!popup) return
        popupWatcher = window.setInterval(() => {
          if (popup && popup.closed) cancel()
        }, 500)
      }

      function launchGoogle() {
        if (popup && !popup.closed) {
          popup.focus()
          return
        }

        popup = window.open(
          googleUrl,
          'toneglass-google-sign-in',
          'popup=yes,width=560,height=760'
        )

        if (!popup) {
          status.textContent = 'Allow the Google sign-in window to continue.'
          openButton.hidden = false
          return
        }

        status.textContent = 'Complete sign-in in the Google window.'
        openButton.hidden = true
        window.setTimeout(() => {
          try { popup.focus() } catch {}
        }, 300)
        watchPopup()
      }

      openButton.addEventListener('click', launchGoogle)
      window.addEventListener('load', () => window.setTimeout(launchGoogle, 250))
      window.addEventListener('pagehide', () => {
        if (!canceled) navigator.sendBeacon(cancelUrl, 'closed')
      })
    </script>
  </body>
</html>`
  }
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
 * browser-assisted flow uses the user's real Chrome installation with a
 * throwaway profile and copies only YouTube cookies into this partition. The
 * embedded fallback uses the same partition.
 */
class AuthService {
  private loginWindow: BrowserWindow | null = null
  private signInTask: Promise<boolean> | null = null
  private browserProcess: ChildProcess | null = null
  private browserProfileDir: string | null = null
  private browserSignInServer: BrowserSignInServer | null = null

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

    const controller = this.browserSignInServer
    this.browserSignInServer = null
    if (controller) void controller.close()

    const child = this.browserProcess
    this.browserProcess = null
    if (child?.pid && !hasExited(child)) terminateProcessTree(child)

    const profile = this.browserProfileDir
    this.browserProfileDir = null
    if (profile) void this.removeBrowserProfile(profile)
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
    this.browserProfileDir = profileDir
    return child
  }

  private async waitForBrowserSignIn(
    child: ChildProcess,
    profileDir: string,
    controller: BrowserSignInServer,
    browserStatus: { error: Error | null }
  ): Promise<boolean> {
    const deadline = Date.now() + LOGIN_TIMEOUT_MS
    const startedAt = Date.now()

    while (Date.now() < deadline) {
      if (browserStatus.error) {
        throw new Error(`Could not start the browser: ${browserStatus.error.message}`)
      }

      // Check the cookie database before cancellation so a sign-in that
      // completes just as the Google window closes is still imported.
      if (profileHasAuthCookies(profileDir)) {
        await delay(BROWSER_LOGIN_SETTLE_MS)
        return true
      }

      if (controller.state.canceled) {
        console.info('[auth] browser sign-in canceled')
        return false
      }

      if (hasExited(child)) return false

      if (controller.state.lastHeartbeat > 0) {
        if (Date.now() - controller.state.lastHeartbeat > BROWSER_HEARTBEAT_TIMEOUT_MS) {
          console.info('[auth] browser window closed; sign-in canceled')
          return false
        }
      } else if (Date.now() - startedAt > BROWSER_CONTROLLER_START_TIMEOUT_MS) {
        throw new Error('Could not open the browser sign-in page.')
      }

      await delay(BROWSER_COOKIE_DB_POLL_MS)
    }

    throw new Error('Browser sign-in timed out. Please try again.')
  }

  private async readCookiesFromProfile(
    browser: BrowserCandidate,
    profileDir: string
  ): Promise<CdpCookie[]> {
    let child: ChildProcess
    try {
      child = this.launchBrowser(browser, profileDir, [
        '--remote-debugging-port=0',
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        'about:blank'
      ])
    } catch (error) {
      throw new Error(
        `Could not read the browser session: ${error instanceof Error ? error.message : 'unknown error'}`,
        { cause: error }
      )
    }

    const browserStatus = trackBrowserError(child)
    let cdp: CdpClient | null = null

    try {
      const port = await waitForDevToolsPort(profileDir, child, () => browserStatus.error)
      const target = await waitForPageTarget(port, child, () => browserStatus.error)
      cdp = await CdpClient.connect(target.webSocketDebuggerUrl)
      const result = await cdp.call<{ cookies?: CdpCookie[] }>('Network.getAllCookies')
      return (result.cookies ?? []).filter((cookie) => isYoutubeCookie(cookie))
    } finally {
      cdp?.close()
    }
  }

  private async signInInBrowser(browser: BrowserCandidate): Promise<boolean> {
    // Google rejects browsers started with remote debugging enabled ("This
    // browser or app may not be secure"). The sign-in phase therefore uses a
    // normal browser and watches the profile's cookie database. Only after the
    // session exists is the profile reopened headlessly with CDP to read it.
    const profileDir = await mkdtemp(join(tmpdir(), 'toneglass-auth-'))
    this.browserProfileDir = profileDir

    let controller: BrowserSignInServer
    try {
      controller = await BrowserSignInServer.start(SIGN_IN_URL)
    } catch (error) {
      this.browserProfileDir = null
      await this.removeBrowserProfile(profileDir)
      throw new Error('Could not prepare browser sign-in.', { cause: error })
    }

    this.browserSignInServer = controller

    try {
      console.info(`[auth] starting ${browser.name} with a temporary profile`)

      let child: ChildProcess
      try {
        child = this.launchBrowser(browser, profileDir, [
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-sync',
          '--disable-popup-blocking',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--window-size=520,460',
          `--app=${controller.url}`
        ])
      } catch (error) {
        throw new Error(
          `Could not start ${browser.name}: ${error instanceof Error ? error.message : 'unknown error'}`,
          { cause: error }
        )
      }

      const browserStatus = trackBrowserError(child)
      const signedIn = await this.waitForBrowserSignIn(child, profileDir, controller, browserStatus)
      if (!signedIn) return false

      console.info('[auth] browser sign-in complete; importing cookies')
      await this.stopBrowserProcess()
      await clearBrowserSingletonFiles(profileDir)

      const cookies = await this.readCookiesFromProfile(browser, profileDir)
      if (!hasAuthCookies(cookies)) {
        throw new Error('The browser session did not include YouTube Music sign-in cookies.')
      }

      await this.importYoutubeCookies(cookies)
      return true
    } finally {
      await controller.close()
      if (this.browserSignInServer === controller) this.browserSignInServer = null
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

    const controller = this.browserSignInServer
    this.browserSignInServer = null
    if (controller) await controller.close()
    await this.stopBrowser()
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

  private async stopBrowser(): Promise<void> {
    const profile = this.browserProfileDir
    this.browserProfileDir = null

    await this.stopBrowserProcess()
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
