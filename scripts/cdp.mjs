import { writeFileSync } from 'node:fs'

const port = process.env.CDP_PORT ?? '9222'
const expression = process.argv.slice(2).join(' ') || 'document.title'

async function targets() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) return response.json()
    } catch {
      // Electron is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Could not connect to Electron DevTools')
}

const list = await targets()
const target = list.find((item) => item.type === 'page' && !item.url.startsWith('devtools://'))

if (!target) {
  console.error(
    'No page target found. Targets:',
    list.map((item) => ({ type: item.type, url: item.url }))
  )
  process.exit(1)
}

const socket = new WebSocket(target.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()

socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) reject(new Error(message.error.message))
    else resolve(message.result)
    return
  }

  if (message.method === 'Runtime.consoleAPICalled') {
    const values = message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type)
    console.log(`[renderer:${message.params.type}]`, ...values)
  }

  if (message.method === 'Log.entryAdded') {
    const entry = message.params.entry
    console.log(`[renderer:log:${entry.level}]`, entry.text)
  }
})

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

function send(method, params = {}) {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

await send('Runtime.enable')
await send('Log.enable')

try {
  const result = await send('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  })

  if (result.exceptionDetails) {
    console.error(JSON.stringify(result.exceptionDetails, null, 2))
    process.exitCode = 1
  } else {
    console.log(JSON.stringify(result.result?.value ?? result.result, null, 2))
  }

  if (process.env.CDP_SCREENSHOT) {
    const screenshot = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false
    })
    writeFileSync(process.env.CDP_SCREENSHOT, Buffer.from(screenshot.data, 'base64'))
    console.log(`screenshot saved to ${process.env.CDP_SCREENSHOT}`)
  }
} finally {
  socket.close()
}
