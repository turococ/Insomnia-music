import type { SignInOutcome } from '@shared/types'
import { app, BrowserWindow, session, shell, type Session } from 'electron'

const AUTH_PARTITION = 'persist:toneglass-auth'
const AUTH_COOKIE_URL = 'https://music.youtube.com/'
const SIGN_IN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F&hl=en'
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000
const COOKIE_POLL_MS = 600
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
    .map((cookie) => `${cookie.name}=${cookie.value ?? ''}`)
    .sort()
    .join('|')
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

// Google's account flow punishes embedded browsers that impersonate Chrome:
// a plain Chrome user agent produced "This browser or app may not be secure"
// (the same behaviour was confirmed for Electron apps in 2026). What Google
// accepts is the native Electron user agent with only the Electron token
// removed, so the app identifies itself and matches its embedded engine.
function loginUserAgent(): string {
  return app.userAgentFallback.replace(/Electron\/\S+\s?/, '')
}

/**
 * Keeps the YouTube Music session in a dedicated Chromium partition. Sign-in
 * happens inside a ToneGlass window that shares this partition, so cookies
 * land exactly where InnerTube expects them and no browser handoff is needed.
 */
class AuthService {
  private loginWindow: BrowserWindow | null = null
  private signInTask: Promise<SignInOutcome> | null = null
  private cancelRequested = false

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

  async signOut(): Promise<void> {
    await this.cancelSignIn()
    await this.clearSessionData()
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
  }

  private async clearSessionData(): Promise<void> {
    const ses = this.authSession()

    await ses.clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage']
    })
    await ses.clearCache()
  }
}

export const authService = new AuthService()
