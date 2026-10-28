import { app, nativeImage } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'build', 'icon-source.png')

const ICON_SIZE = 1024
const CORNER_RADIUS_RATIO = 0.225
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const ICNS_SIZES = [16, 32, 64, 128, 256, 512, 1024]
const ICNS_TYPES = {
  16: 'icp4',
  32: 'icp5',
  64: 'icp6',
  128: 'ic07',
  256: 'ic08',
  512: 'ic09',
  1024: 'ic10'
}

function pngAt(image, size) {
  return image.resize({ width: size, height: size, quality: 'best' }).toPNG()
}

function roundCorners(image) {
  const { width, height } = image.getSize()
  const bitmap = image.toBitmap()
  const radius = Math.min(width, height) * CORNER_RADIUS_RATIO
  const halfWidth = width / 2
  const halfHeight = height / 2

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = Math.abs(x + 0.5 - halfWidth) - (halfWidth - radius)
      const dy = Math.abs(y + 0.5 - halfHeight) - (halfHeight - radius)
      const distance =
        Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius
      const coverage = Math.max(0, Math.min(1, 0.5 - distance))
      if (coverage >= 1) continue

      const alphaIndex = (y * width + x) * 4 + 3
      bitmap[alphaIndex] = Math.round(bitmap[alphaIndex] * coverage)
    }
  }

  return nativeImage.createFromBitmap(bitmap, { width, height })
}

function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  const entries = Buffer.alloc(16 * images.length)
  let offset = header.length + entries.length

  images.forEach(({ size, data }, index) => {
    const entry = index * 16
    entries.writeUInt8(size >= 256 ? 0 : size, entry)
    entries.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    entries.writeUInt8(0, entry + 2)
    entries.writeUInt8(0, entry + 3)
    entries.writeUInt16LE(1, entry + 4)
    entries.writeUInt16LE(32, entry + 6)
    entries.writeUInt32LE(data.length, entry + 8)
    entries.writeUInt32LE(offset, entry + 12)
    offset += data.length
  })

  return Buffer.concat([header, entries, ...images.map((image) => image.data)])
}

function buildIcns(images) {
  const chunks = images.map(({ size, data }) => {
    const type = ICNS_TYPES[size]
    const header = Buffer.alloc(8)
    header.write(type, 0, 4, 'ascii')
    header.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([header, data])
  })

  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4)
  return Buffer.concat([header, ...chunks])
}

app.whenReady().then(() => {
  const image = nativeImage.createFromPath(source)
  if (image.isEmpty()) throw new Error(`Could not read ${source}`)

  const rounded = roundCorners(
    image.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: 'best' })
  )

  const ico = ICO_SIZES.map((size) => ({ size, data: pngAt(rounded, size) }))
  const icns = ICNS_SIZES.map((size) => ({ size, data: pngAt(rounded, size) }))

  mkdirSync(join(root, 'build'), { recursive: true })
  mkdirSync(join(root, 'resources'), { recursive: true })

  writeFileSync(join(root, 'build', 'icon.png'), pngAt(rounded, ICON_SIZE))
  writeFileSync(join(root, 'build', 'icon.ico'), buildIco(ico))
  writeFileSync(join(root, 'build', 'icon.icns'), buildIcns(icns))
  writeFileSync(join(root, 'resources', 'icon.png'), pngAt(rounded, 512))
  writeFileSync(join(root, 'resources', 'tray.png'), pngAt(rounded, 32))

  console.log('Generated icon.png, icon.ico, icon.icns, resources/icon.png and resources/tray.png')
  app.quit()
})
