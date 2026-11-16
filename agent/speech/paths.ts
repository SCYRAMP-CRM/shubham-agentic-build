import path from 'node:path'
import { defaultRoot } from '../config.ts'

/** Shared by the speech engine, Dependencies and installer. Never an .exe alias on Linux. */
export function speechPaths(model: string, root = defaultRoot(process.env), platform: string = process.platform) {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(model) || model.includes('..')) throw new Error('Invalid Whisper model name')
  const p = platform === 'win32' ? path.win32 : path.posix
  const bin = p.join(root, 'speech-bin', 'whisper', 'Release')
  return {
    root,
    bin,
    exe: p.join(bin, platform === 'win32' ? 'whisper-server.exe' : 'whisper-server'),
    models: p.join(root, 'models'),
    model: p.join(root, 'models', `ggml-${model}.bin`),
  }
}
