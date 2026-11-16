/** Public artifacts only. No commands, private keys, credentials, mutable latest URL or automatic model selection. */
export interface Artifact {
  url: string
  bytes: number
  sha256: string
}
export interface ProgramArtifact extends Artifact {
  /** The archive's one folder: every file of the program is directly in it. */
  prefix: string
  /** The server program in it, the one speech/engine.ts runs. */
  server: string
  /** Its SHA-256: the same whisper-server.exe the Server has run since F-080 (read 15 Nov, never run for this). */
  serverSha256: string
}

export const WHISPER_VERSION = '1.9.5'
export const WHISPER_BUILD = 'b5454'
export const MODEL_REVISION = '5359861c739e955e79d9a303bcbc70fb988958b1'
export const SMALL: Artifact = {
  url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${MODEL_REVISION}/ggml-small.bin`,
  bytes: 487_601_967,
  sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
}
const BASE = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_BUILD}/`

/**
 * F-251: Windows x64 only for now. Linux (the Z800) needs its own reviewed archive, layout and CPU check, and its own
 * approval; until then nothing is guessed or fetched for it, or for any other system.
 */
export function programArtifact(platform: string, arch: string): ProgramArtifact {
  if (platform === 'win32' && arch === 'x64') return {
    url: `${BASE}whisper-bin-x64.zip`, bytes: 8_928_640,
    sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb',
    prefix: 'Release', server: 'whisper-server.exe',
    serverSha256: 'a97456e747f28e7bb09c1dac35f40d94404c5ecffa74aaaaa7a3753ea6543121',
  }
  throw new Error(`No reviewed Whisper program for ${platform}/${arch}`)
}

/** Only small has a pinned download. Another model (SAD_WHISPER_MODEL) goes in the models folder by hand. */
export const hasPinnedModel = (model: string) => model === 'small'

export function modelArtifact(model: string): Artifact {
  if (!hasPinnedModel(model)) throw new Error(`No pinned automatic download for Whisper model ${model}; keep the existing model or choose small`)
  return SMALL
}
