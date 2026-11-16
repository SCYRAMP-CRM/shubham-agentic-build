import { NAMES, takeSentences, type Names } from './assistant.ts'
import { MAX_TEXT, type CardGoneReason, type FastServerFrame, type HandoffPhase, type TalkCard } from './fast.ts'

// F-221 (order ob98a, T3a): the talk brain of live voice. Pure: no DOM, no timers, no clock of its own, no randomness, so the same
// events always give the same actions. The page (T3b) feeds it what happens and does what it answers; everything that decides WHEN is
// here, so it is tested with a fake clock and synthetic frames (talk.test.ts).
//   in:  frame (one per 20 ms of mic audio: its level in dBFS, after the page's echo-cancelled mic) · played / play-end (playback) ·
//        stt / stt-fail (Whisper's answers) · stt-busy (Whisper still at work on them) · fast (Quick's frames) · direct (a poll of a
//        direct-mode order) · user (Stop, End, Mute) · tick (every 100 ms) · ready (mic, voice and Quick up; o0de2 round 2: never Whisper's
//        model, and his voice is taken from the first frame: what he says before ready is decided at ready)
//   out: stt / stt-abort · ask / cancel / direct-ask · say / hush / resume / tone · drop-cards · hold-on · end · view
// The rules are Live talking classic's (src/live/classic/old-voice.generated.js, MAP.md): its echo-aware voice detector (the noise floor
// ooe, the echo level aoe, the mic pipeline coe, the segmenter poe), talk-over's echo check (2 of 3 of his words in the last 800 characters
// it said), its stop words and its early guess. Every number is in TALK, and talk.test.ts reads the classic's file to check each ported one.
// New (his answers to the plan, order ob98a): Quick or the Assistant chat answers; Chris's fillers; on the PC or earbuds a voice of
// 500 ms cuts the answer off. Spoken words never confirm anything: there is no action for that here (a card is sent only by his tap).

/** Every number of the brain. The classic's names are in the comments; the parity test checks those against its file. */
export const TALK = {
  /** One mic frame: 320 samples at 16 kHz, 20 ms (classic m8, Rie). Every timing of his voice counts these frames, never a timer. */
  frameMs: 20,
  frameSamples: 320,
  sampleRate: 16_000,
  /** A frame's level against 16-bit full scale; a silent frame is -100 dB (classic ioe). */
  fullScale: 32_768,
  silentDb: -100,
  /** The noise floor (classic ooe): the 10th percentile of the last 150 frames heard while nothing plays, once it has 10, never above -30 dB; -60 until then (QD, Fie). */
  floorFrames: 150,
  floorMinFrames: 10,
  floorPercentile: 0.1,
  floorMaxDb: -30,
  floorStartDb: -60,
  /** Frames the floor has heard before his turn can start (classic $ie). */
  floorReadyFrames: 15,
  /** Voice is over max(-50, min(floor + 12, max(-30, floor + 8))) dB (classic yf). */
  voiceMinDb: -50,
  voiceOverFloorDb: 12,
  voiceCapDb: -30,
  voiceNearFloorDb: 8,
  /** Quiet is under max(-56, min(floor + 6, voice - 3)) dB (classic $2). */
  quietMinDb: -56,
  quietOverFloorDb: 6,
  quietUnderVoiceDb: 3,
  /** Its own echo (classic aoe): the 90th percentile of the last 150 frames heard while it plays and he is not talking, once 15 were loud or 75 were heard, sorted again every 5 (eL, Wie, Gie). */
  echoFrames: 150,
  echoLoudFrames: 15,
  echoMinFrames: 75,
  echoSortEvery: 5,
  echoPercentile: 0.9,
  /** While anything plays (fillers too) his voice starts only 6 dB over that echo (qie), and is quiet under echo + 2 dB (Kie). */
  echoOverDb: 6,
  echoQuietOverDb: 2,
  /** Frames after the sound stops that still count as its echo (classic Vie); the end-of-turn tone gets the same tail. */
  echoTailFrames: 12,
  /** Frames too loud for the echo while it plays are kept, at most this many (classic Xie), and learnt as echo if his words were its own after all. */
  doubtFrames: 50,
  /** His turn starts when 6 of the last 8 frames are over the threshold (classic Iie, JD). */
  onsetFrames: 6,
  onsetWindow: 8,
  /** 3 frames in a row over the quiet line, peaking over the voice line, are voice (classic Die). */
  runFrames: 3,
  /** Frames kept from before his turn started (classic ZD, 500 ms). */
  preRollFrames: 25,
  /** Frames kept after his last voice, and the quiet at which the early guess goes (classic R2, 300 ms). */
  tailFrames: 15,
  /** Quiet that ends his turn at the default 700 ms (classic Lie); the setting makes it 50 or 75 frames. */
  endQuietFrames: 35,
  /** The least voice in a turn (classic DC, 260 ms); a turn cut at the 25 s limit goes on with 5 (LC), which is also when the brain counts him as heard. */
  minSpeechFrames: 13,
  hearingFrames: 5,
  /** The longest piece Whisper is given at once (classic Oie, 25 s); a longer turn is cut there and goes on. */
  maxSegmentFrames: 1250,
  /** A transcription not back in 20 s has failed (classic p8). */
  sttTimeoutMs: 20_000,
  /** Talk-over's echo check (the classic's spokenRecent and yoursIn): the last 800 characters it said; 2 of 3 of his words in them = its own echo. */
  spokenWindowChars: 800,
  echoWordsOf: [2, 3],
  /** One ask, at most (classic Uoe; shared/fast.ts MAX_TEXT). */
  maxAskChars: 2000,
  // --- new (not the classic's) ---------------------------------------------------------------------------------------
  /** On the PC or earbuds (cut-in Auto), a voice this long over the answer cuts it off (500 ms); shorter, the answer goes on. */
  cutInFrames: 25,
  /** The ack waits this long for a first word or tool line (the setting's default; at 2.5 s about 1 turn in 6 gets one, by the logs). */
  ackDelayMs: 2500,
  ackDelayMaxMs: 60_000,
  /** The quiet that ends his turn, as the setting offers it (700 ms is the classic's). */
  endQuietOptionsMs: [700, 1000, 1500],
  /** Auto-end, when it is on: 2 minutes of silence (his decision 6; off by default: only End ends it). The setting takes 1 s to a day. */
  autoEndMs: 120_000,
  autoEndMinMs: 1000,
  autoEndMaxMs: 86_400_000,
  /** Progress lines while it thinks, in Chris's words: 25 s and 90 s after the ask. */
  progressAtMs: [25_000, 90_000],
  /** Fillers in one turn, at most (an ack or a tool label, then the two progress lines). */
  maxFillers: 3,
  /** What he heard of an answer he cut off, at most (the ask's `heard`, as the hub takes it). */
  heardMaxChars: 600,
  /** A direct-mode answer is said up to 3 sentences; the rest is on the screen. */
  directSentences: 3,
  /**
   * One say at most: the PC voice takes 400 characters at a time (T1's MAX_CHARS in agent/speech/tts.ts; 413 above). A longer sentence
   * is said in pieces, so a direct answer's 3 sentences are at most 1200 characters, the hub's own spoken cap (SPEAK_MAX).
   */
  sayMaxChars: 400,
  /** Lines the transcript keeps, and one line's length at most. */
  transcriptMax: 60,
  lineMaxChars: 4000,
  /** Turns and orders the brain remembers (an answer still playing or an order still out keeps its turn). */
  turnsMax: 16,
  ordersMax: 20,
  /** An order's status words, at most (as the hub's progress frame keeps them). */
  wordsMaxChars: 80,
  /** A name of a chat, at most; the session's id prefix, at most. */
  nameMaxChars: 40,
  idPrefixMaxChars: 24,
  /** The longest stop word or backchannel, in words ("stop talking please" is two phrases). */
  phraseMaxWords: 4,
  /**
   * o0de2: he goes on within this long after his last piece ended: the same turn of his, one ask (the classic's merge). Later than that, his
   * earlier words still with Whisper are a turn of their own, decided once they are back and he is quiet. (With Whisper slower than his
   * pauses, the merge went on for as long as he kept talking: nothing was shown and nothing was asked.)
   */
  mergeGapMs: 1500,
  /**
   * o0de2: the 20 s above counts from a transcription's last sign of life: its request, or the PC saying Whisper is still at work on it
   * (loading its model, or busy with it or an earlier piece; the page asks GET /speech/status). This is the most it waits in any case.
   */
  sttMaxMs: 120_000,
  /**
   * o0de2 round 2: a turn of his with this much VOICE (his voiced frames, not the audio sent: that has 0.8 s of the room around them) that
   * Whisper gave no words for gets "I didn't catch any words", said and shown; less is a cough or a click. (Round 1 counted the audio, 1.8 s
   * of it: his short tries of 14 Nov, 1.0-1.78 s of audio, would have got nothing at all had Whisper given no words for them.)
   */
  noWordsVoiceMs: 400,
  /**
   * o0de2 round 3: a "Thank you." the PC dropped as one of Whisper's inventions is his own thank you (a backchannel: nothing said back) only
   * right after an answer he heard, and only with at most this much voice (a thank you takes under a second). Longer, or with no answer
   * before it, it is Whisper's invention on words it could not write (rig s2-empty: his 19 s question and a 1 s "Can you hear me?" came
   * back as " Thank you."), and he is told it caught no words.
   */
  thanksMaxVoiceMs: 1500,
  /**
   * o0de2 round 4: "right after an answer" is this long: his voice starts at most this long after the end of the answer he heard (its last
   * sentence's play-end), with no turn of his decided since (so none of its own lines about his words said either: those are said only as a
   * turn of his is decided). Round 3 asked only that an answer had been heard at some time: his retry after "Sorry, I didn't catch that." or
   * "I didn't catch any words.", or a try a minute later, that Whisper wrote as " Thank you." got nothing at all (rig y-retry-thanks-failed,
   * y-retry-thanks-nowords, y-late-thanks).
   */
  thanksAfterAnswerMs: 5000,
} as const

// --- options (Settings › Chats › Assistant › Live voice) --------------------------------------------------------------------

export type TalkMode = 'quick' | 'direct'
export type TalkCutIn = 'auto' | 'talk-over' | 'tap'
export type TalkDevice = 'pc' | 'earbuds' | 'phone-speaker'
export type TalkFillers = 'words' | 'tone' | 'off'
export type TalkLang = 'auto' | 'en' | 'hi' | 'mr'
export type TalkEndQuiet = (typeof TALK.endQuietOptionsMs)[number]

export interface TalkOptions {
  /** quick: Quick answers (cards for real work). direct: straight to the Assistant chat, as orders (his setting). */
  mode: TalkMode
  /** auto: on the PC or earbuds his voice cuts in, on the phone speaker it talks over; talk-over: its own echo is told from his words; tap: only Stop. */
  cutIn: TalkCutIn
  /** Where the sound comes out (the page decides from the mic's label and the platform). */
  device: TalkDevice
  fillers: TalkFillers
  /** The ack waits this long for a first word or tool line. */
  ackDelayMs: number
  /** Quiet that ends his turn. */
  endQuietMs: TalkEndQuiet
  /** An early transcription at 300 ms of quiet, used when he says no more. */
  guess: boolean
  /** null: only End ends it. */
  autoEndMs: number | null
  /** Whisper's language: the page sends it with each transcription; the brain only keeps it with the other settings. */
  lang: TalkLang
  /** Starts every id the brain makes, so two sessions never share one: a short plain word, new for each session. */
  idPrefix: string
  /** What the chats are called (Settings): the lines that name them follow it. */
  names: Names
}

export const TALK_DEFAULTS: TalkOptions = {
  mode: 'quick',
  cutIn: 'auto',
  device: 'pc',
  fillers: 'words',
  ackDelayMs: TALK.ackDelayMs,
  endQuietMs: TALK.endQuietOptionsMs[0],
  guess: false,
  autoEndMs: null,
  // o0de2 round 2: English unless he chose another (see TALK_SETTINGS.lang).
  lang: 'en',
  idPrefix: 'talk',
  names: NAMES.old,
}
/** An id prefix: plain, and with no ':' so no id the brain makes can look like the hub's own o:<order> turns. */
const ID_PREFIX = new RegExp(`^[A-Za-z0-9_.-]{1,${TALK.idPrefixMaxChars}}$`)

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const oneOf = <T>(v: unknown, list: readonly T[], d: T): T => ((list as readonly unknown[]).includes(v) ? (v as T) : d)
const within = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

