export const COMPRESSION_PROFILES = {
  compact: {
    label: '省空间',
    image: { recursiveScan: true, engine: 'auto', local: { png: { mode: 'lossy', minQuality: 55, maxQuality: 75, maxColors: 128 }, jpeg: { quality: 68, progressive: true }, webp: { mode: 'lossy', quality: 65 }, avif: { quality: 55, speed: 8 } } },
    audio: {
      recursiveScan: true,
      mp3: { bitrate: '48k', sampleRate: 32000, channels: 1 },
      ogg: { bitrate: '64k', sampleRate: 32000, channels: 1 },
      wav: { sampleRate: 16000, channels: 1 }
    }
  },
  balanced: {
    label: '平衡',
    image: { recursiveScan: true, engine: 'auto', local: { png: { mode: 'lossy', minQuality: 70, maxQuality: 90, maxColors: 256 }, jpeg: { quality: 82, progressive: true }, webp: { mode: 'lossy', quality: 80 }, avif: { quality: 70, speed: 6 } } },
    audio: {
      recursiveScan: true,
      mp3: { bitrate: '96k', sampleRate: 44100, channels: 2 },
      ogg: { bitrate: '96k', sampleRate: 44100, channels: 2 },
      wav: { sampleRate: 22050, channels: 2 }
    }
  },
  quality: {
    label: '高质量',
    image: { recursiveScan: true, engine: 'auto', local: { png: { mode: 'lossy', minQuality: 85, maxQuality: 100, maxColors: 256 }, jpeg: { quality: 92, progressive: true }, webp: { mode: 'lossy', quality: 90 }, avif: { quality: 85, speed: 4 } } },
    audio: {
      recursiveScan: true,
      mp3: { bitrate: '192k', sampleRate: 48000, channels: 2 },
      ogg: { bitrate: '160k', sampleRate: 48000, channels: 2 },
      wav: { sampleRate: 44100, channels: 2 }
    }
  }
}

export const DEFAULT_COMPRESSION = COMPRESSION_PROFILES.balanced

export const MP3_BITRATES = ['48k', '64k', '96k', '128k', '192k']
export const OGG_BITRATES = ['64k', '96k', '128k', '160k', '192k']
export const SAMPLE_RATES = [16000, 22050, 32000, 44100, 48000]
export const CHANNEL_OPTIONS = [1, 2]

export function cloneCompression(compression = DEFAULT_COMPRESSION) {
  return {
    image: {
      ...DEFAULT_COMPRESSION.image,
      ...(compression.image ?? {}),
      local: {
        ...DEFAULT_COMPRESSION.image.local,
        ...(compression.image?.local ?? {}),
        png: { ...DEFAULT_COMPRESSION.image.local.png, ...(compression.image?.local?.png ?? {}) },
        jpeg: { ...DEFAULT_COMPRESSION.image.local.jpeg, ...(compression.image?.local?.jpeg ?? {}) },
        webp: { ...DEFAULT_COMPRESSION.image.local.webp, ...(compression.image?.local?.webp ?? {}) },
        avif: { ...DEFAULT_COMPRESSION.image.local.avif, ...(compression.image?.local?.avif ?? {}) }
      }
    },
    audio: {
      ...DEFAULT_COMPRESSION.audio,
      ...(compression.audio ?? {}),
      mp3: { ...DEFAULT_COMPRESSION.audio.mp3, ...(compression.audio?.mp3 ?? {}) },
      ogg: { ...DEFAULT_COMPRESSION.audio.ogg, ...(compression.audio?.ogg ?? {}) },
      wav: { ...DEFAULT_COMPRESSION.audio.wav, ...(compression.audio?.wav ?? {}) }
    }
  }
}

export function imagePayload(paths, compression, apiKeys) {
  const image = compression.image
  return { paths, recursive: image.recursiveScan, engine: image.engine, local: image.local, apiKeys }
}

export function audioPayload(paths, compression) {
  const audio = compression.audio
  return {
    paths,
    recursive: audio.recursiveScan,
    mp3: audio.mp3,
    ogg: audio.ogg,
    wav: audio.wav
  }
}

export function audioSummary(compression) {
  const { mp3, ogg, wav } = compression.audio
  return `MP3 ${mp3.bitrate} / OGG ${ogg.bitrate} / WAV ${formatSampleRate(wav.sampleRate)}`
}

export function formatSampleRate(value) {
  if (value === 22050) return '22.05kHz'
  if (value === 44100) return '44.1kHz'
  return `${value / 1000}kHz`
}
