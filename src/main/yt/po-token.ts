import type { Innertube } from 'youtubei.js'
import type { BotGuardClient } from 'bgutils-js/botguard'
import type { WebPoMinter } from 'bgutils-js/webpo'
import type { WebPoSignalOutput } from 'bgutils-js/shared-types'
import { APP_USER_AGENT, PO_TOKEN_REQUEST_KEY, PO_TOKEN_TTL_MS } from './constants'

interface CachedToken {
  token: string
  expiresAt: number
}

/**
 * Generates content-bound WebPO tokens. One BotGuard VM and one integrity
 * token are reused for as long as possible; a fresh token is minted per video.
 *
 * This is the same flow used by the web player: load the BotGuard interpreter,
 * take a snapshot, exchange it for an integrity token, then mint a token bound
 * to the video ID and append it to the googlevideo URL as `pot`.
 */
class PoTokenProvider {
  private botGuard: BotGuardClient | null = null
  private minter: WebPoMinter | null = null
  private minterExpiresAt = 0
  private readyPromise: Promise<void> | null = null
  private tokens = new Map<string, CachedToken>()
  private pending = new Map<string, Promise<string>>()

  async getToken(yt: Innertube, videoId: string): Promise<string> {
    const cached = this.tokens.get(videoId)
    if (cached && cached.expiresAt > Date.now()) return cached.token

    const pending = this.pending.get(videoId)
    if (pending) return pending

    const promise = this.mint(yt, videoId).finally(() => this.pending.delete(videoId))
    this.pending.set(videoId, promise)
    return promise
  }

  private async mint(yt: Innertube, videoId: string): Promise<string> {
    await this.ensureReady(yt)
    if (!this.minter) throw new Error('PoToken minter is unavailable')

    const token = await this.minter.mintAsWebsafeString(videoId)
    const ttl = Math.min(PO_TOKEN_TTL_MS, Math.max(60_000, this.minterExpiresAt - Date.now()))
    this.tokens.set(videoId, { token, expiresAt: Date.now() + ttl })

    if (this.tokens.size > 200) {
      const now = Date.now()
      for (const [id, entry] of this.tokens) {
        if (entry.expiresAt <= now) this.tokens.delete(id)
      }
    }

    return token
  }

  private async ensureReady(yt: Innertube): Promise<void> {
    if (this.minter && this.minterExpiresAt > Date.now()) return
    if (this.readyPromise) return this.readyPromise

    this.readyPromise = this.refresh(yt).finally(() => {
      this.readyPromise = null
    })
    return this.readyPromise
  }

  private async refresh(yt: Innertube): Promise<void> {
    const started = Date.now()
    if (!this.botGuard) {
      this.botGuard = await this.createBotGuard(yt)
    }

    const { WebPoMinter } = await import('bgutils-js/webpo')
    const { buildURL, getHeaders } = await import('bgutils-js/utils')

    const webPoSignalOutput: WebPoSignalOutput = []
    const botguardResponse = await this.botGuard.snapshot({ webPoSignalOutput }, 15_000)

    const integrityResponse = await fetch(buildURL('GenerateIT', true), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify([PO_TOKEN_REQUEST_KEY, botguardResponse])
    })

    if (!integrityResponse.ok) {
      throw new Error(`Integrity token request failed: HTTP ${integrityResponse.status}`)
    }

    const integrityJson = (await integrityResponse.json()) as [string, number, number, string?]

    if (typeof integrityJson[0] !== 'string') {
      throw new Error('Integrity token response did not contain a token')
    }

    const estimateTtl = typeof integrityJson[1] === 'number' ? integrityJson[1] : 3600
    const minter = await WebPoMinter.create(
      {
        integrityToken: integrityJson[0],
        estimatedTtlSecs: estimateTtl,
        mintRefreshThreshold: integrityJson[2],
        websafeFallbackToken: integrityJson[3]
      },
      webPoSignalOutput
    )

    this.minter = minter
    this.minterExpiresAt =
      Date.now() + Math.max(60_000, Math.min(estimateTtl * 1000 * 0.8, 30 * 60 * 1000))

    console.info(
      `[po-token] minter ready in ${Date.now() - started}ms (ttl ${Math.round(
        (this.minterExpiresAt - Date.now()) / 1000
      )}s)`
    )
  }

  private async createBotGuard(yt: Innertube): Promise<BotGuardClient> {
    const { BotGuardClient } = await import('bgutils-js/botguard')
    const { JSDOM, VirtualConsole } = await import('jsdom')
    const userAgent = yt.session.context.client.userAgent || APP_USER_AGENT

    const challenge = await yt.getAttestationChallenge('ENGAGEMENT_TYPE_UNBOUND')
    const bgChallenge = challenge.bg_challenge
    if (!bgChallenge) throw new Error('YouTube did not return a BotGuard challenge')

    const pageResponse = await fetch('https://www.youtube.com', {
      headers: {
        accept: '*/*',
        'accept-language': 'en-US,en;q=0.7',
        'user-agent': userAgent
      }
    })
    const pageHtml = await pageResponse.text()
    const configMatch = pageHtml.match(/ytcfg\.set\(({.+?})\);/s)

    let ytConfig: Record<string, unknown> = {}
    if (configMatch) {
      try {
        ytConfig = JSON.parse(configMatch[1]) as Record<string, unknown>
      } catch {
        // The VM can usually initialise without the config.
      }
    }

    const virtualConsole = new VirtualConsole()
    virtualConsole.on('jsdomError', (error) => {
      // jsdom does not implement canvas; BotGuard works without it.
      if (!String(error.message).includes('HTMLCanvasElement')) {
        console.error('[po-token] jsdom error', error.message)
      }
    })

    const dom = new JSDOM(
      '<!DOCTYPE html><html lang="en"><head><title></title></head><body></body></html>',
      {
        url: 'https://www.youtube.com',
        referrer: 'https://www.youtube.com/',
        virtualConsole
      }
    )
    Object.defineProperty(dom.window.navigator, 'userAgent', {
      value: userAgent,
      configurable: true
    })

    const interpreterPath =
      bgChallenge.interpreter_url.private_do_not_access_or_else_trusted_resource_url_wrapped_value
    if (!interpreterPath) throw new Error('BotGuard interpreter URL is missing')
    const interpreterUrl = interpreterPath.startsWith('http')
      ? interpreterPath
      : `https:${interpreterPath}`

    const interpreterResponse = await fetch(interpreterUrl)
    if (!interpreterResponse.ok) {
      throw new Error(`BotGuard interpreter request failed: HTTP ${interpreterResponse.status}`)
    }
    const interpreterJavascript = await interpreterResponse.text()

    const globalObject = globalThis as unknown as Record<string, unknown>
    globalObject.window = dom.window
    globalObject.document = dom.window.document
    globalObject.location = dom.window.location
    globalObject.origin = dom.window.origin
    globalObject.yt = { config_: ytConfig }

    Object.defineProperty(globalThis, 'navigator', {
      value: dom.window.navigator,
      configurable: true
    })

    // The interpreter installs the VM under its global name on globalThis.
    new Function(interpreterJavascript)()

    if (!(bgChallenge.global_name in globalObject)) {
      throw new Error('BotGuard VM did not initialise')
    }

    return BotGuardClient.create({
      program: bgChallenge.program,
      globalName: bgChallenge.global_name,
      globalObject
    })
  }
}

export const poTokenProvider = new PoTokenProvider()