/** The settings as the brain takes them: anything missing or not understood is the default. */
export function talkOptions(raw: unknown): TalkOptions {
  const o = isObject(raw) ? raw : {}
  const n = isObject(o.names) ? o.names : {}
  const name = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, TALK.nameMaxChars) : null)
  const big = name(n.big)
  const fast = name(n.fast)
  return {
    mode: oneOf(o.mode, ['quick', 'direct'] as const, TALK_DEFAULTS.mode),
    cutIn: oneOf(o.cutIn, ['auto', 'talk-over', 'tap'] as const, TALK_DEFAULTS.cutIn),
    device: oneOf(o.device, ['pc', 'earbuds', 'phone-speaker'] as const, TALK_DEFAULTS.device),
    fillers: oneOf(o.fillers, ['words', 'tone', 'off'] as const, TALK_DEFAULTS.fillers),
    ackDelayMs: within(o.ackDelayMs, 0, TALK.ackDelayMaxMs) ? Math.round(o.ackDelayMs) : TALK_DEFAULTS.ackDelayMs,
    endQuietMs: oneOf(o.endQuietMs, TALK.endQuietOptionsMs, TALK_DEFAULTS.endQuietMs),
    guess: o.guess === true,
    autoEndMs: within(o.autoEndMs, TALK.autoEndMinMs, TALK.autoEndMaxMs) ? Math.round(o.autoEndMs) : null,
    lang: oneOf(o.lang, ['auto', 'en', 'hi', 'mr'] as const, TALK_DEFAULTS.lang),
    idPrefix: typeof o.idPrefix === 'string' && ID_PREFIX.test(o.idPrefix) ? o.idPrefix : TALK_DEFAULTS.idPrefix,
    names: big && fast ? { big, fast } : TALK_DEFAULTS.names,
  }
}

// --- his settings (T3b: Settings › Chats › Assistant › Live voice, kept in this browser as 'sad-talk') -------------------

/** Who speaks: the PC's own voices (rendered on the PC, played by the page), or the browser's own (the old way). */
export type TalkVoice = 'pc' | 'browser'
/** End: only his End (decision 6's default), or after 2 minutes of silence too. */
export type TalkEndRule = 'button' | 'silence'
/** The PC voice's speeds the setting offers (1 is normal; the PC takes 0.5 to 2). */
export const TALK_RATES = [0.8, 1, 1.2, 1.5] as const
/** The ack's waits the setting offers (2.5 s by default: about 1 turn in 6 gets one, by the logs). */
export const TALK_ACK_DELAYS_MS = [1500, 2500, 4000] as const
/** A PC voice's id at most (a Windows voice token's path is long). */
export const TALK_VOICE_ID_MAX = 300

export interface TalkSettings {
  /** quick: Quick answers (cards for real work). direct: straight to the Assistant chat (offered only with the voice lock below the model). */
  mode: TalkMode
  voice: TalkVoice
  /** A voice from GET /speech/voices; '' = the best one installed (the PC chooses: en-IN for English, hi-IN for Devanagari). */
  pcVoice: string
  rate: (typeof TALK_RATES)[number]
  cutIn: TalkCutIn
  fillers: TalkFillers
  ackDelayMs: (typeof TALK_ACK_DELAYS_MS)[number]
  /** The pause before it answers. */
  endQuietMs: TalkEndQuiet
  guess: boolean
  end: TalkEndRule
  lang: TalkLang
}

export const TALK_SETTINGS: TalkSettings = {
  mode: 'quick',
  voice: 'pc',
  pcVoice: '',
  rate: 1,
  cutIn: 'auto',
  fillers: 'words',
  ackDelayMs: 2500,
  endQuietMs: 700,
  guess: false,
  end: 'button',
  /**
   * o0de2 round 2: English by default (Whisper gets 'en', as dictation's en-IN does). His PC's job log of 14 Nov: dictation's pieces with en
   * ran 1.2-1.5 s, live talk's with auto 3-12 s (whisper.cpp first guesses the language, and it runs one job at a time), and auto can turn
   * noisy pieces into nothing. Auto, Hindi and Marathi stay choices in Settings › Live voice. Round 3: a browser that saved its settings
   * before this gets en too, once (TALK_SETTINGS_VERSION); what he picks after it is kept. His 19:05 talk of 14 Nov: its exact cause is NOT
   * confirmed (most likely Whisper gave back no words with auto); the log fields added in round 1 (the whisper job line's lang= and chars=,
   * the hub's line for each ask it takes) will show it the next time.
   */
  lang: 'en',
}

/**
 * o0de2 round 3: the version his settings are stored with ('sad-talk' keeps { v, ...TalkSettings }). Before it there was none, Language's
 * default was Auto, and every save of ANY Live voice option (the voice, cut in, fillers, the pause...) stored lang 'auto' with the rest: a
 * stored 'auto' without the version is not known to be his choice, so it is moved to English (round 2's default) once (loadTalkSettings),
 * and stored with the version. From then on his Auto, Hindi or Marathi is kept.
 */
export const TALK_SETTINGS_VERSION = 2

/** His stored settings, checked (parseTalkSettings) and moved on to this version. `old`: stored before it (the page stores them again, once). */
export function loadTalkSettings(raw: unknown): { settings: TalkSettings; old: boolean } {
  if (!isObject(raw)) return { settings: parseTalkSettings(raw), old: false }
  const old = !(typeof raw.v === 'number' && raw.v >= TALK_SETTINGS_VERSION)
  return { settings: parseTalkSettings(old && raw.lang === 'auto' ? { ...raw, lang: 'en' } : raw), old }
}

/** His settings as they are stored: with their version. */
export function storedTalkSettings(s: TalkSettings): TalkSettings & { v: number } {
  return { v: TALK_SETTINGS_VERSION, ...s }
}

/** His settings as stored, checked field by field: anything missing, of the wrong type or not one of the choices is that field's default. */
export function parseTalkSettings(raw: unknown): TalkSettings {
  const o = isObject(raw) ? raw : {}
  const d = TALK_SETTINGS
  const voiceId = typeof o.pcVoice === 'string' && o.pcVoice.length <= TALK_VOICE_ID_MAX && !Array.from(o.pcVoice).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ? o.pcVoice.trim() : d.pcVoice
  return {
    mode: oneOf(o.mode, ['quick', 'direct'] as const, d.mode),
    voice: oneOf(o.voice, ['pc', 'browser'] as const, d.voice),
    pcVoice: voiceId,
    rate: oneOf(o.rate, TALK_RATES, d.rate),
    cutIn: oneOf(o.cutIn, ['auto', 'talk-over', 'tap'] as const, d.cutIn),
    fillers: oneOf(o.fillers, ['words', 'tone', 'off'] as const, d.fillers),
    ackDelayMs: oneOf(o.ackDelayMs, TALK_ACK_DELAYS_MS, d.ackDelayMs),
    endQuietMs: oneOf(o.endQuietMs, TALK.endQuietOptionsMs, d.endQuietMs),
    guess: o.guess === true,
    end: oneOf(o.end, ['button', 'silence'] as const, d.end),
    lang: oneOf(o.lang, ['auto', 'en', 'hi', 'mr'] as const, d.lang),
  }
}

/** The brain's options for one session: his settings, and what the page decides (the mode it may use, where the sound comes out, the session's id prefix, the names). */
export function talkBrainOptions(s: TalkSettings, page: { mode: TalkMode; device: TalkDevice; idPrefix: string; names: Names }): TalkOptions {
  return talkOptions({
    mode: page.mode,
    cutIn: s.cutIn,
    device: page.device,
    fillers: s.fillers,
    ackDelayMs: s.ackDelayMs,
    endQuietMs: s.endQuietMs,
    guess: s.guess,
    autoEndMs: s.end === 'silence' ? TALK.autoEndMs : null,
    lang: s.lang,
    idPrefix: page.idPrefix,
    names: page.names,
  })
}

// --- what comes in -----------------------------------------------------------------------------------------------------------

/**
 * A card on his screen: T2's TalkCard (shared/fast.ts; T3b uses that one now that T2 is in). It is sent only by his tap on the page (an
 * HTTP route with his signed-in session); the brain only shows it and may drop it.
 */
export type { CardGoneReason, TalkCard }
/** T2's two card frames on Quick's stream (both clients ignore frames they do not know). */
export type TalkCardFrame = { t: 'card'; card: TalkCard } | { t: 'card-gone'; id: string; reason: CardGoneReason; orderId?: string }
export type TalkFastFrame = FastServerFrame | TalkCardFrame

/** A word's place in a sentence the PC voice rendered: when it starts in the audio, and where it is in the text. */
export interface TalkMark {
  ms: number
  start: number
  end: number
}

/**
 * A direct-mode ask as the page last saw it: POST /talk/ask's answer, then each poll of GET /talk/ask/<orderId> (the order's view,
 * its status words and its relay cards). `id` is the brain's direct-ask id.
 */
export interface TalkDirectView {
  id: string
  orderId?: string
  state: 'queued' | 'working' | 'done' | 'error'
  /** The Assistant's spinner words while it works. */
  words?: string
  /** done: its answer, as it wrote it (the brain makes it fit to be said). */
  speak?: string
  /** error: one plain sentence. */
  error?: string
  cards?: readonly TalkCard[]
  /**
   * T3b (review of T2): while it is open, where the order is (GET /talk/ask/<orderId> gives it: queued, typed, working, waiting-you, slow).
   * A direct line has no socket for Quick's handoff-progress, so this is how it hears 'waiting-you' (the Assistant waits for HIS answer on the PC).
   */
  phase?: HandoffPhase
  /**
   * T4 phase 2: GET /talk/ask's `held`: the Assistant chat is held for this line now (its order, or the residual hold it left when it ended
   * abnormally), so the page shows the voice lock and Let go exactly while it is true. Left out by an older hub (the line holds while it is out).
   * The brain does not read it.
   */
  held?: boolean
}

export type TalkUserAct = 'stop' | 'end' | 'mute' | 'unmute'

/**
 * What happens, each with the page's clock in ms. Frames are counted: the n-th frame event of the session is frame n (from 0, before
 * `ready` and while muted too), and `stt` asks for frames by those numbers.
 */
export type TalkEvent =
  | { t: 'frame'; now: number; db: number }
  /**
   * Playback of a sentence: ms played so far: 0 the moment it starts (its echo is gated from then), then at least every 100 ms while it
   * plays and once more when it is hushed; its word marks when the PC voice gave them (offsets into the sentence's text).
   */
  | { t: 'played'; now: number; id: string; ms: number; marks?: readonly TalkMark[] }
  /** A sentence ended: played out, failed to render, or stopped at its word by `hush word`. (A later sentence starting ends it too.) */
  | { t: 'play-end'; now: number; id: string }
  /**
   * Whisper's words. `dropped` (o0de2 round 3): the whole of what Whisper wrote was one of its known inventions on silence or noise, and the
   * PC dropped it (agent/speech/words.ts; POST /speech/transcribe's `dropped`): what it was. A dropped "Thank you." is his backchannel.
   */
  | { t: 'stt'; now: number; req: number; text: string; dropped?: string }
  | { t: 'stt-fail'; now: number; req: number; status: number }
  /**
   * o0de2: the PC says Whisper is still at work on what was sent (GET /speech/status says busy: a model loading for it counts): every
   * transcription out is alive now, so none is given up while the PC works on it (a cold load, a long piece, a queue of his pieces).
   */
  | { t: 'stt-busy'; now: number }
  | { t: 'fast'; now: number; frame: TalkFastFrame }
  | { t: 'direct'; now: number; view: TalkDirectView }
  | { t: 'user'; now: number; act: TalkUserAct }
  | { t: 'tick'; now: number }
  | { t: 'ready'; now: number }

// --- what goes out -----------------------------------------------------------------------------------------------------------

export type SayKind = 'answer' | 'filler' | 'progress'
export type TalkEndReason = 'end' | 'silence' | 'taken-over' | 'paused' | 'unavailable' | 'off'

/**
 * What the page does. The player keeps the sentences it is given in order:
 *   say: render it and play it after the ones before it.
 *   hush now + hold: pause at once and keep the rest (that sentence from where it stopped, and all after it) for a `resume`.
 *   hush now, no hold: stop at once and drop everything it has.
 *   hush word: let the sentence playing (a filler) reach the end of its word, then stop and drop it and what was queued before this action.
 */
export type TalkAction =
  /**
   * Transcribe frames fromFrame <= n < toFrame, then push `stt` (its text) or `stt-fail`. `guess`: the early guess (Whisper may answer
   * 409 busy at once). One with no sign of life for 20 s (o0de2: the page pushes `stt-busy` while the PC works on it), or out 2 minutes, is
   * given up (`stt-abort`) and counts as failed. `check` (review of T3b): a short sound of his over the answer (under 500 ms), whose words
   * are only looked at for a stop word: not a turn of his, so the page's turn record skips it.
   */
  | { t: 'stt'; req: number; fromFrame: number; toFrame: number; guess: boolean; check?: true }
  | { t: 'stt-abort'; req: number }
  /** To Quick: {t:'ask', id, text, via:'voice', heard?}. `heard`: what he heard of the answer he cut off. */
  | { t: 'ask'; id: string; text: string; heard?: string }
  | { t: 'cancel'; id: string }
  /**
   * Review of T3b: he cut off a turn whose answer was all written already, so no `cancel` goes to the hub; only the page's turn record notes
   * the cut (a turn still being written gets a `cancel`, which the record counts the same).
   */
  | { t: 'cut'; id: string }
  /** Direct mode: POST /talk/ask {id, text}. */
  | { t: 'direct-ask'; id: string; text: string }
  /**
   * One sentence to say. answer: the answer (and its error lines); filler: an ack or a tool line; progress: a progress line or the waiting line.
   * `turn` (review of T3b), for the page's turn record: the ask (or direct-ask) whose answer it is or for which a filler stands in; o:<orderId>
   * when Quick tells an order's answer; none for the brain's own lines (didn't catch that, the waiting line).
   */
  | { t: 'say'; id: string; text: string; kind: SayKind; turn?: string }
  | { t: 'hush'; at: 'now' | 'word'; hold: boolean }
  | { t: 'resume' }
  /** The soft end-of-turn tone (a buzz on the phone). */
  | { t: 'tone' }
  | { t: 'drop-cards' }
  /** Quick mode, once at ready: send {t:'hold', on:true} right after start, and again after every start of a reconnect (every hand-off becomes a card). */
  | { t: 'hold-on' }
  | { t: 'end'; reason: TalkEndReason }
  /** Something on screen changed: read snapshot(). */
  | { t: 'view' }

