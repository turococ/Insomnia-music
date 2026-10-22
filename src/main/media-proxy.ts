import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { musicService } from './yt/music'

/**
 * Chromium requests media with an open-ended `Range: bytes=0-` header.
 * googlevideo.com answers those with 403, but accepts bounded ranges.
 * This proxy turns every request into a bounded range, then streams the
 * response back with the original content range so seeking keeps working.
 */
const CHUNK_SIZE = 256 * 1024
const DEBUG = process.env.NODE_ENV !== 'production'

class MediaProxy {
  private server = createServer((request, response) => {
    void this.handle(request, response)
  })

  private port: number | null = null
  private starting: Promise<void> | null = null
  private readonly token = randomUUID()

  async urlFor(videoId: string): Promise<string> {
    await this.start()
    return `http://127.0.0.1:${this.port}/media/${encodeURIComponent(videoId)}?token=${this.token}`
  }

  private async start(): Promise<void> {
    if (this.port !== null) return
    if (this.starting) return this.starting

    this.starting = new Promise((resolve, reject) => {
      const onError = (error: Error): void => {
        this.starting = null
        reject(error)
      }

      this.server.once('error', onError)
      this.server.listen(0, '127.0.0.1', () => {
        this.server.off('error', onError)
        this.port = (this.server.address() as AddressInfo).port
        resolve()
      })
    })

    return this.starting
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Headers', 'Range')
    response.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Length, Content-Range, Accept-Ranges'
    )
    response.setHeader('Cache-Control', 'no-store')

    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD, OPTIONS' })
      response.end()
      return
    }

    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (!url.pathname.startsWith('/media/') || url.searchParams.get('token') !== this.token) {
      response.writeHead(403)
      response.end('Forbidden')
      return
    }

    const videoId = decodeURIComponent(url.pathname.slice('/media/'.length))
    if (!videoId || videoId.length > 200) {
      response.writeHead(400)
      response.end('Bad request')
      return
    }

    const range = this.boundedRange(request.headers.range)
    if (!range) {
      response.writeHead(416, { 'Content-Range': 'bytes */*' })
      response.end()
      return
    }

    const controller = new AbortController()
    response.on('close', () => controller.abort())

    try {
      const upstream = await this.fetchWithRetry(videoId, range, controller.signal)
      if (DEBUG) {
        console.log(
          '[media]',
          request.headers.range ?? 'no-range',
          '->',
          range,
          '=',
          upstream.status,
          upstream.headers.get('content-range') ?? ''
        )
      }

      await this.pipeUpstream(request, response, upstream, controller)
    } catch (error) {
      if (controller.signal.aborted) return
      console.error('[media] proxy error', error)
      if (!response.headersSent) {
        response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
      }
      response.end('Media upstream failed')
    }
  }

  private async fetchWithRetry(
    videoId: string,
    range: string,
    signal: AbortSignal
  ): Promise<Response> {
    let source = await musicService.resolve(videoId)
    let lastError: unknown = null

    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

      const timeout = AbortSignal.timeout(25_000)
      const attemptSignal = AbortSignal.any([signal, timeout])

      try {
        const upstream = await this.fetchUpstream(source.url, range, attemptSignal)
        if (upstream.status === 403 && attempt < 2) {
          await upstream.body?.cancel()
          source = await musicService.resolve(videoId, true)
          if (DEBUG) console.log('[media] 403, refreshing source', videoId, range)
          await delay(250 * (attempt + 1))
          continue
        }
        return upstream
      } catch (error) {
        lastError = error
        if (signal.aborted) throw error
        if (DEBUG) {
          console.log(
            '[media] upstream attempt failed',
            attempt + 1,
            videoId,
            range,
            error instanceof Error ? error.message : error
          )
        }
        if (attempt < 2) {
          if (attempt >= 1) source = await musicService.resolve(videoId, true)
          await delay(300 * (attempt + 1))
        }
      }
    }

    throw lastError ?? new Error('Media upstream failed')
  }

  private async fetchUpstream(url: string, range: string, signal: AbortSignal): Promise<Response> {
    return fetch(url, {
      headers: {
        Accept: '*/*',
        'Accept-Encoding': 'identity',
        Range: range,
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
      },
      signal
    })
  }

  private async pipeUpstream(
    request: IncomingMessage,
    response: ServerResponse,
    upstream: Response,
    controller: AbortController
  ): Promise<void> {
    if (!upstream.ok) {
      if (!response.headersSent) {
        response.writeHead(upstream.status === 403 ? 502 : upstream.status, {
          'Content-Type': 'text/plain; charset=utf-8'
        })
      }
      response.end(upstream.status === 403 ? 'Media URL expired' : 'Media upstream error')
      return
    }

    const headers: Record<string, string> = {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Accept-Ranges': upstream.headers.get('accept-ranges') ?? 'bytes',
      'Content-Disposition': 'inline'
    }

    const contentLength = upstream.headers.get('content-length')
    const contentRange = upstream.headers.get('content-range')
    if (contentLength) headers['Content-Length'] = contentLength
    if (contentRange) headers['Content-Range'] = contentRange

    response.writeHead(upstream.status, headers)

    if (request.method === 'HEAD' || !upstream.body) {
      response.end()
      await upstream.body?.cancel()
      return
    }

    const stream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0])
    stream.on('error', (error) => {
      controller.abort()
      if (!response.writableEnded) response.destroy(error)
    })
    stream.pipe(response)
  }

  private boundedRange(rangeHeader: string | undefined): string | null {
    if (!rangeHeader) return `bytes=0-${CHUNK_SIZE - 1}`

    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim())
    if (!match) return null

    const start = Number(match[1])
    if (!Number.isSafeInteger(start) || start < 0) return null

    const end = match[2]
      ? Number(match[2])
      : Math.min(start + CHUNK_SIZE - 1, Number.MAX_SAFE_INTEGER)

    if (!Number.isSafeInteger(end) || end < start) return null
    return `bytes=${start}-${end}`
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const mediaProxy = new MediaProxy()