/** hearing: his voice now; writing (o0de2): his voice ended and his words are with Whisper (it was "hearing" until they were decided). */
export type TalkPhase = 'starting' | 'listening' | 'hearing' | 'writing' | 'thinking' | 'speaking' | 'ended'
export interface TalkLine {
  who: 'you' | 'quick' | 'assistant'
  text: string
  /** He cut it off: the text is what he heard. */
  cut?: boolean
}
export type TalkOrderPhase = HandoffPhase | 'done' | 'error'
export interface TalkView {
  phase: TalkPhase
  /** The line under the orb: the sentence being said, else what it is doing. */
  caption: string
  transcript: TalkLine[]
  order?: { orderId: string; phase: TalkOrderPhase; words?: string }
  cards: TalkCard[]
  muted: boolean
  endedWhy?: string
}

export interface TalkBrain {
  /** What to do about one event. After `end` it is [] for every event; only Quick's card-gone still takes a card out of snapshot().cards. */
  push(ev: TalkEvent): TalkAction[]
  snapshot(): TalkView
}

// --- lines it says (Chris's words, mobile/.../core/brain/Lines.kt) ------------------------------------------------------------

/** Chris's acks: one at a time in turn, so never the same twice in a row. */
export const ACKS = ['On it.', 'Right away.', 'One moment.', 'Looking into it.', 'Checking now.'] as const
/** Chris's 90 s line. */
export const PROGRESS_LATE = "This one is taking a while. I'll speak up when it's done."
/** Chris's retry line: Whisper could not give his words (it failed, or they were given up). o0de2: and what to do now. */
export const NOT_CAUGHT = "Sorry, I didn't catch that. Say it again."
/** o0de2: a piece of his words was lost (Whisper failed on it) and the rest was asked: he is told, so nothing is lost silently. */
export const PART_LOST = 'I missed part of that.'
/** o0de2: a real turn of his (TALK.noWordsVoiceMs of voice) that Whisper gave no words for. Round 2: said and shown (a cough is shorter). */
export const NO_WORDS = "I didn't catch any words. Try again."
export const REST_ON_SCREEN = 'The rest is on the screen.'

/** Chris's 25 s line: "Still on it." or "Still on it: <what it is doing>." (his progress1). */
export function progressEarly(step = ''): string {
  const label = step.replace(/\s+/g, ' ').trim().replace(/[.!?:;,…]+$/u, '').trim()
  return label ? `Still on it: ${label.charAt(0).toLowerCase()}${label.slice(1)}.` : 'Still on it.'
}

const sentence = (s: string): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t === '' || /[.!?।॥]$/u.test(t) ? t : `${t}.`
}

/** A text on one line, at most `max` characters, cut at a word. */
function capText(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return (space > max / 2 ? cut.slice(0, space) : cut).trim()
}

/** The end of a text, at most `max` characters, starting at a word (what he heard last is what counts). */
function tailText(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(-max)
  const space = cut.indexOf(' ')
  return (space >= 0 && space < max / 2 ? cut.slice(space + 1) : cut).trim()
}

/**
 * A sentence cut into says the PC voice takes, at most `max` characters each (review of T3a: a direct answer with no full stops was one
 * say of 1370 characters, which the PC voice refuses): cut after a comma when one is past half the length, else at a word, else hard.
 */
export function sayPieces(text: string, max: number = TALK.sayMaxChars): string[] {
  const out: string[] = []
  let rest = text.replace(/\s+/g, ' ').trim()
  while (rest.length > max) {
    const head = rest.slice(0, max + 1)
    const clause = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '), head.lastIndexOf(': '))
    const space = head.lastIndexOf(' ')
    const end = clause > max / 2 ? clause + 1 : space > max / 2 ? space : max
    out.push(rest.slice(0, end).trim())
    rest = rest.slice(end).trim()
  }
  if (rest) out.push(rest)
  return out
}

/** An answer as sentences to be said: the hub's forSpeech (agent/agentic/voice.ts) without its length cut (the brain cuts by sentences). */
export function speechOf(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// --- his words: the text gate -------------------------------------------------------------------------------------------------

/** The classic's stop words (its Yoe list, kept whole), and his Marathi ones. A stop word only stops: never a question, never a yes. */
export const STOP_WORDS: readonly string[] = [
  'stop', 'stop it', 'stop stop', 'stop please', 'please stop', 'ok stop', 'okay stop', 'stop talking', 'wait', 'wait wait', 'hold on',
  'one second', 'one sec', 'one minute', 'enough', "that's enough", 'quiet', 'be quiet', 'shut up', 'shh', 'shhh', 'shush', 'cancel',
  'never mind', 'nevermind', 'pause', 'ruko', 'ruk', 'ruk jao', 'rukiye', 'rukho', 'ruko ruko', 'bas', 'bas bas', 'bas karo', 'bas kar',
  'chup', 'chup karo', 'chup raho', 'ek minute', 'ek min', 'ek second', 'ek sec', 'thehro', 'thahro', 'rehne do', 'chhodo', 'chodo',
  'band karo', 'रुको', 'रुक', 'रुक जाओ', 'रुकिए', 'रुको रुको', 'बस', 'बस बस', 'बस करो', 'चुप', 'चुप करो', 'चुप रहो', 'एक मिनट',
  'एक सेकंड', 'ठहरो', 'रहने दो', 'छोड़ो', 'बंद करो', 'स्टॉप',
  'thamb', 'thamba', 'थांब', 'थांबा',
]
/** "I am listening", not a question: nothing is asked. ("yes" is not one: it may answer Quick's question; it never confirms anything here.) */
export const BACKCHANNELS: readonly string[] = [
  'ok', 'okay', 'okey', 'okk', 'hmm', 'hm', 'hmmm', 'mm', 'mmm', 'mhm', 'uh huh', 'haan', 'han', 'ha', 'achha', 'acha', 'accha', 'achcha',
  'right', 'thank you', 'thanks', 'theek hai', 'thik hai', 'हाँ', 'हां', 'हम्म', 'अच्छा', 'ठीक है', 'ओके',
]

/** The words of a text as the classic compared them (its Kp): NFKC, lower case, apostrophes out, anything not a letter, mark or digit a space. */
export function talkWords(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

const phrases = (list: readonly string[]): ReadonlySet<string> => new Set(list.map(p => talkWords(p).join(' ')).filter(Boolean))
const STOP = phrases(STOP_WORDS)
const BACK = phrases(BACKCHANNELS)
const POLITE = phrases(['please', 'plz', 'pls'])

/** True when the words are made only of phrases from `need` and `also` (longest first), with at least one from `need`. */
function madeOf(words: readonly string[], need: ReadonlySet<string>, also: readonly ReadonlySet<string>[]): boolean {
  let i = 0
  let needed = false
  while (i < words.length) {
    let step = 0
    for (let len = Math.min(TALK.phraseMaxWords, words.length - i); len >= 1 && step === 0; len--) {
      const p = words.slice(i, i + len).join(' ')
      if (need.has(p)) {
        needed = true
        step = len
      } else if (also.some(s => s.has(p))) step = len
    }
    if (step === 0) return false
    i += step
  }
  return needed
}

export type TalkGate = 'empty' | 'backchannel' | 'stop' | 'words'

/** What his words are: nothing (empty, only punctuation), a backchannel, a stop word ("stop stop", "okay wait", "please stop"), or words to ask. */
export function gateOf(text: string): TalkGate {
  const w = talkWords(text)
  if (w.length === 0) return 'empty'
  if (madeOf(w, STOP, [BACK, POLITE])) return 'stop'
  if (madeOf(w, BACK, [])) return 'backchannel'
  return 'words'
}

/** Talk-over's check (the classic's yoursIn): his "words" are its own echo when 2 of 3 of them are in what it said lately (no words: echo too). */
export function isEcho(text: string, spokenLately: string): boolean {
  const w = talkWords(text)
  if (w.length === 0) return true
  const said = new Set(talkWords(spokenLately))
  const [num, den] = TALK.echoWordsOf
  return w.filter(x => said.has(x)).length * den >= w.length * num
}

/** What he heard of a sentence cut off after `ms` of it played: the words before the one playing (the classic's rule), from the voice's marks. */
export function playedPart(text: string, marks: readonly TalkMark[], ms: number): string {
  let cut = 0
  for (const m of marks) if (Number.isFinite(m.ms) && m.ms <= ms && Number.isFinite(m.start) && m.start > cut) cut = Math.min(m.start, text.length)
  return text.slice(0, cut).replace(/\s+/g, ' ').trim()
}

// --- the ears: the classic's voice detector, frame by frame --------------------------------------------------------------------

/** A mic frame's level in dBFS (the classic ioe): RMS of 16-bit samples against full scale, -100 for silence. The page uses it for `frame`. */
export function frameDb(pcm: ArrayLike<number>): number {
  let sum = 0
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i]
  const rms = Math.sqrt(sum / Math.max(1, pcm.length)) / TALK.fullScale
  return rms > 0 ? Math.max(TALK.silentDb, 20 * Math.log10(rms)) : TALK.silentDb
}

/** Voice over the floor (classic yf). */
export const voiceDb = (floor: number): number => Math.max(TALK.voiceMinDb, Math.min(floor + TALK.voiceOverFloorDb, Math.max(TALK.voiceCapDb, floor + TALK.voiceNearFloorDb)))
/** Quiet under it (classic $2). */
export const quietDb = (floor: number): number => Math.max(TALK.quietMinDb, Math.min(floor + TALK.quietOverFloorDb, voiceDb(floor) - TALK.quietUnderVoiceDb))
/** Voice while it plays: 6 dB over its echo (classic F2); no echo level yet = nothing counts as his voice. */
export const echoVoiceDb = (floor: number, echo: number | null): number => (echo === null ? Number.POSITIVE_INFINITY : Math.max(voiceDb(floor), echo + TALK.echoOverDb))
/** Quiet while it plays (classic doe). */
export const echoQuietDb = (floor: number, echo: number | null): number => (echo === null ? quietDb(floor) : Math.max(quietDb(floor), echo + TALK.echoQuietOverDb))

export interface NoiseFloor {
  readonly value: number
  readonly count: number
  push(db: number): void
}
/** The noise floor (classic ooe). */
export function noiseFloor(): NoiseFloor {
  const hist: number[] = []
  let at = 0
  let count = 0
  let value: number = TALK.floorStartDb
  return {
    get value() {
      return value
    },
    get count() {
      return count
    },
    push(db) {
      if (hist.length < TALK.floorFrames) hist.push(db)
      else {
        hist[at] = db
        at = (at + 1) % TALK.floorFrames
      }
      count += 1
      if (hist.length < TALK.floorMinFrames) return
      const s = [...hist].sort((a, b) => a - b)
      value = Math.min(TALK.floorMaxDb, s[Math.floor(s.length * TALK.floorPercentile)])
    },
  }
}

export interface EchoLevel {
  readonly value: number | null
  push(db: number, loud: boolean): void
}
/** Its own echo, as the mic hears it (classic aoe). */
export function echoLevel(): EchoLevel {
  const hist: number[] = []
  let at = 0
  let sinceSort = 0
  let count = 0
  let loud = 0
  let value: number | null = null
  return {
    get value() {
      return value
    },
    push(db, isLoud) {
      if (hist.length < TALK.echoFrames) hist.push(db)
      else {
        hist[at] = db
        at = (at + 1) % TALK.echoFrames
      }
      count += 1
      if (isLoud) loud += 1
      if (loud < TALK.echoLoudFrames && count < TALK.echoMinFrames) return
      sinceSort += 1
      if (value !== null && sinceSort < TALK.echoSortEvery) return
      sinceSort = 0
      const s = [...hist].sort((a, b) => a - b)
      value = s[Math.min(s.length - 1, Math.floor(s.length * TALK.echoPercentile))]
    },
  }
}

/** One frame as the segmenter sees it: its number, level, and whether it may be the echo (and of what level). */
export interface HeardFrame {
  n: number
  db: number
  echo: boolean
  echoDb: number | null
}
/** Frames from <= n < to. */
export interface FrameRange {
  from: number
  to: number
}
/** `voiced`: the voiced frames of what ends here (o0de2 round 2: a 25 s cut says it too, for "I didn't catch any words"). */
export type SegmentOut = { t: 'start' } | { t: 'end'; range: FrameRange | null; voiced: number } | { t: 'cut'; range: FrameRange | null; voiced: number }

export interface Segmenter {
  readonly open: boolean
  readonly voiced: number
  readonly quiet: number
  /** The number of the last voiced frame of the open turn, -1 when none. */
  readonly lastVoice: number
  /** He is heard: open with 5 voiced frames (the classic's `hearing`). */
  readonly hearing: boolean
  push(f: HeardFrame): SegmentOut | null
  /** The frames the early guess sends (the classic's endPcm): null when there is too little voice. */
  guessRange(): FrameRange | null
  reset(): void
}

/** His turns, out of the frames (the classic's poe, line for line): the onset, voice runs, the quiet that ends a turn, the 25 s cut. */
export function createSegmenter(floor: Pick<NoiseFloor, 'value' | 'count'>, endQuietFrames: number = TALK.endQuietFrames): Segmenter {
  let open = false
  let ring: HeardFrame[] = []
  let win: boolean[] = []
  let frames: HeardFrame[] = []
  let voiced = 0
  let run = 0
  let runPeak = Number.NEGATIVE_INFINITY
  let runVoice = false
  let quiet = 0
  let lastVoiced = -1
  let floorAtStart = 0
  let continued = false

  const onDb = (f: HeardFrame, fl: number) => (f.echo ? echoVoiceDb(fl, f.echoDb) : voiceDb(fl))
  const offDb = (f: HeardFrame, fl: number) => (f.echo ? echoQuietDb(fl, f.echoDb) : quietDb(fl))
  const range = (end: number): FrameRange => ({ from: frames[0].n, to: frames[end - 1].n + 1 })

  function resetCounts() {
    voiced = 0
    run = 0
    runPeak = Number.NEGATIVE_INFINITY
    runVoice = false
    quiet = 0
    lastVoiced = -1
  }
  function account(f: HeardFrame, fl: number, i: number) {
    if (f.db < offDb(f, fl)) {
      run = 0
      runPeak = Number.NEGATIVE_INFINITY
      runVoice = false
      quiet += 1
      return
    }
    run += 1
    runPeak = Math.max(runPeak, f.echo ? f.db - (onDb(f, fl) - voiceDb(fl)) : f.db)
    if (runVoice) voiced += 1
    else if (run >= TALK.runFrames && runPeak >= voiceDb(fl)) {
      runVoice = true
      voiced += run
    }
    if (!runVoice) {
      quiet += 1
      return
    }
    quiet = 0
    lastVoiced = i
  }
  function begin(fl: number) {
    open = true
    floorAtStart = fl
    frames = ring
    ring = []
    win = []
    resetCounts()
    continued = false
    frames.forEach((f, i) => account(f, fl, i))
  }
  function close(): SegmentOut {
    const end = Math.min(frames.length, lastVoiced + 1 + TALK.tailFrames)
    const need = continued ? TALK.hearingFrames : TALK.minSpeechFrames
    const out: SegmentOut = { t: 'end', range: voiced >= need && lastVoiced >= 0 && end > 0 ? range(end) : null, voiced }
    ring = frames.slice(-TALK.preRollFrames)
    frames = []
    win = []
    open = false
    resetCounts()
    return out
  }
  function cut(): SegmentOut {
    const out: SegmentOut = { t: 'cut', range: voiced >= TALK.minSpeechFrames ? range(frames.length) : null, voiced }
    frames = []
    voiced = 0
    lastVoiced = -1
    continued = true
    return out
  }
  return {
    get open() {
      return open
    },
    get voiced() {
      return open ? voiced : 0
    },
    get quiet() {
      return quiet
    },
    get lastVoice() {
      return open && lastVoiced >= 0 ? frames[lastVoiced].n : -1
    },
    get hearing() {
      return open && voiced >= TALK.hearingFrames
    },
    push(f) {
      const fl = open ? Math.min(floorAtStart, floor.value) : floor.value
      if (!open) {
        ring.push(f)
        if (ring.length > TALK.preRollFrames) ring.shift()
        const on = f.db >= onDb(f, fl)
        win.push(on)
        if (win.length > TALK.onsetWindow) win.shift()
        if (floor.count >= TALK.floorReadyFrames && on && win.filter(Boolean).length >= TALK.onsetFrames) {
          begin(fl)
          return { t: 'start' }
        }
        return null
      }
      frames.push(f)
      account(f, fl, frames.length - 1)
      if (quiet >= endQuietFrames) return close()
      if (frames.length >= TALK.maxSegmentFrames) return cut()
      return null
    },
    guessRange() {
      if (!open || lastVoiced < 0 || voiced < (continued ? TALK.hearingFrames : TALK.minSpeechFrames)) return null
      return range(Math.min(frames.length, lastVoiced + 1 + TALK.tailFrames))
    },
    reset() {
      open = false
      ring = []
      win = []
      frames = []
      resetCounts()
      continued = false
    },
  }
}

// --- the brain -----------------------------------------------------------------------------------------------------------------

interface Say {
  id: string
  text: string
  kind: SayKind
  /** The turn whose answer it is; null for the brain's own lines. */
  turn: string | null
  started: boolean
  ms: number
  marks: TalkMark[] | null
  /** Being cut at the end of its word. */
  cutting: boolean
  /**
   * Still to be told when a cut-in drops it before it started: a direct-mode order's answer (an order is never asked again) and the
   * brain's line about an order (the waiting line). It is said after his words instead.
   */
  keep: boolean
  /** For the page's turn record only (the say action's `turn`): its turn, or the question a filler or an error line stands in for. */
  of: string | null
  /**
   * o0de2 round 3: one of the brain's own lines about his words (NOT_CAUGHT, NO_WORDS, PART_LOST: sayOwn), with no turn behind it. His
   * voice over one is never taken as over an answer (see onOnset): the line is hushed and his voice is decided by the turn that is out.
   */
  own: boolean
  /**
   * odcd9 (from oeb56's review): a piece of its turn's lead-in, Quick's words before a tool call ("Checking the build."), marked at its first
   * tool frame (markLeadIn). While he has heard nothing of that turn but its lead-in and more of it is to come (leadInOnly), his voice over it
   * is taken as over a filler (onOnset): while it thinks, so his added words and his question are ONE ask.
   */
  leadIn: boolean
}

interface Turn {
  /** The ask's id, the direct-ask's id, or `o:<orderId>` (Quick telling an order's answer). */
  id: string
  kind: 'ask' | 'telling' | 'direct'
  /** What was asked ('' for a telling). */
  text: string
  /** What he heard of the answer before it (the ask's `heard`): o0de2, a question merged with his later words still carries it. */
  heard: string
  at: number
  /** Quick is still writing it; in direct mode, the order is out. */
  generating: boolean
  cancelled: boolean
  /**
   * o0de2: cancelled at his voice before a word of its answer was heard (thinking, on the PC or earbuds): his words decided after that ask it
   * again with theirs, also words of his that were with Whisper when it was cancelled.
   */
  byVoice: boolean
  /** Answer text not cut into sentences yet, and all of it so far. */
  buffer: string
  received: string
  /** Answer text came. */
  answered: boolean
  /** Its answer's sentences that were said in full. */
  said: string[]
  /** odcd9 (from oeb56's review): how many of `said` (the first ones) are its lead-in, said before its first tool call (see Say.leadIn). */
  leadSaid: number
  line: TalkLine | null
  toolSeen: boolean
  /** The latest tool label (direct mode: the order's words). */
  label: string
  labelDone: boolean
  ackDone: boolean
  progress: number
  fillers: number
  /** Something was said in this turn (a filler or the answer). */
  spoke: boolean
  orderId: string | null
}

/**
 * Why he is talking, decided when his voice starts:
 *   plain: nothing was out (or Tap only: his voice never cuts anything).
 *   think: a turn was out and its answer unheard. On the PC or earbuds (Auto) it was cancelled at once (`cancelled`; a direct order
 *          is never cancelled, only its filler stops); talking over it (`talkOver`), it goes on until his words say what they were.
 *          odcd9 (from oeb56's review): its lead-in before a tool ("Checking the build.") is not its answer until a say after it starts
 *          (leadInOnly).
 *   barge: over the answer, on the PC or earbuds (Auto): held; 500 ms of voice makes it `cut`, less lets the answer go on.
 *   cut: he cut the answer off; `heard` is what he heard of it.
 *   hold: over the answer, talking over it: held until his words say whether they were its own echo.
 */
type Policy = 'plain' | 'think' | 'barge' | 'cut' | 'hold'
interface Part {
  req: number
  from: number
  to: number
  text: string | null
  done: boolean
  failed: boolean
  /** It is the early guess, made the final. */
  guess: boolean
  /** o0de2 round 2: his voiced frames in it (the segmenter's count: the room kept around his voice is not counted). */
  voiced: number
  /** o0de2 round 3: Whisper's whole text for it, when the PC dropped it as a known invention (the stt event's `dropped`). */
  dropped: string | null
}
interface Utterance {
  policy: Policy
  turn: Turn | null
  cancelled: boolean
  talkOver: boolean
  heard: string
  parts: Part[]
  /** His voice is still going. */
  open: boolean
  /** o0de2: when his voice started, and when it last ended (the merge gap counts from there). */
  startedAt: number
  closedAt: number
  /** o0de2: his words as they come back from Whisper, in the transcript before they are decided (null until some came back). */
  line: TalkLine | null
}
/** A transcription out: when it was asked for, and its last sign of life (o0de2: the PC said Whisper was still at work). */
type Req = ({ kind: 'guess' } | { kind: 'part'; utt: Utterance; part: Part } | { kind: 'check'; part: Part }) & { at: number; alive: number }
interface Guess {
  req: number
  from: number
  to: number
  lastVoice: number
  text: string | null
  dropped: string | null
  back: boolean
}
interface Order {
  orderId: string
  phase: TalkOrderPhase
  words?: string
  waitingSaid: boolean
}
/**
 * His words over a turn he cut off were lost (Whisper failed), so it said it did not catch them. What his next words carry instead: the
 * question they were added to (`merge`: cancelled while it thought), or what he heard of the answer (cut off while it spoke). Without it
 * that turn would be gone, since the hub keeps a turn cut off only when the next ask says what he heard of it.
 */
interface Lost {
  turn: Turn
  heard: string
  merge: boolean
}

/** An order still out (its answer not back, not given up). */
const OUT: readonly TalkOrderPhase[] = ['queued', 'typed', 'working', 'waiting-you', 'slow']

export function createTalkBrain(given: Partial<TalkOptions> = {}): TalkBrain {
  const o = talkOptions(given)
  const quick = o.mode === 'quick'
  /** How his voice over it is taken: Auto is "barge" on the PC and earbuds, talk-over on the phone speaker. */
  const style: 'barge' | 'talk-over' | 'tap' = o.cutIn === 'tap' ? 'tap' : o.cutIn === 'talk-over' || o.device === 'phone-speaker' ? 'talk-over' : 'barge'
  /** On the phone speaker spoken fillers are an echo risk: tone only, unless only a tap can cut in. */
  const fillers: TalkFillers = o.fillers === 'words' && o.device === 'phone-speaker' && o.cutIn !== 'tap' ? 'tone' : o.fillers
  const endQuietFrames = Math.round(o.endQuietMs / TALK.frameMs)

  let now = 0
  let out: TalkAction[] = []
  const act = (a: TalkAction) => void out.push(a)

  let started = false
  let ended = false
  let endedWhy: string | undefined
  let muted = false
  let dirty = false
  let lastSig = ''

  // the ears
  let frameNo = 0
  const floor = noiseFloor()
  const echo = echoLevel()
  let echoTail = 0
  let doubts: number[] = []
  let wasPlaying = false
  const seg = createSegmenter(floor, endQuietFrames)

  // his words
  let reqNo = 0
  const reqs = new Map<number, Req>()
  let utt: Utterance | null = null
  /**
   * o0de2: his earlier turns still with Whisper when he spoke again after the merge gap, oldest first. Each is decided on its own, in the
   * order he said them, once its words are back and he is quiet (utt, his voice now or last, comes after them).
   */
  let sealed: Utterance[] = []
  let guess: Guess | null = null
  let lost: Lost | null = null
  /**
   * o0de2 round 4: when the last sentence of an answer he heard ended playing; null once a turn of his is decided after it (decide). A dropped
   * "Thank you." is his own only right after it (see rightAfterAnswer).
   */
  let answerEndAt: number | null = null

  // what it says
  let askNo = 0
  let sayNo = 0
  const turns: Turn[] = []
  let queue: Say[] = []
  let pending: Say[] = []
  let held = false
  let spoken = ''
  let ackAt = -1
  let info = ''

  // orders, cards, the transcript
  const orders = new Map<string, Order>()
  let lastOrder: string | null = null
  /** Orders whose answer came: Quick tells each one once, as the turn o:<order> right after it (a stray late frame never starts it again). */
  const tellable = new Set<string>()
  let cards: TalkCard[] = []
  const cardFrom = new Map<string, string>()
  const transcript: TalkLine[] = []
  let lastActive = 0

  // --- the transcript ---------------------------------------------------------------------------------------------------
  function addLine(who: TalkLine['who'], text: string): TalkLine {
    const l: TalkLine = { who, text: capText(text, TALK.lineMaxChars) }
    transcript.push(l)
    while (transcript.length > TALK.transcriptMax) transcript.shift()
    dirty = true
    return l
  }

  // --- turns ------------------------------------------------------------------------------------------------------------
  const turnOf = (id: string | null): Turn | undefined => (id === null ? undefined : turns.find(t => t.id === id))
  const hasSays = (t: Turn) => queue.some(s => s.turn === t.id) || pending.some(s => s.turn === t.id)
  function newTurn(id: string, kind: Turn['kind'], text: string, heard = ''): Turn {
    const t: Turn = { id, kind, text, heard, at: now, generating: true, cancelled: false, byVoice: false, buffer: '', received: '', answered: false, said: [], leadSaid: 0, line: null, toolSeen: false, label: '', labelDone: false, ackDone: false, progress: 0, fillers: 0, spoke: false, orderId: null }
    turns.push(t)
    while (turns.length > TALK.turnsMax) {
      const i = turns.findIndex(x => !x.generating && !hasSays(x))
      turns.splice(i >= 0 ? i : 0, 1)
    }
    return t
  }
  /** Cuts a turn off: Quick is told (its answer is no longer wanted). A direct order is never cut by voice: it stays out and is answered. */
  function stopTurn(t: Turn | null) {
    if (!t || t.kind === 'direct' || t.cancelled) return
    if (t.generating) act({ t: 'cancel', id: t.id })
    // Review of T3b: all of its answer was written (Quick has nothing to stop), but he cut it off: the page's turn record still hears of it.
    else act({ t: 'cut', id: t.id })
    t.generating = false
    t.cancelled = true
    pending = pending.filter(s => s.turn !== t.id)
  }
  /** The turn out whose answer he has not heard yet: still being written (or in direct mode, the order still out), or written and not yet playing. */
  function outTurn(): Turn | null {
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i]
      if (t.cancelled) continue
      if (t.generating) return t
      if (queue.some(s => s.turn === t.id && s.kind === 'answer') || pending.some(s => s.turn === t.id && s.kind === 'answer')) return t
    }
    return null
  }
  /**
   * odcd9 (from oeb56's review): he has heard nothing of this turn but its lead-in (its words before its first tool call, see Say.leadIn), and
   * more of it is to come: his voice now is taken as while it thinks (onOnset), the lead-in as a filler. oeb56's review 2: while none of its
   * says after the lead-in has started, whether Quick still writes it (its tool runs) or it is all written and that answer waits at the page
   * or to go (a 'done' before it played made his added words a barge again: under 500 ms dropped, 500 ms or more asked alone). Not a turn all
   * written with nothing after its lead-in: that line was all of its answer (a hand-off it made is not asked again). Once a say after the
   * lead-in started, it is an answer as before. (A turn with no lead-in counts nothing in `said` as one.)
   */
  function leadInOnly(t: Turn): boolean {
    if (t.cancelled || t.said.length !== t.leadSaid) return false
    const after = [...queue, ...pending].filter(s => s.turn === t.id && s.kind === 'answer' && !s.leadIn)
    return !after.some(s => s.started) && (t.generating || after.length > 0)
  }
  /** odcd9 (from oeb56's review): a say of its turn's lead-in while he has heard nothing of that turn but it (leadInOnly): his voice over it is as over a filler. */
  function leadInSay(s: Say): boolean {
    const t = s.leadIn ? turnOf(s.turn) : undefined
    return t !== undefined && leadInOnly(t)
  }
  /**
   * odcd9 (from oeb56's review): at its first tool frame, what Quick said of the turn before it is its lead-in ("Checking the build."): its
   * sentences said in full, and its says at the page or still to go. oeb56's review 2: only at the first (tools called together come as
   * frames back to back, with no words between them). What it writes after a tool is its answer, also when another tool follows: marked at
   * the next tool, a cough or an "okay" over it while that tool ran asked the whole question again (review of T3a: his voice between two
   * sentences of an answer is over the answer, not while it thinks).
   */
  function markLeadIn(t: Turn) {
    if (t.toolSeen) return
    t.leadSaid = t.said.length
    for (const s of [...queue, ...pending]) if (s.turn === t.id && s.kind === 'answer') s.leadIn = true
  }
  /** Sends what he said: to Quick, or (direct mode) to the Assistant chat. A new ask ends every Quick turn still being written (the hub does the same). */
  function ask(text: string, heard?: string) {
    const clean = capText(text, Math.min(TALK.maxAskChars, MAX_TEXT))
    if (!clean) return
    const id = `${o.idPrefix}-a${++askNo}`
    lost = null
    if (quick) for (const t of turns) if (t.generating && t.kind !== 'direct') stopTurnQuietly(t)
    // Whatever was held for his words is moot once he asks something new.
    if (held) dropAudio(false)
    const h = heard ? tailText(heard, TALK.heardMaxChars) : ''
    newTurn(id, quick ? 'ask' : 'direct', clean, h)
    // The classic's echo window starts again with each question.
    spoken = ''
    info = ''
    if (quick) act({ t: 'ask', id, text: clean, ...(h ? { heard: h } : {}) })
    else act({ t: 'direct-ask', id, text: clean })
    dirty = true
  }
  /** The hub ends a turn by itself when a new ask comes: no cancel is sent for it. */
  function stopTurnQuietly(t: Turn) {
    t.generating = false
    t.cancelled = true
    pending = pending.filter(s => s.turn !== t.id)
  }

  // --- the voice --------------------------------------------------------------------------------------------------------
  const sounding = () => !held && queue.some(s => s.started)
  /** He has the floor (talking, or his words not yet decided) or the sound is held: nothing new starts playing. */
  const blocked = () => held || utt !== null || sealed.length > 0
  /**
   * One sentence to say (in pieces the PC voice takes, when it is long). A direct order's answer is kept through a cut-in (see Say.keep).
   * `of`: the turn the page's record counts it for (its own turn, or the question a filler or an error line stands in for).
   */
  function say(text: string, kind: SayKind, turn: Turn | null, keep = turn?.kind === 'direct', of: string | null = turn?.id ?? null) {
    for (const piece of sayPieces(text)) {
      const s: Say = { id: `${o.idPrefix}-s${++sayNo}`, text: piece, kind, turn: turn?.id ?? null, started: false, ms: 0, marks: null, cutting: false, keep, of, own: false, leadIn: false }
      if (blocked()) pending.push(s)
      else emitSay(s)
    }
  }
  function emitSay(s: Say) {
    // The first words of an answer cut a filler at its next word, so the two never overlap.
    if (s.kind === 'answer' && queue.length > 0 && queue.every(q => q.kind !== 'answer')) {
      act({ t: 'hush', at: 'word', hold: false })
      queue = queue.filter(q => q.started)
      for (const q of queue) q.cutting = true
    }
    queue.push(s)
    act({ t: 'say', id: s.id, text: s.text, kind: s.kind, ...(s.of ? { turn: s.of } : {}) })
    dirty = true
  }
  function flushPending() {
    if (pending.length === 0 || blocked()) return
    const list = pending
    pending = []
    for (const s of list) emitSay(s)
  }
  function hold() {
    if (held || queue.length === 0) return
    held = true
    act({ t: 'hush', at: 'now', hold: true })
  }
  function resume() {
    if (!held) return
    held = false
    act({ t: 'resume' })
  }
  /**
   * Stops and drops what the page has. `all`: what waits to be said goes too (a stop word, Stop). Without it, a cut-in drops what he cut
   * off (the answer of `cut`, Quick's answers, the fillers) but keeps what is still to be told and he has not heard a word of: a direct
   * order's answer and the brain's line about an order (review of T3a: both were lost when his voice came before they started playing).
   * Those the page had are given again, with new ids, after his words: `hush now` without hold made it drop them.
   */
  function dropAudio(all: boolean, cut: Turn | null = null) {
    if (queue.length > 0 || held) act({ t: 'hush', at: 'now', hold: false })
    const keep = (s: Say) => !all && s.keep && !s.started && !(cut !== null && s.turn === cut.id)
    pending = [...queue.filter(keep).map(s => ({ ...s, id: `${o.idPrefix}-s${++sayNo}` })), ...pending.filter(keep)]
    queue = []
    held = false
  }
  function logSay(s: Say) {
    const t = s.kind === 'answer' ? turnOf(s.turn) : undefined
    if (!t || t.kind === 'direct') return
    if (t.line) t.line.text = capText(`${t.line.text} ${s.text}`, TALK.lineMaxChars)
    else t.line = addLine('quick', s.text)
    dirty = true
  }
  function onPlayed(id: string, ms: number, marks: readonly TalkMark[] | undefined) {
    const i = queue.findIndex(q => q.id === id)
    if (i < 0) return
    // It plays them in order: one that started means the ones before it ended (a filler cut at its word among them).
    if (i > 0) onPlayEnd(queue[i - 1].id)
    const s = queue[0]
    if (!s.started) {
      s.started = true
      spoken = `${spoken} ${s.text}`.slice(-TALK.spokenWindowChars)
      logSay(s)
      dirty = true
    }
    if (Number.isFinite(ms) && ms > s.ms) s.ms = ms
    if (Array.isArray(marks)) s.marks = marks.filter(m => isObject(m) && Number.isFinite(m.ms) && Number.isFinite(m.start)).map(m => ({ ms: m.ms, start: m.start, end: m.end }))
  }
  function onPlayEnd(id: string) {
    const i = queue.findIndex(q => q.id === id)
    if (i < 0) return
    // It plays them in order: one that ended means the ones before it have too. One that never started (it failed to render) was not
    // said: it is not in what he heard nor in the transcript (each started one went into the transcript as it started).
    for (const s of queue.splice(0, i + 1)) {
      const t = s.started && s.kind === 'answer' && !s.cutting ? turnOf(s.turn) : undefined
      if (t) {
        t.said.push(s.text)
        // odcd9 (from oeb56's review): a lead-in said in full is still its lead-in (it comes before any of the answer after the tool).
        if (s.leadIn) t.leadSaid += 1
        answerEndAt = now
      }
    }
    dirty = true
  }
  /** What he heard of a turn's answer: the sentences said in full, and the words of the one playing before it was held. */
  function heardOf(t: Turn | null): string {
    if (!t) return ''
    const s = queue.find(q => q.started && q.turn === t.id && q.kind === 'answer')
    const part = s?.marks ? playedPart(s.text, s.marks, s.ms) : ''
    return tailText([...t.said, part].filter(Boolean).join(' '), TALK.heardMaxChars)
  }
  /** The transcript shows what he heard of an answer he cut off. */
  function markCut(t: Turn | null, heard: string) {
    if (!t?.line || t.kind === 'direct') return
    t.line.text = heard
    t.line.cut = true
    dirty = true
  }

  // --- his words --------------------------------------------------------------------------------------------------------
  function dropGuess() {
    if (!guess) return
    if (reqs.delete(guess.req)) act({ t: 'stt-abort', req: guess.req })
    guess = null
  }
  /** The early guess (the classic's sendAhead): at 300 ms of quiet; dropped the moment his voice comes back. */
  function watchGuess() {
    if (!o.guess || !seg.open) return
    if (guess && seg.lastVoice !== guess.lastVoice) dropGuess()
    if (guess || seg.quiet !== TALK.tailFrames) return
    const r = seg.guessRange()
    if (!r) return
    const req = ++reqNo
    guess = { req, from: r.from, to: r.to, lastVoice: seg.lastVoice, text: null, dropped: null, back: false }
    reqs.set(req, { kind: 'guess', at: now, alive: now })
    act({ t: 'stt', req, fromFrame: r.from, toFrame: r.to, guess: true })
  }
  /** The words of a piece of his turn: the guess when it covers exactly these frames (no second transcription), else a new one. */
  function partOf(r: FrameRange, u: Utterance | null, voiced: number): Part {
    const g = guess
    guess = null
    if (g && g.from === r.from && g.to === r.to) {
      const p: Part = { req: g.req, from: r.from, to: r.to, text: g.text, done: g.back, failed: false, guess: true, voiced, dropped: g.dropped }
      const was = reqs.get(g.req)
      const at = was?.at ?? now
      const alive = was?.alive ?? now
      if (!g.back) reqs.set(g.req, u ? { kind: 'part', utt: u, part: p, at, alive } : { kind: 'check', part: p, at, alive })
      return p
    }
    if (g && reqs.delete(g.req)) act({ t: 'stt-abort', req: g.req })
    const p: Part = { req: ++reqNo, from: r.from, to: r.to, text: null, done: false, failed: false, guess: false, voiced, dropped: null }
    reqs.set(p.req, u ? { kind: 'part', utt: u, part: p, at: now, alive: now } : { kind: 'check', part: p, at: now, alive: now })
    act({ t: 'stt', req: p.req, fromFrame: r.from, toFrame: r.to, guess: false, ...(u ? {} : { check: true as const }) })
    return p
  }
  /** His voice starts: what it means depends on what is out and what plays. */
  function onOnset() {
    lastActive = now
    // o0de2: the note that his last turn had no words is about that turn; his voice now is the next.
    if (info === NO_WORDS) {
      info = ''
      dirty = true
    }
    if (utt) {
      // He goes on before his words were asked, within the merge gap: one ask (the merge).
      if (utt.open || now - utt.closedAt <= TALK.mergeGapMs) {
        utt.open = true
        if (sounding()) hold()
        return
      }
      // o0de2: later than that, what he said is a turn of its own: decided once its words are back and he is quiet, while what he says now
      // is taken by the rules below. (With Whisper slower than his pauses, the merge lasted as long as he kept talking: nothing was ever
      // shown or asked.)
      sealed.push(utt)
      utt = null
    }
    const fresh = (policy: Policy, turn: Turn | null, cancelled = false, talkOver = false): Utterance => ({ policy, turn, cancelled, talkOver, heard: '', parts: [], open: true, startedAt: now, closedAt: now, line: null })
    // Tap only: he is heard only while nothing is out or playing (see deaf()), and his voice never cuts anything off.
    if (style === 'tap') {
      utt = fresh('plain', null)
      return
    }
    const over: Policy = style === 'barge' ? 'barge' : 'hold'
    // Speaking: an answer has started playing (its words are being heard). o0de2 round 3: never one of its own lines about his words
    // (NOT_CAUGHT, NO_WORDS, PART_LOST): no turn is behind one, so his voice over it is taken as over a filler, by the turn that is out (below).
    // Taken as over an answer, 500 ms of his voice over "I missed part of that." (said as the rest of his words is asked) asked his new words
    // alone, which ended the question just asked: it was never answered (rig x-partlost-over; x-notcaught-over the same with "Sorry, I didn't
    // catch that." said while a question of his was out).
    // odcd9 (from oeb56's review): nor Quick's lead-in before a tool ("Checking the build.") while nothing of the answer after it has started
    // (leadInOnly; oeb56's review 2: also once all of it is written and that answer waits to play): his voice over it is as over a filler
    // (while it thinks, below), so his added words and his question are ONE ask. Taken as over an answer, under 500 ms of it his words were
    // only looked at for a stop word and dropped, and 500 ms or more asked them alone.
    const playing = held ? undefined : queue.find(s => s.started)
    if (playing?.kind === 'answer' && !playing.own && !leadInSay(playing)) {
      hold()
      utt = fresh(over, turnOf(playing.turn) ?? null)
      return
    }
    const t = outTurn()
    // Between two sentences of an answer he has begun to hear (the next is at the page being made ready by the voice, or still being
    // written): as over the answer, not as while it thinks (review of T3a: a cough there asked the whole question again). A short sound
    // lets it go on; only 500 ms of his voice (or his own words, talking over it) cut it off, and the next ask says what he heard. The
    // answer at the page goes first: a newer turn may be out meanwhile (another order, or the telling the hub starts after an answer).
    // odcd9 (from oeb56's review): a lead-in heard in full is not that answer while none of the answer after it has started (leadInOnly): he
    // has heard none of it yet.
    const next = turnOf(queue.find(s => s.kind === 'answer')?.turn ?? null)
    const heard = [next, t].find(x => x && !x.cancelled && x.said.length > 0 && !leadInOnly(x))
    if (heard) {
      hold()
      utt = fresh(over, heard)
      return
    }
    // Thinking: a turn is out and he has heard none of its answer (a filler, one of its own lines or, odcd9, its lead-in may play): on the PC
    // or earbuds it is cancelled and his words are asked with it (ONE question); talking over it, it is held until his words say what they were.
    if (t) {
      if (style === 'barge') {
        // On the PC or earbuds: cut off at his voice (a filler with it); his words decide what is asked next.
        dropAudio(false)
        stopTurn(t)
        if (t.kind === 'ask') t.byVoice = true
        utt = fresh('think', t, t.kind !== 'direct')
      } else {
        // On the phone speaker or talking over it: held, not cancelled; a filler's own echo must not cancel it.
        hold()
        utt = fresh('think', t, false, true)
      }
      return
    }
    // o0de2 round 3: one of its own lines about his words at the page ("Try again.", "Say it again."), playing or about to, and nothing of his
    // out: on the PC or earbuds his voice is his retry, a turn of its own however short (the 500 ms rule is for answers): the line is hushed
    // and his words decide (rig x-hello-over-nowords: a 0.4 s "Hello?" over it was only looked at for a stop word, and nothing happened).
    // Talking over it, it is held until his words say whether they were its own echo, as below. (A filler being cut at its word goes first.)
    // Round 4: held, not dropped: his words asked drop it (ask), a try that comes to nothing lets it go on (settle), and a try with no words
    // or lost finds it as the same line (sayOwn). Dropped, a cough over "I didn't catch any words. Try again." left no line and no caption.
    if (style === 'barge' && queue.find(s => !s.cutting)?.own) {
      hold()
      utt = fresh('plain', null)
      return
    }
    // One of its own lines is at the page (the waiting line, an error line), playing or about to: held like an answer.
    if (queue.length > 0) {
      hold()
      utt = fresh(over, null)
      return
    }
    utt = fresh('plain', null)
  }
  /** 500 ms of his voice over the answer (Auto on the PC or earbuds): it is cut off, and he is asked about what he heard. */
  function watchCutIn() {
    if (utt?.policy !== 'barge' || seg.voiced < TALK.cutInFrames) return
    utt.policy = 'cut'
    utt.heard = heardOf(utt.turn)
    markCut(utt.turn, utt.heard)
    dropAudio(false, utt.turn)
    stopTurn(utt.turn)
  }
  function onSegmentEnd(range: FrameRange | null, voiced: number) {
    const u = utt
    if (!u) {
      dropGuess()
      return
    }
    if (u.policy === 'barge') {
      // Less than 500 ms over the answer: it goes on. A stop word in it still stops it, when its words come back.
      utt = null
      resume()
      if (range) {
        const p = partOf(range, null, voiced)
        if (p.done) onCheck(p.text ?? '')
      } else dropGuess()
      // o0de2: he is quiet: his earlier turns whose words are back are decided now.
      return settle()
    }
    if (range) {
      if (fillers !== 'off') {
        act({ t: 'tone' })
        echoTail = TALK.echoTailFrames
      }
      u.parts.push(partOf(range, u, voiced))
    } else dropGuess()
    u.open = false
    u.closedAt = now
    settle()
  }
  function onSegmentCut(range: FrameRange | null, voiced: number) {
    dropGuess()
    if (utt && range) utt.parts.push(partOf(range, utt, voiced))
  }
  const textOf = (parts: readonly Part[]) =>
    parts
      .map(p => p.text ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  /**
   * His turns are decided in the order he said them, each once all of its words are back and he is quiet. o0de2: a turn sealed by his
   * going on after the merge gap waits only for its own words (and for him to be quiet: nothing is ever asked while he talks), not for the
   * ones he says after it.
   */
  function settle() {
    // o0de2 round 2: his words from before it was ready (Quick, the mic, the PC voice) are kept, and decided once it is ('ready' settles).
    if (!started) return
    for (;;) {
      const u = sealed[0] ?? utt
      if (!u || u.open || utt?.open || u.parts.some(p => !p.done)) break
      if (u === sealed[0]) sealed.shift()
      else utt = null
      // o0de2: a piece lost (Whisper failed, or it was given up) is never silent (see decide). It used to count only when EVERY piece was
      // lost, so one lost next to an empty one was silence, and one lost next to words went unnoticed.
      decide(u, textOf(u.parts), u.parts.some(p => p.failed))
    }
    // Nothing was asked and nothing cut: what was held for his words goes on (once none of his words is left to decide).
    if (held && utt === null && sealed.length === 0) resume()
  }
  /** o0de2: his words in the transcript as soon as Whisper gives them back, before they are decided (it was a bare "Hearing you" till then). */
  function showWords(u: Utterance) {
    // Talking over its own sound, his "words" may be its echo: they show once decided.
    if (u.policy === 'hold' || u.talkOver) return
    const text = textOf(u.parts.filter(p => p.done))
    if (text) youLine(u, text)
  }
  /** His words in the transcript: the line that showed them as they came back, made final, or a new one. */
  function youLine(u: Utterance | null, text: string) {
    if (!u?.line) {
      const l = addLine('you', text)
      if (u) u.line = l
      return
    }
    u.line.text = capText(text, TALK.lineMaxChars)
    dirty = true
  }
  /**
   * o0de2: the latest question asked after he began these words (from his earlier words, decided while these were with Whisper), none of
   * whose answer he heard: still out, or cut off at his voice since (its text goes with his next words). Quick only (voice never cancels a
   * direct order). Each such question holds the ones before it, so his words are never lost from it.
   */
  function askedSince(u: Utterance): Turn | null {
    if (!quick) return null
    for (let i = turns.length - 1; i >= 0 && turns[i].at >= u.startedAt; i--) {
      const t = turns[i]
      if (t.kind !== 'ask') continue
      if (t.said.length > 0 || queue.some(s => s.turn === t.id && s.started)) return null
      if (t.cancelled) return t.byVoice ? t : null
      const out = t.generating || queue.some(s => s.turn === t.id && s.kind === 'answer') || pending.some(s => s.turn === t.id && s.kind === 'answer')
      return out ? t : null
    }
    return null
  }
  function onCheck(text: string) {
    if (gateOf(text) === 'stop') stopWords(text)
  }
  /** A stop word: hush, cancel what runs, drop the cards; nothing is asked. Direct-mode orders stay out (voice cannot stop an order). */
  function stopWords(text: string, u: Utterance | null = null) {
    if (text) youLine(u, text)
    stopAll()
    act({ t: 'drop-cards' })
  }
  /** Quiet now, and nothing of what was out is said after it: its turns are cancelled, and so are the tellings not begun yet. */
  function stopAll() {
    dropAudio(true)
    lost = null
    for (const t of turns) {
      if (t.kind === 'direct') {
        if (t.generating) t.fillers = TALK.maxFillers
      } else if (t.generating) stopTurn(t)
    }
    // An order's answer that Quick has yet to tell (its turn o:<order> has not begun here) is not told after his stop either (review of
    // T3a: it was told right after it): the screen has the answer, and the hub drops the telling it has queued or cuts it off.
    for (const orderId of tellable) act({ t: 'cancel', id: `o:${orderId}` })
    tellable.clear()
    info = ''
  }
  /** Talking over it, his words were its own echo (or nothing, or a backchannel): it goes on. True when that was so. */
  function wasNothing(gate: TalkGate | 'failed', text: string): boolean {
    if (gate === 'words' && !isEcho(text, spoken)) return false
    // Words came back and were its own (text with no words counts as its own, as in the classic's yoursIn): the loud frames kept while it
    // played were its echo, and are learnt (the classic's O2). Nothing came back (a mute, a sound too short to be words, Whisper's silence
    // or failure), or his own "hmm": those frames may have been him, so they are forgotten, never learnt (review of T3a: learning them
    // made his next cut-in count as its echo).
    if (text !== '' && isEcho(text, spoken)) learnDoubts()
    else doubts = []
    // o0de2: more of his words still to be decided (he went on after these): the sound stays held for them (settle lets it go after).
    if (utt === null && sealed.length === 0) resume()
    return true
  }
  /** One ask of what he said first and what he adds (a turn of Quick's own question only). */
  const merged = (t: Turn | null, text: string) => (quick && t?.kind === 'ask' ? `${t.text} ${text}` : text)
  /** Whisper could not give his words: it says so and listens. `carry`: what his next words take along instead (see Lost). */
  function notCaught(carry: Lost | null) {
    lost = carry
    info = sayOwn(NOT_CAUGHT)
    dirty = true
  }
  /**
   * o0de2 round 2: the brain's own lines about his words (NOT_CAUGHT, NO_WORDS, PART_LOST). Said when the turn they are about is decided (he
   * is quiet then), not held back behind his later words still with Whisper (r-fail-all: it waited 35 s, then said it twice); only a sound
   * held for his voice keeps one waiting. Never twice in a row: not again while the same line (NOT_CAUGHT and NO_WORDS are one: "say it
   * again") is still waiting or playing. Returns the line he will hear (the caption shows that one).
   */
  function sayOwn(text: string): string {
    const again = (t: string) => t === NOT_CAUGHT || t === NO_WORDS
    const same = (s: Say) => s.turn === null && s.of === null && (s.text === text || (again(s.text) && again(text)))
    const waiting = queue.find(same) ?? pending.find(same)
    if (waiting) return waiting.text
    const s: Say = { id: `${o.idPrefix}-s${++sayNo}`, text, kind: 'answer', turn: null, started: false, ms: 0, marks: null, cutting: false, keep: false, of: null, own: true, leadIn: false }
    if (held) pending.push(s)
    else emitSay(s)
    return text
  }
  /** His words asked, with what his lost words carried (the question they were added to, or what he heard of the answer he cut off). */
  function askWords(text: string, heard: string | undefined, carry: Lost | null) {
    if (!carry) return ask(text, heard)
    return ask(carry.merge ? merged(carry.turn, text) : text, heard || carry.heard || undefined)
  }
  /**
   * His words, decided: what they ask, cut or stop. `lostPiece` (o0de2): Whisper lost a piece of them (it failed, or it was given up). With
   * nothing else from him that is "didn't catch that"; with words, they are asked and he is told part of it was missed. Never silent.
   */
  function decide(u: Utterance, text: string, lostPiece: boolean) {
    const asks = askNo
    decideWords(u, text, lostPiece)
    if (lostPiece && askNo > asks && !ended) sayOwn(PART_LOST)
    // o0de2 round 4: a turn of his came after the answer he heard: what he says next is no longer right after it.
    answerEndAt = null
  }
  /** His voice in a turn, ms (his voiced frames, never the room sent around them). */
  const voiceMs = (u: Utterance) => u.parts.reduce((n, p) => n + p.voiced, 0) * TALK.frameMs
  /**
   * o0de2 round 4: his voice started right after an answer he heard: within TALK.thanksAfterAnswerMs of its last sentence's end, and no turn
   * of his decided since (none of its own lines about his words said, then).
   */
  function rightAfterAnswer(u: Utterance): boolean {
    return answerEndAt !== null && u.startedAt - answerEndAt <= TALK.thanksAfterAnswerMs
  }
  /**
   * What his words are. o0de2 round 3: no words, and the PC dropped what Whisper wrote for a piece of them as one of its known inventions
   * (agent/speech/words.ts): a dropped "Thank you." (or "Thanks.") right after an answer he heard, on a thank you's length of voice, is what
   * the BACKCHANNELS list says: nothing to act on, nothing to say back (rig x-thankyou: his "Thank you." after an answer got "I didn't catch
   * any words. Try again."). Otherwise it is no words, as any other invention ("you", "[BLANK_AUDIO]"): see TALK.thanksMaxVoiceMs and
   * (round 4: right after is within seconds of the answer's end, with no try of his between) TALK.thanksAfterAnswerMs.
   */
  function gateOfTurn(u: Utterance, text: string, lostPiece: boolean): TalkGate | 'failed' {
    if (lostPiece && !text) return 'failed'
    const gate = gateOf(text)
    if (gate !== 'empty' || !u.parts.some(p => p.dropped !== null && gateOf(p.dropped) === 'backchannel')) return gate
    return rightAfterAnswer(u) && voiceMs(u) <= TALK.thanksMaxVoiceMs ? 'backchannel' : 'empty'
  }
  function decideWords(u: Utterance, text: string, lostPiece: boolean) {
    const gate = gateOfTurn(u, text, lostPiece)
    const t = u.turn
    // Words lost after a cut-off go with these, when nothing newer is going on (a turn out, an answer playing); else they are moot.
    const carry = t === null ? lost : null
    lost = null
    if (gate === 'stop') return stopWords(text, u)
    const words = gate === 'words'
    // o0de2: his earlier words were asked after he began these, and nothing of their answer was heard yet: ONE question with both (as when
    // he goes on while it thinks), carrying what he heard before it. A backchannel or nothing: that question goes on (asked again when his
    // voice cut it off meanwhile); his words lost: it says so, and (cut off) his next words go with it.
    const since = askedSince(u)
    if (since) {
      if (gate === 'failed') return notCaught(since.cancelled ? { turn: since, heard: since.heard, merge: true } : null)
      if (!words) return since.cancelled ? ask(since.text, since.heard || undefined) : undefined
      youLine(u, text)
      dropAudio(false, since)
      stopTurn(since)
      return ask(merged(since, text), since.heard || undefined)
    }
    switch (u.policy) {
      case 'plain':
        if (words) {
          youLine(u, text)
          return askWords(text, undefined, carry)
        }
        if (gate === 'failed') return notCaught(carry)
        // o0de2 round 3: nothing to ask (no words, a cough, a backchannel): what his lost words carried waits for his next words. (On the PC
        // his voice over "Sorry, I didn't catch that." is a turn of his now, so a cough over it would have taken the question along with it.)
        lost = carry
        if (gate === 'empty') noWords(u)
        return
      case 'hold': {
        if (wasNothing(gate, text)) return
        // His own words over the answer: it is cut off where he was, and his words are the next ask.
        const heard = heardOf(t)
        dropAudio(false, t)
        markCut(t, heard)
        stopTurn(t)
        youLine(u, text)
        return askWords(text, quick ? heard : undefined, carry)
      }
      case 'think':
        if (u.talkOver) {
          if (wasNothing(gate, text)) return
          dropAudio(false)
          stopTurn(t)
        } else if (gate === 'failed') {
          // Cancelled at his voice, and his words lost: it says so, and his next words go with the question as these would have (review
          // of T3a: the question was asked again and he was never told). A direct order was not cancelled: it goes on.
          return notCaught(u.cancelled && t ? { turn: t, heard: '', merge: true } : null)
        } else if (!words) {
          // Cancelled at his voice for a backchannel or nothing: the same question again.
          return u.cancelled && t?.kind === 'ask' ? ask(t.text) : undefined
        }
        // Anything else: ONE ask, what he asked first and what he adds.
        youLine(u, text)
        return ask(u.cancelled || u.talkOver ? merged(t, text) : text)
      case 'cut':
      case 'barge':
        // He cut the answer off and his words were lost: it says so and listens, and his next words say what he heard (review of T3a:
        // the answer went on as for an "okay", and he was never told).
        if (gate === 'failed') return notCaught(quick && t ? { turn: t, heard: u.heard, merge: false } : carry)
        // A backchannel or nothing: it goes on from what he heard (Quick's own question only). o0de2 round 2: over a line with no turn behind
        // it no words at all are noted as in a plain turn (rig s2-empty: his "Can you hear me?" over "I didn't catch any words" came back
        // empty, and nothing happened; round 3: on the PC his voice over one of its own lines is a plain turn, so this is the waiting line's
        // or an error line's case now).
        if (!words) {
          if (quick && t?.kind === 'ask') return ask(t.text, u.heard)
          // o0de2 round 4: over a line with no turn behind it, nothing asked: what his lost words carried waits for his next words, as in a
          // plain turn (an "okay" over the waiting line dropped the question he had cut off, and his next words were asked alone).
          if (t === null) lost = carry
          if (t === null && gate === 'empty') noWords(u)
          return
        }
        youLine(u, text)
        return askWords(text, quick ? u.heard : undefined, carry)
      default:
    }
  }
  /**
   * o0de2: a real turn of his that Whisper gave no words for is noted. Round 2: by his voice (TALK.noWordsVoiceMs of it, never the room sent
   * around it), said and shown: a short "Hello?" that came back empty was silence (a cough is shorter).
   */
  function noWords(u: Utterance) {
    if (voiceMs(u) < TALK.noWordsVoiceMs) return
    info = sayOwn(NO_WORDS)
    dirty = true
  }
  /** His "words" were its own echo after all: the loud frames kept while it played were the echo too (the classic's learnDoubts). */
  function learnDoubts() {
    const v = voiceDb(floor.value)
    for (const d of doubts) {
      const over = echo.value !== null && d >= echoVoiceDb(floor.value, echo.value)
      echo.push(d, d >= v)
      if (over) echo.push(d, true)
    }
    doubts = []
  }
  function onStt(req: number, text: string, dropped: string | null) {
    const r = reqs.get(req)
    if (!r) return
    reqs.delete(req)
    if (r.kind === 'guess') {
      if (guess?.req === req) {
        guess.text = text
        guess.dropped = dropped
        guess.back = true
      }
      return
    }
    r.part.text = text
    r.part.dropped = dropped
    r.part.done = true
    if (r.kind === 'check') onCheck(text)
    else {
      showWords(r.utt)
      settle()
    }
  }
  function onSttFail(req: number) {
    const r = reqs.get(req)
    if (!r) return
    reqs.delete(req)
    if (r.kind === 'guess') {
      if (guess?.req === req) guess = null
      return
    }
    if (r.part.guess) {
      // The guess became the final and then failed (Whisper was busy): the same frames are transcribed in full, once.
      r.part.guess = false
      r.part.req = ++reqNo
      reqs.set(r.part.req, { ...r, at: now, alive: now })
      act({ t: 'stt', req: r.part.req, fromFrame: r.part.from, toFrame: r.part.to, guess: false, ...(r.kind === 'check' ? { check: true as const } : {}) })
      return
    }
    r.part.done = true
    r.part.failed = true
    if (r.kind === 'part') settle()
  }
  /** o0de2: the PC says Whisper is still at work on what was sent: nothing out is given up while it is. */
  function onSttBusy() {
    for (const r of reqs.values()) r.alive = now
  }
  /**
   * A transcription that never came back (a lost request) fails after 20 s with no sign of life (o0de2: the PC saying Whisper is still at
   * work on it is one: a cold load and a long piece take longer than 20 s), and after 2 minutes in any case, so his turn never waits for ever.
   */
  function expireReqs() {
    for (const [req, r] of reqs) {
      if (now - r.alive < TALK.sttTimeoutMs && now - r.at < TALK.sttMaxMs) continue
      act({ t: 'stt-abort', req })
      onSttFail(req)
    }
  }

  // --- the frames: the classic's mic pipeline (coe.onPcm) ---------------------------------------------------------------------
  /**
   * Tap only: while it answers, his voice is not taken at all (the classic's mic was off then). Quick telling an order's answer is
   * answering too (review of T3a: his words there became an ask, which cut the telling off). A direct order out is not: an order runs
   * for minutes and his next words never cut it off.
   */
  const deaf = () => style === 'tap' && (queue.length > 0 || turns.some(t => t.generating && t.kind !== 'direct'))
  function onFrame(db: number) {
    const n = frameNo++
    if (muted) return
    const level = Number.isFinite(db) ? Math.max(TALK.silentDb, db) : TALK.silentDb
    // o0de2 round 2: his voice is taken from the tap (the mic's first frame), not from ready: the same ears run while it gets ready, and what
    // he says then is decided once it is ready (settle), so nothing he says after the tap is lost. (Round 1 only learnt the room then: his
    // voice before ready went into the noise floor, and nothing he said registered until he paused.)
    const playing = sounding()
    // A new stretch of sound: what was kept from the last one is stale.
    if (playing && !wasPlaying) doubts = []
    wasPlaying = playing
    if (playing) echoTail = TALK.echoTailFrames
    else if (echoTail > 0) echoTail -= 1
    const isEcho = playing || echoTail > 0
    if (playing) {
      const limit = echo.value === null ? Number.POSITIVE_INFINITY : echoVoiceDb(floor.value, echo.value)
      // The echo is learnt from what the mic hears while it plays and he is not talking; anything louder may be him.
      if (level < limit && !seg.open) echo.push(level, level >= voiceDb(floor.value))
      else {
        doubts.push(level)
        if (doubts.length > TALK.doubtFrames) doubts.shift()
      }
      // o0de2 round 2: the room is learnt only from frames before his voice starts (and between his turns), never from his speech: frames
      // of an open turn are his, not the room. (The classic learnt them too; his voice going on for seconds became the floor.)
    } else if (!isEcho && !seg.open) floor.push(level)
    if (deaf()) {
      if (seg.open) {
        seg.reset()
        dropGuess()
        onSegmentEnd(null, 0)
      } else seg.reset()
      return
    }
    const r = seg.push({ n, db: level, echo: isEcho, echoDb: isEcho ? echo.value : null })
    if (r?.t === 'start') onOnset()
    else if (r?.t === 'end') onSegmentEnd(r.range, r.voiced)
    else if (r?.t === 'cut') onSegmentCut(r.range, r.voiced)
    if (seg.open) {
      if (seg.hearing) lastActive = now
      watchCutIn()
      watchGuess()
    }
    dirty = dirty || r !== null
  }

  // --- Quick's frames -----------------------------------------------------------------------------------------------------
  function release(t: Turn, done: boolean) {
    const { sentences, rest } = takeSentences(t.buffer, done)
    t.buffer = rest
    for (const s of sentences) {
      t.spoke = true
      say(s, 'answer', t)
    }
  }
  function upsertCard(c: TalkCard, from: string) {
    if (!isObject(c) || typeof c.id !== 'string' || !Number.isFinite(c.version)) return
    const i = cards.findIndex(x => x.id === c.id)
    if (i >= 0 && cards[i].version > c.version) return
    cards = i >= 0 ? cards.map((x, j) => (j === i ? { ...c } : x)) : [...cards, { ...c }]
    cardFrom.set(c.id, from)
    dirty = true
  }
  function removeCard(id: string) {
    if (!cards.some(c => c.id === id)) return
    cards = cards.filter(c => c.id !== id)
    cardFrom.delete(id)
    dirty = true
  }
  /** An order's state, kept under `key` (Quick: its orderId; direct mode: the direct-ask's id, see onDirect); `orderId` is what the view shows. */
  function setOrder(key: string, phase: TalkOrderPhase, words?: string, orderId = key) {
    const od = orders.get(key) ?? { orderId, phase, waitingSaid: false }
    od.orderId = orderId
    od.phase = phase
    if (words) od.words = words
    orders.set(key, od)
    lastOrder = key
    while (orders.size > TALK.ordersMax) orders.delete(orders.keys().next().value as string)
    dirty = true
    return od
  }
  function onFast(f: TalkFastFrame) {
    // Cards are his to see in either mode.
    if (f.t === 'card') return upsertCard(f.card, 'fast')
    if (f.t === 'card-gone') return removeCard(f.id)
    if (!quick) return
    switch (f.t) {
      case 'state': {
        const fast = o.names.fast
        if (f.state === 'taken-over') return finish('taken-over', `Another screen took ${fast}, so live talk ended.`)
        if (f.state === 'paused') return finish('paused', f.reason ? sentence(f.reason) : `${fast} is paused for now, so live talk ended.`)
        if (f.state === 'unavailable') return finish('unavailable', f.reason ? sentence(f.reason) : `${fast} is not available right now, so live talk ended.`)
        if (f.state === 'off') return finish('off', f.reason ? sentence(f.reason) : `${fast} is not on this server, so live talk ended.`)
        return
      }
      case 'delta': {
        let t = turnOf(f.id)
        // Quick telling an order's answer: a turn the hub starts after the answer's frame, spoken like any other.
        if (!t && f.id.startsWith('o:') && tellable.delete(f.id.slice(2))) t = newTurn(f.id, 'telling', '')
        if (!t || !t.generating || t.cancelled || !f.text) return
        t.answered = true
        t.received += f.text
        t.buffer += f.text
        return release(t, false)
      }
      case 'flush': {
        const t = turnOf(f.id)
        if (t?.generating && !t.cancelled) release(t, true)
        return
      }
      case 'tool': {
        const t = turnOf(f.id)
        if (!t?.generating || t.cancelled) return
        // odcd9 (from oeb56's review): what it said of this turn before its first tool call is its lead-in (markLeadIn, onOnset).
        markLeadIn(t)
        t.toolSeen = true
        t.label = f.label
        info = f.label
        dirty = true
        return
      }
      case 'done': {
        const t = turnOf(f.id)
        if (!t?.generating) return
        t.generating = false
        if (t.cancelled) return
        if (f.cancelled) return stopTurnQuietly(t)
        // What it said in full, when a piece of it never came as a delta.
        if (f.text.length > t.received.length && f.text.startsWith(t.received)) {
          t.buffer += f.text.slice(t.received.length)
          t.received = f.text
          t.answered = true
        }
        release(t, true)
        if (info === t.label) info = ''
        return
      }
      case 'error': {
        if (f.id === undefined) {
          info = f.message
          dirty = true
          return
        }
        const t = turnOf(f.id)
        if (!t?.generating || t.cancelled) return
        t.generating = false
        release(t, true)
        info = f.message
        return say(sentence(f.message), 'answer', null, false, t.id)
      }
      case 'handoff':
        setOrder(f.orderId, 'queued')
        addLine('quick', f.line || `Asked the ${o.names.big}.`)
        return
      case 'handoff-progress': {
        if (!orders.has(f.orderId)) return
        const od = setOrder(f.orderId, f.phase, f.words)
        if (f.phase === 'waiting-you' && !od.waitingSaid) {
          od.waitingSaid = true
          // Kept through a cut-in that comes before it plays, so "once" is never "never".
          say(`The ${o.names.big} is waiting for you on the PC.`, 'progress', null, true)
        }
        return
      }
      case 'handoff-answer':
        // The screen shows the full reply; Quick then tells it as a turn o:<order> (its frames come as for any turn). An order made
        // before this session (or by the Alt+K bar) is told too.
        if (orders.has(f.orderId)) setOrder(f.orderId, f.cancelled ? 'error' : 'done')
        tellable.add(f.orderId)
        while (tellable.size > TALK.ordersMax) tellable.delete(tellable.values().next().value as string)
        if (!f.cancelled && f.text.trim()) addLine('assistant', f.text)
        return
      default:
    }
  }

  // --- direct mode: the order's polls -----------------------------------------------------------------------------------------
  function onDirect(v: TalkDirectView) {
    if (typeof v !== 'object' || v === null || typeof v.id !== 'string') return
    const t = turnOf(v.id)
    if (!t || t.kind !== 'direct') return
    if (typeof v.orderId === 'string' && v.orderId) t.orderId = v.orderId
    if (Array.isArray(v.cards)) {
      const list = v.cards as readonly TalkCard[]
      for (const [id, from] of cardFrom) if (from === t.id && !list.some(c => c?.id === id)) removeCard(id)
      for (const c of list) upsertCard(c, t.id)
    }
    // Kept under the ask's own id, so a first view without its orderId and the later ones are one order (review of T3a: the first one
    // stayed 'queued' under the ask id for ever, and auto-end never came); the view shows the orderId once it is known.
    const shown = t.orderId ?? t.id
    if (!t.generating) return
    switch (v.state) {
      case 'queued':
      case 'working': {
        const words = typeof v.words === 'string' ? capText(v.words, TALK.wordsMaxChars) : ''
        if (words) {
          t.toolSeen = true
          t.label = words
          info = words
        }
        // T3b: the order's own phase when the hub gives it (an open one only: its end comes as done or error).
        const phase = typeof v.phase === 'string' && OUT.includes(v.phase) ? v.phase : v.state
        const od = setOrder(t.id, phase, words || undefined, shown)
        if (phase === 'waiting-you' && !od.waitingSaid) {
          od.waitingSaid = true
          // Once, as for Quick's hand-offs, and kept through a cut-in that comes before it plays.
          say(`The ${o.names.big} is waiting for you on the PC.`, 'progress', null, true)
        }
        return
      }
      case 'done': {
        t.generating = false
        t.answered = true
        const clean = speechOf(typeof v.speak === 'string' ? v.speak : '')
        t.line = addLine('assistant', clean || 'Done.')
        // A sentence too long for one say counts as its pieces, so what is said stays within 3 says.
        const all = takeSentences(clean, true).sentences.flatMap(s => sayPieces(s))
        const first = all.slice(0, TALK.directSentences)
        if (first.length === 0) first.push('Done.')
        for (const s of first) say(s, 'answer', t)
        if (all.length > TALK.directSentences) say(REST_ON_SCREEN, 'answer', t)
        setOrder(t.id, 'done', undefined, shown)
        info = ''
        return
      }
      case 'error': {
        t.generating = false
        const e = sentence(typeof v.error === 'string' && v.error.trim() ? v.error : 'That did not work.')
        info = e
        // The order's outcome: told after his words if they come before it plays, like its answer.
        say(e, 'answer', null, true, t.id)
        setOrder(t.id, 'error', undefined, shown)
        return
      }
      default:
    }
  }

  // --- fillers (Chris's) --------------------------------------------------------------------------------------------------
  /** The turn fillers are for: his latest question (never Quick telling an order's answer), still out. */
  function fillerTurn(): Turn | null {
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i]
      if (t.kind === 'telling') continue
      return t.generating && !t.cancelled && t.fillers < TALK.maxFillers ? t : null
    }
    return null
  }
  /**
   * Chris's fillers while it thinks: an ack when no word or tool line came in `ackDelayMs`; the tool line once if nothing was said yet;
   * the progress lines at 25 s and 90 s while it is still out and nothing is half said; at most 3 a turn; never over his voice, never
   * over another sound (one at a time).
   */
  function checkFillers() {
    if (fillers !== 'words' || blocked() || queue.length > 0 || pending.length > 0) return
    const t = fillerTurn()
    if (!t) return
    const filler = (text: string, kind: SayKind) => {
      t.fillers += 1
      t.spoke = true
      // Not the turn's answer (its own lines are not kept for it), but the page's turn record counts it as this question's ack.
      say(text, kind, null, false, t.id)
    }
    if (!t.answered && !t.spoke && !t.toolSeen && !t.ackDone && now >= t.at + o.ackDelayMs) {
      t.ackDone = true
      ackAt = (ackAt + 1) % ACKS.length
      return filler(ACKS[ackAt], 'filler')
    }
    if (!t.answered && t.label && !t.labelDone && !t.spoke) {
      t.labelDone = true
      return filler(sentence(t.label), 'filler')
    }
    const due = now >= t.at + TALK.progressAtMs[1] ? 2 : now >= t.at + TALK.progressAtMs[0] ? 1 : 0
    if (due > t.progress && t.buffer.trim() === '') {
      t.progress = due
      return filler(due === 2 ? PROGRESS_LATE : progressEarly(t.label), 'progress')
    }
  }

  // --- the end --------------------------------------------------------------------------------------------------------------
  function finish(reason: TalkEndReason, why: string) {
    for (const req of reqs.keys()) act({ t: 'stt-abort', req })
    reqs.clear()
    guess = null
    utt = null
    sealed = []
    if (queue.length > 0 || held) act({ t: 'hush', at: 'now', hold: false })
    queue = []
    pending = []
    held = false
    lost = null
    if (reason === 'end') {
      act({ t: 'drop-cards' })
      // The view agrees with what the page was told (review of T3a: the dropped cards were still listed).
      cards = []
      cardFrom.clear()
    }
    act({ t: 'end', reason })
    ended = true
    endedWhy = why
    dirty = true
  }
  /** Something is going on: he talks or is being heard, a turn or an order is out, or it speaks. The silence of auto-end is none of these. */
  const busy = () =>
    seg.hearing ||
    (utt !== null && utt.parts.length > 0) ||
    sealed.length > 0 ||
    reqs.size > 0 ||
    queue.length > 0 ||
    pending.length > 0 ||
    held ||
    turns.some(t => t.generating) ||
    [...orders.values()].some(od => OUT.includes(od.phase))
  function checkAutoEnd() {
    if (o.autoEndMs === null || !started || ended) return
    if (busy()) lastActive = now
    else if (now - lastActive >= o.autoEndMs) {
      const min = Math.round(o.autoEndMs / 60_000)
      finish('silence', min >= 1 ? `Ended after ${min} minute${min === 1 ? '' : 's'} of quiet.` : 'Ended after a quiet while.')
    }
  }

  function onUser(a: TalkUserAct) {
    switch (a) {
      case 'end':
        return finish('end', 'Live talk ended.')
      case 'mute':
        if (muted) return
        muted = true
        // What he was saying is dropped, unheard: mute means the mic hears nothing.
        if (seg.open) {
          seg.reset()
          dropGuess()
          onSegmentEnd(null, 0)
        } else seg.reset()
        dirty = true
        return
      case 'unmute':
        if (!muted) return
        muted = false
        seg.reset()
        dirty = true
        return
      case 'stop':
        // The Stop button: quiet now, and the turn is cancelled; his own words still being taken become a new question. Cards stay (a tap is his).
        stopAll()
        // o0de2 round 2: a question his voice cut off and he then stopped is over: it is never merged into his later words (askedSince).
        for (const t of turns) t.byVoice = false
        for (const [req, r] of reqs) {
          if (r.kind !== 'check') continue
          reqs.delete(req)
          act({ t: 'stt-abort', req })
        }
        // o0de2: his earlier turns still with Whisper too (each is decided on its own, as a new question).
        for (const u of utt ? [...sealed, utt] : sealed) {
          u.policy = 'plain'
          u.turn = null
          u.heard = ''
          u.talkOver = false
        }
        dirty = true
        return
      default:
    }
  }

  // --- the view ---------------------------------------------------------------------------------------------------------
  function phase(): TalkPhase {
    if (ended) return 'ended'
    // o0de2 round 2: his voice is taken while it gets ready too: the strip says so (his words back and waiting for ready: getting ready).
    if (!started) return utt?.open ? 'hearing' : [...sealed, utt].some(u => u?.parts.some(p => !p.done)) ? 'writing' : 'starting'
    // His voice now; o0de2: then his words with Whisper while he is quiet (it said "hearing you" for as long as Whisper took).
    if (utt?.open) return 'hearing'
    if (utt || sealed.length > 0) return 'writing'
    if (queue.some(s => s.kind === 'answer') || pending.some(s => s.kind === 'answer')) return 'speaking'
    if (turns.some(t => t.generating)) return 'thinking'
    if (queue.length > 0) return 'speaking'
    return 'listening'
  }
  function caption(): string {
    if (ended) return endedWhy ?? ''
    const s = held ? undefined : queue.find(q => q.started)
    return s ? s.text : info
  }

  return {
    push(ev) {
      if (typeof ev !== 'object' || ev === null) return []
      if (ended) {
        // Ended: nothing more is done, but a card auto-end kept for his tap still leaves the view when it is sent, dropped or expires
        // (review of T3a: it stayed listed, with its Send). Silently: the page reads snapshot() when it still shows the cards.
        if (ev.t === 'fast' && isObject(ev.frame) && ev.frame.t === 'card-gone' && typeof ev.frame.id === 'string') removeCard(ev.frame.id)
        return []
      }
      out = []
      if (Number.isFinite(ev.now) && ev.now > now) now = ev.now
      switch (ev.t) {
        case 'frame':
          onFrame(ev.db)
          break
        case 'played':
          onPlayed(ev.id, ev.ms, ev.marks)
          break
        case 'play-end':
          onPlayEnd(ev.id)
          break
        case 'stt':
          onStt(ev.req, typeof ev.text === 'string' ? ev.text : '', typeof ev.dropped === 'string' && ev.dropped.trim() !== '' ? ev.dropped : null)
          break
        case 'stt-fail':
          onSttFail(ev.req)
          break
        case 'stt-busy':
          onSttBusy()
          break
        case 'fast':
          if (isObject(ev.frame)) onFast(ev.frame)
          break
        case 'direct':
          if (!quick) onDirect(ev.view)
          break
        case 'user':
          onUser(ev.act)
          break
        case 'ready':
          if (!started) {
            started = true
            lastActive = now
            if (quick) act({ t: 'hold-on' })
            dirty = true
            // o0de2 round 2: what he said while it got ready is decided now (once its words are back and he is quiet), after the hold.
            settle()
          }
          break
        default:
      }
      if (!ended) {
        expireReqs()
        flushPending()
        checkFillers()
        checkAutoEnd()
      }
      const sig = `${phase()}|${caption()}|${muted}`
      if (dirty || sig !== lastSig) {
        dirty = false
        lastSig = sig
        out.push({ t: 'view' })
      }
      return out
    },
    snapshot() {
      const od = lastOrder ? orders.get(lastOrder) : undefined
      return {
        phase: phase(),
        caption: caption(),
        transcript: transcript.filter(l => l.text).map(l => ({ ...l })),
        ...(od ? { order: { orderId: od.orderId, phase: od.phase, ...(od.words ? { words: od.words } : {}) } } : {}),
        cards: cards.map(c => ({ ...c })),
        muted,
        ...(endedWhy !== undefined ? { endedWhy } : {}),
      }
    },
  }
}
