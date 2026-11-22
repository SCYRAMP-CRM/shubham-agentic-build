import { requireCrmHuman, describeHuman, createPromptActions, answeredByAnother, type PromptActor, APPROVAL_GRANT_MS, isNativeApprovalCommit, nativeApprovalSnapshot, type NativeApprovalProof, type NativeApprovalSnapshot, type NativeApprovalCommit } from './human-session.ts'
import { createPcControlStore, isPcControl, immutablePcControl, pcControlError, pcControlRevision, assertPcControlExpected, checkedPcControlNamespace, type PcControlKnownDevice } from './pc-control.ts'
import type { PcControlAnswer, PcControlWorkspace, PcControlCapability, PcControlSlot } from '../../shared/pc-control.ts'
import { executionIdentityOf, requireLegacyExecution, requireRunningEngine, engineUpdateRequired, type RuntimeEngine } from './runtime-engine.ts'
import { requireMessageExecution } from './message-execution.ts'
import { assertExecutionCAS, normalizeExecution, snapshotAgentExecution, type ExecutionIdentity } from '../../shared/chat-execution.ts'
import { createExecutionService } from './execution-service.ts'
import { executionLaunchCwd } from './execution-launch.ts'
import { chatExecutionActor } from './execution-chat-actor.ts'
import type { ExecutionIntentScope } from './execution-intents.ts'
import { loadSession } from '../claude/index.ts'
import { sourceHash } from './switch-fence.ts'
import { forkClaudeExecution, forkNativeCodexExecution } from '../codex-claude/fork.ts'
import { executionHttpError, executionIntentId, requireExecutionCapabilityQuery, requireExecutionOpenRequest,
  requireExecutionSelectionRequest, type ExecutionCapabilityReply } from '../../shared/chat-execution-http.ts'
import { prepareConversation, type PreparedConversation } from '../opencode/switch.ts'
import { interchange } from '../opencode/backend.ts'
import { createOpenCodePool, combinePools, type OpenCodePoolOptions } from '../opencode/pool.ts'
import type { OpenCodeProvider } from '../../shared/opencode.ts'
import { openCodeSelection } from '../../shared/opencode.ts'
import type { OpenCodeCredential } from '../opencode/crm.ts'
import { freeModel } from '../opencode/free-model.ts'
import { randomBytes, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Duplex } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { createUsage, buildIdOf, type Usage } from '../usage/usage.ts'
import { usageSubKeyOf } from '../usage/sub-key.ts'
import { claudeConfigDir, ownStatusLineCommand } from '../usage/own-status-line.ts'
import {
  AGENTIC_PREFIX,
  AGENTS_OFF_STATUS,
  AGENT_EFFORTS,
  AGENT_MODELS,
  HOME_OFFLINE_STATUS,
  isOrchestratorAgent,
  isPersonAssistant,
  AGENT_ULTRACODES,
  NO_DEFAULTS,
  type AgentEffort,
  type AgentModel,
  type AgentUltracode,
  type AgenticEvent,
  type AgenticTeam,
  type ChatElsewhere,
  type ChatImported,
  type ChatDefaults,
  type ChatLast,
  type ChatOpened,
  type ChatRun,
  type ChatState,
  type ClaudeProjectFolder,
  type ClaudeSession,
  type Floor,
  type FloorAgent,
  type FloorPatch,
  type FloorsAnswer,
  type NewAgent,
  type DefaultModel,
  type OpenChatRequest,
  type RunsAnswer,
  type SessionsAnswer,
  type TerminalClientMessage,
  type TuneAnswer,
  type TuneRequest,
} from '../../shared/agentic.ts'
import type { ChatMenu, PreviewsAnswer, SayAnswer, SayDirectAnswer, SayRequest, DeliveryReceipt } from '../../shared/chat.ts'
import { deliveryBlockWords, diagnosticWords, isDeliveryBlockReason, type DeliveryBlockReason } from '../../shared/delivery-reason.ts'
import { readDraftClear, readDraftView, type DraftKind, type DraftView } from '../../shared/chat-draft.ts'
import { createDeliveryReceipts } from './delivery-receipts.ts'
import { createHumanInputGrants, type HumanInputPhase } from './human-delivery.ts'
import type { TasksAnswer, TaskStatus } from '../../shared/tasks.ts'
import type { CrmAnswer, CrmCheck, CrmSessionInfo } from '../../shared/crm.ts'
import type { MemoryKind } from '../../shared/memory.ts'
import { apiError, type ApiMount, type MountRequest, type WsSocket } from '../api.ts'
import { writeAtomic } from '../config.ts'
import type { Logger } from '../log.ts'
import { composeAgentBrief, MCP_SERVER_NAME, writeBrief } from './briefs.ts'
import { claudeJsonPath, prepareClaudeConfig } from './claude-config.ts'
import { createChatPool, findClaude, type ChatInfo, type ChatPool, type ChatPoolOptions, type PtySpawn, type StartChat } from './chats.ts'
import { ownBridgeChat } from './bridge-stop.ts'
import type { ChatHostLink } from '../chathost/link.ts'
import { createChatFeeds } from './chatview.ts'
import { createUiBridge, type UiWho } from './ui-bridge.ts'
import { chosen, mcpConfigFor, readRegistry, strictConfigFor } from './mcp-registry.ts'
import { createOrders, FAST_FROM, isAcknowledgement, isReply, phoneUser, scanMessages, untappedMark, type HandoffApi, type HandOffOptions, type HandOffResult, type Order, type OrderOrigin, type OrderProgress, type Untapped } from './orders.ts'
import { CARD_TEXT_MAX, cleanCardText, createTalkCards, neutralizeMarks, type CardRecord } from './talk-cards.ts'
import { BUSY_WORDS, createLatchFiles, createLineQueue, createLockRecord, createSpokenLatch, HELD_WORDS, holdsChat, LINE_POLL_MS, latchVerdict, lockHook, noLockWords, REFUSED_WORDS } from './talk-latch.ts'
import { createResidualHolds, type Seen } from './talk-residual.ts'
import { createTalkStage } from './talk-stage.ts'
import { LATCH_NAME } from './latch-hook.ts'
import { createOrderWatch, createTurnReader, type TurnReader } from './turns.ts'
import { readStatus } from './screen.ts'
import { createHeartbeat, driftPushOn, phoneItems, unfinishedWork } from './heartbeat.ts'
import { createWatchdog, readFreeCommitMB } from './watchdog.ts'
import { createChatLog, describeEvents } from './chat-log.ts'
import { APP, NOT_RECORDED, UNATTRIBUTED, classesOfInput, createPresence, describePresence, screenActOf, screenCallerOf, screenOutcomeOf, screenToolOf, type ChatActor, type ChatRef, type Door } from './chat-presence.ts'
import { isAutomaticInput } from '../../shared/terminal-automatic.ts'
import { createVoice, type AskView } from './voice.ts'
import { spawn, spawnSync } from 'node:child_process'
import { createFastHost, type FastHost, type FastDeps } from './fast-host.ts'
import { createFastPreview, QUICK_PREVIEW_FAULT } from './fast-preview.ts'
import { createQuickHistory, quickHistoryFile, quickSessionId } from './quick-history.ts'
import { assistantsForPerson, keepsAssistantHistory, readAssistantHistory, requireSavedAssistant } from './assistant-history.ts'
import { createAssistantNativeHistory, type AssistantNativeBinding } from './assistant-native-history.ts'
import { QUICK_HISTORY_NOTICE, type AssistantHistoryIndex, type AssistantHistorySource } from '../../shared/assistant-history.ts'
import { namesChoice, namesFor, type NamesChoice } from '../../shared/fast-names.ts'
import { fastHello, ID_RE, MAX_TEXT } from '../../shared/fast.ts'
import { buildBrief, buildSnapshot, type SnapshotInput } from './fast-brief.ts'
import { createFastSession, type FastSession, type Origin } from './fast.ts'
import { FAST_AGENT_ID, fastDenied } from './fast-tools.ts'
import { readMemory } from './fast-gate.ts'
import { FAST_TOOLS } from './fast-tools-list.ts'
import { createOldFiles, createOldReaderStore, findOldRoot, notesPathOf, oldBrief, oldCall, oldRootCandidates, readNotes } from './old-reader.ts'
import { OLD_TOOL_LABELS, OLD_TOOLS } from './old-reader-tools.ts'
import type { OldReaderInfo } from '../../shared/old-reader.ts'
// Order o7f34: the efficient route's API answers: the saved key (encrypted here), the API host, and the router that picks the Claude login or the API.
import { createModelKeyStore } from './model-key.ts'
import { createApiFastHost } from './api-host.ts'
import { createSourceRouter } from './source-router.ts'
import { ApiFailure, apiWords, testKey, type ToolSpec } from './anthropic-api.ts'
import { API_MODEL_IDS } from '../../shared/api-prices.ts'
import { OLD_SOCKET } from '../../shared/old-route.ts'
import { librarianEnv } from './librarian.ts'
import { killTree } from '../proc-tree.ts'
import { answerable, createApprovalLog, promptOf } from './approvals.ts'
import { createApprovalIgnores, IGNORE_DETAIL, RESTORE_DETAIL, type IgnoreRecord } from './approval-ignores.ts'
import { createFloorEventLog, describeFloorEvent, type FloorEvent, type FloorEventInput } from './floor-events.ts'
import type { Elevation } from './approval-recovery.ts'
import { createAutoUpdate } from './auto-update.ts'
import { withRun, type QuietView } from '../update/coordinator.ts'
import type { WaTools } from '../whatsapp/index.ts'
import { waTool } from '../whatsapp/tools.ts'
import type { SignedKind } from '../../shared/approval-sign.ts'
import { createHash } from 'node:crypto'
import type { AnswerRequest, ApprovalItem, ApprovalLogEntry, ApprovalsAnswer, AutoUpdateRun, AutoUpdateStatus, CancelRequest, IgnoreRequest, IgnoredAnswer, PreparedCard, RestoreRequest, SendAsMeRequest } from '../../shared/approvals.ts'
import { configuredModel, readFileRun } from './runinfo.ts'
import { createFloorStore, assertCodexThreadAvailable, MAX_FLOOR_BODY, type FloorStore } from './floors.ts'
import { ownAssistantFloor, ownAssistantMayUse, OWN_ASSISTANT_FLOOR } from './own-assistant.ts'
import { appCommand, isStaffPolicy, STAFF_OWNER_RE, STAFF_POLICY, STAFF_POLICY_V2, staffBrief, staffMcpConfig, staffSettings, staffToolAllowed, staffToolsOf, staffToolsStampOf, staffUsageEnv, type StaffPolicy } from './staff-policy.ts'
import { STAFF_SEND_FEATURE, STAFF_SEND_REVOKED_WORDS, createStaffRate, staffConvergeTimes, staffSendDone, staffSendPrefix, staffSendText, staffSendTextWords, staffSendWords, type StaffSendOutcome, type StaffSendRefusal } from './staff-send.ts'
import { STAFF_SEND_NOT_RECORDED, createStaffSendRecord, describeStaffSend } from './staff-sends.ts'
import { staffMayScreen } from '../../shared/staff-screen.ts'
import { createFenceStore, type FenceReason } from './staff-fence.ts'
import { createOfflineSettings, OFFLINE_AFTER_MS } from './offline.ts'
import { CODEX_EFFORTS, CODEX_MODEL_MAX, engineOf, type AgentEngine, type CodexEffort, type CodexStatus } from '../../shared/codex.ts'
import type { CodexManager } from '../codex/index.ts'
import { parseVersion } from '../codex/find.ts'
import { dependencyReport } from './dependencies.ts'
import type { DependenciesAnswer, DependencyPc, DependencyReport } from '../../shared/dependencies.ts'
import { buildMcpInventory, findRunner, planInstall, registerCurated, removeCurated, type InventoryChat } from './mcp-inventory.ts'
import { MCP_CURATED, readMcpInstallDone, readMcpInstallPlan, readMcpInventory, type McpInstallDone, type McpInstallPlan, type McpInventory, type McpInventoryAnswer, type McpInventoryPc } from '../../shared/mcp-inventory.ts'
import { profileName, removeProfile, sweepProfiles, writeProfile, type McpServerToml } from '../codex/home.ts'
import { CODEX_FORMAT, discoverThread, findRollout } from '../codex/rollout.ts'
import { readLaunched, readRunning, type DriftReading } from '../codex/drift.ts'
import { watchForThread } from '../codex/discovery.ts'
import { switchConversationComplete } from '../codex/complete-conversion.ts'
import { createConversionProgress } from './conversion-progress.ts'
import { claudeFileContext, conversationCwd, conversationLines, convertClaude } from '../codex/from-claude.ts'
import { toClaude } from '../codex/to-claude.ts'
import { createSwitchFences } from './switch-fence.ts'
import { validatePreparedConversation, type ConversationBinding } from './prepared-conversation.ts'
import type { SendOptions } from '../codex/sender.ts'
import { CLAUDE_FORMAT } from './chatview.ts'
import type { AdoptStatus, OfflineChats } from '../../shared/agentic.ts'
import { createDefaultsStore, parseDefaults } from './defaults.ts'
import { createAssistantSettings, goalsPageCall } from './assistant-settings.ts'
import { createQuickSettings } from './quick-settings.ts'
import { createQuickForwarding } from './quick-forwarding.ts'
import { quickUntappedSender } from '../../shared/quick-forwarding.ts'
import { createToolsSeen, needsRefresh, toolsVersion } from './tools-seen.ts'
import { TOOLS } from './tools.ts'
import { contentTypeOf, createUploadStore, PIECE_BYTES } from './uploads.ts'
import { createMediaShelf } from './media.ts'
import { ATTACH_MAX_BYTES, isStoredName, safeName, storedName } from '../../shared/attachments.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CONTINUE_TEXT, createRecovery, type Recovery, type Remembered } from './recover.ts'
import { AGENT_API_PREFIX } from '../../shared/agent-api.ts'
import type { ChatOwner, ChatShare } from '../../shared/auth.ts'
import type { FeatureAccess } from '../auth/feature-access.ts'
import type { Auth } from '../auth/index.ts'
import { authError, OPEN, type Caller } from '../auth/types.ts'
import { GOALS_CRM_PATH, routeRule } from '../../shared/access.ts'
import { createAccess, policyKey, ruleOf, SBSKRRT_OWNER, type Need, type Rule } from './access.ts'
import { PERSON_DOOR_REFUSED, personChartTouches, personDoorOf, personSocketOf } from './person-assistant-doors.ts'
import { createStaffAdmission, type StartAdmit } from './staff-admission.ts'
import { createQuestionRouting } from './question-routing.ts'
import { createArrowPrompts } from './arrow-prompts.ts'
import { chooseByArrows } from './arrow-select.ts'
import { floorRoutable, routableChat } from './decision-routing.ts'
import {
  candidatesOf, decidesOn, effectiveRoute, OWNER_ROUTE, parseApprovalsScope, routeNames, splitQuestions, type ApprovalsScope, type QuestionRoute,
  type QuestionRoutingAnswer, type WaitingQuestion,
} from '../../shared/question-routing.ts'
import { createStaffTyping } from './staff-typing.ts'
import { isServerChat } from './server-chat.ts'
import { terminalClaimLine, terminalClaimOf, terminalNotice } from './member-terminal.ts'
import { createOwnerPcs } from './owner-pcs.ts'
import { broadcastTargets } from './broadcast-targets.ts'
import { OLD_STAFF_TYPING, staffTypingOf, type StaffTyping } from '../../shared/staff-typing.ts'
import { createFileTaskStore, taskId, taskPatch, taskText } from './tasks.ts'
import { checkCrm, createCrmStore, crmAddress, crmMode } from './crm.ts'
import { createCrmGoals } from './crm-goals.ts'
import { createCrmReads } from './crm-reads.ts'
import { createCrmWrite } from './crm-write.ts'
import { createCrmProxy, type CrmProxy } from './crmproxy.ts'
import { createAccountsEmail } from './accounts-email.ts'
import { createAccountsEmailWrite } from './accounts-email-write.ts'
import { createAccountsPlatformWrite } from './accounts-platform-write.ts'
import { createAccountsCodebaseWrite } from './accounts-codebase-write.ts'
import { createAccountsDatabases } from './accounts-databases.ts'
import { createAccountsImport } from './accounts-import.ts'
import { createAccountsCodebases } from './accounts-codebases.ts'
import { createCodebaseTabs } from './codebase-tabs.ts'
import { createCodebaseImport } from './accounts-codebase-import.ts'
import { createAccountsPlatforms } from './accounts-platforms.ts'
import { savedViewsRequest } from './views.ts'
import { createMemoryStore, type MemoryStore } from './memory.ts'
import { readAgentBrain } from './agent-brain.ts'
import { createCrmFilesModule, type CrmFilesModule, type CrmFilesModuleOptions } from '../crm-files/index.ts'
import { createBrowserHost } from '../browser/host.ts'
import { browserMount } from '../browser/mount.ts'
import { BROWSER_PRIVATE_NOTE } from '../../shared/browser.ts'
import { phoneAnswer } from '../../shared/phone-private.ts'
import { sshAnswer } from '../../shared/ssh-assist.ts'
import { sshWords, type SshAssist } from '../pc-ssh-term.ts'
import { createCrmUploads } from '../crm-files/uploads.ts'
import { createConversations, type Conversations, type ConvSession } from './conversations.ts'
import { noMeaning, type Embedder } from './embedder.ts'
import { createMemoryLayer, type MemoryLayer } from './memory-layer.ts'
import { createNotebooks, joinSections } from './memory-notebook.ts'
import { adminsAreOnlyTheOwner, chatIsShared, chatMemoryPerson, createMemoryPeople, feedFloors, noteFloors, ownProjects, quickMayUseMemory, unfedFloors, type QuickTalker } from './memory-people.ts'
import { appendAt, createTail, markOf, NO_FILE, sameMark, settled, type FileMark } from './mirror.ts'
import { answer, pullFrom as pullTranscriptFrom, readLines, request, servePull, writeLine, type LinkPeer } from './roam.ts'
import {
  claudeProjectsDir,
  copyTranscript,
  encodeProjectPath,
  findTranscript as findClaudeTranscript,
  findTranscriptCwd,
  listSessions,
  sessionFiles,
  type SessionFile,
  readTranscriptFile,
  transcriptPath,
} from './transcripts.ts'

// F-018: the Agentic Workflow section's backend (agentic-claude-manager's floors, agents and
// their chats, and the tools those chats share), mounted on the agent's local API at /agentic.
//   the page    /agentic/floors..., WebSockets /agentic/events and /agentic/terminal, with
//               x-sad-token like the rest of the API (Vite's proxy adds it)
//   the chats   GET /agentic/mcp/tools (the current tool list) and POST /agentic/mcp/call, with the calling chat's key (x-sad-chat-key) and
//               never the app's token: a chat can reach its floor, not the rest of the API
// State in <state>/agent/agentic: floors.json, memory/<floorId>.jsonl, briefs/<sessionId>.md,
// and mcp.json, the --mcp-config every chat is started with.
//
// F-021: one session, used from the hub's PCs in turn (agent/SPEC.md › F-021). The hub keeps
// the floors, the memory and who holds each session (sessions.json); a member shows the hub's
// floors (a copy in replica.json, read-only while the hub can't be reached) and forwards every
// change to it. A chat runs on one PC at a time: a member asks the hub for it first (a lease),
// and taking it over stops it where it ran. Each session's JSONL goes to the others as it
// grows ('jsonl' events) and is caught up in the background (pull), so every PC has it.

/** send_to_chat: one message per sender→target pair every 5 s, at most 6 a minute into one chat. */
const PAIR_COOLDOWN_MS = 5000
const TARGET_WINDOW_MS = 60_000
const TARGET_WINDOW_MAX = 6
/** broadcast_to_chats: one per floor every 10 s. */
const BROADCAST_COOLDOWN_MS = 10_000
const MAX_RELAY_TEXT = 10_000
/** F-050: the longest message the chat view types into a chat, and how long a new chat is taken to be at its start questions. */
const MAX_SAY_TEXT = 20_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** F-021: the hub's state to its members at least this often (their catch-up runs off it). */
const STATE_EVERY_MS = 30_000
/** F-021: a member granted a session is taken to be starting it this long before its live list must show it. */
const LEASE_GRACE_MS = 60_000

/** F-021: this PC among the hub's PCs, as the Agents section needs it (main.ts gives it). */
export interface AgenticTeamLinks {
  self(): { id: string; name: string }
  role(): 'hub' | 'member'
  /** A member: its hub, and the link to it now (null while it is down); null with no hub. */
  hub(): { id: string; name: string; link: LinkPeer | null } | null
  /** The hub: the link to a member now, by id. */
  member(id: string): LinkPeer | null
}

/** F-127: tools that live on the Server only: a chat of a floor made on a member PC while the Server was away has no use of them. */
const NEEDS_SERVER = new Set([
  'task_add',
  'task_list',
  'task_update',
  'ui_screen',
  'ui_control',
  'ui_modules',
  'ui_invoke',
  'phone_screen',
  'phone_control',
  'phone_update',
  'wa_status',
  'wa_chats',
  'wa_read',
  'wa_prepare_send',
  'watchdog_status',
  'memory_read',
  // F-309 N1: the agent notebooks live on the Server (its state folder), whichever PC the chat runs on.
  'notebook_add',
  'notebook_search',
  'notebook_read',
  'prepare_send',
  'crm_whoami',
  'crm_members',
  'crm_goals',
  'crm_goal_add',
  'crm_goal_update',
  'crm_scopes',
  'crm_board',
  'crm_catalog',
  'crm_query',
  'crm_write',
  // Order o528e: the CRM files, through the Server's own CRM sign-in, shown by the Server.
  'crm_files',
  'show_crm_file',
  // Order o68f0: the SSH terminals run on the Server (its ssh client and key).
  'ssh_open',
  'ssh_read',
  'ssh_type',
  'ssh_close',
  // Order o5dc4: the Browser runs on the Server.
  'browser_open',
  'browser_read',
])

/** F-118: tools that reach Shubham's own things (his task list, his phone, his WhatsApp, his screen, the app's memory, his CRM sign-in): the owner of the app's chats only. */
const ADMIN_TOOLS = new Set([
  'crm_whoami',
  'crm_members',
  'crm_goals',
  'crm_goal_add',
  'crm_goal_update',
  'crm_scopes',
  'crm_board',
  'crm_catalog',
  'crm_query',
  'crm_write',
  'task_add',
  'task_list',
  'task_update',
  // Order o355e (+ oe3b1): ui_screen / ui_control / ui_modules / ui_invoke are not here any more: a person's own Assistant (duty orchestrator) uses
  // them on that person's own pages only (ui-bridge.ts scopes every call to its chat's owner).
  'phone_screen',
  'phone_control',
  'phone_update',
  'wa_status',
  'wa_chats',
  'wa_read',
  'wa_prepare_send',
  'watchdog_status',
  'memory_read',
  'prepare_send',
  // Order o16d2: what it shows is served to the owner only.
  'show_media',
  // Order o3963: a PC's screen is the owner's.
  'show_screen',
  // Order o528e: his CRM sign-in's files, read only, served to the owner only.
  'crm_files',
  'show_crm_file',
  // Order o5dc4: the Browser is his, like the PC's screen.
  'browser_open',
  'browser_read',
])

/**
 * A second owner (the owners file, Shubham's orders o4e4e and o2f32) is an administrator: he gets what ADMIN_TOOLS holds, EXCEPT these, which stay SHUBHAM'S BY HIS ID (a chat whose owner is anyone else is refused, before
 * anything runs): his phone (phone_screen, phone_control, phone_update: it is tied to HIS paired phone) and his CRM sign-in (the crm_* tools, crm_files, show_crm_file: they run on this PC's crm-session.json, so they would
 * be Shubham acting in the CRM). A second owner's own CRM work is his own sign-in's, as for any person.
 */
const FIRST_OWNER_TOOLS = new Set([
  'phone_screen',
  'phone_control',
  'phone_update',
  'crm_whoami',
  'crm_members',
  'crm_goals',
  'crm_goal_add',
  'crm_goal_update',
  'crm_scopes',
  'crm_board',
  'crm_catalog',
  'crm_query',
  'crm_write',
  'crm_files',
  'show_crm_file',
])

/** F-124: what a proof needs of the request: who is asking and the browser's headers. */
/**
 * Order oae15 (review): the first string, at any depth, that would climb out of a URL path where page code puts it: a ".." segment between
 * slashes or backslashes, also written with %2e (once or twice encoded). Plain words and ids ("Q3/Q4 plan", "Wait...") pass; null when none.
 */
export function pathClimb(v: unknown, depth = 0): string | null {
  if (depth > 8) return null
  if (typeof v === 'string') {
    let s = v
    for (let i = 0; i < 3; i++) {
      if (/(^|[\\/])(\.|%2e){2}([\\/?#;]|$)/i.test(s)) return v
      let next: string
      try {
        next = decodeURIComponent(s)
      } catch {
        return null
      }
      if (next === s) return null
      s = next
    }
    return null
  }
  if (Array.isArray(v)) {
    for (const x of v) {
      const hit = pathClimb(x, depth + 1)
      if (hit) return hit
    }
    return null
  }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      const hit = pathClimb(k, depth + 1) ?? pathClimb(x, depth + 1)
      if (hit) return hit
    }
  }
  return null
}

export interface ProofRequest {
  caller?: Caller
  headers: IncomingMessage['headers']
}

export interface AgenticOptions {
  /**
   * Order o9465: Settings › Access. This mount tells it who has agents or floors of their own or shared with them, opens a feature's own owner-rule
   * routes (Tasks) to the people it is open to, and runs Goals and the CRM page on a person's own CRM sign-in.
   */
  featureAccess?: FeatureAccess
  /**
   * F-300 S0: the SHARED start admission (F-290, start-admission.ts: reads the free memory and reserves in ONE synchronous step) that a person's own Assistant is asked before it is started. Left out: no memory gate
   * (a person's start is as it was; the per-person start rate still applies). main.ts passes it once that function exists.
   */
  startAdmission?: StartAdmit
  /** Canonical self + registered devices, including offline devices. Never starts chats. */
  pcControlDevices?: () => Array<{ id: string; name: string; online: boolean }>
  /** Order o68f0: the Server's SSH terminals for the overlay Assistant (pc-ssh-term.ts SshAssist); null where there are none (a member, tests). */
  ssh?: () => SshAssist | null
  /** <state>/agent/agentic */
  dir: string
  /** F-134: Codex on this PC (the CRM's Codex login, the home, the chats). Left out (tests, older callers): agents set to Codex are refused with a plain sentence. */
  openCodeCredential?: (provider: OpenCodeProvider) => Promise<OpenCodeCredential>
  openCodeIdentity?: () => string | null
  openCodeFind?: OpenCodePoolOptions['find']
  openCodeBackend?: OpenCodePoolOptions['backend']
  openCodeFreeMemory?: () => number
  codex?: CodexManager | null
  /** F-134, tests: shorter waits for the sender of a Codex chat. */
  codexSend?: SendOptions
  /**
   * F-138: the Claude credential the CRM handed out (claude/index.ts credentialEnv): exactly one of CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY. Left out (tests), `token` applies as before.
   * Order of130: with the id of the CRM subscription it belongs to (claude/index.ts credentialWithSubscription: ONE read), which the usage of a chat started on it is filed under.
   */
  credential?: () => { name: string; value: string; subscriptionId?: string } | null
  /** F-127, tests: how long the Server must be out of reach before new chats are made here (default 20 s). */
  offlineAfterMs?: number
  /** F-127, tests: how long after a failed joining it is tried again (default 30 s). */
  adoptRetryMs?: number
  /** F-118: who is signed in (agent/auth/). Left out (tests), the app is open: every caller may do everything. */
  auth?: Auth
  /** The local API's base URL, http://127.0.0.1:<port>/agent-api (read when a chat starts). */
  apiUrl: () => string
  log?: Logger
  /** Where a floor with no folder of its own works: Documents\shubham-agentic. */
  defaultCodeDir?: string
  /** CLAUDE_CODE_OAUTH_TOKEN as this account has it now (F-007). */
  token?: () => string | null
  /** 10 Nov 2026: an agent's message to a plain native Claude chat is typed the old direct way (one paste, one Enter, no receipt). true = the checked
   *  sender for those too (default: SAD_CHECK_AGENT_MESSAGES=1 or <state>/agent/check-agent-messages.on; off, the old way). Codex, OpenCode and
   *  Codex-in-Claude-Code chats always use the checked sender. */
  checkAgentMessages?: boolean
  /** 12 Nov (Stage 1, fixtures): the "Old way" rule; absent, the rule is SAD_SYNC=old or sync-old.on beside the agent folder. */
  oldWay?: () => boolean
  /** F-087: the fast Assistant's warm process (fast-host.ts): on or off (default: SAD_FAST_ASSISTANT=1 or <state>/agent/fast-assistant.on; off, nothing exists). */
  fastAssistant?: boolean
  /** F-087: tests: the pieces of the fast host that would start a real claude, replaced. */
  fastHostDeps?: Partial<FastDeps>
  /** Order o5007, tests: the old-app reader's folder (`root` null: not on this PC; left out: SAD_OLD_APP_DIR, old-reader.json's root, then
   *  Desktop\Github\CRM\agentic-claude-manager-dev) and the pieces of its host that would start a real claude. */
  /** `anthropicFetch` (tests): the fetch the API answers and the key test use; left out, the real API. */
  oldReader?: { root?: string | null; hostDeps?: Partial<FastDeps>; anthropicFetch?: (url: string, init: RequestInit) => Promise<Response> }
  /** F-021: the hub's PCs; left out, this PC is on its own. */
  team?: AgenticTeamLinks
  /** Tests: a fake node-pty (and a no-op tree kill: its pids are other processes'), a fake claude, and a scratch ~/.claude/projects. */
  spawn?: PtySpawn
  treeKill?: (pid: number) => void
  claude?: string
  projectsDir?: string
  /** Tests: a scratch ~/.claude.json (claude-config.ts). */
  claudeJson?: string
  /**
   * F-078 scope fix: chats start with --strict-mcp-config and a config of their own, so a server in the user's ~/.claude.json that the
   * registry keeps back (windows-mcp) reaches only the agents that name it. On; SAD_MCP_STRICT=0 (or false here) is the way it was.
   */
  strictMcp?: boolean
  /** Tests: the pause between the commands a tune types into one chat (F-067; 800 ms). */
  tuneGapMs?: number
  /** Tests: how often a running chat's JSONL is looked at for what to send on (1 s). */
  syncEveryMs?: number
  /**
   * F-051: the memory layer. meaning: the embedding model (main.ts turns it on; left out, search
   * goes by words and nothing is downloaded); start: started with the agent rather than at first
   * use. The rest are for tests. allowOthers (oc65c S2, tests only, until other people's memory is built in S9): gives every person a layer of their own,
   * so the tests can prove two people's memories never mix; `main.ts` never sets it, and without it only the app owner has one.
   */
  memory?: { meaning?: boolean; start?: boolean; embedder?: Embedder; timers?: boolean; claudeArgs?: string[]; allowOthers?: boolean }
  /** F-078: the heartbeat's timer runs unless this is false (tests) or SAD_HEARTBEAT=0 (the way it was). */
  heartbeat?: boolean
  /** F-083: the watchdog's checks run in the heartbeat's beat unless this is false (tests) or SAD_WATCHDOG=0 (the way it was). */
  watchdog?: boolean
  /** F-083: free commit in MB for the watchdog's memory rule (Windows' own number); tests give theirs. */
  freeCommitMB?: () => Promise<number | null>
  /** F-083: the idle reaper's limits; tests shorten them. */
  idleReapMs?: number
  reapEveryMs?: number
  /** F-078: the newer build waiting for Update now, if there is one (main.ts reads it off the build). */
  newerBuild?: () => string | null
  /** Lead's "visible means TOLD": alarms from other parts of the app that the heartbeat tells the Assistant (main.ts: Ports, the old phone gate). */
  alarms?: () => { key: string; text: string }[]
  /** @deprecated Inert compatibility input. Human actions always use the real CRM cookie session, never an injected proof. */
  voiceProof?: (body: unknown, r?: { caller?: Caller; headers: IncomingMessage['headers'] }) => string
  /** @deprecated Inert compatibility input: approval-device enrollment/recovery is retired; no elevation is run. */
  recoveryElevation?: Elevation
  /** F-080: the speech service's stream (Whisper on the hub), offered to the phone at /voice/speech with its device key. */
  speech?: (ws: WsSocket) => void
  /** F-078: the build running now (its version), for the morning summary. */
  currentBuild?: () => string | null
  /** F-173a: what the app's automatic update is doing (main.ts reads it off the coordinator), added to GET /auto-update. */
  updateRun?: () => AutoUpdateRun | null
  /** F-173a: the switch was changed: the coordinator looks again at once. */
  onAutoUpdateChanged?: () => void
  /** F-072: the Assistant's orders get their answers carried back to it by the app (orders.ts). On; SAD_ORDER_REPLIES=0, or an order-replies.off file in this folder, switches it off (the way it was). Tests set it. */
  orderReplies?: boolean
  /** Order-reply carrier (11 Nov), tests: shorter waits for claude's report of a typed reply and before a reply that was not taken is typed again. */
  orderReplyWaits?: { confirmMs: number; retypeAfterMs: number[] }
  /** F-211, tests: the conversations' copy in the CRM drive on (true) or off (false); left out: on, except inside a test run (and never on a member, nor when switched off). */
  conversationsDrive?: boolean
  /** F-211, tests: how often the conversations are looked at (ms); 0: only when a test asks (agentic.conversations.tick). */
  conversationsTickMs?: number
  /**
   * The Assistant's chat is restarted (its conversation resumes) when the tool list its MCP process was given is not the one now, so a new tool reaches a chat that
   * was running at an Update. On; SAD_ASSISTANT_TOOLS_REFRESH=0, or an assistant-tools-refresh.off file in this folder, switches it off. Tests set it.
   */
  assistantToolsRefresh?: boolean
  /** How long after the agent starts a chat that does not ask for the new list by itself is left alone (120 s), and how often it is looked at (60 s). Tests shorten them. */
  toolsRefreshGraceMs?: number
  toolsRefreshEveryMs?: number
  /** F-294, tests: how long a chat must be away from its question before the prompts a person ignored in it are let go (3 s: a state that blinks while a chat paints must not undo an ignore). */
  approvalIgnoreGraceMs?: number
  /** Claude subscription failover: how long a chat told /exit gets to end itself before it is stopped the usual way (15 s). Tests shorten it. */
  restartGraceMs?: number
  /**
   * F-297: TESTS ONLY, never set in production. Awaited by a staff send between its first checks and its last (the ones made right before anything is typed), so a test can take the person's right
   * away (the switch, a share) in that gap and see that nothing is typed.
   */
  staffSendGap?: () => void | Promise<void>
  /**
   * F-297 stage B (his order od8e2: "yes let ravis be on since start"): on the Server, ONCE, Ravi's `assistant-send` switch is turned ON in Settings > Access (logged as a change by the app, never overwriting a choice).
   * Set by main.ts only: a test that wants it says so, and every other test and tool is unaffected.
   */
  staffSendSeed?: boolean
  /**
   * F-297 stage B: how often a person's Assistant whose policy no longer matches its switch is looked at (every 20 s), how long it must have been QUIET (idle, nothing in flight) before it is restarted (60 s), and how long
   * before it is tried again if that did not work (5 min). Tests shorten them.
   */
  staffConvergeEveryMs?: number
  staffConvergeIdleMs?: number
  staffConvergeRetryMs?: number
  /**
   * F-058: the chats that were open when the app last stopped come back by themselves (the guard sets
   * SAD_RESUME_CHATS=1, main.ts passes it): each is opened again, resumed, and told to carry on if it
   * was mid-turn. `resumeAfterMs` waits for the API to be up (4 s); `resumeGapMs` spaces the chats out (2 s).
   */
  resumeChats?: boolean
  resumeAfterMs?: number
  resumeGapMs?: number
  /** F-054: this PC's CRM session (crm-session.json, beside the agentic folder); tests give a scratch one. */
  crmSession?: string
  /** order o4d14: how the Accounts page opens its database connection (accounts-db.ts); only tests give their own, so no test ever reaches a real database. */
  accountsDbOpen?: typeof import('./accounts-db.ts').openAccountsDb
  /**
   * F-075: the chats' terminals live in the chat host (agent/chathost/), which outlives this agent: the chats
   * started here run there, the ones the agent before this one left running are taken over at start, and
   * stopping the agent lets go of them instead of ending them. Left out (the default: SAD_CHAT_HOST is off):
   * node-pty in this process, as before.
   */
  chatHost?: ChatHostLink | null
  /** F-079: Shubham's WhatsApp on the hub (agent/whatsapp/), for the overlay Assistant's wa_* tools; null where there is none. */
  whatsapp?: () => WaTools | null
  /** F-126: this PC's way to mount the CRM files (Linux brings its own: loopback WebDAV + gvfs). Left out on Windows, where crm-fs.exe through WinFsp is used. */
  crmFilesMountDriver?: CrmFilesModuleOptions['mountDriver']
}

export interface Agentic {
  /** F-126: the CRM files (agent/crm-files/): the tree and its changes, the page's routes, this PC's mount. */
  crmFiles: CrmFilesModule
  /** Order oWA S5: this app's CRM proxy, for the WhatsApp page's CRM bridge (agent/whatsapp-crm/), which calls it on a signed-in person's own session (requestAs). */
  crmProxy: Pick<CrmProxy, 'requestAs'>
  /** F-211: every chat's conversation copied into the CRM drive (conversations.ts); tests look now with tick(). */
  conversations: Pick<Conversations, 'tick' | 'status'>
  mount: ApiMount
  /** Order o5dc4: the Browser's routes and live view, under /browser (agent/browser/mount.ts; the owner's only). */
  browserMount: ApiMount
  /** F-074: the phone app's side: pairing and its device key's routes, under /voice (voice.ts). */
  voiceMount: ApiMount
  /** F-087: the fast Assistant's warm process; undefined while the feature is off (the default). */
  fastHost?: FastHost
  /** Order o5007: the old-app reader's warm process right now; undefined while it is switched off, its folder is not here, or this PC is a member. */
  oldReaderHost(): FastHost | undefined
  /** F-087: hand-offs from the fast Assistant to the Orchestrator (the session in fast.ts uses it). */
  handoff: HandoffApi
  floors: FloorStore
  chats: ChatPool
  memory: MemoryStore
  /** What a tool call does, for the chat whose key it carries; the answer is the text the chat sees. */
  callTool(key: string, name: string, args: unknown): Promise<string>
  /** F-118, for the test that holds the access policy and the route table equal: each route as 'METHOD <regex source>'. */
  routeKeys(): string[]
  /** Separately audited profile routes: explicit per-chat owner rules live in this module. */
  executionRouteKeys(): string[]
  /**
   * Order o7e6d (H2): every staff Assistant run that is not safe (here without the staff policy, here with an unknown one, or on another PC).
   * Read only. An activation preflight: it must be empty before staff access is switched on. (No HTTP route yet: the route table's rules are
   * Agent 7's access.ts.)
   */
  staffPreflight(): { sessionId: string; floor: string; agent: string; pc: string; why: StaffUnsafe }[]
  /** F-021: an 'agentic' stream another of the hub's PCs opened (meta.from says which). */
  serve(meta: Record<string, unknown>): (stream: Duplex) => void
  /**
   * Claude subscription failover (agent/claude/failover.ts): the agent's chat on this PC stopped and
   * started again on the token in place now, its conversation resumed. true: it is running again.
   * false: it isn't running here, or this PC is a member (the hub holds the session).
   */
  restartChat(sessionId: string): Promise<boolean>
  /** F-134: a newer Codex login was put in place while Codex chats were running: each is restarted (its conversation resumes), one after the other. */
  restartCodexChats(): void
  /**
   * F-058: a chat that was open when the app stopped, opened again (its conversation resumed) and,
   * when `text` is given, told it once it is at its prompt (up to 90 s). true: it is running
   * afterwards; false: it can't be opened here (unknown session, a member PC, held elsewhere, an error).
   * Text goes only to a chat started now, never to one that was running already.
   */
  resumeChat(sessionId: string, text?: string): Promise<boolean>
  /** F-075: chats in the middle of something (running or asking) on this PC. */
  busyChats(): number
  /**
   * o25c1 C0: only a LIVE, known unsafe staff/policy run whose evidence is not sound can hold this PC's Update. Unclassified history and a
   * bad store alone hold staff activation, never an unrelated ordinary Update. Read only; no clearing or recovery action.
   */
  updateBlockers(): string[]
  /**
   * F-173a: what the automatic update looks at, read-only (nothing here starts, stops or types anything). Each one may throw:
   * the coordinator treats that as unknown and not quiet.
   */
  quiet: QuietView
  /** F-173a: the automatic-update switch as it is now (read afresh). */
  autoUpdateStatus(): AutoUpdateStatus
  /** F-075: the chat host changes with an update: the open chats are written down (so the new agent resumes them), then ended in the host. */
  retireChatHost(): Promise<void>
  /**
   * F158: current CRM-session human for an audit line; admin-only for pairing/auto-update/WhatsApp.
   * Legacy fields/signature arguments are ignored, never a second authorization path.
   */
  humanProof(kind: SignedKind, fields: (string | number | boolean)[], signed: unknown, r?: ProofRequest): string
  /**
   * Stops everything at once, as always. o13d4: the promise settles when the last writes into the state folder are done (the CRM files
   * module's close, whose "Keep on this PC" engine saves its store last, and the fast host's stop). Nothing has to wait for it; whatever
   * removes the state folder afterwards (a test's temp folder) must, or a late save lands mid-removal (ENOTEMPTY). It never rejects.
   */
  close(): Promise<void>
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown, what: string, max = MAX_RELAY_TEXT) => {
  if (typeof v !== 'string' || !v.trim()) throw apiError(400, `${what} is missing`)
  if (v.length > max) throw apiError(400, `${what} is longer than ${max} characters`)
  return v
}
const json = (v: unknown) => JSON.stringify(v, null, 2)
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const enc = encodeURIComponent
const isMark = (v: unknown): v is FileMark => isObject(v) && typeof v.bytes === 'number' && typeof v.tail === 'string'

/**
 * F-020: the section switched off (Dev, beside the build that runs the chats): nothing is read
 * or started, and every route says so, so the page can tell "off here" from "not running".
 */
export function agenticOff(): ApiMount {
  return {
    prefix: AGENTIC_PREFIX,
    ownAuth: rest => rest === '/mcp/call' || rest === '/mcp/tools',
    http: () =>
      Promise.reject(
        apiError(AGENTS_OFF_STATUS, "Agents are off in Dev: the build runs them, so Dev's chats never mix with its chats. Start Dev with --agents to try them here, apart from the build's"),
      ),
    ws: () => null,
  }
}

/** F-022: copying every conversation of another PC here. */
interface CopyAllState {
  pc: string
  state: 'running' | 'done' | 'failed'
  total: number
  done: number
  copied: number
  bytes: number
  error: string | null
  startedAt: string
}

function readJson(file: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return isObject(v) ? v : {}
  } catch {
    return {}
  }
}

/** F-021, on the hub: who holds each session (the PC running it, or granted it) and where it ran last. */
interface Held {
  holder: string | null
  holderName: string | null
  heldAt: number
  last: ChatLast | null
}

/** F-021, on a member: the hub's floors and sessions as it last said them. */
interface Replica {
  pcControl?: PcControlAnswer
  engineSwitchContinuity?: FloorsAnswer['engineSwitchContinuity']
  floors: Floor[]
  /** F-067: the hub's defaults for model, effort and ultracode. */
  defaults?: ChatDefaults
  where: Record<string, { id: string; name: string; state: ChatState }>
  last: Record<string, ChatLast>
  marks: Record<string, FileMark>
}

/**
 * o25c1 C0: staff activation findings only. A generic old record is unclassified, NOT a verdict on that run. Unknown origins and ordinary
 * non-admin chats are no longer listed as unsafe just because they are not proven administrators'.
 */
export type StaffUnsafe = 'no-policy' | 'unknown-policy' | 'other-pc' | 'fence-store-bad' | 'fence-store-dirty' | 'fence-not-durable' | 'fence-unclassified'

/**
 * Order o7e6d S1 (Agent 3's M3): the Server's own class of one of its agents, judged with the Server's sign-in: 'staff' (a person's own
 * Assistant whose person is not an administrator), 'admin' (an administrator's), 'other'. Sent to the members in the state frame, PC link only.
 */
export type StaffClass = 'staff' | 'admin' | 'other'
const STAFF_CLASSES: readonly string[] = ['staff', 'admin', 'other']
/** One key per (floor, agent): agent ids are a page's to choose, so never joined by a character they could hold. */
const classKey = (floorId: string, agentId: string) => JSON.stringify([floorId, agentId])
/** The classes a state frame carries: a list of [floor id, agent id, class]; anything else (none, an older Server, one bad row): null. */
export function parseStaffClasses(raw: unknown): Map<string, StaffClass> | null {
  if (!Array.isArray(raw)) return null
  const out = new Map<string, StaffClass>()
  for (const row of raw) {
    if (!Array.isArray(row) || row.length !== 3 || typeof row[0] !== 'string' || typeof row[1] !== 'string' || typeof row[2] !== 'string' || !STAFF_CLASSES.includes(row[2])) return null
    out.set(classKey(row[0], row[1]), row[2] as StaffClass)
  }
  return out
}
/** Floors a member can take from a state frame: a list of objects, each with an id and a list of agents that each have an id. */
const wellFormedFloors = (v: unknown): v is Floor[] =>
  Array.isArray(v) && v.every(f => typeof f === 'object' && f !== null && typeof (f as Floor).id === 'string' && Array.isArray((f as Floor).agents) && (f as Floor).agents.every(a => typeof a === 'object' && a !== null && typeof a.id === 'string'))
const classesFingerprint = (rows: [string, string, StaffClass][] | null) => (rows ? rows.map(r => r.join('\u0000')).sort().join('\u0001') : 'none')

/** Order o7e6d S1: the staff fence record's problems as the Update guard words them (Agentic.updateBlockers). */
const STAFF_FENCE_WORDS: Record<string, string> = {
  'fence-store-bad': "the staff fence evidence can't be read (agent/agentic/staff); a person has to look at it",
  'fence-store-dirty': 'a write of the staff fence evidence may not have landed (a poison marker is there); a person has to look at it',
  'fence-not-durable': 'a staff fence could not be written to disk (it is held in memory only)',
}

export function createAgentic(o: AgenticOptions): Agentic {
  const approvalNativeRuntimes = new Map<string, { fingerprint: string; generation: string }>()
  const log = o.log
  const team = o.team
  const projectsDir = o.projectsDir ?? claudeProjectsDir()
  // Order o5d4e: "Buttons for arrow-select prompts" (arrow-prompts.json on this PC; on unless he switched it off; the old way, no buttons, is kept).
  const arrowPrompts = createArrowPrompts(path.join(o.dir, 'arrow-prompts.json'))
  if (arrowPrompts.unreadable()) log?.warn('arrow-select prompts: the saved setting (arrow-prompts.json) could not be read; they get no buttons until he chooses again')
  const menuOpts = () => ({ arrows: arrowPrompts.on() })
  /** A menu as this app shows it: an unnumbered one only while the setting is on (a member PC's snapshot may carry one). */
  const menuIfOn = (m: ChatMenu | null): ChatMenu | null => (m?.keys === 'arrows' && !arrowPrompts.on() ? null : m)
  // F-050: the chat view's reading of conversations (chatview.ts): the end of a file, never all of it.
  const chatFeeds = createChatFeeds({
    projectsDir,
    log: o.log,
    screen: sid => chats.screen(sid),
    arrowMenus: () => arrowPrompts.on(),
    // F-134: a Codex chat's conversation is its rollout file, read in Codex's format.
    fileOf: sid => isOpenCode(sid) ? openCode.file(sid) : codexRollout(sid),
    formatOf: sid => (isCodexSession(sid) ? CODEX_FORMAT : CLAUDE_FORMAT),
    // o655f (Stage 1): after /clear or /resume claude goes on in a NEW session and a new file, in the same terminal: the chat view follows it.
    successor: sid => chats.claudeSession?.(sid) ?? null,
    // Stage 1 (o400b): what the chat is doing as Claude's own transcript says, for the page's `claude` message (the simple layer only).
    claude: sid => (syncOld() ? null : turns?.turn(sid) ?? null),
  })
  // F-062: the effort each chat running here was started with, and when (what its chip says until a /effort changes it).
  const launched = new Map<string, { effort: string; at: string; ultracode: boolean }>()
  const claudeJson = o.claudeJson ?? claudeJsonPath()
  const defaultCodeDir = o.defaultCodeDir ?? path.join(os.homedir(), 'Documents', 'shubham-agentic')
  const briefsDir = path.join(o.dir, 'briefs')
  const mcpConfig = path.join(o.dir, 'mcp.json')
  const heldFile = path.join(o.dir, 'sessions.json')
  const replicaFile = path.join(o.dir, 'replica.json')
  const shim = fileURLToPath(new URL('./mcp-shim.ts', import.meta.url))
  // The shim is named here once; the key it needs comes from the chat's own terminal.
  const appMcpServers = { [MCP_SERVER_NAME]: { type: 'stdio', command: process.execPath, args: [shim] } }
  writeAtomic(mcpConfig, `${json({ mcpServers: appMcpServers })}\n`)
  /** Other MCP servers, given to single agents by name (mcp-registry.ts). */
  const mcpRegistryFile = path.join(o.dir, 'mcp-servers.json')
  // F-051: the memory's hook (memory-hook.ts), for every chat's --settings, which claude adds to
  // the user's own settings. One command line, run by claude's shell: both paths quoted, with
  // forward slashes (a folder like "Shubham's Agent" has a space and an apostrophe).
  const hooksFile = path.join(o.dir, 'hooks.json')
  const fwd = (p: string) => p.replace(/\\/g, '/')
  const hookScript = fileURLToPath(new URL('./memory-hook.ts', import.meta.url))
  // F-221 (ob98a, T4): the two prompt hooks are named, so the Orchestrator's own settings file (below) carries exactly the same one.
  const memoryPromptHook = [{ hooks: [{ type: 'command', command: `"${fwd(process.execPath)}" "${fwd(hookScript)}"`, timeout: 10 }] }]
  // Order ofedf: the Claude usage's status line (usage/statusline.mjs) rides in every chat's settings file while usage is on (SAD_CLAUDE_USAGE=0 or
  // the file claude-usage.off beside the state folder turns it off: the old way, no status line of ours). Its values come from the chat's environment.
  // Only with sign-in wired (no auth: nobody to file usage under, so the chats keep their settings as before).
  const usageOn = !!o.auth && process.env.SAD_CLAUDE_USAGE !== '0' && !existsSync(path.join(o.dir, '..', 'claude-usage.off'))
  const usageHook = fileURLToPath(new URL('../usage/statusline.mjs', import.meta.url))
  const usageStatusLine = usageOn ? { statusLine: { type: 'command', command: `"${fwd(process.execPath)}" "${fwd(usageHook)}"` } } : {}
  writeAtomic(hooksFile, `${json({ hooks: { UserPromptSubmit: memoryPromptHook }, ...usageStatusLine })}\n`)
  // Order ofedf: a chat with no other hook gets a file of its own that only names the usage status line (it is used when the other two are off).
  const statusOnlyFile = path.join(o.dir, 'hooks-statusline.json')
  if (usageOn) writeAtomic(statusOnlyFile, `${json({ ...usageStatusLine })}\n`)
  // 12 Nov (Agent 12, Lead's yes): while the memory layer is off, every NEW Claude chat still gets the PROMPT REPORT: the same script with
  // --report-only, which only tells the agent which prompt claude took (the send confirmation, o655f, and the order-reply carrier), prints
  // nothing, gives up after 2 s and always exits 0. The memory layer's own switch is not touched. Off for new chats: SAD_PROMPT_HOOK=0 or the
  // file <state>/agent/prompt-hook.off, looked at at each chat start; a running chat keeps the flags it started with.
  // Claude's own limit stays the memory hook's 10 s: it counts from the moment claude starts the hook, and Windows sometimes takes ~3 s just
  // to start it (real rig, 12 Nov: with a 3 s limit claude printed "hook ... timed out" under the prompt). The script's own 2 s cap is the wait.
  const promptHookFile = path.join(o.dir, 'prompt-hook.json')
  const reportPromptHook = [{ hooks: [{ type: 'command', command: `"${fwd(process.execPath)}" "${fwd(hookScript)}" --report-only`, timeout: 10 }] }]
  writeAtomic(promptHookFile, `${json({ hooks: { UserPromptSubmit: reportPromptHook }, ...usageStatusLine })}\n`)
  const promptHookOff = () => process.env.SAD_PROMPT_HOOK === '0' || existsSync(path.join(o.dir, '..', 'prompt-hook.off'))
  // Order o7e6d (o4002): a person's own Assistant (staff-policy.ts) has a folder of its own here: its settings file, its MCP files and each
  // person's empty room (its working folder). The settings file is written at each of its starts, from fixed app-owned commands with absolute
  // paths (the prompt report and the usage status line, each only while on; Lead's decision of 15 Nov); a write that fails stops the start.
  const staffDir = path.join(o.dir, 'staff')
  // S1 (Lead's F1): the durable fence, read here, before the chat host's chats are taken over (staff-fence.ts).
  const staffFence = createFenceStore(staffDir, { log })
  const staffSettingsFile = path.join(staffDir, 'settings.json')
  function staffSettingsNow(): string {
    const reportCommand = promptHookOff() ? undefined : appCommand(process.execPath, hookScript, '--report-only')
    const statusLineCommand = usageOn ? appCommand(process.execPath, usageHook) : undefined
    writeAtomic(staffSettingsFile, `${json(staffSettings({ reportCommand, statusLineCommand }))}\n`)
    return staffSettingsFile
  }
  // One answer per chat start: two reads in one start must agree even if the file appears in between (the pool read `settings` twice before
  // F-221 T4 made it one call); the next start (a later tick) looks again.
  let promptHookPick: string | undefined | null = null
  const promptHookSettings = () => {
    if (promptHookPick === null) {
      promptHookPick = promptHookOff() ? undefined : promptHookFile
      queueMicrotask(() => { promptHookPick = null })
    }
    return promptHookPick
  }
  // F-221 (ob98a, T4): the voice lock below the model (latch-hook.ts). The Orchestrator's chat, and ONLY it (a hook process at every tool call of
  // every chat would slow all agents), starts with its own settings file: the very prompt hook it gets by the rules above (the memory's, the prompt
  // report, or none) plus a PreToolUse hook on every tool that refuses all but reads while a spoken line holds the chat (talk-latch.ts mirrors the
  // latch into talk-latch/<session>). Written as that chat starts, naming it; the hub's own (a member keeps no orders, so nothing could hold there).
  // Which chats were started with it is kept (voice-lock.json, by start time): GET /talk/caps says 'full' only for the Orchestrator running now.
  const orchestratorHooksFile = path.join(o.dir, 'hooks-orchestrator.json')
  const latchDir = path.join(o.dir, 'talk-latch')
  const latchHookScript = fileURLToPath(new URL('./latch-hook.ts', import.meta.url))
  const voiceLocks = createLockRecord(path.join(o.dir, 'voice-lock.json'), log)
  /** The chat whose start the settings below just gave the voice lock (startHere notes it once the start went through). */
  let voiceLockGiven: string | null = null
  /**
   * Order ofedf: the usage status line's values for one Claude chat's process: its folder, a fresh launch id (per spawn), the person who
   * made the chat (the floor agent's owner; empty when there is none, so nothing is filed), and the PC's own status line, if any, to chain.
   */
  function usageEnv(s: StartChat): Record<string, string> {
    // Assistant order ob7d3: the owner is read on every PC, a member PC included (its floors are the replicas), so a person's own Assistant files under them.
    const at = allFloors().flatMap(f => (f.id === s.floorId ? f.agents.filter(a => a.id === s.agentId).map(a => ({ f, a })) : []))[0]
    // Order o7e6d: a staff chat's usage goes under its person, whose id must fit the status line's own rule (else it is not started), and its
    // status line chains nothing: no SAD_STATUSLINE_CHAIN at all (chats.ts also takes away any it might have had).
    if (s.policy) return staffUsageEnv({ dir: usage ? usage.snapshotDir : '', launch: randomBytes(16).toString('hex'), person: at?.a.owner?.id ?? '' })
    const own = ownStatusLineCommand(claudeConfigDir(), usageHook)
    return {
      SAD_USAGE_DIR: usage ? usage.snapshotDir : '',
      SAD_USAGE_LAUNCH: randomBytes(16).toString('hex'),
      SAD_USAGE_USER: at?.a.owner?.id ?? '',
      SAD_USAGE_ORG: '',
      SAD_USAGE_SUB: '',
      SAD_STATUSLINE_CHAIN: own ? Buffer.from(own, 'utf8').toString('base64') : '',
    }
  }
  /**
   * Order of130: the subscription key a Claude process started on the credential `cred` files its usage under (usage/sub-key.ts): the credential's subscription id, else the blank key (the PC's own login, and the
   * old way: the marker file usage-sub.off beside the agent folder). Built on the PC that starts the chat, from that PC's own credential: the hub never labels a chat that runs on another PC. A label that is not a
   * UUID would be dropped by the status line without a word, so it is said here, once per id.
   */
  const notKeys = new Set<string>()
  const usageSubFor = (cred: { subscriptionId?: string } | null | undefined): string =>
    usageSubKeyOf(cred, path.join(o.dir, '..'), id => {
      if (notKeys.has(id)) return
      notKeys.add(id)
      log?.warn(`claude usage: the CRM's subscription id "${id.slice(0, 40)}" is not a UUID, so the usage of the chats started on it is filed as "this PC's own login" (not managed)`)
    })
  /** What a Claude chat starts with (chats.ts asks once per start, never for Codex or Codex in Claude Code). */
  function chatSettings(s: StartChat): string | undefined {
    // Order o7e6d: a staff chat gets its own file (never the memory's recall, the voice lock or a coding chat's file); a failed write throws.
    if (s.policy) return staffSettingsNow()
    const at = mode() === 'member' ? undefined : allFloors().flatMap(f => (f.id === s.floorId ? f.agents.filter(a => a.id === s.agentId).map(a => ({ f, a })) : []))[0]
    // F-309 N2: a chat that has a notebook gets the recall hook (the one that prints what the notebook found for each prompt), also with the memory layer off; a chat with none is picked for exactly as before.
    // notebook-door: K10
    const hasNotebook = !!at && notebooks.forChat(at.f, at.a).ok
    const picked = o.memory?.start || hasNotebook ? hooksFile : promptHookSettings()
    // Order ofedf: with no hook of the other kinds, a chat still gets the usage status line (its own file) while usage is on.
    const base = picked ?? (usageOn ? statusOnlyFile : undefined)
    if (!at || !isOrchestratorAgent(at.f.name, at.a) || !LATCH_NAME.test(s.sessionId)) return base
    const prompt = base === hooksFile ? memoryPromptHook : base === promptHookFile ? reportPromptHook : null
    try {
      writeAtomic(orchestratorHooksFile, `${json({ hooks: { ...(prompt ? { UserPromptSubmit: prompt } : {}), PreToolUse: [lockHook(process.execPath, latchHookScript, latchDir, s.sessionId)] }, ...usageStatusLine })}\n`)
    } catch (e) {
      // Started the old way: its app tools are still held by the hub, and the page does not offer the direct line (caps say 'app-tools').
      log?.warn(`voice lock: could not write ${orchestratorHooksFile}; the Orchestrator starts without it: ${message(e)}`)
      return base
    }
    voiceLockGiven = s.sessionId
    return orchestratorHooksFile
  }

  /** 'alone': no hub (as before F-021); 'hub': it keeps the floors; 'member': it shows its hub's. */
  const mode = (): 'alone' | 'hub' | 'member' => (!team ? 'alone' : team.role() === 'hub' ? 'hub' : team.hub() ? 'member' : 'alone')
  const self = () => team?.self() ?? { id: 'this-pc', name: os.hostname() }

  // F-118: every events socket with its caller: what it is sent is what that person may see.
  const events = new Map<WsSocket, Caller>()
  // Orders of95c / o9ccb / ocf0e: which chats a non-owner may type into (shared/staff-typing.ts), the owner's choice kept on the Server: by
  // default (no saved choice) a chat they own and one shared to them as "Can type", not on the Server (his o2f56, 19 Nov; "every PC" is a choice); an unreadable saved choice is the 15 Nov rule
  // (their own Assistant only), which is also kept as a choice.
  const staffTyping = createStaffTyping(path.join(o.dir, 'staff-typing.json'))
  // F-302 L4 (Agent 14's R2): the PCs the owner marked as HIS: an unsigned page on a member PC is the app's owner only when its PC is marked here (owner-pcs.ts). None marked = none trusted that way.
  const ownerPcs = createOwnerPcs(path.join(o.dir, 'owner-pcs.json'))
  if (ownerPcs.unreadable()) log?.warn('owner PCs: owner-pcs.json could not be read; no PC counts as the owner\'s until he marks them again')
  if (staffTyping.unreadable()) log?.warn('staff typing: the saved choice (staff-typing.json) could not be read; non-owners type only into their own Assistant (the 15 Nov rule) until he chooses again')
  /** The Server's own PC id: this PC on the hub (or alone), the hub on a member PC; null when it is not known. */
  const serverPcId = () => (mode() === 'member' ? (team?.hub()?.id ?? null) : self().id)
  /** A member PC types by the Server's choice from the Server's current state frame (fresh: replicaIsFresh); without one, the 15 Nov rule. */
  const typingNow = (): StaffTyping => (mode() === 'member' ? (replicaIsFresh() ? fresh?.typing : null) ?? OLD_STAFF_TYPING : staffTyping.get())
  const access = createAccess(o.auth, undefined, {
    typing: () => typingNow(),
    // The 'not-on-server' scope: a chat with no home yet, an unknown Server, a home that IS the Server, or a chat that RUNS on the Server counts as the Server's (it stays closed). A chat homed on another PC
    // but opened or taken over here runs as the Server's Windows user whatever its home says (Agent 14's L1, server-chat.ts).
    serverChat: a => isServerChat(a, { server: serverPcId(), runsOnServer }),
    // F-300 S0: Settings > Access 'assistant', asked at every right on a person's own Assistant (access.ts rights()), so closing it closes every door of that chat, not only the page's button.
    assistantOpen: c => !o.featureAccess || o.featureAccess.allows(c, 'assistant') === true,
  })
  // Order o9465 (order o929e: an existing share is his explicit choice): a person with an agent or a floor of their own or shared with them keeps
  // the Agents routes whatever Settings › Access says; this mount still shows them only those.
  o.featureAccess?.useShares(c => !!c.person && !access.isAdmin(c) && allFloors().some(f => access.floorSeen(c, f)))
  // F-070: the screens the overlay assistant can drive (ui-bridge.ts).
  const ui = createUiBridge()
  /** Order o355e (+ oe3b1): whose page or call it is, for the screen bridge: the signed-in person (or nobody), and an administrator or not. */
  const uiWho = (c: Caller): UiWho => ({ person: c.person?.id ? c.person.id.toLowerCase() : null, admin: access.isAdmin(c) })
  /** One event as this caller may see it, as text; null when it is not theirs at all. */
  function eventFor(e: AgenticEvent, c: Caller): string | null {
    // Order o9465: the task list's changes also go to someone it is open to (Settings › Access).
    if (e.t === 'tasks') return access.isAdmin(c) || (!!c.person && !!o.featureAccess?.allows(c, 'tasks')) ? JSON.stringify(e) : null
    if (e.t === 'auth') return JSON.stringify(e)
    if (e.t === 'memory') {
      const f = allFloors().find(x => x.id === e.floorId)
      return f && access.floorSeen(c, f) ? JSON.stringify(e) : null
    }
    if (e.t === 'pc-control') return JSON.stringify({ t: 'pc-control', answer: scopePcControl(e.answer, c) } satisfies AgenticEvent)
    if (e.t === 'floors') return JSON.stringify({ t: 'floors', floors: access.scope(c, e.floors.filter(f => !isPcControl(f))) } satisfies AgenticEvent)
    const seen = access.visible(c, allFloors())
    if (seen === null) return JSON.stringify(e)
    const mine = <T>(m: Record<string, T>) => Object.fromEntries(Object.entries(m).filter(([sid]) => seen.has(sid)))
    if (e.t === 'live') return JSON.stringify({ t: 'live', live: mine(e.live) } satisfies AgenticEvent)
    if (e.t === 'where') return JSON.stringify({ ...e, elsewhere: mine(e.elsewhere), last: mine(e.last) } satisfies AgenticEvent)
    return JSON.stringify(e)
  }
  // F-118: the terminal and chat sockets that are open, with who holds each: closed when their person loses sight of the chat.
  const viewers = new Set<{ ws: WsSocket; caller: Caller; sid: string }>()
  function watch(sid: string, caller: Caller, ws: WsSocket) {
    const entry = { ws, caller, sid }
    viewers.add(entry)
    ws.onClose(() => viewers.delete(entry))
  }
  /**
   * Each open socket judged again by the rule that let it in (wsAllow): a session that is a chat's is for the people with rights to that chat; one
   * that is no chat's any more (its agent taken off, its floor deleted, its session replaced or cleared) is the owner of the app's only, as at the
   * handshake. G2 (16 Nov): before, such a socket was skipped and stayed open, so what that chat still wrote afterwards (a chat on another PC whose
   * stop failed runs on: its relay and its mirrored transcript go on) reached people whose right to it had ended. Judged on the same view of the
   * floors as the handshake, a member's too: its copy of the Server's floors changes only by the Server's own word (a whole state frame of the
   * current stream, or a whole floor the Server answered with), so a chat the Server still has never drops out of it for a moment.
   */
  function recheckSockets() {
    for (const e of [...viewers]) {
      const at = bySession(e.sid)
      if (at ? access.rights(e.caller, at.agent) === null : !access.isAdmin(e.caller)) {
        viewers.delete(e)
        e.ws.close(4403, "That chat isn't yours any more")
      }
    }
  }
  // F-300 S0 (Agent 14's F1): an Access change emits no floors event, so the sockets were judged again only when some floor changed: closing 'assistant' left a person's open terminal view and chat feed streaming. Now every saved change of Access
  // (the owner's tap, and the system's seed) judges them again at once, by the rule that let them in (rights() asks 'assistant' at every right).
  o.featureAccess?.onChange(() => recheckSockets())
  const emit = (e: AgenticEvent) => {
    if (e.t === 'floors') recheckSockets()
    // Callers with the same rights get the same text: made once.
    const made = new Map<string, string | null>()
    for (const [s, c] of events) {
      const key = JSON.stringify(c)
      if (!made.has(key)) made.set(key, eventFor(e, c))
      const t = made.get(key)
      if (t) s.sendText(t)
    }
  }

  let executionService: ReturnType<typeof createExecutionService> | null = null
  const executionAuthority = {
    assertCurrent: (request: import('./floors.ts').FloorExecutionCommit) => {
      if (!executionService) throw executionHttpError('execution-capability-required', 'selection')
      executionService.authority.assertCurrent(request)
    },
    persist: (file: string, text: string) => {
      if (!executionService) throw executionHttpError('execution-capability-required', 'selection')
      executionService.authority.persist(file, text)
    },
  }
  // The floors' structural history (floor-events.ts): ONE append-only line per change, written by the STORE itself, so every entry point (a page, a chat's own
  // tool, a member's adoption, the own-Assistant path) is covered. Like an approval's record it is written AFTER the change, and a write that fails is never
  // silent: the change stands, the line that could not be written is kept here (newest first, 50), said in the log, told to the owner once in the heartbeat and
  // shown by GET /floor-events, so it can be written up by hand. Since this run only. The log's own file is this PC's: a member keeps one for its own floors.
  const floorEventLog = createFloorEventLog(path.join(o.dir, 'floor-events.jsonl'))
  const unrecordedFloorEvents: FloorEvent[] = []
  let unrecordedFloorEventCount = 0, unrecordedFloorEventTold = 0
  function recordFloorEvent(e: FloorEventInput) {
    try {
      floorEventLog.add(e)
    } catch (err) {
      unrecordedFloorEvents.unshift({ at: new Date().toISOString(), ...e })
      unrecordedFloorEvents.splice(50)
      unrecordedFloorEventCount++
      log?.error(`floor events: a change could not be recorded (${message(err)}): ${describeFloorEvent(e)}`)
    }
  }
  const hubFloors = createFloorStore(path.join(o.dir, 'floors.json'), () => {
    if (mode() === 'member') return
    emit({ t: 'floors', floors: hubFloors.list() })
    pushState()
  }, { executionAuthority, defaultEngine: () => defaultsNow().engine ?? '', executionDefaults: () => defaultsNow(), switchConversation: carryConversation, validateCodexThread: (f, a, t) => assertCodexThreadAvailable(allFloors(), f, a, t), events: recordFloorEvent,
    // F-127: a member's floor arrives whole (its chats, their content), but only the people this hub already lists keep their place in it (floors.ts adopt): an
    // administrator, someone Settings › Access lets use Agents, or someone already on one of its floors. Always on: with no sign-in wired (a test) nobody can be
    // verified, so nobody is `allowed` and only the owner and the people already on its floors keep a place; a lapsed session changes none of these inputs.
    adoptTrust: () => ({
      owner: SBSKRRT_OWNER,
      admins: [SBSKRRT_OWNER.id, ...(o.auth?.admins() ?? [])],
      ...(o.auth && o.featureAccess ? { allowed: (id: string) => o.featureAccess!.allows({ person: { id, username: '', name: '', canSeeAll: false }, via: 'local', sid: null }, 'agents') === true } : {}),
    }) })
  // F-127: a member's OWN floors, made while the Server could not be reached (floors-local.json). The same store, and 'alone' mode's code, run them. The facade
  // below is the one `floors` every handler already uses: a member's is the local one (it keeps no copy of the Server's floors in a store: that is the replica),
  // the hub's and a PC alone's is the usual one.
  const localFloors = createFloorStore(path.join(o.dir, 'floors-local.json'), () => {
    if (mode() === 'member') emitFloors()
  }, { executionAuthority, defaultEngine: () => defaultsNow().engine ?? '', executionDefaults: () => defaultsNow(), switchConversation: carryConversation, validateCodexThread: (f, a, t) => assertCodexThreadAvailable(allFloors(), f, a, t), events: recordFloorEvent })
  const offlineSettings = createOfflineSettings(path.join(o.dir, 'offline.json'))
  const controlFloors = createPcControlStore(path.join(o.dir, 'pc-control.json'), () => { emitFloors(); if (mode() !== 'member') pushState() }, { switchConversation: carryConversation, validateCodexThread: (f, a, t) => assertCodexThreadAvailable(allFloors(), f, a, t) })
  const pickFloors = () => (mode() === 'member' ? localFloors : hubFloors)
  const storeFor = (id: string) => controlFloors.store.get(id) ? controlFloors.store : pickFloors()
  const controlExecutionUnverified = () => {
    const store = controlFloors.store
    // An older store that cannot report profile-aware ownership cannot authorize credential cleanup.
    return !('hasUnverifiedExecution' in store) || typeof store.hasUnverifiedExecution !== 'function' || store.hasUnverifiedExecution() !== false
  }
  const floors: FloorStore = {
    hasUnverifiedExecution: () => pickFloors().hasUnverifiedExecution() || controlExecutionUnverified(),
    executionState: (f, a) => {
      if (isPcControl(floorOf(f))) throw immutablePcControl()
      return pickFloors().executionState(f, a)
    },
    commitExecution: request => {
      if (isPcControl(floorOf(request.floorId))) throw immutablePcControl()
      return pickFloors().commitExecution(request)
    },
    list: () => mode() === 'member' ? allFloors() : checkedPcControlNamespace([...pickFloors().list(), ...controlFloors.store.list()]),
    // Backend only (the Server's stalls, 16 Nov): this PC's floors then PC Control's, the stores' OWN rows (live objects, NOT copied), the same rows list()
    // copies. Read only: never change them, never hand them out. It is the one way the hub's bySession reads rows, looked up here at call time, so a test that
    // makes "the floors unreadable" by replacing list and rows reaches that lookup too. A member answers nothing: its floors are the replica's (bySession
    // checks mode() first and keeps the old loop there).
    rows: () => mode() === 'member' ? [] : [...(pickFloors().rows?.() ?? []), ...(controlFloors.store.rows?.() ?? [])],
    get: id => storeFor(id).get(id) ?? (mode() === 'member' ? replica.floors.find(f => f.id === id && isPcControl(f)) ?? null : null),
    create: (name, as) => pickFloors().create(name, as),
    validatePatch: (id, p, as) => storeFor(id).validatePatch(id, p, as),
    setOpenCodeSession: (f, a, n) => storeFor(f).setOpenCodeSession(f, a, n),
    patch: (id, p, as) => storeFor(id).patch(id, p, as),
    setShare: (f, a, l, as) => storeFor(f).setShare(f, a, l, as),
    assignUnowned: owner => pickFloors().assignUnowned(owner),
    adopt: (raw, from) => hubFloors.adopt(raw, from),
    remove: (id, as, handedTo) => storeFor(id).remove(id, as, handedTo),
    reorder: order => pickFloors().reorder(order),
    moveAgent: (from, agent, to, before, as) => storeFor(from).moveAgent(from, agent, to, before, as),
    addAgent: (f, req, as, via) => storeFor(f).addAgent(f, req, as, via),
    bindSession: (f, a, s) => storeFor(f).bindSession(f, a, s),
    setCodexThread: (f, a, t) => storeFor(f).setCodexThread(f, a, t),
    setHome: (f, a, h) => storeFor(f).setHome(f, a, h),
    setPersonAssistantDuty: (f, a, as) => storeFor(f).setPersonAssistantDuty(f, a, as),
    bySession: sid => bySession(sid),
    // Order o7e6d S1 (H1): the main store's load facts (this PC's own floors); the PC Control store's are read where they are needed.
    loadStatus: () => pickFloors().loadStatus(),
  }
  // F-118: every floor and chat that has no owner is sbskrrt's (the one-time move; it is idempotent, so a chat some older path
  // made without an owner is covered at the next start too). A member keeps no floors of its own: this changes nothing there.
  if (o.auth) {
    try {
      const moved = hubFloors.assignUnowned(SBSKRRT_OWNER)
      if (moved) log?.info(`F-118: ${moved} floors and chats had no owner; they are sbskrrt's now`)
      if (!o.auth.migrated()) o.auth.markMigrated()
    } catch (error) {
      if (!['execution-invalid', 'execution-intent-uncertain'].includes(String((error as { code?: unknown }).code))) throw error
      log?.warn('Execution metadata is quarantined. Floor bytes and ownership migration remain unchanged.')
    }
  }
  // F-067: what "Default" means for a chat's model, effort and ultracode, kept on the hub (a member gets a copy with the state).
  const chatDefaults = createDefaultsStore(path.join(o.dir, 'chat-defaults.json'), () => {
    if (mode() !== 'member') pushState()
  })
  const defaultsNow = (): ChatDefaults => (mode() === 'member' ? (replica.defaults ?? NO_DEFAULTS) : chatDefaults.get())
  // The overlay Assistant's settings (Settings › Assistant), kept on the hub; the screen tools that use them run on the hub only.
  const assistantSettings = createAssistantSettings(path.join(o.dir, 'assistant-settings.json'))
  // Which tool list each chat's MCP process was last given (tools-seen.ts), so a chat behind the current one can be seen.
  const toolsSeen = createToolsSeen(path.join(o.dir, 'chat-tools.json'))
  const TOOLS_NOW = toolsVersion(TOOLS)
  const upSince = Date.now()
  const memory = createMemoryStore(path.join(o.dir, 'memory'))
  // F-309 N1: the agent notebooks (memory-notebook.ts), OFF until the owner switches them on and maps a floor to one (agent-notebooks/settings.json). Written by a chat's three notebook_* tools,
  // read by the owner through the /notebooks routes. Nothing in the F-051 layer flows into it; the F-051 guard (admins) only decides whether notes that record what a person said are served.
  const notebooks = createNotebooks({ dir: o.dir, floors: () => floors.list(), appOwnerId: SBSKRRT_OWNER.id, admins: () => o.auth?.admins() ?? [SBSKRRT_OWNER.id] })
  // F-056: the task list (the Tasks tab, and the chats' task tools), kept on the hub like the floors.
  // Behind TaskStore (tasks.ts): a hosted database can take its place without anything else changing.
  const tasks = createFileTaskStore(path.join(o.dir, 'tasks.json'))
  tasks.onChange(() => tasksChanged())

  // F-054: how the CRM page shows the CRM (built into the page, or its website in a frame) and where
  // that website is, kept on the hub, with the last look at that site (for the frame).
  const crm = createCrmStore(path.join(o.dir, 'crm.json'))
  let crmChecked: { url: string; app: string | null; at: number; check: CrmCheck } | null = null
  // The CRM built into the page talks to the CRM's backend through this PC's own session, never the page's.
  const crmProxy = createCrmProxy({ file: o.crmSession ?? path.join(o.dir, '..', 'crm-session.json') })
  // The CRM's goals as tools for the owner's chats (crm_goals, crm_goal_add, ...): on the same PC session.
  const crmGoals = createCrmGoals({ proxy: crmProxy })
  const crmReads = createCrmReads({ proxy: crmProxy })
  const crmWrite = createCrmWrite({ proxy: crmProxy })
  // order o57e2, o4d14: the Accounts page's Email tab, read from the NEW Supabase project (schema sad; db/accounts/README.md) through the login sad_app named in two files in this state folder. Nothing connects
  // until Shubham has made those files himself; the answer says so in plain words.
  const accountsEmail = createAccountsEmail({ dir: path.join(o.dir, '..'), log: o.log, open: o.accountsDbOpen })
  // Order ofd53 (slice 1 of o45c0): the email edit modal's writes (soft delete; the owner's rows only).
  const accountsEmailWrite = createAccountsEmailWrite({ dir: path.join(o.dir, '..'), log: o.log, open: o.accountsDbOpen })
  // Accounts edit slice: the platform accounts edit and soft delete (the owner's only).
  const accountsPlatformWrite = createAccountsPlatformWrite({ dir: path.join(o.dir, '..'), log: o.log, open: o.accountsDbOpen })
  // Codebase details slice: a codebase's details edit (the owner's only).
  const accountsCodebaseWrite = createAccountsCodebaseWrite({ dir: path.join(o.dir, '..'), log: o.log, open: o.accountsDbOpen })
  // Databases section (order oba25): the two fixed databases and their pings (the owner's only).
  const accountsDatabases = createAccountsDatabases({ dir: path.join(o.dir, '..'), log: o.log, open: o.accountsDbOpen })
  // order o5c4d: the one-way copy of the CRM's email accounts into that database (reads the CRM with the PC's CRM sign-in, writes only to the new database, deletes nothing).
  const accountsImport = createAccountsImport({ proxy: crmProxy, dir: path.join(o.dir, '..'), log: o.log, open: o.accountsDbOpen })
  // orders o0e2a, oc2db: the Accounts page's Codebases tab: its list (the codebases with their detail rows and platform accounts) and the one-way copy from the CRM (no secret is copied: flags and counts only).
  const accountsCodebases = createAccountsCodebases({ dir: path.join(o.dir, '..'), log: o.log, open: o.accountsDbOpen })
  // Order ocf00: the Codebases modal's tabs (BE, FE, Deployment, Database and Environment variables), the same database and the owner's rows only.
  const codebaseTabs = createCodebaseTabs({ dir: path.join(o.dir, '..'), log: o.log, open: o.accountsDbOpen, pcName: () => self().name })
  // order o4029: the platform accounts for the Accounts page's "Accounts" tab (the CRM's Code > Accounts page), read from the same database. The copy above brings them in with the codebases.
  const accountsPlatforms = createAccountsPlatforms({ dir: path.join(o.dir, '..'), log: o.log, open: o.accountsDbOpen })
  const codebaseImport = createCodebaseImport({ proxy: crmProxy, dir: path.join(o.dir, '..'), log: o.log, open: o.accountsDbOpen })
  // F-126: the CRM's files in this app, and this PC's mount of them (the drive comes back by itself if it was on).
  const crmFiles = createCrmFilesModule({ dir: o.dir, proxy: crmProxy, root: path.resolve(import.meta.dirname, '..', '..'), mountDriver: o.crmFilesMountDriver, log: o.log, viewerSession: o.auth ? h => o.auth!.viewerCrm(h) : undefined })
  // Order o5dc4: the Browser: one headless Chrome/Edge on this PC, started only when asked (agent/browser/host.ts), its own profile under <agentic>/browser.
  const browser = createBrowserHost({ dir: path.join(o.dir, 'browser'), log: line => o.log?.info(line) })
  void crmFiles.resume().catch(() => undefined)
  // Order ofedf: the Claude usage, reported to the CRM the way the old app did (usage/usage.ts): every Claude chat's cost per person, per hour,
  // and Claude's own 5-hour and week limits per account, each sent with the person's own CRM login. Off with the status line (SAD_CLAUDE_USAGE=0).
  const usage: Usage | null = o.auth && usageOn ? createUsage({ dir: o.dir, auth: o.auth, proxy: crmProxy, build: () => { const v = o.currentBuild?.(); return v ? { id: buildIdOf(v), label: os.hostname().slice(0, 120) } : null }, log: o.log, onError: m => o.log?.warn(m) }) : null
  if (usage && !process.env.NODE_TEST_CONTEXT) usage.start()
  // F-211 stage 1 (orders obd04, o7472): every floor chat's conversation goes, one way, into the CRM drive's project "Conversations" as plain JSONL parts and a manifest
  // (conversations.ts). Only the hub (or a PC on its own) sends: it holds every PC's copy (F-021). Its own uploads engine (its own waiting folder: the page's uploads list never
  // shows these), and these files are never shared by link. Off: SAD_CONV_DRIVE=0, or <state>/agent/conversations-drive.off; never by itself inside a test run.
  const convUploads = createCrmUploads({
    dir: path.join(o.dir, 'conversations', 'pending'),
    backend: { ...crmFiles.service.uploadBackend, finish: p => crmFiles.service.uploadBackend.finish({ ...p, share: false }) },
    parallel: 2,
    log: o.log,
  })
  void convUploads.start().catch(e => o.log?.warn(`conversations: the waiting folder could not be read (${e instanceof Error ? e.message : String(e)})`))
  const quickHistory = createQuickHistory(o.dir, SBSKRRT_OWNER.id)
  const assistantNativeHistory = createAssistantNativeHistory(o.dir)
  const conversations = createConversations({
    dir: path.join(o.dir, 'conversations'),
    sessions: () => conversationSessions(),
    fileOf: sid => historyFile(sid),
    drive: {
      children: id => crmFiles.service.children(id),
      folder: (parent, name) => crmFiles.service.folder(parent, name),
      async createProject(name) {
        const r = await crmProxy.request('POST', 'org/projects', { json: { name, description: "Every chat's conversation (its JSONL), copied by the Agentic app (F-211)." } })
        await r.body?.cancel().catch(() => undefined)
        if (!r.ok) throw new Error(`the CRM did not make the project "${name}" (${r.status})`)
      },
    },
    uploads: convUploads,
    on: () => (o.conversationsDrive ?? !process.env.NODE_TEST_CONTEXT) && mode() !== 'member' && process.env.SAD_CONV_DRIVE !== '0' && !existsSync(path.join(o.dir, '..', 'conversations-drive.off')),
    signedIn: () => crmProxy.session().signedIn,
    ...(o.conversationsTickMs !== undefined ? { tickMs: o.conversationsTickMs } : {}),
    log: o.log,
  })

  // F-051: the memory layer, kept on the hub (or a PC on its own); a member's chats reach it
  // through the hub, as their tool calls do. Started with the agent when main.ts says so, else
  // at first use; meaning (the embedding model) only when main.ts turns it on.
  // oc65c S1 (the owner key): one layer per PERSON (memory-people.ts), made when it is first asked for. Only the owner's exists: at the folders it
  // has always had, with the texts it has always made and the floors it has always seen.
  // oc65c S2 (the one door): EVERY way to a layer, or to its brief, goes through the functions of this block (routeLayer, chatLayer, memoryBrief and
  // the start-up), and each asks "whose memory?" and answers from that person's layer or from none. Outside this block those names, memoryPeople and
  // quickMayUseMemory may appear ONLY as a call at a marked site, each marker (`memory-door` and an ID) naming a row of the door x person matrix that
  // memory-doors.test.ts holds, with an exact count of sites per row: a call with no marker, a marker with no call, an alias, a destructuring or
  // the name passed as a value is a RED test, so a NEW door goes in the matrix before it merges (Lead's rule, 18 Nov 2026).
  // memory-gate: begin
  // The guard (Lead's ruling, 18 Nov 2026): the memory is offered only while the app owner is the ONLY administrator. An administrator is owner-equivalent in
  // the chat plane (access.ts mayType, chatRights): they can type "search the memory for X" into his chat and read the recalled text in its transcript. Asked at
  // every scope(); the live list has one administrator (the app cannot add one: only a hand edit of auth.json), so today it changes nothing.
  let guardWarned = false
  const memoryEnabled = (): boolean => {
    const ok = adminsAreOnlyTheOwner(o.auth?.admins() ?? [SBSKRRT_OWNER.id], SBSKRRT_OWNER.id)
    if (!ok && !guardWarned) {
      guardWarned = true
      log?.warn('memory: switched off for everybody while another administrator exists (auth.json admins): an administrator can type into his chats and read what was recalled there')
    }
    return ok
  }
  const memoryPeople = createMemoryPeople({
    dir: o.dir,
    appOwner: SBSKRRT_OWNER,
    // Tests only, until other people's memory is built (S9): without it only the app owner has a layer.
    allowOthers: o.memory?.allowOthers,
    enabled: memoryEnabled,
    make: (person, home) =>
      createMemoryLayer({
        dir: o.dir,
        home: home.layerDir,
        wikiDir: home.wikiDir,
        person,
        // A person's own memory starts from "learns only what they tell it" (his answer, 18 Nov: A). The owner's saved settings are untouched.
        settings: home.legacy ? undefined : { fromChats: false, pastChats: false },
        modelsDir: path.join(o.dir, '..', 'models'),
        notes: id => memory.all(id),
        // S4 (feeding by owner): the chats that feed this memory are the ones the person OWNS (no owner on record: the app owner's), that nobody else can type into and that are not
        // PC Control chats; the notes read are those of the floors that are wholly theirs. The owner's layer is no exception any more (it was every floor's).
        floors: () => feedFloors(floors.list(), person.id, SBSKRRT_OWNER.id),
        noteFloors: () => noteFloors(floors.list(), person.id, SBSKRRT_OWNER.id),
        // Agent 14's F2: the chats that do not feed are not read, but their read position stays at the end of their files (no other person's words, no backlog of a chat that changed hands).
        unfedFloors: () => unfedFloors(floors.list(), person.id, SBSKRRT_OWNER.id),
        transcript: sid => findTranscript(sid, projectsDir),
        projectsDir,
        // S3: the Claude Code memory files are read only from the project folders that are his own and that no other person's chat runs in (no sweep of every project).
        // A person's layer reads none until S9 says whose folders are theirs.
        memoryProjects: home.legacy ? () => ownProjects(floors.list(), person.id, SBSKRRT_OWNER.id, sid => claudeTranscript(sid, projectsDir), a => engineFor(a) === 'claude' && (!a.homePc || a.homePc === self().id)) : undefined,
        token: o.token,
        claude: () => o.claude ?? findClaude(),
        log,
        embedder: o.memory?.embedder ?? (o.memory?.meaning ? undefined : noMeaning()),
        timers: o.memory?.timers,
        claudeArgs: o.memory?.claudeArgs,
        active: () => mode() !== 'member',
        live: !!o.memory?.start,
      }),
  })
  /** Each layer is started once, at its first use (its wiki, its index, its timers): here, where this PC keeps the memory. */
  const layersStarted = new WeakMap<MemoryLayer, Promise<void>>()
  async function startedLayer(layer: MemoryLayer): Promise<MemoryLayer> {
    let started = layersStarted.get(layer)
    if (!started) layersStarted.set(layer, (started = layer.start()))
    await started
    return layer
  }
  /**
   * One WARN per (code, who, where) per hour, in the denial log's own format (`auth <status> <code>: <who> <where>`), with the memory's own codes (AuthErrorCode has none
   * of them, so auth.deny is not used): his own Memory tab polls every 15 s, and an unlimited line would bury the real ones (Agent 3's read).
   */
  const memoryDenials = new Map<string, number>()
  function whoIs(c: Caller): string {
    return c.person ? `${c.person.username} (${c.person.id.slice(0, 8)})` : `nobody signed in (${c.via})`
  }
  function logMemoryDenial(status: number, code: string, who: string, where: string) {
    const key = `${code}|${who}|${where}`
    const now = Date.now()
    const last = memoryDenials.get(key)
    if (last !== undefined && now - last < 3_600_000) return
    if (memoryDenials.size >= 200) memoryDenials.clear()
    memoryDenials.set(key, now)
    log?.warn(`auth ${status} ${code}: ${who} ${where}`)
  }
  /**
   * PAGE and API doors: the layer of the CALLER'S OWN person (access.ownerOf: the open app and the PC's own program are the app owner). No route takes a person
   * from its path, query or body. Asked BEFORE anything is made or started: a caller who has no memory (anyone but the app owner until S9; everybody while another
   * administrator exists) gets 409 (code memory-others-not-built or memory-admins), and the refusal is LOGGED, once an hour per person and route.
   */
  async function routeLayer(r: MountRequest): Promise<MemoryLayer> {
    const caller = callerOf(r)
    const scope = memoryPeople.scope(access.ownerOf(caller))
    if (!scope) {
      const refusal = memoryPeople.refusal()
      logMemoryDenial(409, refusal.code, whoIs(caller), `${r.method} ${AGENT_API_PREFIX}${AGENTIC_PREFIX}${r.rest}`)
      throw refusal
    }
    return startedLayer(memoryPeople.layer(scope))
  }
  /**
   * CHAT doors (a tool, the recall hook): the STARTED layer of the chat's OWNER (chatMemoryPerson), or null: none (a chat shared with other people, a person with
   * no memory yet, an owner id that is not a person id, another administrator exists: never a throw). The caller's administrator flag plays no part here (each tool
   * keeps its own administrator test as it was: an ownerless agent, whose caller is the open one, still gets nothing there). `quick`: set only by Quick's own calls
   * (fastCall -> toolFor): its talker decides (quickMayUseMemory: the layer is offered to the app owner talking on a web page, never to a phone or anyone else).
   */
  async function chatLayer(agent: FloorAgent, quick?: { talker: QuickTalker | null }): Promise<MemoryLayer | null> {
    const person = chatMemoryPerson(agent, SBSKRRT_OWNER)
    if (!person) return null
    if (quick && !quickMayUseMemory(quick.talker, SBSKRRT_OWNER.id)) return null
    const scope = memoryPeople.scope(person)
    return scope ? startedLayer(memoryPeople.layer(scope)) : null
  }
  /** What Quick says when its layer is withheld (memory_read): the owner is never told "That tool is for the owner of this app" on his own phone. */
  function quickDenied(talker: QuickTalker | null): Error & { status: number; code: string } {
    if (!talker) return Object.assign(apiError(403, 'Nobody holds Quick right now, so its memory is not offered.'), { code: 'memory-quick-nobody' })
    if (talker.kind === 'phone') return Object.assign(apiError(403, "Quick's memory is not offered on the phone yet: the phone cannot say who is talking."), { code: 'memory-quick-phone' })
    return Object.assign(apiError(403, "Quick's memory is for the app owner, on his own page."), { code: 'memory-quick-talker' })
  }
  /**
   * What a chat door that refuses (memory_read) says, and LOGS (once an hour per chat and tool): a shared chat in its own words, another administrator's presence in
   * its own, Quick's talker in its own, anyone else the owner-only answer a person who is not the owner gets.
   */
  function memoryDenied(agent: FloorAgent, name: string, quick?: { talker: QuickTalker | null }): Error {
    let e: Error & { status: number; code?: string }
    if (chatIsShared(agent)) e = Object.assign(apiError(403, "This chat is shared with other people, so the app's memory is off for it until that ends."), { code: 'memory-shared-chat' })
    else if (!memoryEnabled()) e = memoryPeople.refusal()
    else if (quick && !quickMayUseMemory(quick.talker, SBSKRRT_OWNER.id)) e = quickDenied(quick.talker)
    else e = authError(403, 'That tool is for the owner of this app.', 'admin-only')
    const who = agent.owner ? `${agent.owner.username} (${agent.owner.id.slice(0, 8)})` : 'a chat with no owner on record'
    logMemoryDenial(e.status, e.code ?? 'memory-refused', who, `tool ${name}${agent.sessionId ? ` chat ${agent.sessionId.slice(0, 8)}` : ''}`)
    return e
  }
  /** Switched on (main.ts): the chats get it (recall, the brief's section, memory_read, hits). Off, the Memory tab still can. */
  const memoryOn = !!o.memory?.start
  // memory-door: I1 (the app's own start-up of the owner's layer, and so of its timers, when the memory is switched on)
  const startScope = memoryOn && mode() !== 'member' ? memoryPeople.scope(SBSKRRT_OWNER) : null
  if (startScope) void startedLayer(memoryPeople.layer(startScope)).catch(e => log?.warn(`memory: couldn't start: ${message(e)}`))
  /** F-051, on a member: the hub's memory section for its chats' briefs, as last fetched. */
  let memberBrief = ''
  /**
   * A member asks the hub for the section and keeps what it is told. Agent 14's F3 and Agent 3's log count (read in source and in the Server's logs, 18 Nov):
   * the request carries no person, so the hub takes it for the open caller, which is NOT an administrator once a sign-in is wired (production always has one),
   * and REFUSES it (403, before the handler): a member's chats have always had an empty section, the fetch never shows the layer to anyone and never starts it
   * (the owner's own Memory tab does). It is asked only while the memory is switched on (the timer below), which ends about 576 warning lines a day and changes
   * nothing else. NEVER repair it by letting that request through: a member's section is built per chat, through the `tool` link kind (S5).
   */
  // memory-door: B5 (the member's fetch of GET /memory/brief)
  function refreshMemberBrief(): string {
    const link = team?.hub()?.link
    if (link)
      void request<{ text: string }>(link, 'http', { method: 'GET', rest: '/memory/brief', query: '', body: undefined })
        .then(r => (memberBrief = typeof r?.text === 'string' ? r.text : memberBrief))
        .catch(() => {})
    return memberBrief
  }
  /** The memory section of ONE chat's brief (B1-B4 of the matrix): its owner's, or '' for a chat that is shared or whose owner has no memory. Read once, at the chat's start. */
  function memoryBrief(agent: FloorAgent): string {
    const person = chatMemoryPerson(agent, SBSKRRT_OWNER)
    const scope = person ? memoryPeople.scope(person) : null
    if (!scope) return ''
    if (mode() !== 'member') return memoryPeople.layer(scope).brief()
    // On a member the only section there is to ask for is the app owner's: only a chat of his asks for it.
    return scope.person.id.toLowerCase() === SBSKRRT_OWNER.id ? refreshMemberBrief() : ''
  }
  // A member keeps its copy fresh, so a chat started there has the hub's latest: only while the memory is switched on (the hub refuses the fetch today: see above).
  const memberBriefTimer = setInterval(() => {
    if (memoryOn && mode() === 'member') refreshMemberBrief()
  }, 5 * 60_000)
  memberBriefTimer.unref()
  // memory-gate: end

  // ---------------------------------------------------------------------------------------
  // F-021 state: on the hub, who holds what and its members' live chats; on a member, the copy

  const held = new Map<string, Held>(loadHeld())
  const remote = new Map<string, { name: string; live: Record<string, ChatState> }>()
  const subs = new Map<string, Duplex>()
  let replica: Replica = loadReplica()
  /** F-302 L4: the Server's state frame says it judges the person a member's terminal stream names (terminalJudgesPerson: 1); a member sends the claim only to a Server that said so (an older Server ignores it anyway). */
  let hubJudgesTerminal = false
  /** `gen`: this subscription's generation (one more at each new stream), so a judgement or a freshness of an older one never counts for it. */
  let sub: { token: object; stream: Duplex; gen: number } | null = null
  let subGen = 0
  /**
   * Order o7e6d S1 (Agent 3's M1, Lead's S-a decision): the copy of the Server's floors is FRESH only once a well-formed `state` frame was
   * taken from the CURRENT subscription stream, of the Server this PC is joined to now, over the link it is joined by now (its token), in this
   * generation: an open stream is not freshness, and the copy read from replica.json at the start never is. With it, the Server's own classes
   * of its agents (staff / admin / other, judged with the Server's sign-in; M3), sent in that same frame over the PC link only. Cleared at once
   * when that stream closes or errs, the subscription is dropped, the link changes or this PC stops being a member, and by a frame it can't use.
   */
  let fresh: {
    stream: Duplex
    token: object
    hubId: string
    gen: number
    classes: Map<string, StaffClass> | null
    /** Orders of95c / o9ccb / ocf0e: the Server's choice of who may type where, from that same frame (null from an older Server, or a bad one). */
    typing: StaffTyping | null
  } | null = null
  /** The current subscription's stream, over the link this PC is joined by now (M2): only its frames change anything here. */
  function currentStream(link: LinkPeer, stream: Duplex): boolean {
    if (mode() !== 'member' || !sub || sub.stream !== stream || sub.token !== link.token) return false
    const h = team?.hub()
    return !!h && h.id === link.id && !!h.link && h.link.token === link.token
  }
  function replicaIsFresh(): boolean {
    const f = fresh
    if (mode() !== 'member' || !f || !sub || f.stream !== sub.stream || f.gen !== sub.gen || f.token !== sub.token) return false
    const h = team?.hub()
    return !!h && h.id === f.hubId && !!h.link && h.link.token === f.token
  }
  let subscribing = false
  // F-127: when this member lost its Server (null while it has it), and the debounce after which new chats are made here.
  let downSince: number | null = null
  const offlineAfter = o.offlineAfterMs ?? OFFLINE_AFTER_MS
  const offlineActive = () => mode() === 'member' && offlineSettings.on() && sub === null && downSince !== null && Date.now() - downSince >= offlineAfter
  /** F-127: new floors and chats on this PC use this PC's own Claude sign-in (F-007); without one they are refused, plainly, before anything is made. */
  function needClaudeHere() {
    if (o.token && !o.token()) throw Object.assign(apiError(409, "Sign in to Claude on this PC first (Settings › Devices): new chats made here while the Server is down use this PC's own Claude sign-in."), { code: 'no-claude' })
  }

  function loadHeld(): [string, Held][] {
    try {
      const raw: unknown = JSON.parse(readFileSync(heldFile, 'utf8'))
      if (!isObject(raw)) return []
      return Object.entries(raw).flatMap(([sid, v]) => {
        if (!isObject(v)) return []
        const last = isObject(v.last) && typeof v.last.pc === 'string' && typeof v.last.at === 'string' ? { pc: v.last.pc, at: v.last.at } : null
        // A holder from before a restart is kept: its PC may still be running the chat.
        const holder = typeof v.holder === 'string' ? v.holder : null
        return [[sid, { holder, holderName: typeof v.holderName === 'string' ? v.holderName : null, heldAt: 0, last }] as [string, Held]]
      })
    } catch {
      return []
    }
  }
  const saveHeld = () => writeAtomic(heldFile, `${json(Object.fromEntries([...held].map(([sid, h]) => [sid, { holder: h.holder, holderName: h.holderName, last: h.last }])))}\n`)

  function loadReplica(): Replica {
    try {
      const raw = JSON.parse(readFileSync(replicaFile, 'utf8')) as Partial<Replica>
      return { floors: Array.isArray(raw.floors) ? raw.floors : [], defaults: parseDefaults(raw.defaults), where: {}, last: isObject(raw.last) ? (raw.last as Record<string, ChatLast>) : {}, marks: {} }
    } catch {
      return { floors: [], where: {}, last: {}, marks: {} }
    }
  }
  let replicaTimer: NodeJS.Timeout | null = null
  function saveReplica() {
    if (replicaTimer) return
    replicaTimer = setTimeout(() => {
      replicaTimer = null
      writeAtomic(replicaFile, `${json({ floors: replica.floors, defaults: replica.defaults, last: replica.last })}\n`)
    }, 500)
    replicaTimer.unref()
  }

  // ---------------------------------------------------------------------------------------
  // Floors, as this PC sees them

  /** The floors: the hub's own, or, on a member, the hub's with this PC's folder as codeDir. */
  function allFloors(): Floor[] {
    if (mode() !== 'member') return floors.list()
    const me = self().id
    const theirs = replica.floors.map(f => ({ ...f, codeDir: f.folders?.[me] ?? null }))
    // F-127: this PC's own floors the Server does not have yet (once it has one, it is the Server's: the copy here is dropped from the list).
    const have = new Set(theirs.map(f => f.id))
    const mine = localFloors.list().filter(f => !have.has(f.id)).map(f => ({ ...f, local: true }))
    return checkedPcControlNamespace([...mine, ...theirs])
  }

  /** F-127: a floor made on this PC that the Server does not have yet (it is run here, whatever the link says). */
  const isLocalFloor = (id: string) => mode() === 'member' && localFloors.get(id) !== null && !replica.floors.some(f => f.id === id)
  const isLocalSession = (sid: string) => mode() === 'member' && localFloors.bySession(sid) !== null && !replica.floors.some(f => f.agents.some(a => a.sessionId === sid))

  function floorOf(id: string): Floor {
    const f = allFloors().find(x => x.id === id)
    if (!f) { pickFloors().get(id); throw apiError(404, 'No such floor') }
    return f
  }

  function agentOf(floor: Floor, id: string): FloorAgent {
    const a = floor.agents.find(x => x.id === id)
    if (!a) throw apiError(404, 'No such agent on this floor')
    return a
  }

  function bySession(sid: string): { floor: Floor; agent: FloorAgent } | null {
    // A quarantined persisted profile must not become an unbound legacy-Claude session.
    const own = pickFloors().bySession(sid)
    // The Server's stalls (profile, 16 Nov): on the hub, allFloors() deep-copied EVERY floor for each lookup of ONE chat, and GET /runs did that twice per agent
    // per request. The hub's answer is the same here without the copy: the same two stores in the same order (this PC's floors, then PC Control), the same
    // collision check (checkedPcControlNamespace throws before any answer, as allFloors() did), the same null; only the floor found is copied. The rows are
    // read ONLY through the facade's floors.rows(), looked up at each call (Agent 12's review: "floors unreadable" in a test must reach this lookup too). A member
    // keeps the old way: its floors are the replica's (codeDir = this PC's folder), which no store holds; so does a store without rows().
    if (mode() !== 'member' && pickFloors().rows && controlFloors.store.rows && floors.rows) {
      const rows = floors.rows()
      checkedPcControlNamespace([...rows])
      if (own) return { floor: own.floor, agent: own.floor.agents.find(a => a.sessionId === sid) ?? own.agent }
      // No floor of this PC's store has the chat (its own lookup said so), so the first hit in the rows is PC Control's, in its order.
      for (const f of rows) {
        if (!f.agents.some(a => a.sessionId === sid)) continue
        const floor = structuredClone(f)
        return { floor, agent: floor.agents.find(a => a.sessionId === sid)! }
      }
      return null
    }
    for (const floor of allFloors()) {
      const agent = floor.agents.find(a => a.sessionId === sid)
      if (agent) return { floor, agent }
    }
    return null
  }

  const validTransferSid = (id: string) => /^[0-9a-zA-Z-]{8,64}$/.test(id)
  const sameControlId = (a: string | null | undefined, b: string) => a === b || (typeof a === 'string' && UUID_RE.test(a) && UUID_RE.test(b) && a.toLowerCase() === b.toLowerCase())
  const controlBindingMatches = (a: Floor['agents'][number], id: string) =>
    [a.sessionId,a.codexThread,a.opencodeSession].some(v => sameControlId(v,id)) ||
    !!a.conversationHistory?.some(h => [h.sessionId,h.codexThread,h.opencodeSession].some(v => sameControlId(v,id)))
  // Protected UUID aliases cannot bypass exact-key leases or conversion fences.
  const validMirrorSid = (id: string) => validTransferSid(id) && !(UUID_RE.test(id) && id !== id.toLowerCase() && controlPinnedPc(id))
  function controlPinnedPc(id: string): string | null {
    return allFloors().filter(isPcControl).find(f => sameControlId(f.id,id) || f.agents.some(a =>
      sameControlId(a.id,id) || controlBindingMatches(a,id)))?.targetPcId ?? null
  }
  const controlAlias = (id: string) => controlPinnedPc(id) !== null

  /** Captured before I/O and rechecked by the writer after every async transfer boundary. */
  function controlTransferGuard(peer: LinkPeer, sid: string): () => void {
    const execution = bySession(sid)
    if (execution) requireLegacyExecution(execution.agent, defaultsNow())
    if (!validMirrorSid(sid)) throw apiError(400, 'Expected a canonical session id')
    const proof = () => {
      const pin = controlPinnedPc(sid)
      if (!pin) return null
      const floor = allFloors().filter(isPcControl).find(f => f.agents.some(a => controlBindingMatches(a,sid)))
      const agent = floor?.agents.find(a => controlBindingMatches(a,sid))
      if (!floor || !agent) throw immutablePcControl()
      const hub = team?.hub()
      const mirrorFromHub = mode() === 'member' && pin === self().id && peer.id === hub?.id && peer.token === hub.link?.token && !chats.info(sid)
      if (peer.id !== pin && !mirrorFromHub) throw pcControlError('pc-control-wrong-device', 'Only the pinned PC can supply this managed conversation.')
      const current = mode() === 'member' ? hub?.link : team?.member(peer.id)
      if (!current || current.token !== peer.token) throw pcControlError('pc-control-stale', 'The source PC connection changed before history transfer.')
      return JSON.stringify([floor.id,pin,controlGeneration(agent)])
    }
    const captured = proof()
    return () => { if (proof() !== captured) throw pcControlError('pc-control-stale', 'The managed conversation changed while history transfer was queued.') }
  }

  function assertPcControlTarget(floor: Floor, target: string, req: { here?: boolean; takeOver?: boolean }) {
    if (!isPcControl(floor)) return
    if (target !== floor.targetPcId || req.here || req.takeOver) throw pcControlError('pc-control-wrong-device', 'This chat is pinned to its registered PC. Takeover and fallback are unavailable.')
    const live = whereAll()
    for (const a of floor.agents) if (a.sessionId && live[a.sessionId] && live[a.sessionId].id !== floor.targetPcId) {
      throw pcControlError('pc-control-wrong-device', 'A conflicting runtime exists on another PC. Nothing was stopped or moved.')
    }
    for (const a of floor.agents) if (a.sessionId && held.get(a.sessionId)?.holder && held.get(a.sessionId)!.holder !== floor.targetPcId) throw pcControlError('pc-control-wrong-device', 'A conflicting lease exists on another PC. Nothing was stopped or moved.')
  }

  function guardPcControlRoute(r: MountRequest, params: string[]) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) || r.rest.startsWith('/pc-control')) return
    if (!/^\/floors(?:\/|$)/.test(r.rest)) return
    // Sending is subject to the existing typing ACL and pinned launch guards, not workspace editing.
    if (r.method === 'POST' && /^\/floors\/[^/]+\/agents\/[^/]+\/say(?:-direct)?$/.test(r.rest)) return
    const id = params[0], f = id ? allFloors().find(f => f.id === id) : null
    if (isPcControl(f)) throw immutablePcControl()
    if (isObject(r.body)) {
      const body = r.body
      if (r.body.workspace === 'pc-control' || r.body.pcControlSlot !== undefined ||
          (typeof body.floorId === 'string' && isPcControl(allFloors().find(f => f.id === body.floorId))) ||
          [r.body.sessionId, r.body.codexThread, r.body.opencodeSession].some(x => typeof x === 'string' && controlAlias(x)) ||
          (Array.isArray(body.agents) && body.agents.some(a => isObject(a) && [a.id,a.sessionId,a.codexThread,a.opencodeSession].some(x => typeof x === 'string' && controlAlias(x)))) ||
          (Array.isArray(r.body.order) && r.body.order.some(x => typeof x === 'string' && isPcControl(allFloors().find(f => f.id === x))))) throw immutablePcControl()
    }
  }

  const controlCapabilities = new Map<string, PcControlCapability | null>()
  const controlRuntimes = new Map<string, { generation: string; token: object; at: number; runtime: PcControlSlot['runtime'] }>()
  const controlGeneration = (a: FloorAgent) => JSON.stringify([a.id, a.sessionId, a.codexThread ?? null, a.opencodeSession ?? null])
  const controlDeviceCatalogue = (): PcControlKnownDevice[] => o.pcControlDevices?.() ?? [{ ...self(), online: true }]
  function scopePcControl(answer: PcControlAnswer, c: Caller): PcControlAnswer {
    return { workspaces: answer.workspaces.flatMap(w => {
      const agents = w.floor.agents.flatMap(a => {
        const rights = access.rights(c, a)
        if (!rights) return []
        return [{ ...a, ...rights, sharedWith: rights.can === 'owner' ? a.sharedWith : [] }]
      })
      if (!agents.length) return []
      const allowed = new Map(agents.map(a => [a.id, a]))
      return [{ ...w, floor: { ...w.floor, agents }, slots: w.slots.map(s => {
        const a = s.agentId ? allowed.get(s.agentId) : null
        return a ? { ...s, agent: a, canOpen: s.canOpen && a.can !== 'view', canChangeEngine: s.canChangeEngine && a.can === 'owner' }
          : { number: s.number, agentId: null, agent: null, runtime: null, canOpen: false, canChangeEngine: false }
      }) as PcControlWorkspace['slots'] }]
    }) }
  }
  function controlRawAnswer(): PcControlAnswer {
    if (mode() === 'member' && replica.pcControl) return replica.pcControl
    const known = new Map(controlDeviceCatalogue().map(d => [d.id, d]))
    return { workspaces: allFloors().filter(isPcControl).map(f => {
      const d = known.get(f.targetPcId) ?? { id: f.targetPcId, name: f.name, online: false }
      const cap = d.id === self().id ? { version: 1 as const, pinnedWorkspace: true as const, actualEngineProof: true as const, engines: ['claude', 'codex'] as ('claude'|'codex')[] } : controlCapabilities.get(d.id) ?? null
      const device = { ...d, capability: cap, unavailable: !d.online ? 'offline' as const : !cap ? 'update-required' as const : null }
      return { device, floor: f, revision: pcControlRevision(f), slots: ([1,2] as const).map(number => {
        const agent = f.agents.find(a => a.pcControlSlot === number)!
        const info = agent.sessionId ? chats.info(agent.sessionId) : null
        const proof = controlRuntimes.get(`${d.id}:${agent.id}`)
        const remoteRuntime = d.online && proof?.generation === controlGeneration(agent) && proof.token === team?.member(d.id)?.token && Date.now() - proof.at < 10_000 ? proof.runtime : null
        const runtime = d.id !== self().id ? remoteRuntime : info && (info.engine === 'claude' || info.engine === 'codex') ? { engine: info.engine, startedAt: info.startedAt, state: info.state } : null
        return { number, agentId: agent.id, agent, runtime, canOpen: device.unavailable === null, canChangeEngine: device.unavailable === null }
      }) as PcControlWorkspace['slots'] }
    }) }
  }
  async function requirePcControlPeer(link: LinkPeer) {
    let cap: unknown
    try { cap = await request(link, 'pc-control-capabilities', {}, 5000) } catch { cap = null }
    if (!isObject(cap) || cap.version !== 1 || cap.pinnedWorkspace !== true || cap.actualEngineProof !== true || !Array.isArray(cap.engines) || !cap.engines.includes('claude') || !cap.engines.includes('codex')) {
      controlCapabilities.set(link.id, null)
      throw pcControlError('pc-control-update-required', `${link.name} needs an app update before PC Control can start a chat.`)
    }
    controlCapabilities.set(link.id, cap as unknown as PcControlCapability)
  }
  function localControlRuntime(raw: unknown) {
    if (!isObject(raw) || typeof raw.floorId !== 'string' || !Array.isArray(raw.slots) || raw.slots.length > 2 || Object.keys(raw).some(k => !['floorId','slots'].includes(k))) throw apiError(400, 'Expected managed runtime bindings.')
    const f = floorOf(raw.floorId)
    if (!isPcControl(f)) throw immutablePcControl()
    assertPcControlTarget(f, self().id, {})
    const ids = new Set<string>()
    const slots = raw.slots.map(x => {
      if (!isObject(x) || typeof x.agentId !== 'string' || typeof x.generation !== 'string' || Object.keys(x).some(k => !['agentId','generation'].includes(k)) || ids.has(x.agentId)) throw apiError(400, 'Expected unique managed slots.')
      ids.add(x.agentId)
      const a = agentOf(f, x.agentId)
      if (x.generation !== controlGeneration(a)) throw pcControlError('pc-control-stale', 'The target conversation changed. Refresh PC Control.')
      const info = a.sessionId ? chats.info(a.sessionId) : null
      if (info && (info.floorId !== f.id || info.agentId !== a.id || !['claude','codex'].includes(info.engine))) throw pcControlError('engine-runtime-mismatch', 'The target runtime does not belong to this managed slot.')
      return { agentId: a.id, generation: x.generation, runtime: info ? { engine: info.engine, startedAt: info.startedAt, state: info.state } : null }
    })
    return { pcId: self().id, floorId: f.id, slots }
  }
  async function refreshControlRuntime(link: LinkPeer, w: PcControlWorkspace) {
    const slots = w.floor.agents.map(a => ({ agentId: a.id, generation: controlGeneration(a) }))
    const raw = await request<unknown>(link, 'pc-control-runtime', { floorId: w.floor.id, slots }, 5000)
    if (!isObject(raw) || raw.pcId !== link.id || raw.floorId !== w.floor.id || !Array.isArray(raw.slots) || raw.slots.length !== slots.length || team?.member(link.id)?.token !== link.token) throw pcControlError('pc-control-update-required', 'The target did not provide a current managed runtime proof.')
    const checked = new Map<string, PcControlSlot['runtime']>()
    for (const x of raw.slots) {
      if (!isObject(x) || typeof x.agentId !== 'string' || checked.has(x.agentId) || !slots.some(s => s.agentId === x.agentId && s.generation === x.generation)) throw pcControlError('pc-control-stale', 'The target runtime proof belongs to a different conversation.')
      const runtime = x.runtime
      if (runtime !== null && (!isObject(runtime) || !['claude','codex'].includes(String(runtime.engine)) || typeof runtime.startedAt !== 'string' || !Number.isFinite(Date.parse(runtime.startedAt)) || !['idle','running','question'].includes(String(runtime.state)))) throw pcControlError('pc-control-update-required', 'The target returned malformed runtime proof.')
      checked.set(x.agentId, runtime as PcControlSlot['runtime'])
    }
    const current = floorOf(w.floor.id)
    for (const s of slots) if (!current.agents.some(a => a.id === s.agentId && controlGeneration(a) === s.generation)) throw pcControlError('pc-control-stale', 'The conversation changed while its runtime was checked.')
    for (const s of slots) controlRuntimes.set(`${link.id}:${s.agentId}`, { generation: s.generation, token: link.token, at: Date.now(), runtime: checked.get(s.agentId)! })
  }
  async function controlAnswer(c: Caller): Promise<PcControlAnswer> {
    if (mode() !== 'member') {
      const devices = controlDeviceCatalogue()
      const workflow = pickFloors().list()
      const bindings = (a: FloorAgent) => [a.id, a.sessionId, a.codexThread, a.opencodeSession, ...(a.conversationHistory ?? []).flatMap(h => [h.sessionId, h.codexThread, h.opencodeSession])].filter((x): x is string => typeof x === 'string')
      const ids = new Set(workflow.flatMap(f => [f.id, ...f.agents.flatMap(bindings)]))
      for (const f of controlFloors.store.list()) if (ids.has(f.id) || f.agents.some(a => bindings(a).some(x => ids.has(x)))) throw immutablePcControl()
      controlFloors.ensure(devices)
    }
    const scoped = scopePcControl(controlRawAnswer(), c)
    await Promise.all(scoped.workspaces.map(async w => {
      if (!w.device.online || w.device.id === self().id) return
      const link = team?.member(w.device.id)
      if (link) await requirePcControlPeer(link).then(() => refreshControlRuntime(link, w)).catch(() => {
        controlCapabilities.set(link.id, null)
        for (const a of w.floor.agents) controlRuntimes.delete(`${link.id}:${a.id}`)
      })
    }))
    return scopePcControl(controlRawAnswer(), c)
  }

  const controlMutations = new Map<string, Promise<unknown>>()
  function controlMutate(device: string, agentId: string, action: string, r: MountRequest) {
    const pending = (controlMutations.get(device) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const c = callerOf(r), raw = r.body
      if (!isObject(raw) || Object.keys(raw).some(k => !['expected', ...(action === 'engine' ? ['engine','confirmNewConversation'] : [])].includes(k))) throw apiError(400, 'PC Control requires an exact expected snapshot.')
      const answer = await controlAnswer(c), w = answer.workspaces.find(w => w.device.id === device)
      if (!w) throw pcControlError('pc-control-forbidden', 'That PC workspace is unavailable to you.', 403)
      const f = floorOf(w.floor.id), a = agentOf(f, agentId)
      access.needChat(c, a, action === 'engine' ? 'owner' : 'type', 'PC Control')
      assertPcControlExpected(f, a, raw.expected)
      if (w.device.unavailable) throw pcControlError(w.device.unavailable === 'offline' ? 'pc-control-offline' : 'pc-control-update-required', `${w.device.name} is ${w.device.unavailable}. Nothing was started or moved.`, w.device.unavailable === 'offline' ? 424 : 409)
      assertPcControlTarget(f, device, {})
      if (action === 'engine') {
        if (!['claude','codex'].includes(String(raw.engine)) || (raw.confirmNewConversation !== undefined && raw.confirmNewConversation !== true)) throw apiError(400, 'Choose Claude or Codex.')
        if (raw.engine !== a.engine) await patchFloor(f.id, { agents: f.agents.map(x => x.id === a.id ? { ...x, engine: raw.engine } : x),
          confirmNewConversation: raw.confirmNewConversation, expectedConversation: { agentId: a.id, ...raw.expected } }, access.ownerOf(c))
      } else if (action === 'stop') {
        if (a.sessionId) await stopAt(device, a.sessionId)
      } else if (action === 'open') {
        const opened = device === self().id ? await openChat(f.id, a.id, {}, undefined, undefined, actorOfCaller(c)) : await openOnPeer(peerOf(device), f, a, undefined, terminalClaimLine(c, access.isAdmin(c)))
        const workspace = (await controlAnswer(c)).workspaces.find(w => w.device.id === device)!
        emit({ t: 'pc-control', answer: controlRawAnswer() })
        if (mode() !== 'member') pushState()
        return { workspace, opened }
      }
      emit({ t: 'pc-control', answer: controlRawAnswer() })
      return { workspace: (await controlAnswer(c)).workspaces.find(w => w.device.id === device)! }
    })
    controlMutations.set(device, pending)
    void pending.finally(() => { if (controlMutations.get(device) === pending) controlMutations.delete(device) }).catch(() => {})
    return pending
  }

  /** The floor's folder, made when it is the default one and missing. */
  function codeDirOf(floor: Floor): string {
    if (!floor.codeDir) {
      mkdirSync(defaultCodeDir, { recursive: true })
      return defaultCodeDir
    }
    if (!existsSync(floor.codeDir) || !statSync(floor.codeDir).isDirectory()) {
      throw apiError(409, `This floor's folder isn't there${mode() === 'member' ? ' on this PC' : ' any more'}: ${floor.codeDir}. Change it on the Preamble tab.`)
    }
    return floor.codeDir
  }

  // ---------------------------------------------------------------------------------------
  // F-134: the engine of an agent, and where a Codex chat's conversation is

  /** The engine an agent really runs: its own setting, else Settings › Chats'. */
  const engineFor = (agent: FloorAgent): 'claude' | 'codex' | 'opencode' => executionIdentityOf(agent, defaultsNow()).engine
  const isCodexSession = (sid: string): boolean => {
    const at = bySession(sid)
    return !!at && engineFor(at.agent) === 'codex'
  }
  const rolloutCache = new Map<string, string>()
  const switchFences = createSwitchFences(path.join(o.dir, 'engine-switches.json'))
  const activeSwitches = new Set<string>()
  const conversionProgress = createConversionProgress()
  const pullFrom = (peer: LinkPeer, sid: string, file: string) => {
    const guard = controlTransferGuard(peer, sid)
    guard()
    return pullTranscriptFrom(peer, sid, file, () => {
      if (switchFences.blocked(sid)) return false
      try { guard(); return true } catch { return false }
    })
  }
  const threadWatchers = new Map<string, () => void>()
  /** A Codex chat's rollout file, once its conversation id is known and the file is there; null for every other chat. */
  function codexRollout(sid: string): string | null {
    const at = bySession(sid)
    const thread = at && engineFor(at.agent) === 'codex' ? at.agent.codexThread : null
    if (!thread || !o.codex) return null
    const cached = rolloutCache.get(thread)
    if (cached && existsSync(cached)) return cached
    const found = findRollout(o.codex.paths.home, thread)
    if (found) rolloutCache.set(thread, found)
    else rolloutCache.delete(thread)
    return found
  }
  /** Every place that looks for a chat's conversation goes through this: a Codex chat's is its rollout, any other chat's is Claude's JSONL. */
  const isOpenCode = (sid: string) => { const at = bySession(sid); return !!at && engineFor(at.agent) === 'opencode' }
  // The Server's stalls (profile, 16 Nov): finding a Claude JSONL lists every project folder and asks each for the file (existsSync, on this thread), for every
  // chat, on every GET /runs: 8% of the thread. Where it was FOUND is remembered (a chat whose file is not there yet is never remembered: it appears later);
  // a remembered place is used only while that file is still there (one existsSync instead of one per folder: a moved file is looked for again at once) and for
  // CLAUDE_FILE_MS at most (a copy placed in another folder is found within that). The engine is still asked first, every time: an OpenCode or Codex chat, or
  // one that switched to such, never reads this.
  const CLAUDE_FILE_MS = 10_000
  const claudeFiles = new Map<string, { file: string; at: number }>()
  function claudeTranscript(sid: string, dir: string): string | null {
    const key = `${dir}\0${sid}`
    const hit = claudeFiles.get(key)
    if (hit && Date.now() - hit.at < CLAUDE_FILE_MS && existsSync(hit.file)) return hit.file
    claudeFiles.delete(key)
    const found = findClaudeTranscript(sid, dir)
    if (found) {
      if (claudeFiles.size >= 5_000) claudeFiles.clear()
      claudeFiles.set(key, { file: found, at: Date.now() })
    }
    return found
  }
  const findTranscript = (sid: string, dir: string): string | null => isOpenCode(sid) ? openCode.file(sid) : codexRollout(sid) ?? claudeTranscript(sid, dir)

  /** Where this PC keeps a session's JSONL, whether it has it yet or not. */
  function fileOf(sid: string): string {
    if (!validMirrorSid(sid)) throw apiError(400, 'Expected a canonical session id')
    if (isOpenCode(sid)) return openCode.mirror(sid)
    const found = findTranscript(sid, projectsDir)
    if (found) return found
    const at = bySession(sid)
    return transcriptPath(at?.floor.codeDir ?? defaultCodeDir, sid, projectsDir)
  }

  /**
   * Where a chat runs on this PC, and whether there is a conversation to resume: the floor's
   * folder; else the folder the conversation was held in, when it has one here; else (it came
   * from another PC, held in a folder this PC hasn't got) it is moved under the floor's folder.
   */
  function placeForRun(sid: string, folder: string): { cwd: string; resume: boolean } {
    const found = findTranscript(sid, projectsDir)
    if (!found) return { cwd: folder, resume: false }
    const dir = path.dirname(found)
    if (dir === path.join(projectsDir, encodeProjectPath(folder))) return { cwd: folder, resume: true }
    const cwd = findTranscriptCwd(sid, projectsDir)
    if (cwd && existsSync(cwd) && dir === path.join(projectsDir, encodeProjectPath(cwd))) return { cwd, resume: true }
    const to = transcriptPath(folder, sid, projectsDir)
    mkdirSync(path.dirname(to), { recursive: true })
    renameSync(found, to)
    return { cwd: folder, resume: true }
  }

  // ---------------------------------------------------------------------------------------
  // Chats on this PC, and their JSONL to the others

  let liveTimer: NodeJS.Timeout | null = null
  let lastLive = new Set<string>()
  // F-058: the list of open chats the next start will reopen (see resumeAll below).
  let recovery: Recovery | null = null
  let closing = false
  // F-069: the files sent to the chats that run on this PC (the page's photos, pictures and files).
  const uploads = createUploadStore(path.join(o.dir, 'uploads'))
  uploads.prune()
  // Order o16d2: the pictures and videos the agents show in their chats (show_media), served by unguessable id to the owner only.
  // Order o528e: and the CRM files they give (show_crm_file), read through this PC's own CRM files service.
  const mediaShelf = createMediaShelf({ file: path.join(o.dir, 'media.json'), crm: crmFiles.service })
  // F-078: every chat that stops or starts, and why (chat-log.ts): the pattern Shubham is told in the morning.
  const chatLog = createChatLog(path.join(o.dir, 'chat-events.jsonl'))
  /** Why the next start of a chat is happening, when it is not the usual (the heartbeat starting it again). */
  const startCause = new Map<string, string>()
  /** Who asked for the next start of a chat, when the asker said (openChat's `by`): written onto its start event, then forgotten. Absent is NOT "nobody": it is "not said here". */
  const startBy = new Map<string, ChatActor>()
  /** The `by` for a start event, taken once (a start site spreads it into its line): nothing when the asker did not say. */
  const startedBy = (sid: string): { by?: ChatActor } => {
    const by = startBy.get(sid)
    startBy.delete(sid)
    return by ? { by } : {}
  }
  // Who was present at a chat (chat-presence.ts): keys that reached a terminal (their CLASS, never the keys) and the screen an Assistant drove (the kind of act, never
  // what or where), one line per actor and class per minute. A line that cannot be written never stops the typing or the call: it is said in the log and told to the owner
  // once in the heartbeat (GET /chat-presence shows it too).
  const presence = createPresence({ file: path.join(o.dir, 'chat-presence.jsonl'), error: m => log?.error(m) })
  /** The chat `sid` as the record names it: its short id and, when it is on a floor, its agent and floor. */
  const presenceChat = (sid: string): ChatRef => {
    const at = bySession(sid)
    return { id: sid.slice(0, 8), ...(at ? { agent: at.agent.name, floor: at.floor.name } : {}) }
  }
  /**
   * Who is calling a screen tool, for the presence record. QUICK HAS ITS OWN VALUE: its made-up agent (FAST_AGENT_ID, no session) is spread from the Orchestrator's and
   * PASSES isOrchestratorAgent, so by that test alone its calls would be filed as the overlay Assistant's: a synthetic identity inheriting a real one's attribution (the
   * shape of the "Others 91.6%" usage bug). Checked first, on purpose, and by the shared id, not by a second copy of the string.
   */
  function screenActorOf(floor: Floor, agent: FloorAgent, sid: string): ChatActor {
    return screenCallerOf({
      quick: agent.id === FAST_AGENT_ID,
      personAssistantOf: isPersonAssistant(agent) && agent.owner ? { id: agent.owner.id, name: agent.owner.name } : null,
      orchestrator: isOrchestratorAgent(floor.name, agent),
      chat: { id: sid.slice(0, 8), agent: agent.name, floor: floor.name },
    })
  }
  /** Keys reached chat `sid`: the record is told their CLASSES (chat-presence.ts classesOfInput), never the keys. xterm's own replies are not people (`skipAutomatic`). */
  function noteKeys(sid: string, data: string, by: ChatActor, skipAutomatic: boolean) {
    try {
      if (skipAutomatic && isAutomaticInput(data)) return
      presence.keys(sid, () => presenceChat(sid), classesOfInput(data), by)
    } catch (err) {
      log?.error(`chat presence: keys could not be noted (${message(err)})`)
    }
  }
  /**
   * A terminal frame on its way to a chat on ANOTHER PC never passes through chats.input here. What is noted is that it was HANDED TO THE LINK (`keys-relayed`, with the PC it was handed
   * toward when the call site knows it), never that it "reached" the terminal: this PC cannot know whether the far PC took it (Agent 6's review, R3, ruled a NAME-ONLY fix). Noting at the
   * write, where a failed write could be told apart, is FILED. xterm's own replies are not people (`isAutomaticInput`), as for a chat on this PC.
   */
  function noteRelayedFrame(sid: string, frame: unknown, by: ChatActor, toPc?: { id: string; name: string }) {
    try {
      if (!isObject(frame) || frame.t !== 'in' || typeof frame.d !== 'string') return
      if (isAutomaticInput(frame.d)) return
      presence.relayed(sid, () => presenceChat(sid), classesOfInput(frame.d), by, toPc)
    } catch (err) {
      log?.error(`chat presence: relayed keys could not be noted (${message(err)})`)
    }
  }
  /** Who a page's socket is, as the presence record names them: the person signed in on it, or the open app of the owner's own PCs; and the door it came through. */
  const actorOfCaller = (c: Caller): ChatActor => {
    const door: Door = c.via === 'tailnet' ? 'tailnet' : 'local'
    return c.person ? { kind: 'person', person: { id: c.person.id, name: c.person.name }, door } : { kind: 'owner-open-app', door }
  }
  let mirrorOffAt = 0
  let mirrorOffNow = false
  /** F-193: the live mirror is switched off on this PC (SAD_INPUT_MIRROR=0, or the file input-mirror.off beside check-agent-messages.on). */
  function inputMirrorOff(): boolean {
    if (Date.now() - mirrorOffAt > 2000) {
      mirrorOffAt = Date.now()
      mirrorOffNow = process.env.SAD_INPUT_MIRROR === '0' || existsSync(path.join(o.dir, '..', 'input-mirror.off'))
    }
    return mirrorOffNow
  }
  let syncOldAt = 0
  let syncOldNow = false
  /**
   * 12 Nov (oad50 / o400b, Stage 1): the "Old way" switch, one per PC: SAD_SYNC=old, or the file <state>/agent/sync-old.on (beside input-mirror.off;
   * Settings › Chats writes it, POST /sync-mode). On: today's checked send, the screen's state and the old order rule. Off (the default): the simple
   * layer. Looked at once a second at most (it is asked at every terminal write); the route that changes it looks again at once.
   */
  function syncOld(): boolean {
    if (o.oldWay) return o.oldWay()
    if (Date.now() - syncOldAt > 1000) {
      syncOldAt = Date.now()
      syncOldNow = process.env.SAD_SYNC === 'old' || existsSync(path.join(o.dir, '..', 'sync-old.on'))
    }
    return syncOldNow
  }
  /** Stage 1 (o400b): Claude's own transcript, read for every Claude chat running here (turns.ts); made right after the pool. */
  let turns: TurnReader | null = null
  /**
   * F-221 (ob98a, fix round 3): true from the moment the link to the chat host is lost until it is back AND onBack's reopen loop is over (onLost,
   * onBack below). The pool's chats ended then because the link went, not the chats: the host may still run them (link.ts takes the same processes
   * over when the link is back) or they are reopened and told to carry on. Meanwhile a chat not seen is not known to have stopped (chatsKnown: a
   * spoken order holds), and the chats that left with the link (leftWithHost) let no lease go and are reported as `reconnecting` (liveReport: a
   * member PC's, so the hub keeps holding them).
   */
  let hostSettling = false
  const leftWithHost = new Set<string>()
  /** Each loss counts: a chat whose reopen a newer loss overtook is reopened again by the next loop (reopenLost). */
  let hostLosses = 0
  /**
   * F-221 (T4 phase 2): what the chats are seen doing, told to the residual holds as it changes (a chat here, a member PC's report), so a short turn
   * is seen working too, not only at the orders tick. Only chats in the report count (one not in it is another PC's, or gone: the tick decides).
   * Set once the residual holds exist (below the orders).
   */
  let sawChats: (states: Readonly<Record<string, ChatState>>) => void = () => {}
  const poolOptions: ChatPoolOptions = {
    addDirs: [uploads.dir],
    // F-083: a chat with an open order or unfinished work is never ended for being idle.
    keep: sid => workOf(sid) !== null,
    idleReapMs: o.idleReapMs,
    reapEveryMs: o.reapEveryMs,
    // F-193: the live mirror's agent-side switch: SAD_INPUT_MIRROR=0 or the file <state>/agent/input-mirror.off (looked at every 2 s at most).
    mirrorOff: inputMirrorOff,
    onEnded: e => {
      void executionService?.runtime.ended(e.sessionId)
      approvalNativeRuntimes.delete(e.sessionId)
      // F-134: a Codex chat that ended lets the login go (the last one puts a changed login back to the CRM first, then takes the file out) and its profile.
      if (e.engine === 'codex' && o.codex) {
        removeProfile(o.codex.paths, e.sessionId)
        void o.codex.release(e.sessionId).catch(err => log?.warn(`Codex login: ${message(err)}`))
      }
      const at = bySession(e.sessionId)
      chatLog.append({ event: 'stop', sessionId: e.sessionId, agent: at?.agent.name ?? '?', floor: at?.floor.name ?? '?', cause: e.cause, code: e.code, ranMin: Math.max(0, Math.round((Date.now() - Date.parse(e.startedAt)) / 60_000)) })
      // F-221 (ob98a, fix round 2): a chat that ended (stopped, or restarted) cannot run a spoken line it had: that order is closed at the next tick
      // and lets go. (When the agent itself stops, the chat host keeps its chats going and nothing ends here.) Fix round 3: not while this agent
      // holds no link to the chat host (before its first take-over, or from a lost link until it is back): the pool's chats end then (-1) because
      // the LINK went, and the host may still run them (link.ts takes the same processes over) or they are reopened and told to carry on.
      if (!(o.chatHost && !hostAdopted)) spokenChatEnded(e.sessionId)
    },
    toolsUrl: () => `${o.apiUrl()}${AGENTIC_PREFIX}/mcp`,
    mcpConfig,
    log,
    spawn: o.chatHost?.spawn ?? o.spawn,
    // In the host, the host ends a chat's processes (by exact PID); nothing here is theirs to end.
    treeKill: o.chatHost ? () => {} : o.treeKill,
    keepOnClose: !!o.chatHost,
    claude: o.claude,
    codexBin: () => o.codex?.bin() ?? null,
    codexCredential: () => o.codex?.credentialEnv() ?? null,
    codexSend: o.codexSend,
    // 12 Nov (oad50, Stage 1): "Old way" is off by default. On: SAD_SYNC=old, or the file sync-old.on beside the agent folder (one switch per PC);
    // o.oldWay in tests. One function for the sender and the transcript reader (syncOld, above: the same rule, looked at once a second).
    oldWay: syncOld,
    // Stage 1 (o400b, Agent 12): what Claude's own transcript says (turns.ts), for Agent 4's simple send (asking, transcriptTook) and the pool's state.
    chatSignals: {
      asking: sid => turns?.asking(sid) ?? false,
      transcriptTook: (sid, text, since) => turns?.took(sid, text, since) === true,
      state: sid => turns?.state(sid) ?? null,
    },
    token: o.token,
    credential: o.credential,
    // Order of130: a chat started on the CRM's credential files its usage under that subscription (the same read of the credential gives the label).
    usageSub: usageSubFor,
    // F-051: recall in every prompt, once the memory layer is on (main.ts). Else the prompt report (12 Nov), unless it is switched off:
    // asked each time a chat starts, so the switch is looked at then. F-221 (T4): the Orchestrator's chat gets its own file, with the voice lock.
    settings: chatSettings,
    // Order ofedf: the usage status line's values for each Claude chat's process (none when usage is off).
    chatEnv: usage ? usageEnv : undefined,
    onChange: () => {
      noteOpen()
      sawChats(chats.states())
      // A chat that ended lets its session go (after its last write is sent on). F-221 (fix round 3): one that left with a lost chat host link
      // does not yet: the host may still run it; it is let go when the host is back and the reopen loop is over, if it is not running again.
      const now = new Set(Object.keys(chats.states()))
      for (const sid of lastLive) if (!now.has(sid) && !(hostSettling && leftWithHost.has(sid))) void ended(sid)
      lastLive = now
      // States flip several times a second while a chat paints; the page needs the settled one.
      if (liveTimer) return
      liveTimer = setTimeout(() => {
        liveTimer = null
        emit({ t: 'live', live: chats.states() })
        emitWhere()
        if (mode() === 'member' && sub) writeLine(sub.stream, { t: 'live', ...liveReport() })
        pushState()
      }, 150)
      liveTimer.unref()
    },
  }
  const openCode = createOpenCodePool({
    dir: path.join(o.dir, 'opencode'), toolsUrl: () => poolOptions.toolsUrl(), shim,
    credential: o.openCodeCredential ?? (async () => { throw apiError(503, 'OpenCode CRM credentials are not configured on this PC.') }),
    find: o.openCodeFind, backend: o.openCodeBackend, freeMemory: o.openCodeFreeMemory, spawn: o.spawn,
    keep: sid => workOf(sid) !== null,
    identity: o.openCodeIdentity,
    onBind: async (sid, native) => {
      const at = bySession(sid)
      if (!at) throw apiError(409, 'The OpenCode chat binding changed during start.')
      if (mode() === 'member' && !isLocalFloor(at.floor.id)) await request(needHub(), 'opencode-bind', { sessionId: sid, native })
      else floors.setOpenCodeSession(at.floor.id, at.agent.id, native)
    },
    onChange: () => poolOptions.onChange?.(), onEnded: e => poolOptions.onEnded?.(e),
  })
  const nativeChats = combinePools(createChatPool(poolOptions), openCode.pool)
  if (o.codex && o.chatHost?.inspect && o.chatHost.current && !o.spawn) {
    executionService = createExecutionService({ directory: path.join(o.dir, 'codex-claude'), manager: o.codex, host: o.chatHost, self,
      pool: () => nativeChats, memorySettings: o.memory?.start ? hooksFile : undefined,
      current: request => {
        try {
          const at = bySession(request.binding.sessionId!)
          if (!at || isPcControl(at.floor) || request.targetPcId !== self().id) return false
          assertExecutionCAS(request.binding, snapshotAgentExecution(at.agent, defaultsNow()))
          return loadSession(o.crmSession ?? path.join(o.dir, '..', 'crm-session.json'))?.user.id === request.ownerId
        } catch { return false }
      },
      actor: scope => {
        const agent = workflowExecutionAgent(scope.floorId, scope.agentId)
        if (agent.owner?.id !== scope.ownerId || scope.targetPcId !== self().id
          || agent.homePc !== scope.targetPcId) throw executionHttpError('execution-forbidden', 'authorization')
      },
      state: scope => floors.executionState(scope.floorId, scope.agentId),
      floorFile: () => path.join(o.dir, mode() === 'member' ? 'floors-local.json' : 'floors.json'),
      commit: request => { floors.commitExecution(request) },
      target: (scope, profile) => targetExecution(profile, workflowExecutionAgent(scope.floorId, scope.agentId)),
      progress: (scope, stage, operationId) => {
        if (operationId && stage === 'checking') conversionProgress.begin(scope.floorId, scope.agentId, operationId)
        if (operationId && conversionProgress.get(scope.floorId, scope.agentId)?.operationId !== operationId) return
        conversionProgress.update(scope.floorId, scope.agentId, stage)
      },
      nativeOpen: async (request, assertCurrent, executable) => {
        const guard = () => {
          assertCurrent()
          const agent = workflowExecutionAgent(request.scope.floorId, request.scope.agentId)
          assertExecutionCAS(request.binding, snapshotAgentExecution(agent, defaultsNow()))
          if (request.signal.aborted || request.kind !== 'native' || request.binding.execution.profile !== 'codex-native-v1'
            || agent.owner?.id !== request.scope.ownerId || request.scope.targetPcId !== self().id
            || loadSession(o.crmSession ?? path.join(o.dir, '..', 'crm-session.json'))?.user.id !== request.scope.ownerId) throw executionHttpError('execution-forbidden', 'open')
        }
        guard()
        await openChat(request.scope.floorId, request.scope.agentId, { cols: request.cols, rows: request.rows }, guard, executable)
        guard()
      },
      // Order occ4c: the way back to native Claude (execution-native-claude.ts). The existing open, Claude Code at the exact executable proved,
      // under the same guards as native Codex just above; never a person's own Assistant (its own staff launch only).
      claudeBin: () => o.claude ?? findClaude(),
      nativeClaudeOpen: async (request, assertCurrent, executable) => {
        const guard = () => {
          assertCurrent()
          const agent = workflowExecutionAgent(request.scope.floorId, request.scope.agentId)
          assertExecutionCAS(request.binding, snapshotAgentExecution(agent, defaultsNow()))
          if (request.signal.aborted || request.kind !== 'native' || request.binding.execution.profile !== 'claude-native-v1' || isStaffAssistant(agent)
            || agent.owner?.id !== request.scope.ownerId || request.scope.targetPcId !== self().id
            || loadSession(o.crmSession ?? path.join(o.dir, '..', 'crm-session.json'))?.user.id !== request.scope.ownerId) throw executionHttpError('execution-forbidden', 'open')
        }
        guard()
        await openChat(request.scope.floorId, request.scope.agentId, { cols: request.cols, rows: request.rows }, guard, executable)
        guard()
      },
      launch: request => {
        const floor = floorOf(request.scope.floorId), agent = workflowExecutionAgent(floor.id, request.scope.agentId)
        // Order o7e6d: never a bridge launch of a staff Assistant (blocked here, before the bridge; its proof is not touched).
        if (isStaffAssistant(agent)) throw executionHttpError('execution-forbidden', 'open')
        assertExecutionCAS(request.binding, snapshotAgentExecution(agent, defaultsNow()))
        const sid = request.binding.sessionId!, cwd = executionLaunchCwd(findTranscriptCwd(sid, projectsDir), () => codeDirOf(floor))
        prepareClaudeConfig(cwd, claudeJson, poolOptions.addDirs)
        // memory-door: B4
        const brief = composeAgentBrief(floor, { ...agent, model: '' }, withNotebook(o.memory?.start ? memoryBrief(agent) : '', floor, agent), orderReplies())
          + '\n\nExecution: provider Codex (ChatGPT subscription), harness Claude Code, transcript Claude JSONL. Every provider request is GPT-6.1 Sol with explicit max effort. Never claim to be native Codex.\n'
        const built = strictConfigFor(o.dir, sid, appMcpServers, mcpRegistryFile, claudeJson, cwd, agent.mcpServers)
        return { sessionId: sid, floorId: floor.id, agentId: agent.id, cwd, briefPath: writeBrief(briefsDir, sid, brief),
          mcpConfig: built.file, strictMcp: true, model: 'gpt-6.1-sol', effort: 'max', resume: !!findClaudeTranscript(sid, projectsDir), cols: request.cols, rows: request.rows }
      },
      seal: async (scope, expected) => {
        conversionProgress.update(scope.floorId, scope.agentId, 'stopping')
        assertExecutionCAS(expected, floors.executionState(scope.floorId, scope.agentId).binding)
        if (!expected.sessionId || expected.execution.engine === 'opencode') throw executionHttpError('execution-lineage-invalid', 'selection')
        const token = randomUUID(), file = expected.execution.engine === 'codex'
          ? expected.codexThread && o.codex ? findRollout(o.codex.paths.home, expected.codexThread) : null
          : findClaudeTranscript(expected.sessionId, projectsDir)
        if (!file) throw executionHttpError('execution-lineage-invalid', 'selection')
        switchFences.begin(expected.sessionId, token, 'execution-profile-v1')
        if (nativeChats.info(expected.sessionId)) { nativeChats.kill(expected.sessionId, 'execution-selection'); await nativeChats.waitStopped?.(expected.sessionId) }
        if (expected.execution.profile === 'codex-in-claude-v1') await executionService?.runtime.ended(expected.sessionId)
        await settled(file)
        switchFences.snapshot(expected.sessionId, token, file, 'execution-profile-v1'); switchFences.seal(expected.sessionId, token, 'execution-profile-v1')
        const digest = sourceHash(file)
        return { assertCurrent: () => { if (sourceHash(file) !== digest) throw executionHttpError('execution-stale', 'selection') },
          finish: (committed, changed) => { if (committed && changed) switchFences.retire(expected.sessionId!, token, 'execution-profile-v1'); else switchFences.cancel(expected.sessionId!, token, 'execution-profile-v1') } }
      },
      prepare: async (scope, expected, target) => {
        const floor = floorOf(scope.floorId), file = expected.execution.engine === 'codex'
          ? expected.codexThread && o.codex ? findRollout(o.codex.paths.home, expected.codexThread) : null
          : findClaudeTranscript(expected.sessionId!, projectsDir)
        if (!file) throw executionHttpError('execution-lineage-invalid', 'selection')
        const onProgress = (stage: import('../../shared/conversion-progress.ts').ConversionStage, transfer: import('../codex/complete-conversion.ts').TransferProgress) => conversionProgress.update(scope.floorId, scope.agentId, stage, transfer)
        if (target.profile === 'codex-native-v1' && o.codex) {
          let recovery: import('../codex/complete-conversion.ts').CompleteConversionOptions['recovery']
          if (expected.execution.profile === 'codex-native-v1') {
            const agent=workflowExecutionAgent(scope.floorId,scope.agentId),history=agent.conversationHistory??[]
            const chain: import('../../shared/agentic.ts').ConversationRecord[]=[]
            const visited=new Set<string>()
            let cursor=history.find(r=>r.sessionId===expected.sessionId&&r.engine==='codex')
            while(cursor) {
              if(visited.has(cursor.sessionId)||chain.length>=32)throw executionHttpError('execution-lineage-invalid','selection')
              visited.add(cursor.sessionId);chain.unshift(cursor)
              if(!cursor.sourceSessionId)break
              const previous=history.filter(r=>r.sessionId===cursor!.sourceSessionId)
              cursor=previous.find(r=>r.sourceSessionId)||previous[0]
              if(!cursor)throw executionHttpError('execution-lineage-invalid','selection')
            }
            if(chain.length<3||chain[0].engine!=='codex')throw executionHttpError('execution-lineage-invalid','selection')
            const seals=JSON.parse(readFileSync(path.join(o.dir,'engine-switches.json'),'utf8')) as Array<{sessionId:string;state:string;file?:string;sha256?:string}>
            const segments: NonNullable<typeof recovery>['segments']=[]
            for(const [index,record] of chain.entries()) {
              const source=record.engine==='codex'&&record.codexThread?findRollout(o.codex.paths.home,record.codexThread):record.engine==='claude'?findClaudeTranscript(record.sessionId,projectsDir):null
              if(!source||record.homePc!==self().id)throw executionHttpError('execution-lineage-invalid','selection')
              if(record.sessionId!==expected.sessionId){const seal=seals.find(s=>s.sessionId===record.sessionId)
                if(nativeChats.info(record.sessionId)||seal?.state!=='retired'||seal.file!==source||seal.sha256!==sourceHash(source))throw executionHttpError('execution-lineage-invalid','selection')}
              segments.push({file:source,format:record.engine as 'codex'|'claude',sessionId:record.sessionId,delta:index!==0})
            }
            recovery={segments}
          }
          return forkNativeCodexExecution({ expected, target, file, cwd: conversationCwd(file) || codeDirOf(floor), codexHome: o.codex.paths.home, onProgress, recovery })
        }
        return forkClaudeExecution({ expected, target, file, cwd: conversationCwd(file) || codeDirOf(floor), projectsDir, onProgress })
      },
    })
  }
  let blockedLegacyAdoption = false
  const assertLegacySid = (sid: string) => {
    const current = bySession(sid)
    if (current) requireLegacyExecution(current.agent, defaultsNow())
  }
  const legacySidAllowed = (sid: string) => { try { assertLegacySid(sid); return true } catch { return false } }
  const runtimeSidAllowed = (sid: string) => {
    try {
      const at = bySession(sid)
      if (!at || executionIdentityOf(at.agent, defaultsNow()).profile !== 'codex-in-claude-v1') return legacySidAllowed(sid)
      const binding = snapshotAgentExecution(at.agent, defaultsNow()), info = nativeChats.info(sid)
      if (!info?.execution || !executionService?.runtime.matches(binding, info.bridgeRunId)) return false
      assertExecutionCAS(binding, info.execution); return true
    } catch { return false }
  }
  // F-163: this agent's own bridge chat in the pool, admitted or not, can be stopped and shown (never typed into): bridge-stop.ts.
  const ownBridgeSid = (sid: string) => ownBridgeChat(bySession(sid)?.agent, nativeChats.info(sid))
  function assertMessageRuntime(sid: string, targetPcId: string, confirmed: boolean) {
    const at=bySession(sid)
    if(!at)return
    const runtime=nativeChats.info(sid)
    requireMessageExecution(at.agent,defaultsNow(),{selfPcId:self().id,targetPcId,confirmed,
      runtimeBinding:runtime?.execution,runId:runtime?.bridgeRunId,
      admitted:(expected,runId)=>executionService?.runtime.matches(expected,runId)===true})
  }
  /**
   * Order o7e6d: whose own Assistant runs under the staff policy. A person's own Assistant (F-162, duty 'person-assistant', set only by
   * own-assistant.ts) whose person is not an administrator of this app: the same rule as the ui_* case (Agent 7). An administrator's own
   * "My Assistant" (Shubham's, if he makes one) is an owner's chat and keeps the owner's launch and tools; the hub's Orchestrator and every
   * worker are untouched. With sign-in off (no auth) everyone is the owner, so no Assistant is staff there.
   */
  const isStaffAssistant = (agent: FloorAgent) => isPersonAssistant(agent) && !access.isAdmin(access.asChat(agent))
  /**
   * Lead (15 Nov): a running chat once found unsafe stays fenced for as long as THAT run lasts (by its start time), whatever its floor says
   * later: its agent deleted, moved, its session bound elsewhere or its duty changed. A new run (after a stop) is judged afresh.
   */
  const staffFenced = new Map<string, { startedAt: string; why: FenceReason }>()
  /** Agent 3's M5: a floor of a store this PC holds itself: on the hub every floor (its own and its PC Control); on a member its own floors and its own PC Control store. */
  const isOwnStore = (f: Floor) => mode() !== 'member' || isLocalFloor(f.id) || controlFloors.store.get(f.id) !== null
  /** The run's own floor (its exact origin) is in a store this PC holds: judged here, so it never waits for a fresh copy of the Server's floors. */
  const originInOwnStore = (run: ChatInfo) => {
    const floor = lineageFloors().find(f => f.id === run.floorId)
    return !!floor && isOwnStore(floor)
  }
  /** The floors the lineage looks in: every floor this PC knows (a member's own PC Control store too). */
  function lineageFloors(): Floor[] {
    const list = allFloors()
    if (mode() !== 'member') return list
    const have = new Set(list.map(f => f.id))
    return [...list, ...controlFloors.store.list().filter(f => !have.has(f.id))]
  }
  /**
   * Order o7e6d S1: one agent's class for the lineage. Of a store this PC holds (M5): judged here with this PC's sign-in, definite. Of a member's
   * copy of the Server's floors (M3): the Server's own class from the current fresh frame, else none (null), because a member's sign-in can't
   * say who is the Server's administrator (with sign-in off it calls everyone one). C0 does not turn stale/local readings of a replica into
   * staff provenance. Only a definite staff class may create a new runtime fence; once recorded, that exact run's reason survives disconnection.
   */
  function classOf(floor: Floor, agent: FloorAgent): StaffClass | null {
    if (isOwnStore(floor)) {
      return isStaffAssistant(agent) ? 'staff' : access.isAdmin(access.asChat(agent)) ? 'admin' : 'other'
    }
    const key = classKey(floor.id, agent.id)
    return replicaIsFresh() ? fresh?.classes?.get(key) ?? null : null
  }
  /**
   * o25c1 C0: only definite STAFF provenance restricts a no-policy run. Its current binding or its EXACT immutable spawn pair can supply it.
   * A same-id agent on another floor is not proof (ids are page controlled). Missing/ambiguous origins, a non-admin ordinary agent, a stale
   * replica or a lookup failure supply NO new runtime restriction and NO durable reason. Access/B2 still decide what the caller may do.
   */
  function knownStaffOrigin(run: ChatInfo): boolean {
    try {
      const at = bySession(run.sessionId)
      if (at && classOf(at.floor, at.agent) === 'staff') return true
      const exact = lineageFloors().filter(f => f.id === run.floorId).flatMap(f => f.agents.filter(a => a.id === run.agentId).map(a => ({ f, a })))
      return exact.length === 1 && classOf(exact[0].f, exact[0].a) === 'staff'
    } catch (e) {
      const now = Date.now()
      if (now - (lineageWarned.get(run.sessionId) ?? 0) >= 60_000) {
        lineageWarned.set(run.sessionId, now)
        log?.warn(`staff provenance: chat ${run.sessionId.slice(0, 8)} could not be classified now (${message(e)}); no new runtime fence or evidence is inferred`)
      }
      return false
    }
  }
  const lineageWarned = new Map<string, number>()
  /**
   * ONE runtime check at every C0 gate. STAFF_POLICY is enforced by the pool itself. Unknown policy, known staff without the policy, or
   * independently typed evidence for this exact incarnation fence it. Old generic records and F1 state NEVER stand in for provenance.
   * A typed reason is sticky after rebind/delete; a failed write is retried on the next observation. record=false (preflight/quiet) is read only.
   */
  function runFenced(sid: string, record = true): boolean {
    const run = nativeChats.info(sid)
    if (!run) { staffFenced.delete(sid); return false }
    if (isStaffPolicy(run.policy)) return false
    const saved = staffFenced.get(sid)
    const remembered = saved && saved.startedAt === run.startedAt ? saved.why : staffFence.reason(sid, run.startedAt)
    let why: FenceReason | null = run.policy !== undefined ? 'unknown-policy' : remembered
    if (!why && knownStaffOrigin(run)) why = 'staff'
    if (!why) return false
    if (record) {
      staffFenced.set(sid, { startedAt: run.startedAt, why })
      staffFence.add(sid, run.startedAt, why)
    }
    return true
  }
  /** A live unsafe staff run with unsound evidence is related to this Update. An ordinary-only PC (even with corrupt/unclassified history) is not. */
  function staffUpdateBlockers(): string[] {
    if (!nativeChats.live().some(run => !isStaffPolicy(run.policy) && runFenced(run.sessionId, false))) return []
    return staffFence.problems().filter(p => p !== 'fence-unclassified').map(p => STAFF_FENCE_WORDS[p] ?? `the staff fence evidence has a problem (${p})`)
  }
  /** Current definite staff binding, policy, or typed runtime evidence, never an old generic record. */
  const isStaffSid = (sid: string) => {
    if (nativeChats.info(sid)?.policy !== undefined || runFenced(sid)) return true
    try { const at = bySession(sid); return !!at && classOf(at.floor, at.agent) === 'staff' } catch { return false }
  }
  const chats: ChatPool = { ...nativeChats,
    beforeAdopt: async info => {
      const at = bySession(info.sessionId)
      if (at && executionIdentityOf(at.agent, defaultsNow()).profile === 'codex-in-claude-v1') {
        const expected = snapshotAgentExecution(at.agent, defaultsNow())
        assertExecutionCAS(expected, info.execution)
        if (!executionService || !info.bridgeRunId) throw executionHttpError('execution-runtime-mismatch', 'runtime')
        await executionService.runtime.adopt(expected, info.bridgeRunId)
      }
    },
    start: options => { assertLegacySid(options.sessionId); switchFences.assertWritable(options.sessionId); return nativeChats.start(options) },
    // Presence (chat-presence.ts): this facade is the ONE place every key to a terminal passes, whatever pool runs the chat, so it is where the record is made: only keys that
    // REACHED the chat, and a caller that does not say who sent them is `unattributed` (visible, never filed as somebody). press() is the app's own keys.
    input: (sid, data, by) => {
      const took = runtimeSidAllowed(sid) && !switchFences.blocked(sid) && !runFenced(sid) && nativeChats.input(sid, data)
      if (took) noteKeys(sid, data, by ?? UNATTRIBUTED, true)
      return took
    },
    press: (sid, data) => {
      const took = runtimeSidAllowed(sid) && !switchFences.blocked(sid) && !runFenced(sid) && nativeChats.press(sid, data)
      if (took) noteKeys(sid, data, APP, false)
      return took
    },
    type: (sid, text, options) => runtimeSidAllowed(sid) && !switchFences.blocked(sid) && !runFenced(sid) && nativeChats.type(sid, text, options),
    deliver: async (sid, text, options) => {
      // o7e6d: a fenced run takes no message (runFenced).
      if (runFenced(sid)) { options?.onBlocked?.('staff-runtime'); return 'blocked' }
      return !runtimeSidAllowed(sid) || switchFences.blocked(sid) ? 'blocked' : nativeChats.deliver?.(sid, text, options) ?? 'unconfirmed'
    },
    clearDraft: sid => (!runFenced(sid) && nativeChats.clearDraft ? nativeChats.clearDraft(sid) : Promise.resolve({ result: 'unsupported' as const, draft: null })),
    draftMirror: (sid, client) => (!runFenced(sid) ? nativeChats.draftMirror?.(sid, client) ?? null : null),
    attach: (sid, viewer) => runtimeSidAllowed(sid) || ownBridgeSid(sid) ? nativeChats.attach(sid, viewer) : null,
    resize: (sid, cols, rows) => { if (runtimeSidAllowed(sid)) nativeChats.resize(sid, cols, rows) },
    kill: (sid, why) => (runtimeSidAllowed(sid) || ownBridgeSid(sid)) && nativeChats.kill(sid, why),
    typeWhenReady: (sid, text, options) => { assertLegacySid(sid); switchFences.assertWritable(sid); if (!runFenced(sid)) nativeChats.typeWhenReady(sid, text, options) },
    adopt: (info, pty, replay) => {
      try {
        const at = bySession(info.sessionId)
        if (at && executionIdentityOf(at.agent, defaultsNow()).profile === 'codex-in-claude-v1') {
          if (!executionService) throw executionHttpError('execution-capability-required', 'runtime')
          const expected = snapshotAgentExecution(at.agent, defaultsNow())
          assertExecutionCAS(expected, info.execution)
          if (!executionService?.runtime.matches(expected, info.bridgeRunId)) throw executionHttpError('execution-runtime-mismatch', 'runtime')
        } else assertLegacySid(info.sessionId)
      } catch (error) { blockedLegacyAdoption = true; throw error }
      const result = nativeChats.adopt(info, pty, replay)
      if (switchFences.blocked(info.sessionId)) nativeChats.kill(info.sessionId, 'engine-switch-recovery')
      // o25c1 C0: a KNOWN staff run without its policy, or a policy this build does not know, is quarantined, never ended by adoption. It takes
      // no input and no tool (runFenced), and stays as it is until an explicit stop; the next open starts it afresh.
      else if (runFenced(info.sessionId)) {
        log?.warn(`staff policy: chat ${info.sessionId.slice(0, 8)} was taken over without the staff policy; it is quarantined (known unsafe staff/policy provenance, no input or tools), not stopped`)
      }
      return result
    },
  }
  // Stage 1 (o400b): every native Claude chat running here (not Codex, not OpenCode, not Codex in Claude Code) is followed in its own transcript while
  // the simple layer is on; a change of what it is doing is told like any other (the `live` states, debounced).
  turns = createTurnReader({
    sessions: () => (syncOld() ? [] : nativeChats.live().filter(c => c.engine === 'claude' && !c.execution).map(c => ({ sessionId: c.sessionId, startedAt: c.startedAt }))),
    target: sid => nativeChats.claudeSession?.(sid) ?? sid,
    find: sid => findClaudeTranscript(sid, projectsDir),
    log,
    onChange: () => poolOptions.onChange?.(),
  })

  // F-075: the chats the agent before this one left running in the chat host are taken over at once.
  let hostAdopted = !o.chatHost
  function requireHostAdoption() {
    if(!hostAdopted)throw apiError(503,'Chats are reconnecting. Try again shortly.')
  }
  const adopted: Promise<void> = o.chatHost
    ? Promise.resolve(existsSync(path.join(o.dir, 'codex-claude', 'capability.json')) ? executionService?.runtime.ensure() : undefined)
        .then(() => o.chatHost!.adopt(chats))
        .then(r => {
          // S1: the host's own complete list of its chats, just read: a fence record of a run that is not on it (ended) or whose session now runs
          // as a newer run goes; one it lists but this agent couldn't take over stays. (Only here: never on a lost link, a timeout or a floor change.)
          const hostRuns = new Map<string, string | null>()
          for (const sid of r.adopted) hostRuns.set(sid, nativeChats.info(sid)?.startedAt ?? null)
          for (const sid of r.skipped ?? []) hostRuns.set(sid, null)
          staffFence.reconcile(hostRuns)
          hostAdopted = true
          // F-134: a Codex chat the host kept running holds the Codex login file: it counts as one of the chats that keep it.
          for (const c of chats.live()) if (c.engine === 'codex') o.codex?.adopt(c.sessionId)
          if (r.adopted.length || r.ended.length) log?.info(`chat host: took over ${r.adopted.length} running chat${r.adopted.length === 1 ? '' : 's'}${r.ended.length ? `; ${r.ended.length} ended while no agent was there` : ''}`)
        })
        .catch(e => void log?.warn(`chat host: could not take over its chats: ${message(e)}`))
    : Promise.resolve()
  /**
   * F-221 (T4 phase 2): the start-up take-over has settled (done or failed): until then a member PC's reports say `adopting` (liveReport), so the hub
   * lets none of its leases go for a chat its pool does not have yet. Once settled, the next report says what runs.
   */
  let adoptionSettled = !o.chatHost
  void adopted.then(() => {
    adoptionSettled = true
    poolOptions.onChange?.()
  })
  // F-134, once the chats the host kept are known: profiles of chats that are gone are swept, and a Codex login file left by a crash is settled (put back to the CRM
  // first if Codex had refreshed it) and taken out when no Codex chat runs.
  void adopted.then(async () => {
    const cx = o.codex
    if (!cx) return
    if (blockedLegacyAdoption || floors.hasUnverifiedExecution()) {
      log?.warn('Execution ownership is unverified; native credential cleanup is deferred until trusted provider adoption.')
      return
    }
    for (const floor of floors.list()) for (const agent of floor.agents) {
      if (engineFor(agent) !== 'codex' || !agent.sessionId || agent.codexThread) continue
      const sid = agent.sessionId
      if (!learnThread(sid, floor.id, agent.id, 0) && chats.info(sid)) watchThread(sid, floor.id, agent.id, 0)
    }
    try {
      sweepProfiles(cx.paths, new Set(chats.live().filter(c => c.engine === 'codex').map(c => profileName(c.sessionId))))
      await cx.sweep()
    } catch (e) {
      log?.warn(`Codex start-up sweep: ${message(e)}`)
    }
  }).catch(e => log?.warn(`Codex start-up discovery blocked: ${message(e)}`))
  // The host is lost (it died): the chats that ran in it end. Noted first; reopened (resumed) when a host is back.
  // F-221 (T4 review): one list for every loss (by session: what each chat was doing), worked through by one reopen loop at a time. A loss while the
  // loop runs adds to the list (a chat the loop is reopening stays on it) and stops the loop at its next step (no host: nothing could be opened);
  // the next back goes on with what is left. So no lost chat is dropped, and the host is settled (hostSettled) only once every one was looked at
  // with a host there: an older loop never settles a newer loss, and a newer loop never settles while an older one still has chats to reopen.
  const toReopen = new Map<string, ChatState>()
  let reopening = false
  const working = (st: ChatState | undefined) => st === 'running' || st === 'question'
  o.chatHost?.onLost(why => {
    hostAdopted = false
    hostSettling = true
    hostLosses++
    const now = Object.entries(chats.states())
    for (const [sid, state] of now) {
      // T4 review: a chat the loop reopened and told to carry on, whose carry-on has not been typed yet, is still working: the next loop tells it again.
      const owed = (chats.waiting?.(sid, CONTINUE_TEXT) ?? 0) > 0
      const was = toReopen.get(sid)
      toReopen.set(sid, was !== undefined && working(was) ? was : owed ? 'running' : state)
      leftWithHost.add(sid)
    }
    log?.error(`the chat host is gone (${why}): ${now.length} chat(s) ended with it; they are reopened when a host is back`)
  })
  o.chatHost?.onBack(() => {
    hostAdopted = true
    void reopenLost()
  })
  /** The reopen loop: the lost chats one at a time, a gap apart, while a host is there; then the host is settled. */
  async function reopenLost() {
    // A loop that runs already goes on with what this back added.
    if (reopening) return
    reopening = true
    let drained = false
    try {
      for (;;) {
        if (closing || !hostAdopted) break
        const next = toReopen.entries().next()
        if (next.done) {
          drained = true
          break
        }
        const [sid, state] = next.value
        if (chats.info(sid)) {
          toReopen.delete(sid)
          continue
        }
        const loss = hostLosses
        const ok = await resumeChat(sid, working(state) ? CONTINUE_TEXT : undefined)
        log?.info(`chat host: chat ${sid.slice(0, 8)} ${ok ? 'reopened after the host was lost' : 'could not be reopened'}`)
        // Lost again meanwhile: it stays on the list (onLost noted what it was doing) for the loop of the next back.
        if (loss === hostLosses) toReopen.delete(sid)
        await new Promise(res => setTimeout(res, o.resumeGapMs ?? 2000))
      }
    } finally {
      reopening = false
    }
    if (drained && !closing && hostAdopted) hostSettled()
  }
  /** F-221 (fix round 3): the host is back and its reopen loop is over: a chat that left with the link and is not running again has stopped. */
  function hostSettled() {
    hostSettling = false
    const gone = [...leftWithHost].filter(sid => !chats.info(sid))
    leftWithHost.clear()
    for (const sid of gone) void ended(sid)
    // A member PC's next live report says it (no more `reconnecting`).
    poolOptions.onChange?.()
  }
  /**
   * F-221 (fix round 3): what this PC tells its hub of its chats: the live ones, and the ones that left with a lost chat host link (they may come
   * back). T4 phase 2: `adopting` until its start-up take-over has settled (an agent that just started, e.g. after an Update, while its chat host
   * keeps the chats running): its pool does not have them yet, so the hub must not take a missing chat for a stopped one (it lets no lease go).
   */
  function liveReport(): { live: Record<string, ChatState>; reconnecting?: string[]; adopting?: true } {
    const live = chats.states()
    const reconnecting = hostSettling ? [...leftWithHost].filter(sid => !live[sid]) : []
    return { live, ...(reconnecting.length ? { reconnecting } : {}), ...(adoptionSettled ? {} : { adopting: true as const }) }
  }

  const tail = createTail({
    everyMs: o.syncEveryMs,
    onData(sid, from, data) {
      const line = { t: 'jsonl', sid, from, d: data.toString('base64') }
      if (mode() === 'member') {
        if (sub) writeLine(sub.stream, line)
      } else for (const s of subs.values()) writeLine(s, line)
    },
  })

  /** A chat that ended: once its last write is in and sent on, the session is free again. */
  const flushing = new Map<string, Promise<FileMark>>()
  function endFlush(sid: string): Promise<FileMark> {
    let p = flushing.get(sid)
    if (p) return p
    p = (async () => {
      const file = fileOf(sid)
      await settled(file)
      tail.flush(sid)
      tail.untrack(sid)
      return markOf(file)
    })()
    flushing.set(sid, p)
    void p.finally(() => setTimeout(() => flushing.delete(sid), 10_000).unref())
    return p
  }

  async function ended(sid: string) {
    if (!team) return
    const mark = await endFlush(sid).catch(() => markOf(fileOf(sid)))
    if (mode() === 'member') {
      const link = team.hub()?.link
      if (link) await request(link, 'release', { sessionId: sid, mark }).catch(e => log?.warn(`couldn't tell the hub chat ${sid.slice(0, 8)} ended: ${message(e)}`))
    } else release(sid, self())
  }

  /**
   * F-134: starts an agent's chat on this PC with Codex. The CRM's login is made ready first (codex/index.ts acquire: refused with a Codex code if it can't be), the
   * chat's profile is written (its brief, model, effort and MCP servers; the chat's own key is only NAMED there), and codex is started in the shared home.
   * A chat whose conversation id is not known yet is a new conversation; its id is learnt from its rollout file once Codex has written it.
   */
  async function startCodexHere(floor: Floor, agent: FloorAgent, sid: string, size: OpenChatRequest, executionGuard?: () => void, nativeExecutable?: string): Promise<boolean> {
    executionGuard?.()
    const cx = o.codex
    if (!cx) throw Object.assign(apiError(503, "Codex isn't set up on this PC."), { code: 'not-installed' })
    const thread = agent.codexThread ?? learnThread(sid, floor.id, agent.id, 0)?.thread ?? null
    // A discovered member-side candidate is not resumable until the hub commits its native binding.
    const binding = threadBinds.get(sid)
    if (binding) await binding
    const requireConfirmedThread = () => {
      executionGuard?.()
      const current = bySession(sid)
      if (current?.floor.id !== floor.id || current.agent.id !== agent.id || engineFor(current.agent) !== 'codex' || (current.agent.codexThread ?? null) !== thread) {
        throw pcControlError('engine-change-stale', 'The approved Codex conversation changed before launch. Refresh and open the chat again.')
      }
    }
    requireConfirmedThread()
    const rollout = thread ? findRollout(cx.paths.home, thread) : null
    const resume = !!rollout
    const cwd = (rollout && conversationCwd(rollout)) || codeDirOf(floor)
    if (thread && !resume) {
      throw Object.assign(apiError(409, "This Codex conversation isn't on this PC: Codex conversations stay on the PC that started them (for now). Open the chat on that PC, or change the agent's engine to start a new conversation."), {
        code: 'codex-conversation-elsewhere',
      })
    }
    await cx.acquire(sid)
    try {
      requireConfirmedThread()
      const dflt = defaultsNow()
      // memory-door: B2
      const brief = composeAgentBrief(floor, agent, withNotebook(o.memory?.start ? memoryBrief(agent) : '', floor, agent), orderReplies(), 'Codex')
      const mcp: Record<string, McpServerToml> = {
        // The shim is told whose chat it is by the terminal's environment, never by a file.
        [MCP_SERVER_NAME]: { command: process.execPath, args: [shim], env_vars: ['SAD_AGENTIC_KEY', 'SAD_AGENTIC_URL'] },
      }
      const registry = readRegistry(mcpRegistryFile)
      for (const name of chosen(registry, agent.mcpServers)) {
        const def = registry[name]
        mcp[name] = { command: def.command, args: def.args, ...(def.env && Object.keys(def.env).length ? { env: def.env } : {}) }
      }
      writeProfile(cx.paths, { sessionId: sid, cwd, brief, model: agent.codexModel || dflt.codexModel || '', effort: agent.codexEffort || dflt.codexEffort || '', mcp, ...(cx.credentialEnv() ? { keyVar: cx.credentialEnv()!.name } : {}) })
      log?.info(`chat ${sid.slice(0, 8)}: Codex, MCP servers ${Object.keys(mcp).join(', ')}`)
      const startedMs = Date.now()
      chats.start({
        sessionId: sid,
        floorId: floor.id,
        agentId: agent.id,
        cwd,
        briefPath: '',
        model: '',
        resume,
        cols: size.cols,
        rows: size.rows,
        engine: 'codex',
        codex: { home: cx.paths.home, profile: profileName(sid), thread: resume ? thread : null, ...(nativeExecutable ? { bin: nativeExecutable } : {}) },
      })
      launched.set(sid, { effort: agent.codexEffort || dflt.codexEffort || '', at: new Date().toISOString(), ultracode: false })
      heartbeat.opened(sid)
      chatLog.append({ event: 'start', sessionId: sid, agent: agent.name, floor: floor.name, cause: startCause.get(sid) ?? (resume ? 'resumed' : 'new'), ...startedBy(sid) })
      startCause.delete(sid)
      if (!resume) watchThread(sid, floor.id, agent.id, startedMs)
      if (team) tail.track(sid, fileOf(sid), markOf(fileOf(sid)).bytes)
      return resume
    } catch (e) {
      removeProfile(cx.paths, sid)
      await cx.release(sid)
      throw e
    }
  }

  function unboundCodex(sid: string, floorId: string, agentId: string) {
    const at = bySession(sid)
    return at?.floor.id === floorId && at.agent.id === agentId && engineFor(at.agent) === 'codex' && !at.agent.codexThread
  }

  const threadBinds = new Map<string, Promise<void>>()
  function learnThread(sid: string, floorId: string, agentId: string, sinceMs: number) {
    if (!o.codex || !unboundCodex(sid, floorId, agentId)) return null
    const found = discoverThread(o.codex.paths.home, sid, sinceMs)
    if (!found || !unboundCodex(sid, floorId, agentId)) return null
    assertCodexThreadAvailable(allFloors(), floorId, agentId, found.thread)
    const record = () => {
      rolloutCache.set(found.thread, found.file)
      log?.info(`chat ${sid.slice(0, 8)}: Codex conversation ${found.thread.slice(0, 8)}`)
      if (team && chats.info(sid)) tail.track(sid, found.file, 0)
    }
    if (mode() === 'member' && !isLocalFloor(floorId)) {
      if (!threadBinds.has(sid)) {
        const binding = request(needHub(), 'codex-bind', { sessionId: sid, native: found.thread }).then(reply => {
          if (!isObject(reply) || reply.ok !== true) throw apiError(409, 'Native conversation binding was not confirmed by the hub.')
          const at = bySession(sid)
          if (at?.floor.id !== floorId || at.agent.id !== agentId || engineFor(at.agent) !== 'codex' || (at.agent.codexThread && at.agent.codexThread !== found.thread)) throw pcControlError('engine-change-stale', 'The conversation changed while its native binding was being confirmed.')
          if (at?.floor.id === floorId && at.agent.id === agentId && engineFor(at.agent) === 'codex' && !at.agent.codexThread) {
            replica.floors = replica.floors.map(f => f.id !== floorId ? f : { ...f, agents: f.agents.map(a => a.id !== agentId ? a : { ...a, codexThread: found.thread }) })
          }
          record()
        }).catch(error => {
          log?.warn(`Could not record the remote Codex conversation: ${message(error)}`)
          if (!closing && chats.info(sid) && unboundCodex(sid, floorId, agentId)) watchThread(sid, floorId, agentId, sinceMs)
          throw error
        }).finally(() => threadBinds.delete(sid))
        threadBinds.set(sid, binding)
        void binding.catch(() => {}) // Background discovery reports through its watcher; launchers await the same confirmation.
      }
    } else { floors.setCodexThread(floorId, agentId, found.thread); record() }
    return found
  }

  /** Includes adopted chats. A delayed first write is not a reason to abandon a live conversation. */
  function watchThread(sid: string, floorId: string, agentId: string, startedMs: number) {
    if (!o.codex) return
    threadWatchers.get(sid)?.()
    threadWatchers.set(sid, watchForThread({
      active: () => !closing && !!chats.info(sid) && unboundCodex(sid, floorId, agentId),
      discover: () => !!learnThread(sid, floorId, agentId, startedMs),
      failed: e => log?.warn(`chat ${sid.slice(0, 8)}: couldn't keep its Codex conversation id: ${message(e)}`),
    }))
  }

  /** A newer login was put in place while Codex chats were running: they hold the older one, so each is restarted (its conversation resumes), one after the other. */
  function restartCodexChats() {
    void (async () => {
      for (const c of chats.live()) {
        if (closing || c.engine !== 'codex') continue
        try {
          await restartChat(c.sessionId)
        } catch (e) {
          log?.warn(`couldn't restart chat ${c.sessionId.slice(0, 8)} on the newer Codex login: ${message(e)}`)
        }
      }
    })()
  }

  // ---------------------------------------------------------------------------------------
  // Order o7e6d (o4002): a person's own Assistant (F-162, duty 'person-assistant') runs under the staff policy (staff-policy.ts), or not at all

  /**
   * F-300 S0: a person's own Assistant is ADMITTED before it is started (staff-admission.ts): the shared start admission for memory (o.startAdmission, F-290) and a per-person start rate. A refusal is the same plain
   * words for every cause, 409 'staff-resting', before anything is spawned; the owner's chats are never stopped to make room. The reservation is held until the start is over, thrown or not.
   */
  const staffAdmission = createStaffAdmission({ startAdmit: o.startAdmission })
  function withStaffAdmission<T>(agent: FloorAgent, sid: string, start: () => T): T {
    const admitted = staffAdmission.admit(agent.owner?.id ?? '', sid)
    if (!admitted.ok) {
      log?.warn(`staff start refused (${admitted.cause}): chat ${sid.slice(0, 8)} of ${agent.owner?.username || 'a person'}'s Assistant waits`)
      throw Object.assign(apiError(409, admitted.words), { code: admitted.code })
    }
    try {
      return start()
    } finally {
      admitted.release()
    }
  }

  function staffError(words: string) {
    return Object.assign(apiError(409, words), { code: 'staff-policy' })
  }

  /**
   * Where and as what a person's own Assistant may run: on this PC when it is the hub or alone (a member PC can't show its launch), as native
   * Claude only (no Codex, OpenCode, Codex in Claude Code or other managed execution), at home here, for a person whose id fits. Else refused.
   */
  function assertStaffStart(floor: Floor, agent: FloorAgent) {
    if (staffFence.activationBlocked() && (!agent.sessionId || !isStaffPolicy(nativeChats.info(agent.sessionId)?.policy))) {
      throw staffError('Staff activation is held: the staff provenance evidence needs review (GET /staff/preflight). Nothing was started.')
    }
    if (mode() === 'member') throw staffError("A person's own Assistant runs on the Server only.")
    if (isPcControl(floor)) throw staffError("A person's own Assistant is not a PC-control chat.")
    if (executionIdentityOf(agent, defaultsNow()).profile !== 'claude-native-v1') throw staffError("A person's own Assistant runs only as native Claude (not Codex, OpenCode or Codex in Claude Code).")
    if (agent.homePc && agent.homePc !== self().id) throw staffError(`This Assistant's home is ${homeName(agent, agent.homePc)}; a person's own Assistant runs on the Server only.`)
    if (!STAFF_OWNER_RE.test(agent.owner?.id ?? '')) throw staffError("This Assistant's person can't be named, so it was not started.")
  }

  /**
   * P1 (Lead, 15 Nov): a run of a staff Assistant that is not under the staff policy (an older build's, an unknown policy) is never used and never
   * stopped by an open: the open is refused while it runs (it is quarantined: no input, no tools). An explicit stop (terminate) replaces it; the
   * next open starts it under the policy. One running on another PC can't be checked here and is refused too.
   */
  function staffRefuseOld(sid: string) {
    const w = whereAll()[sid]
    if (!w) return
    if (w.id !== self().id) throw staffError(`This Assistant's chat runs on ${w.name}, where its restrictions can't be checked. Stop it there first.`)
    if (isStaffPolicy(chats.info(sid)?.policy)) return
    log?.warn(`staff policy: chat ${sid.slice(0, 8)} of a person's own Assistant runs without it; the open is refused until it is stopped`)
    throw staffError("Restart required: this Assistant's chat is running without its restrictions (an older start). It takes no messages and no tools until it is stopped; stop it, then open it again.")
  }

  /**
   * Plan A (Lead's GO, 15 Nov): on a member PC, is this a staff Assistant of the Server's that has never run (no home; its session, if bound,
   * runs nowhere: not in this PC's pool, not anywhere this PC knows of)? Then its open from this PC's page goes to the Server (forwardFirstOpen).
   * Anything else keeps the old ways: home on the Server (run-on there), running there (answered as there), home elsewhere (refused).
   */
  function staffFreshHere(floorId: string, agentId: string): boolean {
    const agent = agentOf(floorOf(floorId), agentId)
    if (!isStaffAssistant(agent) || agent.homePc) return false
    const sid = agent.sessionId
    return !sid || (!whereAll()[sid] && !chats.info(sid))
  }

  /** Opens of one Assistant now on their way from this PC's pages: a second one waits for the first, never a second forward (or start). */
  const staffForwarding = new Map<string, Promise<ChatOpened>>()

  /**
   * Plan A: the member PC passes the page's open of a never-run staff Assistant to the Server, which alone decides: it checks the person, that the
   * Assistant is theirs, Settings › Access and the native staff launch before it binds a session or starts anything (fromMember, checkRule,
   * openChat). On this PC: no spawn, no session bound, no lease, no home. Over the link in use NOW, pinned: the Server is first asked whether it
   * runs the staff policy; no link, another link by the time it is asked to open, an unknown answer, an older Server or a timeout all refuse the
   * open, and nothing is ever started here instead.
   * Pinned by what the link IS, never by the wrapper object (Lead's object review): team.hub() hands out a new LinkPeer at every read (main.ts
   * linkPeer), the same link in a new wrapper, so the pin is the Server's id and the link's incarnation (LinkPeer.token, the Mux under it; a new
   * one after a reconnect). After the probe both must still be the same, and the open goes over the link read first.
   */
  async function forwardFirstOpen(floorId: string, agentId: string, r: MountRequest): Promise<ChatOpened> {
    const key = `${floorId}/${agentId}`
    const pending = staffForwarding.get(key)
    if (pending) return { ...(await pending), started: false, resumed: false }
    const run = (async (): Promise<ChatOpened> => {
      const hub = team?.hub() ?? null
      const link = hub?.link ?? null
      if (!hub || !link || !link.token || link.id !== hub.id) throw staffError("The Server can't be reached from this PC now, and a person's own Assistant opens only there. Nothing was started.")
      const pinned = { id: hub.id, token: link.token }
      const probe = await request<{ version?: unknown; policy?: unknown }>(link, 'staff-policy', {}, 10_000).catch(() => null)
      if (!probe || probe.version !== 1 || probe.policy !== STAFF_POLICY) throw staffError("The Server can't open a person's own Assistant with its restrictions (it may need the Update). Nothing was started.")
      const now = team?.hub() ?? null
      if (!now || now.id !== pinned.id || !now.link || now.link.id !== pinned.id || !now.link.token || now.link.token !== pinned.token) throw staffError('The connection to the Server changed before the Assistant could be opened there. Nothing was started; try again.')
      const opened = await request<ChatOpened>(link, 'http', { method: 'POST', rest: `/floors/${enc(floorId)}/agents/${enc(agentId)}/chat`, query: '', body: {}, by: callerOf(r).person }, 60_000)
      log?.info(`staff policy: the first open of ${agentOf(floorOf(floorId), agentId).name} was passed to ${hub.name}`)
      return { ...opened, on: opened.on ?? hub.name }
    })()
    staffForwarding.set(key, run)
    try {
      return await run
    } finally {
      if (staffForwarding.get(key) === run) staffForwarding.delete(key)
    }
  }

  /** Opens of one staff Assistant in flight on this PC (two pages, a member's forward): a second waits for the first; it is started once. */
  const staffOpening = new Map<string, Promise<ChatOpened>>()

  /**
   * C0 staff ACTIVATION preflight. Store trouble/unclassified history is visible without turning it into an ordinary runtime fence. No clear,
   * certify or recovery endpoint is added. Remote ordinary/unknown runs are not classified as unsafe merely for lacking an admin proof.
   */
  function staffPreflight(): { sessionId: string; floor: string; agent: string; pc: string; why: StaffUnsafe }[] {
    const out: ReturnType<typeof staffPreflight> = []
    for (const why of staffFence.problems()) if (why !== 'fence-unclassified') out.push({ sessionId: '', floor: '', agent: '', pc: self().name, why })
    const where = whereAll()
    for (const entry of staffFence.entries()) {
      if (entry.why) continue
      let at: { floor: Floor; agent: FloorAgent } | null = null
      try { at = bySession(entry.sessionId) } catch { /* the evidence stays visible */ }
      out.push({ sessionId: entry.sessionId, floor: at?.floor.name ?? '', agent: at?.agent.name ?? '', pc: where[entry.sessionId]?.name ?? self().name, why: 'fence-unclassified' })
    }
    for (const [sid, w] of Object.entries(where)) {
      let at: { floor: Floor; agent: FloorAgent } | null = null
      try { at = bySession(sid) } catch { /* not proof of staff */ }
      const row = { sessionId: sid, floor: at?.floor.name ?? '', agent: at?.agent.name ?? '', pc: w.name }
      if (w.id !== self().id) {
        let staff = false
        try { staff = !!at && classOf(at.floor, at.agent) === 'staff' } catch { /* no new restriction from a failed lookup */ }
        if (staff) out.push({ ...row, why: 'other-pc' })
        continue
      }
      const run = nativeChats.info(sid)
      if (run && runFenced(sid, false)) {
        const saved = staffFenced.get(sid)
        const why = run.policy !== undefined && !isStaffPolicy(run.policy) ? 'unknown-policy'
          : (saved && saved.startedAt === run.startedAt ? saved.why : staffFence.reason(sid, run.startedAt))
        out.push({ ...row, why: why === 'unknown-policy' ? 'unknown-policy' : 'no-policy' })
      }
    }
    return out
  }

  /** The person's own empty room, its working folder: the same at every start and resume, never the floor's folder, a repo or the owner's. */
  function staffRoom(agent: FloorAgent) {
    return path.join(staffDir, 'rooms', agent.owner!.id.toLowerCase())
  }

  /** A staff chat's start (from startHere): its room, its own brief, MCP file and settings; model and effort from Settings › Chats only. */
  function staffStartHere(floor: Floor, agent: FloorAgent, sid: string, size: OpenChatRequest, nativeExecutable?: string): boolean {
    assertStaffStart(floor, agent)
    if (nativeExecutable) throw staffError("A person's own Assistant runs only as native Claude.")
    const room = staffRoom(agent)
    // Its conversation lives under its room. One found anywhere else (H3: an older run's, made outside the restrictions) is never moved or
    // copied: it stays exactly where it is, and this build refuses to resume it (restart required: a new conversation for this Assistant).
    const found = findClaudeTranscript(sid, projectsDir)
    if (found && path.resolve(found).toLowerCase() !== path.resolve(transcriptPath(room, sid, projectsDir)).toLowerCase()) {
      log?.warn(`staff policy: chat ${sid.slice(0, 8)}'s conversation was made outside the staff restrictions; it is left where it is and not resumed`)
      throw staffError("This Assistant's conversation was started without its restrictions, so it can't be resumed under them. It needs a new conversation (restart required); the old one is kept as it is.")
    }
    const resume = !!found
    mkdirSync(room, { recursive: true })
    if (!resume && !UUID_RE.test(sid)) throw apiError(400, `"${sid}" has no conversation to resume, and a new chat's id must be a UUID`)
    try {
      const done = prepareClaudeConfig(room, claudeJson)
      if (done.length) log?.info(`answered in ${claudeJson} so the chat opens on its prompt: ${done.join(', ')}`)
    } catch (e) {
      log?.warn(`couldn't update ${claudeJson}: ${message(e)}`)
    }
    const person = agent.owner!.name || agent.owner!.username || 'its person'
    // F-297: v2 when sending is on for this person now, else v1 exactly as before; the chat records it and the hub asks the switch again at every send.
    const policy = staffPolicyFor(agent)
    const briefPath = writeBrief(briefsDir, sid, staffBrief({ agent: agent.name, person, md: agent.md, server: MCP_SERVER_NAME, policy }))
    const mcpFile = path.join(staffDir, 'mcp', `${sid}.json`)
    writeAtomic(mcpFile, `${json(staffMcpConfig(MCP_SERVER_NAME, process.execPath, shim, policy))}\n`)
    const dflt = defaultsNow()
    voiceLockGiven = null
    chats.start({ sessionId: sid, floorId: floor.id, agentId: agent.id, cwd: room, briefPath, mcpConfig: mcpFile, strictMcp: true, model: dflt.model, effort: dflt.effort || undefined, resume, cols: size.cols, rows: size.rows, policy })
    voiceLockGiven = null
    launched.set(sid, { effort: dflt.effort, at: new Date().toISOString(), ultracode: false })
    heartbeat.opened(sid)
    chatLog.append({ event: 'start', sessionId: sid, agent: agent.name, floor: floor.name, cause: startCause.get(sid) ?? (resume ? 'resumed' : 'new'), ...startedBy(sid) })
    startCause.delete(sid)
    log?.info(`chat ${sid.slice(0, 8)}: ${agent.name} started under the staff policy (${policy})`)
    if (team) tail.track(sid, fileOf(sid), markOf(fileOf(sid)).bytes)
    return resume
  }

  /** Starts the agent's chat on this PC (its lease already got). */
  async function startHere(floor: Floor, agent: FloorAgent, sid: string, size: OpenChatRequest, executionGuard?: () => void, nativeExecutable?: string): Promise<boolean> {
    executionGuard?.()
    requireLegacyExecution(agent, defaultsNow())
    assertPcControlTarget(floor, self().id, size)
    // F-221 (T4 review): held before it starts, whoever starts it, when a spoken line holds it (heldStart).
    heldStart(sid)
    // Order o7e6d: a staff Assistant starts only under the staff policy, never by any of the ways below.
    if (isStaffAssistant(agent)) return withStaffAdmission(agent, sid, () => staffStartHere(floor, agent, sid, size, nativeExecutable))
    if (engineFor(agent) === 'opencode') {
      const dflt = defaultsNow(), cwd = codeDirOf(floor)
      const selection = openCodeSelection(agent, dflt)
      if (agent.opencodeSession && agent.homePc && agent.homePc !== self().id) throw apiError(409, 'OpenCode conversations resume on their home PC.')
      const mcp: NonNullable<import('../opencode/backend.ts').BackendOptions['mcp']> = {}
      const registry = readRegistry(mcpRegistryFile)
      for (const name of chosen(registry, agent.mcpServers)) { const def = registry[name]; mcp[name] = { command: [def.command, ...def.args], environment: def.env } }
      // memory-door: B3
      await openCode.prepare({ sessionId: sid, floorId: floor.id, agentId: agent.id, cwd, briefPath: '', model: '', resume: !!agent.opencodeSession, engine: 'opencode', provider: selection.provider, selectedModel: selection.model, native: agent.opencodeSession ?? null, brief: composeAgentBrief(floor, agent, withNotebook(o.memory?.start ? memoryBrief(agent) : '', floor, agent), orderReplies(), 'OpenCode'), mcp })
      heartbeat.opened(sid)
      chatLog.append({ event: 'start', sessionId: sid, agent: agent.name, floor: floor.name, cause: agent.opencodeSession ? 'resumed' : 'new', ...startedBy(sid) })
      if (team) tail.track(sid, fileOf(sid), markOf(fileOf(sid)).bytes)
      return !!agent.opencodeSession
    }
    if (engineFor(agent) === 'codex') return startCodexHere(floor, agent, sid, size, executionGuard, nativeExecutable)
    const { cwd, resume } = placeForRun(sid, codeDirOf(floor))
    if (!resume && !UUID_RE.test(sid)) throw apiError(400, `"${sid}" has no conversation to resume, and a new chat's id must be a UUID`)
    try {
      // The chat's folder and every folder the pool starts it with (--add-dir: the uploads folder): claude asks about each, so each is recorded (of24b).
      const done = prepareClaudeConfig(cwd, claudeJson, poolOptions.addDirs)
      if (done.length) log?.info(`answered in ${claudeJson} so the chat opens on its prompt: ${done.join(', ')}`)
    } catch (e) {
      log?.warn(`couldn't update ${claudeJson}: ${message(e)}`)
    }
    // F-051: the memory's section (what it is, core.md, the wiki's pages) once the layer is on: this chat's OWNER's, never another person's.
    // memory-door: B1
    const briefPath = writeBrief(briefsDir, sid, composeAgentBrief(floor, agent, withNotebook(o.memory?.start ? memoryBrief(agent) : '', floor, agent), orderReplies()))
    // F-067: an agent set to Default gets Settings › Chats' model, effort and ultracode.
    const dflt = defaultsNow()
    const effort = agent.effort || dflt.effort
    const ultracode = agent.ultracode ? agent.ultracode === 'on' : dflt.ultracode
    // Per-agent MCP servers (mcp-registry.ts): only what this agent was given, else the shared file as ever.
    // F-078 scope fix: with the strict way (the default) the chat's file is its own and lists the servers by name in the log (never their values).
    let mcp: string
    let strictMcp = false
    if (o.strictMcp ?? process.env.SAD_MCP_STRICT !== '0') {
      try {
        const built = strictConfigFor(o.dir, sid, appMcpServers, mcpRegistryFile, claudeJson, cwd, agent.mcpServers)
        mcp = built.file
        strictMcp = true
        log?.info(`chat ${sid.slice(0, 8)}: MCP servers ${built.names.join(', ')}`)
      } catch (e) {
        log?.warn(`couldn't write chat ${sid.slice(0, 8)}'s MCP file, starting it the old way: ${message(e)}`)
        mcp = mcpConfigFor(o.dir, sid, appMcpServers, readRegistry(mcpRegistryFile), agent.mcpServers, mcpConfig)
      }
    } else {
      mcp = mcpConfigFor(o.dir, sid, appMcpServers, readRegistry(mcpRegistryFile), agent.mcpServers, mcpConfig)
    }
    voiceLockGiven = null
    // Order occ4c: a managed native Claude run starts at the executable its capability proved (nativeExecutable), never a fresh lookup.
    const started = chats.start({ sessionId: sid, floorId: floor.id, agentId: agent.id, cwd, briefPath, mcpConfig: mcp, strictMcp, model: agent.model || dflt.model, effort, resume, cols: size.cols, rows: size.rows,
      ...(nativeExecutable ? { claudeBin: nativeExecutable } : {}) })
    // F-221 (ob98a, T4): this run has the voice lock when its start was given hooks-orchestrator.json (chatSettings); kept by its start time.
    if (voiceLockGiven === sid) voiceLocks.started(sid, started.startedAt)
    voiceLockGiven = null
    launched.set(sid, { effort, at: new Date().toISOString(), ultracode })
    heartbeat.opened(sid)
    chatLog.append({ event: 'start', sessionId: sid, agent: agent.name, floor: floor.name, cause: startCause.get(sid) ?? (resume ? 'resumed' : 'new'), ...startedBy(sid) })
    startCause.delete(sid)
    // Ultracode is claude's own mode, on for the session only: asked for once its prompt is up (`/effort ultracode`).
    if (ultracode) chats.typeWhenReady(sid, '/effort ultracode')
    if (team) tail.track(sid, fileOf(sid), markOf(fileOf(sid)).bytes)
    return resume
  }

  // ---------------------------------------------------------------------------------------
  // F-021 on the hub: who runs what, holding and letting go, stopping a chat wherever it runs

  /** Every chat running on the hub's PCs, by session. */
  /** Whether this chat RUNS on the Server right now: in this process on the hub (or alone), and on a member PC what the hub's state frame says (the chat is on the hub's PC). */
  function runsOnServer(sessionId: string): boolean {
    return mode() === 'member' ? replica.where[sessionId]?.id === serverPcId() : !!chats.info(sessionId)
  }

  function whereAll(): Record<string, { id: string; name: string; state: ChatState }> {
    const me = self()
    if (mode() === 'member') {
      const out = Object.fromEntries(Object.entries(replica.where).filter(([, w]) => w.id !== me.id))
      for (const [sid, state] of Object.entries(chats.states())) out[sid] = { id: me.id, name: me.name, state }
      return out
    }
    const out: Record<string, { id: string; name: string; state: ChatState }> = {}
    for (const [id, r] of remote) for (const [sid, state] of Object.entries(r.live)) out[sid] = { id, name: r.name, state }
    for (const [sid, state] of Object.entries(chats.states())) out[sid] = { id: me.id, name: me.name, state }
    return out
  }

  function elsewhere(): Record<string, ChatElsewhere> {
    const me = self().id
    return Object.fromEntries(
      Object.entries(whereAll())
        .filter(([, w]) => w.id !== me)
        .map(([sid, w]) => [sid, { pc: w.name, state: w.state }]),
    )
  }

  function lastAll(): Record<string, ChatLast> {
    const running = whereAll()
    if (mode() === 'member') return Object.fromEntries(Object.entries(replica.last).filter(([sid]) => !running[sid]))
    return Object.fromEntries([...held].filter(([sid, h]) => h.last && !running[sid]).map(([sid, h]) => [sid, h.last!]))
  }

  /**
   * F-211: every floor chat's Claude conversation (all floors; not PC Control's, and not native Codex or OpenCode, whose conversations are not Claude's JSONL), with the names its
   * folder in the CRM drive is made of: its owner's username, the PC it runs or ran on, its floor and agent. A running chat that /clear or /resume moved to another session counts
   * that session too.
   */
  function conversationSessions(): ConvSession[] {
    const where = whereAll(), last = lastAll(), me = self()
    const out: ConvSession[] = []
    for (const f of floors.list()) {
      if (isPcControl(f)) continue
      for (const a of f.agents) {
        const sid = a.sessionId
        if (!sid && !keepsAssistantHistory(a)) continue
        const base = { owner: a.owner?.username || SBSKRRT_OWNER.username, pc: (sid ? where[sid]?.name ?? last[sid]?.pc : null) ?? me.name, floor: f.name, agent: a.name, running: !!sid && !!where[sid] }
        if (sid && (engineFor(a) === 'claude' || keepsAssistantHistory(a))) out.push({ sessionId: sid, ...base })
        if (keepsAssistantHistory(a)) for (const h of a.conversationHistory ?? []) {
          if (!out.some(s => s.sessionId === h.sessionId)) out.push({ ...base, sessionId: h.sessionId, running: h.sessionId === sid && base.running, pc: h.homePcName || base.pc })
        }
        if (a.owner?.id === SBSKRRT_OWNER.id && a.duty === 'orchestrator') {
          const roots = new Set((a.conversationHistory ?? []).filter(h => h.engine === 'claude' && !h.executionProfile).map(h => h.sessionId))
          if (sid && engineFor(a) === 'claude' && !a.executionProfile) roots.add(sid)
          for (const appSid of roots) {
            const binding = ownerAssistantBinding(f, a, appSid)
            if (binding) for (const r of assistantNativeHistory.forBinding(binding)) {
              if (!out.some(s => s.sessionId === r.nativeSessionId)) out.push({ ...base, sessionId: r.nativeSessionId, running: sid === appSid && chats.claudeSession?.(appSid) === r.nativeSessionId })
            }
          }
        }
        if (sid && engineFor(a) === 'claude') {
          const next = chats.claudeSession?.(sid)
          if (next && next !== sid) out.push({ sessionId: next, ...base })
        }
      }
    }
    if (existsSync(quickHistory.file)) out.push({ sessionId: quickHistory.sessionId, owner: SBSKRRT_OWNER.username, pc: me.name, floor: 'Assistant', agent: 'Quick', running: !!fastHost?.status().pid })
    return out
  }

  /** Every saved Assistant binding, not only the newest engine. Nothing is copied into a live native transcript. */
  function historyFile(sid: string): string | null {
    if (sid === quickSessionId(SBSKRRT_OWNER.id)) return existsSync(quickHistory.file) ? quickHistory.file : null
    for (const f of floors.list()) for (const a of f.agents) if (keepsAssistantHistory(a)) {
      const h = a.conversationHistory?.find(r => r.sessionId === sid)
      const engine = a.sessionId === sid ? engineFor(a) : h?.engine
      const thread = a.sessionId === sid ? a.codexThread : h?.codexThread
      if (engine === 'codex') return thread && o.codex ? findRollout(o.codex.paths.home, thread) : null
      if (engine === 'opencode') return openCode.file(sid)
    }
    return findClaudeTranscript(sid, projectsDir)
  }

  /** Scope only; callers still require the existing native runtime/engine/staff fences. No profile or staff launch is changed here. */
  function ownerAssistantBinding(floor: Floor, a: FloorAgent, sid: string): AssistantNativeBinding | null {
    return a.duty === 'orchestrator' && a.owner?.id === SBSKRRT_OWNER.id
      ? { ownerId: a.owner.id, floorId: floor.id, agentId: a.id, appSessionId: sid } : null
  }
  /**
   * oc65c: an Assistant session KNOWN to have had a conversation: its own hook reported a prompt in it, or the CRM drive copy (F-211) holds its
   * bytes. Only then is a missing or empty JSONL a loss, and the open is refused instead of starting it empty. An Assistant opened but never
   * used has no file yet and starts as before.
   */
  function assistantHadConversation(a: FloorAgent, sid: string): boolean {
    if (!keepsAssistantHistory(a)) return false
    try {
      if (a.owner?.id && assistantNativeHistory.hadPrompt(a.owner.id, sid)) return true
    } catch { /* An owner id the history store does not take: no receipt evidence. */ }
    return (conversations.status().sessions.find(s => s.sessionId === sid)?.inDrive ?? 0) > 0
  }
  /** A native session that is another agent's (bound now or kept in its history) or that another live chat is writing to now. */
  function nativeClaimedElsewhere(native: string, agentId: string, runningSid?: string): boolean {
    const is = (s: string | null | undefined) => !!s && s.toLowerCase() === native.toLowerCase()
    return floors.list().some(f => f.agents.some(a => a.id !== agentId && (is(a.sessionId) || is(a.codexThread) || is(a.opencodeSession)
      || !!a.conversationHistory?.some(h => is(h.sessionId) || is(h.codexThread) || is(h.opencodeSession)))))
      || chats.live().some(c => c.sessionId !== runningSid && (is(c.sessionId) || is(chats.claudeSession?.(c.sessionId))))
  }
  /**
   * oc65c: the newer native session a stopped owner Assistant went on in (/clear, /resume), when it is safe to continue there; else null and
   * its own binding resumes as before. Never one with no saved words, one that is another agent's, or one another live chat is writing to.
   */
  function nativeSuccessorFor(floor: Floor, a: FloorAgent, sid: string): string | null {
    if (engineFor(a) !== 'claude' || a.executionProfile) return null
    const binding = ownerAssistantBinding(floor, a, sid)
    const next = binding ? assistantNativeHistory.successor(binding) : null
    if (!next) return null
    const file = findClaudeTranscript(next, projectsDir)
    let size = 0
    try { size = file ? statSync(file).size : 0 } catch { /* Not here: nothing to continue. */ }
    if (!size) {
      log?.warn(`assistant history: ${a.name}'s newer native session ${next.slice(0, 8)} has no saved conversation here; its own one resumes`)
      return null
    }
    if (nativeClaimedElsewhere(next, a.id)) {
      log?.warn(`assistant history: ${a.name}'s newer native session ${next.slice(0, 8)} is another chat's now; its own one resumes`)
      return null
    }
    return next
  }

  function assistantHistory(c: Caller): AssistantHistoryIndex {
    if (!c.person && !access.isAdmin(c)) throw authError(401, 'Sign in to read your Assistant history.', 'sign-in')
    const person = access.ownerOf(c)
    const sources: AssistantHistorySource[] = []
    const warnings: string[] = []
    const native = assistantNativeHistory.snapshot(person.id)
    if (native.problem) warnings.push(native.problem)
    const add = (id: string, engine: AssistantHistorySource['engine'], channel: AssistantHistorySource['channel'], recordedAt: string | null, current: boolean) => {
      const key = `${engine}:${id}`
      const old = sources.find(s => s.id === key)
      if (old) { old.current ||= current; return }
      const file = engine === 'quick' ? quickHistoryFile(o.dir, person.id) : historyFile(id)
      let bytes: number | null = null
      try { if (file) bytes = statSync(file).size } catch { /* Explicitly unavailable, never silently empty. */ }
      sources.push({ id: key, engine, channel, recordedAt, current, available: bytes !== null, bytes, file })
    }
    for (const { floor, agent: a } of assistantsForPerson(floors.list(), person.id)) {
      // The conversation it is in now: a live /clear or /resume successor, else the newest one its receipts name, else its binding.
      const live = a.sessionId && engineFor(a) === 'claude' ? chats.claudeSession?.(a.sessionId) ?? null : null
      const ownBinding = a.sessionId ? ownerAssistantBinding(floor, a, a.sessionId) : null
      const later = live && live !== a.sessionId ? live : ownBinding && engineFor(a) === 'claude' && !a.executionProfile ? assistantNativeHistory.successor(ownBinding) : null
      for (const h of a.conversationHistory ?? []) add(h.sessionId, h.engine, 'assistant', h.recordedAt, !later && h.sessionId === a.sessionId && h.engine === engineFor(a))
      if (a.sessionId) add(a.sessionId, engineFor(a), 'assistant', null, !later)
      const roots = new Set((a.conversationHistory ?? []).filter(h => h.engine === 'claude' && !h.executionProfile).map(h => h.sessionId))
      if (a.sessionId && engineFor(a) === 'claude' && !a.executionProfile) roots.add(a.sessionId)
      for (const appSid of roots) {
        const binding = ownerAssistantBinding(floor, a, appSid)
        if (!binding) continue
        for (const r of native.receipts.filter(r => r.agentId === binding.agentId && r.appSessionId.toLowerCase() === binding.appSessionId.toLowerCase())) {
          add(r.nativeSessionId, 'claude', 'assistant', r.observedAt, !!later && r.nativeSessionId === later)
        }
      }
      if (later) add(later, 'claude', 'assistant', null, true)
    }
    add(quickSessionId(person.id), 'quick', 'quick', null, true)
    return { person: { id: person.id, username: person.username }, sources, quickNotice: QUICK_HISTORY_NOTICE, warnings: [...new Set(warnings)] }
  }

  function teamInfo(): AgenticTeam | null {
    const m = mode()
    if (m === 'alone') return null
    if (m === 'hub') return { pc: self().name, role: 'hub', hub: null, reachable: true, pcs: pcs() }
    const offline: OfflineChats = { on: offlineSettings.on(), active: offlineActive(), since: sub === null && downSince !== null ? new Date(downSince).toISOString() : null, hubName: team!.hub()?.name ?? null }
    return { pc: self().name, role: 'member', hub: team!.hub()?.name ?? null, reachable: sub !== null, offline, pcs: pcs() }
  }

  const emitWhere = () => emit({ t: 'where', elsewhere: elsewhere(), last: lastAll(), team: teamInfo() })
  const emitFloors = () => { emit({ t: 'floors', floors: allFloors() }); emit({ t: 'pc-control', answer: controlRawAnswer() }) }

  function hold(sid: string, who: { id: string; name: string }) {
    const pin = controlPinnedPc(sid)
    if (pin && pin !== who.id) throw pcControlError('pc-control-wrong-device', 'This lease belongs only to its pinned PC.')
    held.set(sid, { holder: who.id, holderName: who.name, heldAt: Date.now(), last: held.get(sid)?.last ?? null })
    saveHeld()
    // F-064: the first PC to run a chat is its home (a chat that has one keeps it, however it is run later).
    const at = floors.bySession(sid)
    if (at && !at.agent.homePc) floors.setHome(at.floor.id, at.agent.id, who)
  }

  /** Lets a session go: what `who` held is free, and ran last there. */
  function release(sid: string, who: { id: string; name: string }) {
    const pin = controlPinnedPc(sid)
    if (pin && pin !== who.id) return
    const h = held.get(sid)
    if (h?.holder && h.holder !== who.id) return
    held.set(sid, { holder: null, holderName: null, heldAt: 0, last: { pc: who.name, at: new Date().toISOString() } })
    saveHeld()
    emitWhere()
    pushState()
  }

  /** Brings the hub's copy up to `want` (a member's, where the chat ran) when it isn't there already. */
  async function catchUpFrom(link: LinkPeer, sid: string, want: FileMark) {
    if (!want.bytes) return
    const file = fileOf(sid)
    if (markOf(file).bytes >= want.bytes && sameMark(markOf(file, want.bytes), want)) return
    await pullFrom(link, sid, file)
  }

  /** The hub: stops the session where it runs (here, or on a member, whose last bytes then come here). */
  async function stopAt(id: string, sid: string): Promise<void> {
    const managed = bySession(sid)
    if (managed) assertPcControlTarget(managed.floor, id, {})
    if (id === self().id) {
      chats.kill(sid)
      await endFlush(sid)
      release(sid, self())
      return
    }
    const link = team?.member(id) ?? null
    const name = remote.get(id)?.name ?? held.get(sid)?.holderName ?? id
    if (!link) {
      // Out of reach: it is let go, on the asker's say-so (the page warned it may split).
      log?.warn(`took chat ${sid.slice(0, 8)} from ${name}, which can't be reached`)
      release(sid, { id, name })
      return
    }
    const { mark } = await request<{ mark: FileMark }>(link, 'stop', { sessionId: sid }, 20_000)
    await catchUpFrom(link, sid, mark)
    release(sid, { id, name })
  }

  /** Stops a session's chat wherever it runs, not waiting (an agent taken off, a floor deleted). */
  function stopAnywhere(sid: string) {
    heartbeat.stoppedOnPurpose(sid)
    if (chats.info(sid)) {
      chats.kill(sid)
      return
    }
    const w = whereAll()[sid]
    if (w && mode() === 'hub') void stopAt(w.id, sid).catch(e => log?.warn(`couldn't stop chat ${sid.slice(0, 8)} on ${w.name}: ${message(e)}`))
  }

  /**
   * The hub: the session for `who`, taken over when it runs (or is held) elsewhere. Throws 409
   * when it is elsewhere and `takeOver` wasn't asked. Answers where it was taken from.
   */
  async function lease(sid: string, who: { id: string; name: string }, takeOver: boolean, agentName: string): Promise<string | undefined> {
    // Order o7e6d (plan C, Lead's GO): a staff Assistant's session is held by this PC (the Server) only. Judged by this PC's own facts (its floors,
    // its fenced runs), never by what the asking PC says, and before anything is held, stopped or made anyone's home: an older member build, which
    // needs this lease before it starts a chat, can never start one there.
    if (who.id !== self().id && isStaffSid(sid)) throw staffError("A person's own Assistant runs on the Server only; no other PC may hold it.")
    const bound = bySession(sid)
    if (bound) requireLegacyExecution(bound.agent, defaultsNow())
    const pinned = bySession(sid)
    if (pinned) assertPcControlTarget(pinned.floor, who.id, { takeOver })
    switchFences.assertWritable(sid)
    const there = whereAll()[sid]
    const h = held.get(sid)
    let from: { id: string; name: string } | null = null
    if (there && there.id !== who.id) from = { id: there.id, name: there.name }
    else if (h?.holder && h.holder !== who.id && (h.holder !== self().id || chats.info(sid))) {
      const reachable = h.holder === self().id || !!team?.member(h.holder)
      // Granted to a member that hasn't shown it running: starting, unless it is long past that.
      if (!reachable || Date.now() - h.heldAt < LEASE_GRACE_MS || remote.get(h.holder)?.live[sid]) from = { id: h.holder, name: h.holderName ?? h.holder }
    }
    if (from) {
      if (!takeOver) throw apiError(409, `${agentName}'s chat is running on ${from.name}. Take it over to run it here; it stops there first.`)
      await stopAt(from.id, sid)
    }
    switchFences.assertWritable(sid)
    hold(sid, who)
    return from?.name
  }

  // ---------------------------------------------------------------------------------------
  // F-021 on the hub: its members' standing streams

  let pushTimer: NodeJS.Timeout | null = null
  /** The classes in the last state pushed (memberTick pushes again when this PC's sign-in changes them). */
  let classesPushed = ''
  /**
   * Order o7e6d S1 (Agent 3's M3, Lead): this hub's own class of every agent it keeps (its floors and PC Control slots), judged with ITS
   * sign-in, for the members: computed at every state it sends, over the PC link only (never on a floor, never to a page). null when it can't
   * be judged now: a member then treats what it would decide as unknown, fenced for each check only.
   */
  let classesWarned = 0
  function hubStaffClasses(list: Floor[]): [string, string, StaffClass][] | null {
    try {
      return list.flatMap(f => f.agents.map(a => [f.id, a.id, isStaffAssistant(a) ? 'staff' : access.isAdmin(access.asChat(a)) ? 'admin' : 'other'] as [string, string, StaffClass]))
    } catch (e) {
      if (Date.now() - classesWarned >= 60_000) {
        classesWarned = Date.now()
        log?.warn(`staff policy: this Server's classes of its agents could not be judged now (${message(e)}); the members fence what they would decide`)
      }
      return null
    }
  }
  function pushState() {
    if (mode() !== 'hub' || !subs.size || pushTimer) return
    pushTimer = setTimeout(() => {
      pushTimer = null
      const list = floors.list()
      const staffClasses = hubStaffClasses(list)
      classesPushed = classesFingerprint(staffClasses)
      // Orders of95c / o9ccb / ocf0e: staffTyping, the choice in force here, so the members type by the Server's choice (PC link only).
      const state = { t: 'state', floors: list, staffClasses, staffTyping: staffTyping.get(), pcControl: controlRawAnswer(), defaults: chatDefaults.get(), where: whereAll(), last: lastAll(), marks: marksHere(), engineSwitchContinuity: { version: 1, failClosed: true, homePcPreparation: true }, terminalJudgesPerson: 1 }
      for (const s of subs.values()) writeLine(s, state)
    }, 150)
    pushTimer.unref()
  }

  /** The marks of every floor session this PC has a copy of. */
  function marksHere(): Record<string, FileMark> {
    const out: Record<string, FileMark> = {}
    for (const f of allFloors())
      for (const a of f.agents) {
        if (!a.sessionId) continue
        const found = findTranscript(a.sessionId, projectsDir)
        if (found) out[a.sessionId] = markOf(found)
      }
    return out
  }

  /** Catch-up, one at a time: a copy brought up to the far end's in the background. */
  const pulling = new Set<string>()
  let pulls: Promise<void> = Promise.resolve()
  function backfill(link: LinkPeer, sid: string) {
    if (pulling.has(sid) || chats.info(sid) || switchFences.blocked(sid)) return
    pulling.add(sid)
    pulls = pulls
      .then(async () => {
        // Started here meanwhile: this PC writes it now.
        if (chats.info(sid) || switchFences.blocked(sid)) return
        const m = await pullFrom(link, sid, fileOf(sid))
        log?.info(`chat ${sid.slice(0, 8)}: copy brought up from ${link.name} (${m.bytes} bytes)`)
      })
      .catch(e => log?.warn(`couldn't bring chat ${sid.slice(0, 8)} up from ${link.name}: ${message(e)}`))
      .finally(() => pulling.delete(sid))
  }

  function onSubscribe(from: { id: string; name: string }, stream: Duplex) {
    subs.get(from.id)?.destroy()
    subs.set(from.id, stream)
    remote.set(from.id, { name: from.name, live: {} })
    log?.info(`${from.name} is following the floors`)
    const link = () => team?.member(from.id) ?? null
    readLines(stream, raw => {
      if (!isObject(raw) || subs.get(from.id) !== stream) return
      if ((raw.t === 'hello' || raw.t === 'live') && isObject(raw.live)) {
        const live = Object.fromEntries(Object.entries(raw.live).filter((e): e is [string, ChatState] => typeof e[1] === 'string' && validMirrorSid(e[0]) && (!controlPinnedPc(e[0]) || controlPinnedPc(e[0]) === from.id)))
        remote.set(from.id, { name: from.name, live })
        // F-221 (fix round 3): the chats that left its pool with its lost chat host link: they may still run there (taken over again when that link
        // is back), so they are not let go (its spoken order holds while the chat is away: awayChat). That PC lets them go itself once it knows.
        const reconnecting = new Set(Array.isArray(raw.reconnecting) ? raw.reconnecting.filter((s): s is string => typeof s === 'string' && validMirrorSid(s)) : [])
        // What it held and no longer runs (it stopped, or restarted): let go. F-221 (T4 phase 2): never from a report made before its start-up take-over
        // settled (`adopting`: its pool does not have the chats its chat host kept running yet, so a chat missing from it may still run there, and
        // a spoken order's hold stays while the chat is away); its first report after the take-over decides.
        if (raw.adopting !== true) for (const [sid, h] of held) if (h.holder === from.id && !live[sid] && !reconnecting.has(sid) && Date.now() - h.heldAt > LEASE_GRACE_MS) release(sid, from)
        // F-221 (T4 phase 2): what its chats are seen doing, for a residual hold on one of them.
        sawChats(live)
        emitWhere()
        pushState()
      }
      if ((raw.t === 'hello' || raw.t === 'marks') && isObject(raw.marks)) {
        const l = link()
        for (const [sid, m] of Object.entries(raw.marks)) {
          if (!validMirrorSid(sid)) continue
          if (controlPinnedPc(sid) && controlPinnedPc(sid) !== from.id) continue
          if (!isMark(m) || chats.info(sid)) continue
          const h = held.get(sid)
          if (h?.holder && h.holder !== from.id) continue
          if (m.bytes > markOf(fileOf(sid)).bytes && l) backfill(l, sid)
        }
      }
      if (raw.t === 'jsonl' && typeof raw.sid === 'string' && validMirrorSid(raw.sid) && typeof raw.from === 'number' && typeof raw.d === 'string') {
        if (controlPinnedPc(raw.sid) && controlPinnedPc(raw.sid) !== from.id) return
        // Only from the PC running it (or granted it, starting), and never into a copy this PC writes.
        if (chats.info(raw.sid) || (held.get(raw.sid)?.holder !== from.id && remote.get(from.id)?.live[raw.sid] === undefined)) return
        const data = Buffer.from(raw.d, 'base64')
        if (switchFences.blocked(raw.sid)) return
        const r = appendAt(fileOf(raw.sid), raw.from, data)
        if (r === 'ok') {
          for (const [id, s] of subs) if (id !== from.id) writeLine(s, raw)
        } else {
          const l = link()
          if (l) backfill(l, raw.sid)
        }
      }
    })
    const gone = () => {
      if (subs.get(from.id) !== stream) return
      subs.delete(from.id)
      remote.delete(from.id)
      log?.info(`${from.name} stopped following the floors`)
      emitWhere()
      pushState()
    }
    stream.on('close', gone)
    stream.on('error', gone)
    pushState()
  }

  // ---------------------------------------------------------------------------------------
  // F-021 on a member: its standing stream to the hub, and what comes on it

  function needHub(): LinkPeer {
    const h = team?.hub()
    if (!h) throw apiError(409, 'This PC has no hub')
    if (!h.link || !sub) {
      const here = !offlineSettings.on()
        ? ''
        : offlineActive()
          ? ' New floors and chats made on this PC work without it.'
          : ` If it stays out of reach for ${Math.round(offlineAfter / 1000)} s, new floors and chats can be made on this PC.`
      throw Object.assign(apiError(503, `${h.name} (the hub) can't be reached right now, so the floors on it are read-only here and no chat of theirs can start. Chats running here go on.${here}`), { code: 'hub-offline' })
    }
    return h.link
  }

  function memberTick() {
    void reconcileSwitchFences().catch(error => log?.warn('Engine-switch recovery remains fenced: ' + message(error)))
    if (mode() !== 'member') {
      downSince = null
      fresh = null
      if (sub) dropSub()
      // Order o7e6d S1 (M3, Lead): the classes the members get follow this PC's sign-in too (an administrator added or removed), not only its
      // floors: a change of them is pushed like a change of the floors.
      if (mode() === 'hub' && subs.size && classesFingerprint(hubStaffClasses(floors.list())) !== classesPushed) pushState()
      return
    }
    const link = team!.hub()?.link ?? null
    if (sub && (!link || sub.token !== link.token)) dropSub()
    if (sub) downSince = null
    else if (downSince === null) downSince = Date.now()
    // F-127: floors made here while the Server was away join it as soon as it can be reached (again, after a failure, every 30 s).
    if (link && sub && !adopting && Date.now() >= adoptRetryAt && localFloors.list().length) void adoptLocal(link)
    if (!link || sub || subscribing) return
    subscribing = true
    link.open({ op: 'subscribe' }).then(
      stream => {
        subscribing = false
        sub = { token: link.token, stream, gen: ++subGen }
        replica.engineSwitchContinuity = undefined
        downSince = null
        writeLine(stream, { t: 'hello', ...liveReport(), marks: marksHere() })
        readLines(stream, raw => onHubEvent(link, raw, stream))
        const gone = () => {
          if (fresh?.stream === stream) fresh = null
          if (sub?.stream !== stream) return
          sub = null
          downSince = Date.now()
          emitWhere()
        }
        stream.on('close', gone)
        stream.on('error', gone)
        log?.info(`following ${link.name}'s floors`)
        emitWhere()
        // F-127: this PC's own floors from the time the Server was away.
        void adoptLocal(link)
      },
      (e: unknown) => {
        subscribing = false
        log?.debug(`couldn't follow ${link.name}'s floors yet: ${message(e)}`)
      },
    )
  }

  function dropSub() {
    const s = sub
    sub = null
    fresh = null
    downSince = Date.now()
    s?.stream.destroy()
    emitWhere()
  }

  function onHubEvent(link: LinkPeer, raw: unknown, stream: Duplex) {
    // Order o7e6d S1 (Agent 3's M2): only a frame of the CURRENT subscription's stream, over the link this PC is joined by now, changes anything
    // here. A frame of an older stream (buffered before a drop or a reconnect) changes nothing, of any kind: before, a late `state` of an old
    // stream could overwrite a newer copy, and replica.json, with older floors.
    if (!currentStream(link, stream)) return
    if (!isObject(raw)) return
    if (raw.t === 'state' && !wellFormedFloors(raw.floors)) {
      // Not floors this PC can take: nothing is taken, and the copy it has is no longer fresh.
      fresh = null
      return
    }
    if (raw.t === 'state' && Array.isArray(raw.floors)) {
      hubJudgesTerminal = raw.terminalJudgesPerson === 1
      replica = {
        engineSwitchContinuity: isObject(raw.engineSwitchContinuity) && raw.engineSwitchContinuity.version === 1 && raw.engineSwitchContinuity.failClosed === true && raw.engineSwitchContinuity.homePcPreparation === true
          ? { version: 1, failClosed: true, homePcPreparation: true } : undefined,
        floors: raw.floors as Floor[],
        pcControl: isObject(raw.pcControl) && Array.isArray(raw.pcControl.workspaces) ? raw.pcControl as unknown as PcControlAnswer : undefined,
        defaults: parseDefaults(raw.defaults),
        where: isObject(raw.where) ? (raw.where as Replica['where']) : {},
        last: isObject(raw.last) ? (raw.last as Record<string, ChatLast>) : {},
        marks: isObject(raw.marks) ? (raw.marks as Record<string, FileMark>) : {},
      }
      // M1/M3: taken from the current stream, so the copy is fresh for this generation, with the Server's classes from this same frame (none from
      // an older Server, or a malformed list: then whatever they would decide is unknown, fenced for each check only).
      const classes = parseStaffClasses(raw.staffClasses)
      // Orders of95c / o9ccb / ocf0e: the Server's typing choice from this same frame; none (an older Server, a bad value): the 15 Nov rule here.
      fresh = { stream, token: link.token, hubId: link.id, gen: sub!.gen, classes, typing: staffTypingOf(raw.staffTyping) }
      saveReplica()
      emitFloors()
      emitWhere()
      // Every copy here brought up to the hub's, unless this PC runs it (then it writes it).
      for (const [sid, theirs] of Object.entries(replica.marks)) {
        if (!validMirrorSid(sid) || !isMark(theirs) || chats.info(sid)) continue
        const mine = markOf(fileOf(sid))
        if (mine.bytes < theirs.bytes || (mine.bytes === theirs.bytes && mine.tail !== theirs.tail)) backfill(link, sid)
      }
    } else if (raw.t === 'jsonl' && typeof raw.sid === 'string' && validMirrorSid(raw.sid) && typeof raw.from === 'number' && typeof raw.d === 'string') {
      if (chats.info(raw.sid) || switchFences.blocked(raw.sid)) return
      // A gap or a fork is left to catch-up.
      appendAt(fileOf(raw.sid), raw.from, Buffer.from(raw.d, 'base64'))
    } else if (raw.t === 'memory' && typeof raw.floorId === 'string') {
      emit({ t: 'memory', floorId: raw.floorId })
    } else if (raw.t === 'tasks') {
      // F-056: the hub's task list changed; this PC's page asks the hub for it again.
      emit({ t: 'tasks' })
    }
  }

  /** On a member: the agent's chat started here, the hub granting it (taken over from where it ran, when asked). */
  async function openOnMember(floorId: string, agentId: string, req: OpenChatRequest): Promise<ChatOpened> {
    const link = needHub()
    const floor = floorOf(floorId)
    const agent = agentOf(floor, agentId)
    requireLegacyExecution(agent, defaultsNow())
    let sid = agent.sessionId
    assertPcControlTarget(floor, self().id, req)
    if (sid) switchFences.assertWritable(sid)
    await requirePeerEngine(link, agent)
    // Order o7e6d: a staff Assistant never runs on a member PC: one running here is an unsafe older run (fenced), never handed back.
    if (isStaffAssistant(agent) && sid && chats.info(sid)) throw staffError("Restart required: this Assistant's chat runs on this PC, where its restrictions can't be checked. Stop it, then open it on the Server.")
    // S1, B3: a run here that is fenced is never handed out as if it were safe (nor leased).
    if (sid && chats.info(sid) && runFenced(sid)) throw fencedOpenError(sid)
    if (sid && chats.info(sid)) {
      requireRunningEngine(engineFor(agent), chats.info(sid)!.engine)
      const proof = await request<{ engine?: RuntimeEngine }>(link, 'lease', { sessionId: sid, takeOver: false, expectedEngine: engineFor(agent) })
      if (engineFor(agent) !== 'claude') requireRunningEngine(engineFor(agent), proof.engine)
      switchFences.assertWritable(sid)
      return { sessionId: sid, started: false, resumed: false, engine: chats.info(sid)!.engine }
    }
    // Order o7e6d: a staff Assistant already running on the Server is reached there (this page follows it there): never leased or taken over here.
    if (isStaffAssistant(agent) && sid) {
      const w = whereAll()[sid]
      if (w && w.id === team?.hub()?.id) return { sessionId: sid, started: false, resumed: false, engine: 'claude', on: w.name }
    }
    const atHome = await resumeAtHome(floor, agent, sid, req)
    if (atHome) return atHome
    // A known Assistant conversation without its transcript must not be restarted as --session-id (an empty replacement).
    if (sid && assistantHadConversation(agent, sid)) requireSavedAssistant(historyFile(sid), true)
    // Order o7e6d (Lead's routing ask): a staff Assistant whose home is the Server was just opened there (resumeAtHome: run-on), and a never-run one
    // is passed to the Server by the page's route (forwardFirstOpen). Any other way from here would start it on this PC (its home is another PC,
    // or this open came another way), so it is refused HERE, before a session is bound or a lease taken: its home is never pinned to this PC.
    if (isStaffAssistant(agent)) throw staffError("A person's own Assistant runs on the Server only, and this one can't be opened there from this PC now. Nothing was started.")
    if (!sid) {
      sid = randomUUID()
      const r = isPcControl(floor)
        ? await request<{ floor: Floor }>(link, 'pc-control-bind', { floorId, agentId, sessionId: sid, revision: pcControlRevision(floor), expectedEngine: engineFor(agent) })
        : await request<{ floor: Floor }>(link, 'http', { method: 'POST', rest: `/floors/${enc(floorId)}/agents/${enc(agentId)}/session`, body: { sessionId: sid } })
      replica.floors = replica.floors.map(f => (f.id === r.floor.id ? r.floor : f))
    }
    const granted = await request<{ mark: FileMark; tookOverFrom: string | null; engine?: RuntimeEngine }>(link, 'lease', { sessionId: sid, takeOver: req.takeOver === true, expectedEngine: engineFor(agent) }, 45_000)
    try {
      if (engineFor(agent) !== 'claude') requireRunningEngine(engineFor(agent), granted.engine)
      // This PC's copy brought up to the hub's first, unless it already has all of it.
      const file = fileOf(sid)
      const mark = isMark(granted.mark) ? granted.mark : NO_FILE
      // F-134: a Codex chat's conversation is not mirrored between PCs yet: it stays on the PC that started it.
      const codexHere = (() => {
        try {
          return engineFor(agentOf(floorOf(floorId), agentId)) !== 'claude'
        } catch {
          return false
        }
      })()
      if (!codexHere && mark.bytes && !(markOf(file).bytes >= mark.bytes && sameMark(markOf(file, mark.bytes), mark))) await pullFrom(link, sid, file)
      const now = floorOf(floorId)
      const resumed = await startHere(now, agentOf(now, agentId), sid, req)
      requireRunningEngine(engineFor(agentOf(floorOf(floorId), agentId)), chats.info(sid)?.engine)
      return { sessionId: sid, started: true, resumed, engine: chats.info(sid)!.engine, ...(granted.tookOverFrom ? { tookOverFrom: granted.tookOverFrom } : {}) }
    } catch (e) {
      await request(link, 'release', { sessionId: sid, mark: markOf(fileOf(sid)) }).catch(() => {})
      throw e
    }
  }

  // ---------------------------------------------------------------------------------------
  // F-127: the floors made on this PC while the Server was away join the Server's list when it is back

  let adopting = false
  let adoptRetryAt = 0
  let adoptStatus: AdoptStatus = { state: 'idle', floors: 0, joined: 0, sessions: 0, why: null }
  const setAdopt = (s: Partial<AdoptStatus>) => {
    adoptStatus = { ...adoptStatus, ...s }
    emit({ t: 'adopt', adopt: adoptStatus })
  }

  interface AdoptAnswer {
    floors: { id: string; name: string; created: boolean; renamedFrom: string | null }[]
    /** The hub's copy of each conversation after it caught up. */
    marks: Record<string, FileMark>
  }

  /**
   * The member's side. The Server is asked to take the floors in whole (same ids, owners, shares, chats), then its list must show them, the conversations must be
   * equal on both sides (the same size and tail; a chat still running here is only moved on from where the Server's copy is), and only THEN are they dropped from the
   * local file, which is kept as floors-local.adopted-<time>.json: nothing is deleted. Any failure leaves everything as it was and it is tried again in 30 s;
   * asking twice is a no-op on the Server (it knows a floor by id).
   */
  async function adoptLocal(link: LinkPeer): Promise<void> {
    if (adopting || mode() !== 'member' || sub === null) return
    const all = localFloors.list()
    if (!all.length) return
    adopting = true
    try {
      const pending = all.filter(f => !replica.floors.some(x => x.id === f.id))
      const sids = all.flatMap(f => f.agents.flatMap(a => (a.sessionId ? [a.sessionId] : [])))
      setAdopt({ state: 'running', floors: all.length, joined: all.length - pending.length, sessions: 0, why: null })
      const running = sids.filter(s => !!chats.info(s))
      const marks: Record<string, FileMark> = {}
      for (const sid of sids) {
        const found = findTranscript(sid, projectsDir)
        if (found) marks[sid] = markOf(found)
      }
      let checked = 0
      {
        // Always all of them: a floor the Server has already is a no-op there, but its conversations are brought up and checked again before anything is dropped.
        const notes = Object.fromEntries(all.map(f => [f.id, memory.all(f.id).map(x => ({ text: x.text, tags: x.tags, authorName: x.authorName ?? null }))]))
        const answer = await request<AdoptAnswer>(link, 'adopt', { floors: all, running, marks, notes }, 120_000)
        for (const sid of sids) {
          const mine = marks[sid]
          if (!mine) continue
          const theirs = answer.marks?.[sid]
          if (!isMark(theirs)) throw new Error(`the Server has no copy of chat ${sid.slice(0, 8)} yet`)
          if (running.includes(sid)) {
            // Still writing here: its stream goes on from where the Server's copy is (what it lacks is sent again).
            tail.track(sid, fileOf(sid), theirs.bytes)
          } else if (theirs.bytes !== mine.bytes || theirs.tail !== mine.tail) {
            throw new Error(`the Server's copy of chat ${sid.slice(0, 8)} isn't equal to this PC's yet`)
          }
          checked++
        }
      }
      // Its own list must show them, each with the same chats and owners, before the local copy goes.
      const deadline = Date.now() + 20_000
      while (!all.every(f => replica.floors.some(x => x.id === f.id))) {
        if (sub === null) throw new Error('the link to the Server dropped')
        if (Date.now() > deadline) throw new Error("the Server's list doesn't show them yet")
        await new Promise(r => setTimeout(r, 100))
      }
      for (const f of all) {
        const theirs = replica.floors.find(x => x.id === f.id)!
        // The Server puts its OWN owner where the floor named a person it does not list (floors.ts adopt, F-127): that is the one owner that may differ.
        const same = f.agents.length === theirs.agents.length && f.agents.every(a => theirs.agents.some(b => b.id === a.id && b.sessionId === a.sessionId && (b.owner?.id === a.owner?.id || b.owner?.id === SBSKRRT_OWNER.id)))
        if (!same) throw new Error(`the Server lists floor "${f.name}" differently from this PC`)
      }
      writeAtomic(path.join(o.dir, `floors-local.adopted-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), `${json({ at: new Date().toISOString(), to: link.name, floors: all })}\n`)
      // Its own copy goes now the Server holds the floor: told on this PC's record as a HANDING OVER (not a removal: the floor is alive on the Server).
      for (const f of all) localFloors.remove(f.id, null, { id: link.id, name: link.name })
      log?.info(`F-127: ${all.length} floors made here while the Server was away joined ${link.name}'s list (${checked} conversations checked)`)
      setAdopt({ state: 'done', floors: all.length, joined: all.length, sessions: checked, why: null })
      emitFloors()
    } catch (e) {
      adoptRetryAt = Date.now() + (o.adoptRetryMs ?? 30_000)
      const why = message(e)
      log?.warn(`F-127: floors made here couldn't join ${link.name}'s list yet: ${why}`)
      setAdopt({ state: 'failed', why: /doesn't do adopt/.test(why) ? `${link.name} is an older build and can't take them in yet: update it.` : why })
    } finally {
      adopting = false
    }
  }

  /** The hub's side: floors a member made while it was away, taken in whole. A floor it already has (same id) is left alone. */
  async function adoptFloors(from: { id: string; name: string }, raw: unknown): Promise<AdoptAnswer> {
    if (!isObject(raw) || !Array.isArray(raw.floors) || raw.floors.length === 0 || raw.floors.length > 200) throw apiError(400, 'Expected {floors: [...]}')
    const running = new Set(Array.isArray(raw.running) ? raw.running.filter((x): x is string => typeof x === 'string') : [])
    const marks = isObject(raw.marks) ? raw.marks : {}
    const notes = isObject(raw.notes) ? raw.notes : {}
    const link = team?.member(from.id) ?? null
    const out: AdoptAnswer['floors'] = []
    const mine: Record<string, FileMark> = {}
    for (const f of raw.floors) {
      if (isObject(f) && (f.workspace === 'pc-control' || (typeof f.id === 'string' && controlAlias(f.id)) || (Array.isArray(f.agents) && f.agents.some(a => isObject(a) && (a.pcControlSlot !== undefined || [a.id, a.sessionId, a.codexThread, a.opencodeSession].some(x => typeof x === 'string' && controlAlias(x))))))) throw immutablePcControl()
    }
    for (const f of raw.floors) {
      const { floor, created, renamedFrom, restamped } = hubFloors.adopt(f, from)
      out.push({ id: floor.id, name: floor.name, created, renamedFrom })
      // F-127: a floor that named people this hub does not list was taken in with its owner in their place: said here, never silently.
      if (created && restamped && (restamped.makers || restamped.owners || restamped.sharees)) {
        log?.warn(`F-127: ${from.name}'s floor "${floor.name}" named people this Server does not list: ${restamped.makers} maker and ${restamped.owners} chat owner(s) put back as its owner, ${restamped.sharees} share(s) dropped`)
      }
      const list = notes[floor.id]
      if (created && Array.isArray(list)) {
        for (const x of list.slice(0, 500)) {
          if (isObject(x) && typeof x.text === 'string') memory.save(floor.id, { text: x.text, tags: Array.isArray(x.tags) ? x.tags.filter((t): t is string => typeof t === 'string') : [], authorName: typeof x.authorName === 'string' ? x.authorName : null })
        }
        memoryChanged(floor.id)
      }
      for (const a of floor.agents) {
        const sid = a.sessionId
        if (!sid) continue
        // It runs there now (held by that PC), or it ran there last.
        if (running.has(sid)) hold(sid, from)
        else release(sid, from)
        const want = marks[sid]
        if (isMark(want) && link) await catchUpFrom(link, sid, want)
        const found = findTranscript(sid, projectsDir)
        if (found) mine[sid] = markOf(found)
      }
    }
    log?.info(`${from.name}: ${out.filter(f => f.created).length} floors it made while the Server was away joined the list`)
    return { floors: out, marks: mine }
  }

  /** GET /agentic/offline-chats: the setting, whether it is in use now, and how the joining goes. */
  function offlineAnswer() {
    const t = teamInfo()
    return { ...(t?.offline ?? { on: offlineSettings.on(), active: false, since: null, hubName: null }), adopt: adoptStatus }
  }

  /** GET /agentic/codex/status: names and plain sentences only, never a login. */
  function codexAnswer(): CodexStatus {
    if (o.codex) return o.codex.status()
    return {
      enabled: true,
      installed: false,
      version: null,
      state: 'not-installed',
      hint: "Codex isn't set up on this PC.",
      assigned: null,
      lastFetchedAt: null,
      lastWrittenBackAt: null,
      waitingToWriteBack: false,
    }
  }

  // F-165: the facts behind the Dependencies page, all already on this PC. `claude --version` is the one
  // process started, at most once a minute; nothing reaches ChatGPT, the CRM or a credential.
  let claudeSeen: { at: number; path: string | null; version: string | null } | null = null
  function claudeVersion() {
    if (claudeSeen && Date.now() - claudeSeen.at < 60_000) return claudeSeen
    const file = o.claude ?? findClaude()
    let version: string | null = null
    if (file) {
      const r = spawnSync(file, ['--version'], { encoding: 'utf8', timeout: 8000, windowsHide: true })
      version = r.status === 0 ? parseVersion(r.stdout) : null
    }
    return (claudeSeen = { at: Date.now(), path: file, version })
  }
  function localDependencies(): DependencyReport {
    const codex = o.codex?.status() ?? null, claude = claudeVersion()
    let chatHost = false
    try { o.chatHost?.current?.(); chatHost = !!o.chatHost } catch { chatHost = false }
    return dependencyReport({ pc: { id: self().id, name: self().name }, platform: process.platform, arch: process.arch, node: process.versions.node,
      claude: { found: !!claude.path, version: claude.version }, codex: { found: !!codex?.installed, version: codex?.version ?? null }, chatHost,
      codexState: codex?.state ?? null, codexKind: codex?.assigned?.kind ?? null, codexHint: codex?.hint ?? null,
      bridge: executionService?.runtime.status() ?? null }, Date.now())
  }
  const dependencyShape = (v: unknown): v is DependencyReport => isObject(v) && v.version === 1 && Array.isArray(v.checks) && isObject(v.pc)
  async function dependenciesAnswer(): Promise<DependenciesAnswer> {
    return { pcs: await Promise.all(pcs().map(async (pc): Promise<DependencyPc> => {
      if (pc.here) return { ...pc, report: localDependencies(), error: null }
      try {
        const report = await request<unknown>(peerOf(pc.id), 'dependencies', {}, 20_000)
        return dependencyShape(report) ? { ...pc, report, error: null } : { ...pc, report: null, error: 'It answered something this page can\'t read: update that PC.' }
      } catch (e) {
        // A PC on a build from before F-165 does not know the question.
        return { ...pc, report: null, error: /doesn't do dependencies/.test(message(e)) ? 'That PC runs an older build: update it to see its checks.' : `Can't reach it right now (${message(e)}).` }
      }
    })) }
  }

  // ---- F-168 part 2: every MCP server on each PC, and a register-only Install from a short curated list (admin only, this PC's list file only).
  const mcpDeps = () => ({ pc: { id: self().id, name: self().name }, registryFile: mcpRegistryFile, runner: (n: 'uvx' | 'npx') => findRunner(n) })
  function localMcpInventory(): McpInventory {
    const chatList: InventoryChat[] = []
    let chatsWithoutHome = 0
    for (const floor of allFloors()) for (const a of floor.agents) {
      if (!a.homePc) { if (mode() !== 'member') chatsWithoutHome++; continue }
      if (a.homePc !== self().id) continue
      chatList.push({ floor: floor.name, agent: a.name, cwd: floor.codeDir || defaultCodeDir, mcpServers: a.mcpServers, running: !!(a.sessionId && nativeChats.info(a.sessionId)) })
    }
    return buildMcpInventory({ ...mcpDeps(), claudeJson, appServerNames: Object.keys(appMcpServers), chats: chatList, chatsWithoutHome })
  }
  async function mcpInventoryAnswer(): Promise<McpInventoryAnswer> {
    return { version: 1, pcs: await Promise.all(pcs().map(async (pc): Promise<McpInventoryPc> => {
      if (pc.here) return { ...pc, inventory: localMcpInventory(), error: null }
      try {
        const inventory = readMcpInventory(await request<unknown>(peerOf(pc.id), 'mcp-inventory', {}, 20_000))
        return inventory ? { ...pc, inventory, error: null } : { ...pc, inventory: null, error: "It answered something this page can't read: update that PC." }
      } catch (e) {
        return { ...pc, inventory: null, error: /doesn't do mcp-inventory/.test(message(e)) ? 'That PC runs an older build: update it to see its MCP servers.' : `Can't reach it right now (${message(e)}).` }
      }
    })) }
  }
  /** Which PC an MCP action is for: this one, or (from the Server only) a linked one. Never a PC this one cannot speak for. */
  function mcpTarget(body: unknown): { pc: string; id: string; here: boolean } {
    if (!isObject(body) || typeof body.pc !== 'string' || typeof body.id !== 'string' || !MCP_CURATED.some(c => c.id === body.id)) throw apiError(400, 'Expected {pc, id} with an id from the list')
    const here = body.pc === self().id
    if (!here && mode() !== 'hub') throw apiError(409, "Another PC's MCP list is changed from the Server's page, not from here.")
    if (!here && !pcs().some(p => p.id === body.pc)) throw apiError(404, 'No such PC')
    return { pc: body.pc, id: body.id, here }
  }
  async function mcpPlanAnswer(body: unknown): Promise<McpInstallPlan> {
    const t = mcpTarget(body)
    if (t.here) return planInstall(mcpDeps(), t.id)
    const plan = readMcpInstallPlan(await request<unknown>(peerOf(t.pc), 'mcp-plan', { id: t.id }, 20_000).catch(e => { throw apiError(/doesn't do mcp-plan/.test(message(e)) ? 409 : 503, /doesn't do mcp-plan/.test(message(e)) ? 'That PC runs an older build: update it to install here.' : `Can't reach that PC right now (${message(e)}).`) }))
    if (!plan || plan.pc.id !== t.pc || plan.id !== t.id) throw apiError(502, "That PC answered something this page can't read: update it.")
    return plan
  }
  async function mcpApply(action: 'register' | 'remove', body: unknown): Promise<McpInstallDone> {
    const t = mcpTarget(body)
    const fingerprint = isObject(body) ? body.fingerprint : undefined
    if (t.here) return action === 'register' ? registerCurated(mcpDeps(), t.id, fingerprint) : removeCurated(mcpDeps(), t.id)
    const op = action === 'register' ? 'mcp-register' : 'mcp-remove'
    const done = readMcpInstallDone(await request<unknown>(peerOf(t.pc), op, { id: t.id, fingerprint }, 20_000).catch(e => {
      if (isObject(e) && typeof e.status === 'number' && e.status >= 400 && e.status < 500) throw e
      throw apiError(/doesn't do mcp-/.test(message(e)) ? 409 : 503, /doesn't do mcp-/.test(message(e)) ? 'That PC runs an older build: update it to change its MCP list.' : `Can't reach that PC right now (${message(e)}).`)
    }))
    if (!done || done.pc.id !== t.pc || done.id !== t.id) throw apiError(502, "That PC answered something this page can't read. Check its MCP list before trying again.")
    return done
  }
  const mcpIdOf = (raw: unknown) => { if (!isObject(raw) || typeof raw.id !== 'string' || !MCP_CURATED.some(c => c.id === raw.id)) throw apiError(400, 'Expected {id} from the list'); return raw.id }

  function retireCodexSettings(r: MountRequest) {
    const c = callerOf(r)
    // Preserve the old endpoint's person/admin checks even though it can no longer change anything.
    if (o.auth && c.person?.canSeeAll !== true) {
      o.auth.deny(c, c.person ? 403 : 401, c.person ? 'admin-only' : 'sign-in', 'PUT /agent-api/agentic/codex/settings')
      throw c.person ? authError(403, 'Only the owner of this app changes this.', 'admin-only') : authError(401, 'Sign in first.', 'sign-in')
    }
    throw apiError(410, 'The local Codex chats setting has been retired. Codex uses installation and CRM access checks.')
  }

  function setOfflineChats(raw: unknown, r: MountRequest) {
    if (!isObject(raw) || typeof raw.on !== 'boolean') throw apiError(400, 'Expected {on: true | false}')
    const c = callerOf(r)
    // A machine setting: a signed-in sbskrrt's to change (the open app, at any level, and everybody else are not).
    if (o.auth && c.person?.canSeeAll !== true) {
      o.auth.deny(c, c.person ? 403 : 401, c.person ? 'admin-only' : 'sign-in', 'PUT /agent-api/agentic/offline-chats')
      throw c.person ? authError(403, 'Only the owner of this app changes this.', 'admin-only') : authError(401, 'Sign in first.', 'sign-in')
    }
    offlineSettings.set(raw.on)
    log?.warn(`${c.person?.username ?? 'someone'} turned "New chats on this PC while the Server is down" ${raw.on ? 'ON' : 'off'}`)
    emitWhere()
    return offlineAnswer()
  }

  /** Stage 1 (o400b): GET /agentic/sync-mode, what Web's Settings › Chats › "Old way" reads: 'simple' (the default) or 'old'; `forced`: SAD_SYNC=old. */
  function syncModeAnswer() {
    syncOldAt = 0
    return { mode: syncOld() ? 'old' : 'simple', forced: process.env.SAD_SYNC === 'old' }
  }
  /** POST /agentic/sync-mode {mode}: this PC's switch (the file sync-old.on beside the agent folder), for the owner only. */
  function setSyncMode(raw: unknown, r: MountRequest) {
    if (!isObject(raw) || (raw.mode !== 'simple' && raw.mode !== 'old')) throw apiError(400, "Expected {mode: 'simple' | 'old'}")
    const c = callerOf(r)
    if (o.auth && c.person?.canSeeAll !== true) {
      o.auth.deny(c, c.person ? 403 : 401, c.person ? 'admin-only' : 'sign-in', 'POST /agent-api/agentic/sync-mode')
      throw c.person ? authError(403, 'Only the owner of this app changes this.', 'admin-only') : authError(401, 'Sign in first.', 'sign-in')
    }
    const file = path.join(o.dir, '..', 'sync-old.on')
    if (raw.mode === 'old') writeAtomic(file, `Old way: on since ${new Date().toISOString()} (Settings › Chats)\n`)
    else rmSync(file, { force: true })
    log?.warn(`${c.person?.username ?? 'someone'} set the chat-terminal layer to ${raw.mode === 'old' ? 'the Old way' : 'Simple'}${process.env.SAD_SYNC === 'old' ? ' (SAD_SYNC=old still forces the Old way)' : ''}`)
    const answer = syncModeAnswer()
    // The states now come from the other source: told to every page.
    poolOptions.onChange?.()
    return answer
  }

  const memberTimer = team ? setInterval(memberTick, 1000) : null
  memberTimer?.unref()
  const stateTimer = team
    ? setInterval(() => {
        if (mode() === 'hub') pushState()
        else if (mode() === 'member' && sub) writeLine(sub.stream, { t: 'marks', marks: marksHere() })
      }, STATE_EVERY_MS)
    : null
  stateTimer?.unref()
  if (team) setImmediate(memberTick)

  // ---------------------------------------------------------------------------------------
  // Opening an agent's chat

  /** F-064: this PC's name for a PC's id (the hub's own, a member's, or the name the agent kept). */
  const homeName = (agent: FloorAgent, id: string) => (id === self().id ? self().name : (remote.get(id)?.name ?? (team?.hub()?.id === id ? team.hub()!.name : null) ?? agent.homePcName ?? id))

  /**
   * F-064: a chat that isn't running is resumed on its HOME PC, whichever PC the click, the message
   * or the app starting again came from. Nothing to do here (null) when this PC is its home, it has
   * none yet, or it was asked for here (`here`: the home is offline and Shubham chose to start it
   * here, or the hub has already chosen). A chat that is running anywhere is the take-over question
   * as before (the caller's 409, or `takeOver`). When the home can't be reached the answer is 424,
   * naming it (the page offers here).
   */
  async function requirePeerEngine(link: LinkPeer, agent: FloorAgent) {
    // Hybrid Claude never reaches the historical Claude-only compatibility exception.
    const expectedEngine = requireLegacyExecution(agent, defaultsNow())
    if (expectedEngine !== 'claude') {
      let proof: unknown
      try { proof = await request(link, 'engine-open-capabilities', {}, 5000) } catch { throw engineUpdateRequired(link.name) }
      if (!isObject(proof) || proof.version !== 1 || !Array.isArray(proof.engines) || !proof.engines.includes(expectedEngine)) throw engineUpdateRequired(link.name)
    }
  }

  async function openOnPeer(link: LinkPeer, floor: Floor, agent: FloorAgent, text?: string, claim?: ReturnType<typeof terminalClaimLine>): Promise<ChatOpened> {
    // Order o7e6d: a staff Assistant never on another PC (its launch can't be shown here).
    if (isStaffAssistant(agent)) throw staffError("A person's own Assistant runs on the Server only.")
    requireLegacyExecution(agent, defaultsNow())
    const expectedEngine = engineFor(agent)
    if (isPcControl(floor)) { assertPcControlTarget(floor, link.id, {}); await requirePcControlPeer(link) }
    await requirePeerEngine(link, agent)
    // F-302 L4b: a member PC names the person it opens this for (member-terminal.ts), only to a Server whose state frame says it judges it; the Server refuses an `open` without a usable claim.
    const opened = await request<ChatOpened>(link, 'open', { floorId: floor.id, agentId: agent.id, expectedEngine, text, ...(claim && mode() === 'member' && hubJudgesTerminal ? claim : {}) }, 60_000)
    // Legacy Claude-only apps can still open Claude. They never prove support for a newer engine.
    if (opened.engine === undefined && expectedEngine !== 'claude') throw engineUpdateRequired(link.name)
    if (opened.engine !== undefined) requireRunningEngine(expectedEngine, opened.engine)
    return opened
  }

  async function resumeAtHome(floor: Floor, agent: FloorAgent, sid: string | null, req: OpenChatRequest): Promise<ChatOpened | null> {
    if (isPcControl(floor) && agent.homePc !== floor.targetPcId) throw pcControlError('pc-control-wrong-device', 'The saved home does not match this PC workspace.')
    if (req.here || mode() === 'alone') return null
    const home = agent.homePc
    if (!home || home === self().id) return null
    const name = homeName(agent, home)
    // Running somewhere already (at its home, or started elsewhere): that is the take-over question, as before.
    if (sid && whereAll()[sid]) return null
    const offline = () => apiError(HOME_OFFLINE_STATUS, `${name} is offline, and ${agent.name}'s chat lives there. Start it on this PC instead? Its home stays ${name}.`)
    if (mode() === 'hub') {
      const link = team?.member(home) ?? null
      if (!link) throw offline()
      // F-221 (T4 review): started on its home PC: held first when a spoken line holds it, as for a start here (heldStart).
      if (sid) heldStart(sid)
      return { ...(await openOnPeer(link, floor, agent, req.say)), on: name }
    }
    // A member reaches every other PC through the hub, which does the same for it (the run-on route).
    if (!team?.hub()?.link || !sub) throw offline()
    const via = await request<ChatOpened>(needHub(), 'http', { method: 'POST', rest: `/floors/${enc(floor.id)}/agents/${enc(agent.id)}/run-on`, body: { pc: home, say: req.say } }, 60_000).catch((e: unknown) => {
      throw (e as { status?: unknown }).status === HOME_OFFLINE_STATUS ? offline() : e
    })
    return { ...via, on: name }
  }

  /**
   * Its chat, running here: started fresh, resumed from its transcript, taken over, or as it was. Order o7e6d (Lead's first-open GO): two opens of
   * one staff Assistant at once (two pages, a member's forward and a page here) start it once: the second waits for the first's answer.
   */
  async function openChat(floorId: string, agentId: string, req: OpenChatRequest, executionGuard?: () => void, nativeExecutable?: string, by?: ChatActor): Promise<ChatOpened> {
    let staffKey: string | null = null
    try {
      if (isStaffAssistant(agentOf(floorOf(floorId), agentId))) staffKey = `${floorId}/${agentId}`
    } catch {
      // No such floor or agent: the open itself says so.
    }
    if (!staffKey) return openChatOnce(floorId, agentId, req, executionGuard, nativeExecutable, by)
    const key = staffKey
    const pending = staffOpening.get(key)
    if (pending) return { ...(await pending), started: false, resumed: false }
    const run = openChatOnce(floorId, agentId, req, executionGuard, nativeExecutable, by)
    staffOpening.set(key, run)
    try {
      return await run
    } finally {
      if (staffOpening.get(key) === run) staffOpening.delete(key)
    }
  }

  async function openChatOnce(floorId: string, agentId: string, req: OpenChatRequest, executionGuard?: () => void, nativeExecutable?: string, by?: ChatActor): Promise<ChatOpened> {
    requireHostAdoption()
    executionGuard?.()
    const managed = floorOf(floorId)
    if (isPcControl(managed) && (req.here || req.takeOver)) throw immutablePcControl()
    requireLegacyExecution(agentOf(managed, agentId), defaultsNow())
    const selected = agentOf(floorOf(floorId), agentId).sessionId
    if (selected) switchFences.assertWritable(selected)
    // F-127: a floor made on this PC while the Server was away is run here, as on a PC alone: no lease, this PC's own Claude sign-in.
    if (mode() === 'member') {
      if (!isLocalFloor(floorId)) return openOnMember(floorId, agentId, req)
      // Order o7e6d: a staff Assistant never starts on a member PC (one on the Server's floors is opened there, just above).
      if (isStaffAssistant(agentOf(floorOf(floorId), agentId))) throw staffError("A person's own Assistant runs on the Server only.")
      if (engineFor(agentOf(floorOf(floorId), agentId)) === 'claude') needClaudeHere()
    }
    let floor = floorOf(floorId)
    let agent = agentOf(floor, agentId)
    let sid = agent.sessionId
    if (!sid && keepsAssistantHistory(agent) && agent.conversationHistory?.length) {
      // Older builds' Close could unbind a session. Restore the last native binding, not a new UUID and not an archive pasted as a prompt.
      const h = agent.conversationHistory.at(-1)!
      if (h.engine !== engineFor(agent) || h.executionProfile) throw apiError(409, 'The Assistant has saved history under another execution. Use a checked history carry-over; nothing was started empty.')
      if (isStaffAssistant(agent)) {
        assertStaffStart(floor, agent)
        // Agent 3's review of 7ab1767: the restored binding is judged BEFORE anything is written, as the agent will be once restored (its session and
        // the home its saved entry names; bindSession clears any other home). A saved conversation whose home is another PC is refused here, so a
        // refused open leaves no binding and no home behind (else that home would go on refusing every later open).
        assertStaffStart(floor, { ...agent, sessionId: h.sessionId, homePc: h.homePc ?? null, homePcName: h.homePc ? h.homePcName || 'Home PC' : null })
        staffRefuseOld(h.sessionId)
      }
      const claimed = floors.bySession(h.sessionId)
      if (claimed && claimed.agent.id !== agent.id) throw apiError(409, 'The saved Assistant conversation is bound elsewhere. Nothing was replaced or taken over.')
      if (assistantHadConversation(agent, h.sessionId)) requireSavedAssistant(historyFile(h.sessionId), true)
      switchFences.assertWritable(h.sessionId)
      floor = floors.bindSession(floor.id, agent.id, h.sessionId)
      if (h.engine === 'codex' && h.codexThread) floor = floors.setCodexThread(floor.id, agent.id, h.codexThread)
      if (h.engine === 'opencode' && h.opencodeSession) floor = floors.setOpenCodeSession(floor.id, agent.id, h.opencodeSession)
      if (h.homePc) floor = floors.setHome(floor.id, agent.id, { id: h.homePc, name: h.homePcName || 'Home PC' })
      agent = agentOf(floor, agentId); sid = agent.sessionId
    }
    // Order o7e6d: a staff Assistant opens here, under the staff policy only; while a run of it without the policy is up here, or any run of it on
    // another PC, the open is refused (P1). (A take-over open is how a member's page reaches it at its home, the Server: run-on, here.)
    if (isStaffAssistant(agent)) {
      assertStaffStart(floor, agent)
      if (sid) staffRefuseOld(sid)
    }
    // S1, B3: the chat bound to it runs here fenced (its lineage, an earlier finding, an untrusted record): it is never handed out as if it were
    // safe; an explicit stop replaces it, then the open starts it afresh.
    if (sid && chats.info(sid) && runFenced(sid)) throw fencedOpenError(sid)
    if (sid && chats.info(sid)) {
      const actual = chats.info(sid)!.engine
      requireRunningEngine(engineFor(agent), actual)
      return { sessionId: sid, started: false, resumed: false, engine: actual }
    }
    const atHome = await resumeAtHome(floor, agent, sid, req)
    executionGuard?.()
    if (atHome) return atHome
    const successor = sid ? nativeSuccessorFor(floor, agent, sid) : null
    if (successor) {
      // oc65c: before it stopped it went on in a newer native session (/clear, /resume): it continues THERE, not in the older file. The binding it
      // had stays in its history (bindSession keeps it), and nothing is copied into either native transcript.
      switchFences.assertWritable(successor)
      log?.info(`assistant history: ${agent.name} continues in its newer native session ${successor.slice(0, 8)} (was ${sid!.slice(0, 8)})`)
      floor = floors.bindSession(floor.id, agent.id, successor)
      agent = agentOf(floor, agentId)
      sid = successor
    }
    if (sid && assistantHadConversation(agent, sid)) requireSavedAssistant(historyFile(sid), true)
    if (!sid) {
      sid = randomUUID()
      floor = floors.bindSession(floor.id, agent.id, sid)
    }
    const tookOverFrom = mode() === 'hub' ? await lease(sid, self(), req.takeOver === true, agent.name) : undefined
    try {
      executionGuard?.()
      const now = floorOf(floorId)
      // Who asked, for the start event (chat-log.ts `by`): handed to the start sites through startBy, as startCause is, and forgotten whether or not one used it.
      if (by) startBy.set(sid, by)
      const resumed = await startHere(now, agentOf(now, agentId), sid, req, executionGuard, nativeExecutable)
      executionGuard?.()
      requireRunningEngine(engineFor(agentOf(floorOf(floorId), agentId)), chats.info(sid)?.engine)
      return { sessionId: sid, started: true, resumed, engine: chats.info(sid)!.engine, ...(tookOverFrom ? { tookOverFrom } : {}) }
    } catch (e) {
      if (mode() === 'hub') release(sid, self())
      throw e
    } finally {
      startBy.delete(sid)
    }
  }

  /**
   * Claude subscription failover (agent/claude/failover.ts): the chat stopped and started again, its
   * conversation resumed, on the token in place now (chats.start reads it afresh). It is stopped
   * gently first: a chat sitting at its prompt is told /exit and ends itself, so no process is
   * killed; only one that has not ended after `restartGraceMs` is stopped the way the app stops one
   * (stopAt: chats.kill, its last write sent on, the session let go). Then it is opened the way
   * openChat opens it. A member PC does not: the hub holds the session, so it is restarted there.
   */
  async function restartChat(sid: string, by: ChatActor = APP): Promise<boolean> {
    if (mode() === 'member') return false
    const at = floors.bySession(sid)
    if (at) requireLegacyExecution(at.agent, defaultsNow())
    if (!at || !chats.info(sid)) return false
    // C0: known unsafe staff/policy runs are never stopped by an automatic restart (a subscription switch, a tool-list refresh):
    // only an explicit stop replaces it.
    if (runFenced(sid)) {
      log?.warn(`staff policy: chat ${sid.slice(0, 8)} is quarantined; it is not restarted (stop it, then open it)`)
      return false
    }
    if (chats.info(sid)?.engine === 'opencode') {
      await openCode.abort(sid)
      chats.kill(sid, 'restart')
      await openCode.waitStopped(sid)
      return resumeChat(sid, undefined, by)
    }
    // The same draft rule as every message to a chat: /exit pasted after Shubham's unsent words would be sent WITH them, and a
    // chat stopped under them would lose them. A real draft: nothing is typed, nothing is stopped, 409. (A grey suggestion is not one.)
    if (hasDraft(sid)) throw apiError(409, `${at.agent.name}'s chat has unsent text in its box; nothing was typed and it was not restarted.`)
    if (chats.info(sid)?.state === 'idle' && chats.type(sid, '/exit', { refuseDraft: true })) {
      const until = Date.now() + (o.restartGraceMs ?? 15_000)
      while (chats.info(sid) && Date.now() < until) await new Promise(r => setTimeout(r, 200))
    }
    await stopAt(self().id, sid)
    // Opened again the way F-058 brings chats back after a crash (resumeChat, below): one way to open a chat again.
    return await resumeChat(sid, undefined, by)
  }

  // ---------------------------------------------------------------------------------------
  // F-058: the chats that were open when the app stopped come back (recover.ts)

  async function resumeChat(sid: string, text?: string, by: ChatActor = APP): Promise<boolean> {
    await adopted
    if (team?.role() === 'member') return false
    const at = floors.bySession(sid)
    if (!at) return false
    // F-221 (T4 phase 2; T4 review): a chat a spoken line holds is held again (a residual hold) as it starts, before the carry-on is typed: startHere
    // does it (heldStart) for every way a chat starts, this one included.
    try {
      // Here: it was open on this PC when the app stopped (or needs its token again), so it comes back on this PC.
      // `by` is the app UNLESS a person's call asked for the restart (the restart route passes the caller's actor, Agent 6's review R2): recovery after a stop, a failover restart, a
      // refresh of the tool list and a lost host are the app bringing a chat back and keep the default; filing a person's own Restart as the app would be a false attribution.
      const opened = await openChat(at.floor.id, at.agent.id, isPcControl(at.floor) ? {} : { here: true }, undefined, undefined, by)
      // oc65c: an Assistant that went on in a newer native session reopens THERE, so the carry-on goes to the session that was opened.
      if (opened.started && text) chats.typeWhenReady(opened.sessionId, text)
      return opened.started || chats.info(opened.sessionId) !== null
    } catch (e) {
      log?.warn(`couldn't reopen chat ${sid.slice(0, 8)}: ${message(e)}`)
      return false
    }
  }

  /** The chats open now, written down for the next start. */
  function noteOpen() {
    if (!recovery) return
    const open: Remembered[] = []
    for (const [sid, state] of Object.entries(chats.states())) {
      const info = chats.info(sid)
      if (info) open.push({ sessionId: sid, floorId: info.floorId, agentId: info.agentId, state })
    }
    recovery.note(open)
  }

  let resumeTimer: NodeJS.Timeout | null = null
  /** F-083: false from the start until recovery has reopened its list (or when there is none to wait for: true at once). */
  let recoveryDone = !o.resumeChats || team?.role() === 'member'
  /**
   * F-221 (ob98a, fix rounds 2 and 3): the hub knows where its chats are: the chat host's chats are taken over, start-up recovery has reopened its
   * list, and no lost chat host link is still being settled (hostSettling: until the link is back and its reopen loop is over). Before that a chat
   * that is not seen is not known to have stopped: a spoken order's hold stays, and a direct line starts no Orchestrator of its own.
   */
  const chatsKnown = () => hostAdopted && recoveryDone && !hostSettling
  if (o.resumeChats && team?.role() !== 'member') {
    const mine = createRecovery(path.join(o.dir, 'open-chats.json'), { log })
    recovery = mine
    resumeTimer = setTimeout(() => {
      resumeTimer = null
      void (async () => {
        // The chats still running in the chat host are the pool's by now; only the others are reopened.
        await adopted
        const list = mine.pending
        if (list.length) log?.info(`recovery: reopening ${list.length} chat${list.length === 1 ? '' : 's'} that ${list.length === 1 ? 'was' : 'were'} open when the app stopped`)
        let n = 0
        for (const r of list) {
          if (closing) return
          if (chats.info(r.sessionId)) continue
          const carryOn = r.state === 'running' || r.state === 'question'
          const ok = await resumeChat(r.sessionId, carryOn ? CONTINUE_TEXT : undefined)
          log?.info(`recovery: chat ${r.sessionId.slice(0, 8)} ${ok ? `reopened${carryOn ? ', told to carry on' : ''}` : 'could not be reopened'}`)
          if (++n < list.length) await new Promise(res => setTimeout(res, o.resumeGapMs ?? 2000))
        }
        if (closing) return
        // The list is used: from now on it follows the chats.
        mine.arm()
        recoveryDone = true
        noteOpen()
      })()
    }, o.resumeAfterMs ?? 4000)
    resumeTimer.unref()
  }

  // ---------------------------------------------------------------------------------------
  // The tools (tools.ts), for the chat whose key came with the call

  const pairLast = new Map<string, number>()
  const targetHits = new Map<string, number[]>()
  const broadcastLast = new Map<string, number>()
  /**
   * F-297: the checks a STAFF send asks again while it is delivered (its person's switch, its policy, the person's right on the target), kept by the Caller object THAT send passes as `actor`; deliveryAcl and typeInto read
   * them. A WeakMap, so nothing is kept after the send, and only staffSendToChat ever registers one: every other caller is asked nothing more than before.
   */
  const liveChecks = new WeakMap<object, () => boolean>()

  /** Counts a message against the cooldowns; returns what takes it back (a message the chat refused because of a draft starts no cooldown). */
  function relayAllowed(from: string, to: string): () => void {
    const t = Date.now()
    const pair = `${from}>${to}`
    const pairBefore = pairLast.get(pair)
    if (t - (pairBefore ?? 0) < PAIR_COOLDOWN_MS) throw apiError(429, 'You just messaged that chat; give it a few seconds to answer before sending again.')
    const before = targetHits.get(to) ?? []
    const hits = before.filter(x => t - x < TARGET_WINDOW_MS)
    if (hits.length >= TARGET_WINDOW_MAX) throw apiError(429, 'That chat has had too many messages this minute; wait before sending more.')
    pairLast.set(pair, t)
    targetHits.set(to, [...hits, t])
    return () => {
      if (pairBefore === undefined) pairLast.delete(pair)
      else pairLast.set(pair, pairBefore)
      targetHits.set(to, hits)
    }
  }
  /**
   * typeInto for a message that counted against the cooldowns: if the chat refuses it (409, his draft) the count is taken back. F-221 (review of T2):
   * `unsure` (his tap on a held message) reads a member PC's lost answer as delivery-unconfirmed, so the card is used up and never sent twice.
   */
  const typeIntoOrUndo = (undo: () => void, c: { sessionId: string; id: string }, body: string, uncertain?: () => void, actor?: Caller, unsure = false) =>
    typeInto(c, body, { confirmed: true, caller: actor, ...(unsure ? { unconfirmedThrows: true } : {}) }).then(ok => { if (!ok) undo(); return ok }).catch(e => {
      if (e?.code === 'delivery-unconfirmed' || e?.code === 'delivery-pending') uncertain?.()
      else undo()
      throw e
    })
  /** F-297: whether the checks a STAFF send registered (liveChecks) still hold, asked right before a write; a caller that registered none is never refused by this. */
  const stillAllowed = (c: { sessionId: string }, opt: { caller?: Caller }) => !opt.caller || !liveChecks.has(opt.caller) || deliveryAcl(opt.caller, c.sessionId)

  function rosterOf(floor: Floor, me: FloorAgent) {
    const byId = new Map(floor.agents.map(a => [a.id, a]))
    const where = whereAll()
    const agents = floor.agents.map(a => {
      const live = a.sessionId ? where[a.sessionId] : undefined
      return {
        name: a.name,
        role: a.role,
        isBoss: a.isBoss,
        reportsTo: a.reportsTo ? (byId.get(a.reportsTo)?.name ?? null) : null,
        status: live ? 'online' : a.sessionId ? 'offline' : 'never opened',
        doing: live ? live.state : null,
        pc: live ? live.name : null,
        sessionId: live ? a.sessionId : null,
        isYou: a.id === me.id,
      }
    })
    const online = agents.filter(a => a.status === 'online').length
    return { floor: floor.name, total: agents.length, online, offline: agents.length - online, agents }
  }

  /** A running chat on the caller's floor (on any of the hub's PCs), by the id list_chats gave. */
  function siblingOf(floor: Floor, sid: unknown): { sessionId: string; id: string } {
    if (typeof sid !== 'string' || !sid) throw apiError(400, 'sessionId is missing')
    const w = whereAll()[sid]
    if (!w || bySession(sid)?.floor.id !== floor.id) throw apiError(404, `No running chat ${sid} on your floor; list_chats shows the ones there are`)
    return { sessionId: sid, id: w.id }
  }

  /** F-029: a running chat anywhere in the app (any floor, any PC). */
  function anyChat(sid: unknown): { sessionId: string; id: string } {
    if (typeof sid !== 'string' || !sid) throw apiError(400, 'sessionId is missing')
    const w = whereAll()[sid]
    if (!w) throw apiError(404, `No running chat ${sid}; app_chats shows which are running`)
    return { sessionId: sid, id: w.id }
  }

  /** F-029: an agent by its floor's and its own name (or ids). */
  function findAgent(floorRef: unknown, agentRef: unknown): { floor: Floor; agent: FloorAgent } {
    const want = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '')
    const fw = want(floorRef)
    const f = floors.list().find(x => x.id === floorRef || x.name.trim().toLowerCase() === fw)
    if (!f) throw apiError(404, `No floor called ${String(floorRef)}`)
    const aw = want(agentRef)
    const a = f.agents.find(x => x.id === agentRef || x.name.trim().toLowerCase() === aw)
    if (!a) throw apiError(404, `No agent called ${String(agentRef)} on ${f.name}`)
    return { floor: f, agent: a }
  }

  async function readChat(c: { sessionId: string; id: string }, lines: number): Promise<string> {
    if (c.id === self().id) return chats.read(c.sessionId, lines) ?? ''
    const link = team?.member(c.id)
    if (!link) throw apiError(409, "That chat's PC can't be reached right now")
    return request<string>(link, 'read', { sessionId: c.sessionId, lines })
  }

  /**
   * What the chat's screen shows right now, as lines of text (not its scroll-back: that still holds menus long gone). This PC's chat: its
   * screen model; another PC's: that PC's, over the link. Null when the screen can't be had (an older PC that has no such request).
   */


  // The one key a Cancel button presses (the member PC's 'keys' request takes it, and digits, nothing else).
  const ESC_KEY = String.fromCharCode(27)

  /**
   * What a waiting chat asks, off its live screen only: options come from the menu drawn now, never from older text above a newer
   * footer. Where the screen can't be had, the scroll-back gives the words around it but no buttons (nothing is pressed from stale text).
   */
  async function promptOfChat(c: { sessionId: string; id: string }) {
    let native: NativeApprovalSnapshot | null = null
    const runtime = approvalRuntime(c.sessionId, c.id)
    try {
      if (c.id === self().id) native = localApprovalSnapshot(c.sessionId, null)
      else {
        const link = team?.member(c.id)
        if (link) native = nativeApprovalSnapshot(await request(link, 'approval-snapshot-v1', { version: 1, pcId: c.id, sessionId: c.sessionId }), c.id, c.sessionId)
      }
      if (native && c.id !== self().id && (native.proof.hubId !== self().id || native.proof.hubEpoch === null)) native = null
    } catch { /* Missing/malformed/old peers never get a legacy keys fallback. */ }
    if (!native) return { menu: null, context: 'This PC needs a current app and a live native prompt before approvals can be used.', cancellable: false,
      id: createHash('sha256').update(JSON.stringify([promptEpoch, c, 'unsupported'])).digest('hex'), native: null }
    const p = native.proof
    return { menu: menuIfOn(native.menu), context: native.context, cancellable: native.cancellable,
      id: createHash('sha256').update(JSON.stringify([promptEpoch, c.sessionId, c.id, runtime, p.targetEpoch, p.generation, p.hubId, p.hubEpoch, p.floorId, p.agentId, p.promptId])).digest('hex'), native }
  }

  /** M1: a chat waiting at a permission prompt or a menu is never typed into (Enter would pick the highlighted option). The words for a person or an agent. */
  // On this PC the screen decides (a phantom guess from plain words is put right); on another PC the state it reports.
  const atPrompt = (sessionId: string) => (chats.info(sessionId) ? chats.asking(sessionId) : whereAll()[sessionId]?.state === 'question')
  const promptWords = (sessionId: string) => `${floors.bySession(sessionId)?.agent.name ?? 'That agent'}'s chat is waiting at a prompt (Approvals tab); nothing was typed. Try again once it is answered.`

  // A draft: unsent text in a chat's idle input box (Shubham is typing there). A message pasted now would join it and one Enter would
  // send both. Messages from agents and the app wait or are refused; his own say() from the chat view is his text joining his draft.
  // Known only for chats on this PC (their screens); another PC's chats are typed into as before.
  const hasDraft = (sessionId: string) => (chats.info(sessionId) ? chats.drafting(sessionId) : false)
  const draftWords = (sessionId: string) => `${floors.bySession(sessionId)?.agent.name ?? 'That agent'}'s chat has unsent text in its box; try again shortly.`
  // 10 Nov 2026 (Shubham): a message joins the text in a CLAUDE chat's box (old direct send). A native Codex chat's own sender never types over
  // text it did not paste, so for a Codex chat the refusal stays, and says so honestly instead of reporting a send that typed nothing.
  const joinsDraft = (sessionId: string) => { const at = floors.bySession(sessionId); return !at || engineFor(at.agent) !== 'codex' }
  // A plain native Claude chat (not Codex, OpenCode or Codex in Claude Code): agent messages to it use the old direct send (see typeInto).
  const oldWayForClaude = (sessionId: string) => {
    if (o.checkAgentMessages ?? (process.env.SAD_CHECK_AGENT_MESSAGES === '1' || existsSync(path.join(o.dir, '..', 'check-agent-messages.on')))) return false
    const at = floors.bySession(sessionId)
    if (!at) return false
    try { return requireLegacyExecution(at.agent, defaultsNow()) === 'claude' } catch { return false }
  }

  /**
   * F-221 (ob98a, review of T2): a 'type' request to a member PC whose answer was lost after it was sent (502 no answer, 504 no answer in time) may
   * have typed all the same. Read as "not typed" (false) as before, unless the caller must never take that for sure (a spoken line, his tap on a
   * held message): then it is delivery-unconfirmed, as callTool already says for a member's own sends. Fix round 2: a stream that never opened
   * (roam.ts request: `sent: false`) carried nothing to that PC: that is "not typed" for certain, for every caller.
   */
  const lostAnswer = (e: unknown, opt: { unconfirmedThrows?: boolean }): false => {
    if (opt.unconfirmedThrows && isObject(e) && e.sent !== false && (e.status === 502 || e.status === 504)) {
      throw Object.assign(apiError(409, 'Delivery is not confirmed: the link to that PC failed before it answered, so the message may already be typed. Inspect the destination; do not resend.'), { code: 'delivery-unconfirmed' })
    }
    return false
  }

  /**
   * Types `body` into a chat here or on a member PC.
   * 10 Nov 2026, Shubham's order ("remove the rule"): a CLAUDE chat is no longer refused because its box holds unsent text (an agent's message,
   * a broadcast, a nudge, an order's reply). The confirmed sender never types over text it did not paste, so when it finds a draft it
   * reports 'blocked'; the message then goes in the OLD direct way instead: pasted after the text, one Enter, no receipt. That is what the
   * old app did, and it unblocks a chat whose box holds a stuck paste. Prompts/menus are still never pressed Enter on (atPrompt guards
   * the callers). A restart (/exit) still refuses a draft: that is not a message. A Codex chat keeps the refusal (see joinsDraft).
   * F-221 (review of T2): `unconfirmedThrows`: a member PC's lost answer is delivery-unconfirmed, never "not typed" (lostAnswer).
   */
  async function typeInto(c: { sessionId: string; id: string }, body: string, opt: { human?: boolean; confirmed?: boolean; caller?: Caller; unconfirmedThrows?: boolean } = {}): Promise<boolean> {
    // 10 Nov 2026, Shubham ("before Codex everything worked"): a message from an agent (agent tools, broadcast, order reply) to a NATIVE CLAUDE
    // chat goes the old direct way again: one paste, one Enter, no receipt, no confirmation, no retry. The checked sender stayed for the chats
    // that need it (Codex, OpenCode, Codex in Claude Code). It also ends the stuck "[Pasted text #N]": Claude Code collapses a long paste, the
    // checked sender could not recognise its own text and never pressed Enter. Never sends twice: there is no retry.
    const confirmed = opt.confirmed === true && !oldWayForClaude(c.sessionId)
    assertMessageRuntime(c.sessionId,c.id,confirmed)
    const refuseDraft = false
    // F-297: a STAFF send (the caller registered its live checks) NEVER joins unsent text, on any path: the hub looked first (staffSendToChat), and this is the last step, at the write itself.
    const staffSend = !!opt.caller && liveChecks.has(opt.caller)
    if (confirmed) {
      let result: unknown, diagnostic: DeliveryReceipt | null = null
      if (c.id === self().id) {
        const delivery = await confirmedDelivery(c.sessionId, body, refuseDraft, opt.caller, r => { diagnostic = r })
        result = delivery === 'blocked' && chats.drafting(c.sessionId) ? 'draft' : { delivery }
      }
      else {
        const at = bySession(c.sessionId)
        if (!at) return false
        // Observe the one native operation; timing out this tool does not end
        // that operation or turn a known pending receipt into a final failure.
        const observation: { receipt: DeliveryReceipt | null } = { receipt: null }
        const tracking = remoteNativeDelivery(c.id, c.sessionId, body, 'agent-message', randomUUID(), deliveryBinding(at.agent), opt.caller, undefined, r => { observation.receipt = r }).catch(() => null)
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          const receipt = await Promise.race([tracking, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 18_000) })])
          diagnostic = receipt ?? observation.receipt
          result = receipt?.blockedByDraft ? 'draft' : { delivery: diagnostic?.state ?? 'unconfirmed' }
        } finally { clearTimeout(timer) }
      }
      if (result === 'draft') {
        // F-297: a staff send NEVER joins unsent text (it is a person's own words, and the Enter that follows would submit them with it).
        if (!joinsDraft(c.sessionId) || staffSend) throw apiError(409, draftWords(c.sessionId))
        // Nothing was typed by the confirmed sender. Send the old direct way, joining the unsent text.
        log?.info(`chat ${c.sessionId.slice(0, 8)}: the box holds unsent text; the message is typed the old direct way after it (no receipt)`)
        if (c.id === self().id) {
          refuseFencedHere(c.sessionId)
          await mirrorYields(c.sessionId)
          return chats.type(c.sessionId, body)
        }
        const peerLink = team?.member(c.id)
        if (!peerLink) return false
        return (await request<boolean | 'draft'>(peerLink, 'type', { sessionId: c.sessionId, text: body }).catch(e => lostAnswer(e, opt))) === true
      }
      const delivery = isObject(result) ? result.delivery : undefined
      if (delivery === 'sent') return true
      if (delivery === 'blocked') throw Object.assign(apiError(409, blockDescription(diagnostic)), { code: 'delivery-blocked' })
      if (delivery === 'gone') return false
      if (delivery === 'pending') throw Object.assign(apiError(409, `Delivery is still in progress${diagnostic ? ` (receipt ${diagnostic.id})` : ''}; the tool's observation window ended, not the native send. Wait for this same operation and inspect the destination; never resend or automatically press Enter.`), { code: 'delivery-pending' })
      throw Object.assign(apiError(409, 'Delivery is not confirmed; the one pending message may already have been submitted, may still complete, or may remain in the composer. Inspect the destination; do not automatically press Enter or resend.'), { code: 'delivery-unconfirmed' })
    }
    if (c.id === self().id) {
      // A message the caller wanted confirmed (an agent's message, a broadcast) that the old way sends directly: a fenced chat refuses it as the
      // confirmed way would. Every other caller (tune, effort, a direct send, the Assistant's lines) keeps its own answer for a chat that takes nothing.
      if (opt.confirmed === true) refuseFencedHere(c.sessionId)
      await mirrorYields(c.sessionId)
      // F-297: the last step before the write: a staff send asks its checks again (nothing for any other caller).
      if (!stillAllowed(c, opt)) return false
      return chats.type(c.sessionId, body, refuseDraft || staffSend ? { refuseDraft: true } : undefined)
    }
    const link = team?.member(c.id)
    if (!link) return false
    if (!stillAllowed(c, opt)) return false
    const r = await request<boolean | 'draft'>(link, 'type', { sessionId: c.sessionId, text: body, ...(refuseDraft || staffSend ? { refuseDraft: true } : {}) }).catch(e => lostAnswer(e, opt))
    if (r === 'draft') throw apiError(409, draftWords(c.sessionId))
    return r === true
  }

  /**
   * Order o7e6d S1 (Lead's decision (1)b): a MESSAGE (the caller asked for a confirmed delivery) that the old way types directly into a chat of
   * THIS PC that is fenced (runFenced) is refused the way the confirmed way refuses it: 409 code delivery-blocked with the staff-runtime words,
   * before anything is typed. Before, chats.type (which the fence refuses) only returned false and the agent tools said "That chat stopped
   * before the message reached it", which is not true: the chat runs and takes nothing. Unfenced chats, the other PCs' paths and every caller
   * that did not ask for a confirmed delivery (tune, effort, a direct send, the Assistant's lines: each keeps its own answer) are unchanged.
   */
  function refuseFencedHere(sid: string) {
    if (!runFenced(sid)) return
    logDeliveryBlock(sid, 'staff-runtime')
    throw Object.assign(apiError(409, `${deliveryBlockWords('staff-runtime')} [staff-runtime]`), { code: 'delivery-blocked' })
  }

  /** o4743: the running chat a draft question is about, after the access check (the same as typing in it); where it runs is `pcId`. */
  function draftTarget(id: string, agentId: string, r: Parameters<typeof callerOf>[0]): { sessionId: string; pcId: string } {
    const agent = agentOf(floorOf(id), agentId)
    access.needChat(callerOf(r), agent, 'type', 'draft')
    const sessionId = agent.sessionId, live = sessionId ? whereAll()[sessionId] : undefined
    if (!sessionId || !live) throw apiError(409, "This chat isn't running, so it has no input line.")
    if (switchFences.blocked(sessionId)) throw apiError(409, 'This chat is changing engines. Try again when it has finished.')
    return { sessionId, pcId: live.id }
  }
  const olderPc = (e: unknown) => (e as { code?: string })?.code === 'unknown-op' || /this PC doesn't do draft-/i.test(message(e))
  async function draftAt(id: string, agentId: string, r: Parameters<typeof callerOf>[0], op: 'draft-read'): Promise<unknown> {
    const t = draftTarget(id, agentId, r)
    if (t.pcId === self().id) return chats.draftView?.(t.sessionId) ?? null
    const link = team?.member(t.pcId)
    if (!link) throw apiError(409, 'That chat runs on another PC that is not connected right now. Open the terminal there.')
    try { return readDraftView(await request<unknown>(link, op, { sessionId: t.sessionId }, 5000)) }
    catch (e) { throw apiError(409, olderPc(e) ? 'That chat runs on a PC with an older build that cannot show its input line from here. Open the terminal.' : 'That PC did not answer. Open the terminal.') }
  }
  async function clearDraftAt(id: string, agentId: string, r: Parameters<typeof callerOf>[0]): Promise<unknown> {
    const t = draftTarget(id, agentId, r)
    log?.info(`chat ${t.sessionId.slice(0, 8)}: clear the input line asked from the page (${callerOf(r).person ? `person ${callerOf(r).person!.id}` : 'app'})`)
    if (t.pcId === self().id) return chats.clearDraft?.(t.sessionId) ?? { result: 'unsupported', draft: null }
    const link = team?.member(t.pcId)
    if (!link) throw apiError(409, 'That chat runs on another PC that is not connected right now. Open the terminal there.')
    try { return readDraftClear(await request<unknown>(link, 'draft-clear', { sessionId: t.sessionId }, 8000)) }
    catch (e) { throw apiError(409, olderPc(e) ? 'That chat runs on a PC with an older build that cannot clear its input line from here. Open the terminal.' : 'That PC did not answer. Open the terminal.') }
  }

  /** F-193: before an agent's message the live mirror's own text is taken out of the line (and typed back after it); while he types: refused (409). */
  async function mirrorYields(sid: string) {
    const r = await (chats.mirrorTakeOut?.(sid) ?? Promise.resolve('none'))
    if (r === 'typing' || r === 'failed') throw apiError(409, draftWords(sid))
  }

  const logDeliveryBlock = (sid: string | null, reason: DeliveryBlockReason) => log?.warn(`chat ${sid?.slice(0, 8) ?? 'unbound'}: delivery blocked (${reason})`)
  const blockDescription = (r: Pick<DeliveryReceipt, 'reason' | 'targetPcName'> | null | undefined) => r?.reason
    ? `${deliveryBlockWords(r.reason, r.targetPcName)} [${r.reason}]`
    : 'The destination refused this send without a specific diagnostic. Inspect the terminal before another send. [peer-blocked]'
  const messageReceipts = createDeliveryReceipts(path.join(o.dir, 'message-receipts.json'))
  // One log line for every send that ended here (sent, unconfirmed, gone) with which branch ended it and when each step happened: milliseconds
  // and codes only, never the message. It is how a false "unconfirmed" is explained afterwards.
  const nativeReceipts = createDeliveryReceipts(path.join(o.dir, 'native-delivery-receipts.json'), { onFinal: (r, diag) => {
    if (r.state === 'blocked' || !diag) return
    const line = `chat ${r.sessionId?.slice(0, 8) ?? 'unbound'}: delivery ${r.state} (${diagnosticWords(diag)})`
    if (r.state === 'sent') log?.info(line); else log?.warn(line)
  } })
  const humanInputGrants = createHumanInputGrants()
  const deliveryActor = (r?: { caller?: Caller }) => r?.caller?.person ? `person:${r.caller.person.id}` : JSON.stringify(r?.caller ?? OPEN)
  const deliveryBinding = (a: FloorAgent) => {
    const execution = executionIdentityOf(a, defaultsNow())
    return JSON.stringify([a.sessionId, execution.engine, a.codexThread ?? null, a.opencodeSession ?? null, a.homePc ?? null,
      ...(a.executionProfile !== undefined || a.executionRevision !== undefined
        ? [execution.profile, execution.provider, execution.harness, execution.transcript, a.executionRevision ?? 0] : [])])
  }
  function advanceDeliveryBinding(binding: string, a: FloorAgent): string | null {
    const current = deliveryBinding(a)
    if (binding === current) return binding
    // Learning the first native ID on this same runtime is not a conversation switch.
    try {
      const before: unknown = JSON.parse(binding), after: unknown[] = JSON.parse(current)
      if (!Array.isArray(before) || before.length !== after.length) return null
      const slot = engineFor(a) === 'codex' ? 2 : engineFor(a) === 'opencode' ? 3 : -1
      if (slot < 0 || before[slot] !== null || typeof after[slot] !== 'string') return null
      return before.every((v, i) => i === slot || v === after[i]) ? current : null
    } catch { return null }
  }
  const deliveryAcl = (actor: Caller, sid: string) => {
    // F-297: a staff send's own checks (its person's switch, its policy, the scope) are asked here too; nothing is registered for any other actor.
    try { const at = bySession(sid); return !!at && (access.needChat(actor, at.agent, 'type', 'message delivery'), true) && (liveChecks.get(actor)?.() ?? true) } catch { return false }
  }
  function sayIntent(raw: unknown): Omit<SayRequest, 'text'> {
    if (!isObject(raw)) return {}
    if (raw.messageId !== undefined && (typeof raw.messageId !== 'string' || !UUID_RE.test(raw.messageId))) throw apiError(400, 'messageId must be a UUID')
    if (raw.expectedSessionId !== undefined && raw.expectedSessionId !== null && (typeof raw.expectedSessionId !== 'string' || !validTransferSid(raw.expectedSessionId))) throw apiError(400, 'expectedSessionId must be the captured session ID or null')
    return { ...(raw.messageId !== undefined ? { messageId: String(raw.messageId) } : {}), ...(raw.expectedSessionId !== undefined ? { expectedSessionId: raw.expectedSessionId as string | null } : {}) }
  }

  function beginNativeDelivery(sessionId: string, body: string, owner: string, messageId?: string, expectedBinding?: string, extraGuard?: () => boolean, authorize?: (phase: HumanInputPhase) => Promise<boolean>) {
    assertMessageRuntime(sessionId,self().id,true)
    const at = bySession(sessionId)
    if (!at) throw apiError(409, 'The destination conversation changed. Nothing was submitted.')
    const { floor, agent } = at
    return nativeReceipts.begin({ id: messageId, owner, floorId: floor.id, agentId: agent.id, text: body, expectedSessionId: sessionId }, async (bind, noteBlocked, note) => {
      const generation = chats.generation?.(sessionId)
      let binding = expectedBinding ?? deliveryBinding(agent)
      let reason: DeliveryBlockReason | undefined
      const fail = (code: DeliveryBlockReason) => { reason = code; return false }
      const refuse = () => { const code = reason ?? 'preflight-failed'; logDeliveryBlock(sessionId, code); return noteBlocked(code) }
      const valid = () => {
        const current = bySession(sessionId), runtime = chats.info(sessionId)
        if (closing) return fail('agent-closing')
        if (!current || current.floor.id !== floor.id || current.agent.id !== agent.id) return fail('binding-changed')
        if (!runtime) return fail('runtime-unavailable')
        if (chats.generation?.(sessionId) !== generation) return fail('generation-changed')
        if (runtime.engine !== engineFor(current.agent)) return fail('runtime-mismatch')
        if (switchFences.blocked(sessionId)) return fail('switch-in-progress')
        const advanced = advanceDeliveryBinding(binding, current.agent)
        if (!advanced) return fail('binding-changed')
        binding = advanced
        try { assertMessageRuntime(sessionId,self().id,true) } catch { return fail('runtime-mismatch') }
        try { assertPcControlTarget(current.floor, self().id, {}) } catch { return fail('pc-control-denied') }
        return extraGuard?.() === false ? fail('authorization-revoked') : true
      }
      if (!generation) { reason = 'runtime-unavailable'; return refuse() }
      if (!valid()) return refuse()
      bind(sessionId, generation, false)
      const state = await chats.deliver?.(sessionId, body, { refuseDraft: true, waitUntilReady: true, waitForOutcome: true, guard: valid, authorize, human: owner !== 'agent-message', onBlocked: code => { reason ??= code }, onReport: report => note(report) }) ?? 'unconfirmed'
      return state === 'blocked' ? refuse() : state
    })
  }

  /** Tool callers retain a bounded observation window; the one native transaction continues. */
  async function confirmedDelivery(sessionId: string, body: string, _refuseDraft: boolean, actor?: Caller, onResult?: (receipt: DeliveryReceipt) => void) {
    try {
      const at = bySession(sessionId)
      if (!at) return 'gone' as const
      const owner = 'agent-message', receipt = beginNativeDelivery(sessionId, body, owner, undefined, undefined, actor ? () => deliveryAcl(actor, sessionId) : undefined)
      const final = await nativeReceipts.wait(receipt.id, owner, at.floor.id, at.agent.id)
      if (final) onResult?.(final)
      return final?.state ?? 'unconfirmed' as const
    } catch { return 'unconfirmed' as const }
  }

  function validReceipt(raw: unknown, id: string): raw is DeliveryReceipt {
    return isObject(raw) && raw.id === id && ['pending','sent','blocked','unconfirmed','gone'].includes(String(raw.state)) && (raw.sessionId === null || typeof raw.sessionId === 'string') && (raw.generation === null || typeof raw.generation === 'string') && typeof raw.started === 'boolean' && typeof raw.updatedAt === 'string' && (raw.reason === undefined || isDeliveryBlockReason(raw.reason)) && (raw.targetPcName === undefined || typeof raw.targetPcName === 'string' && raw.targetPcName.length <= 120)
  }

  /** The initial request is sent once. A broken response changes the operation into status-only observation. */
  async function remoteNativeDelivery(pcId: string, sid: string, body: string, owner: string, id: string, binding: string, actor?: Caller, humanAuthority?: () => boolean, onObservation?: (receipt: DeliveryReceipt | null) => void): Promise<(DeliveryReceipt & { blockedByDraft?: boolean }) | null> {
    assertLegacySid(sid)
    const peer = () => team?.member(pcId) ?? null
    const first = peer()
    const refuse = (reason: DeliveryBlockReason): DeliveryReceipt => {
      logDeliveryBlock(sid, reason)
      return { id, state: 'blocked', sessionId: sid, generation: null, started: false, updatedAt: new Date().toISOString(), reason, targetPcName: first?.name.slice(0, 120) }
    }
    if (!first) return refuse('peer-unreachable')
    let support: unknown
    try { support = await request<unknown>(first, 'delivery-capabilities', {}, 3000) }
    catch (error) {
      const old = (error as { code?: string }).code === 'unknown-op' || /this PC doesn't do delivery-capabilities/i.test(message(error))
      log?.warn(`chat ${sid.slice(0, 8)}: delivery capability check (${old ? 'unknown-operation' : 'no-capability-answer'})`)
      return refuse(old ? 'peer-delivery-unsupported' : 'peer-unreachable')
    }
    if (!isObject(support) || support.version !== 1 || support.idempotent !== true) {
      log?.warn(`chat ${sid.slice(0, 8)}: delivery capability check (missing-capability-fields)`)
      return refuse('peer-delivery-unsupported')
    }
    if (humanAuthority && support.humanInputAuthorization !== 1) return refuse('peer-authorization-unsupported')
    const target = bySession(sid)
    if (!target) return refuse('binding-changed')
    const currentBinding = advanceDeliveryBinding(binding, target.agent)
    if (!currentBinding) return refuse('binding-changed')
    if (actor && !deliveryAcl(actor, sid)) return refuse('access-denied')
    binding = currentBinding
    const grant = humanAuthority ? humanInputGrants.register(pcId, first.token, id, sid, humanAuthority) : null
    if (humanAuthority && !grant) return refuse('authorization-revoked')
    try {
    let raw: unknown = await request(first, 'type', { sessionId: sid, text: body, refuseDraft: true, confirmDelivery: true, messageId: id, owner, expectedBinding: binding, floorId: target.floor.id, agentId: target.agent.id, targetPcId: pcId, actor, ...(grant ? { humanAuthorization: grant.nonce } : {}) }, 16_000).catch(() => null)
    const deadline = Date.now() + 300_000
    for (;;) {
      const r = isObject(raw) ? raw.receipt : null
      onObservation?.(validReceipt(r, id) ? r : null)
      if (validReceipt(r, id) && r.state !== 'pending') {
        if (r.state === 'blocked') {
          logDeliveryBlock(sid, r.reason ?? 'peer-blocked')
          // Older senders could call a post-paste menu 'blocked'. Without a
          // specific pre-input diagnostic, preserve uncertainty and its fence.
          if (!r.reason) return { ...r, state: 'unconfirmed' }
        }
        return { ...r, ...(r.state === 'blocked' && r.reason === 'draft' ? { blockedByDraft: true } : {}) }
      }
      if (raw !== null && !validReceipt(r, id)) return null
      if (Date.now() >= deadline || closing) return validReceipt(r, id) ? { ...r, state: 'unconfirmed' } : null
      await new Promise<void>(resolve => setTimeout(resolve, 500))
      const link = peer()
      raw = link ? await request(link, 'delivery-status', { messageId: id, owner, floorId: target.floor.id, agentId: target.agent.id, targetPcId: pcId }, 6000).catch(() => null) : null
    }
    } finally { grant?.close() }
  }

  // F-076: what was answered and sent as the person (viewable), and the cards the assistant prepared (never sent by it).
  const approvalLog = createApprovalLog(path.join(o.dir, 'approvals.jsonl'))
  /**
   * o66aa / o7e97 (Lead's ruling on Agent 3's record-ordering point): an answer's record is written AFTER its key, never before (a row claiming
   * a decision that never happened is worse in an accountability record than a gap). A write that fails is never silent: the answer stands (its
   * key was typed), and the record that could not be written is kept here with the person, the prompt and the choice, for the owner to see
   * (his overlay's cards, GET /approvals/log, the heartbeat once) and in the hub's log, so it can be written up by hand. Since this run only.
   */
  const unrecorded: ApprovalLogEntry[] = []
  let unrecordedCount = 0, unrecordedTold = 0
  function recordAnswer(e: Omit<ApprovalLogEntry, 'at'>) {
    try {
      approvalLog.add(e)
    } catch (err) {
      unrecorded.unshift({ at: new Date().toISOString(), ...e })
      unrecorded.splice(50)
      unrecordedCount++
      log?.error(`approvals: an answer's record could not be written (${message(err)}): ${e.by} answered prompt ${e.promptId ?? '?'} in ${e.agent} on ${e.floor}: ${e.choice ?? e.detail}`)
    }
  }
  // F-294 (his o8c55, "give button ignroe pleae"): the prompts each person has hidden from their own cards. This is only the LIVE set, in memory (approval-ignores.ts says why); who
  // ignored what, and when, is in the approvals log (kinds ignore and restore: ids and kinds only, never what a prompt said). Nothing here ever touches a chat.
  const ignores = createApprovalIgnores({ graceMs: o.approvalIgnoreGraceMs })
  /** Lets go the ignores of every chat that is no longer at a question (answered, ended, gone). Nothing to look at while nothing is ignored. */
  function sweepIgnores() {
    if (!ignores.size()) return
    const where = whereAll()
    ignores.sweep(sid => where[sid]?.state === 'question')
  }
  // The phones (browsers) whose signature an approval or a send needs: registered once, here on the hub.
  // F-081: the switch the guard's night-watch reads (auto-update.json in this folder).
  const autoUpdate = createAutoUpdate(path.join(o.dir, 'auto-update.json'))
  const prepared = new Map<string, PreparedCard>()
  const PREPARED_MAX = 20
  // F-072: the orders the overlay Assistant gives, and the replies that come back to it (orders.ts).
  // Only the hub keeps them: a member's tool calls are run by the hub (callTool).
  // F-087: where a hand-off's answer and progress go (the fast Assistant's session registers them: handoff.listen below).
  const fastLinks: { onReturn?: (order: Order, text: string) => Promise<boolean>; onProgress?: (p: OrderProgress) => void } = {}
  // F-221 (ob98a): live talk's safety, in code. Spoken words never approve, pay, delete or publish. The tap-to-send cards (talk-cards.ts): what a
  // holding connection hands off, and what the Orchestrator wants to send to another chat while a direct line holds it, wait there for his tap.
  // The spoken latch (talk-latch.ts): which spoken orders hold the Orchestrator's tools now (toolFor decides by it), read from the open orders only
  // (orders.json keeps `spoken`), so an order still open after a restart of the agent still holds. The cards live in memory only. Fix round 2: the
  // direct line's spoken lines go one at a time, typed only into an Orchestrator that rests (spokenLines: the ones waiting for that, in order).
  const talkCards = createTalkCards({ now: Date.now, tell: (conn, frame) => fastSession?.tell(conn, frame) ?? false, ...(log ? { log } : {}) })
  // F-221 (ob98a, T4 phase 2): the residual holds (talk-residual.ts, kept in talk-residual.json): a chat a spoken line held when that line closed for
  // any reason but its reply being seen or his Let go, or that was told to carry on while held, stays held until a turn end is seen there.
  const residual = createResidualHolds({ now: Date.now, file: path.join(o.dir, 'talk-residual.json'), ...(log ? { log } : {}) })
  // F-221 (order oeb56): live talk's turn records, one log line each, numbers only (talk-stage.ts): POST /talk/stage, his page's only.
  // oc65c / F-051 S2 (Lead's ruling on Agent 7's F6): live talk is the APP OWNER's (the eighth /talk surface: the other seven reach appOwnerOnly, see talkPage).
  const talkStage = createTalkStage({ now: Date.now, isOwner: c => access.isAdmin(c) && access.ownerOf(c).id.toLowerCase() === SBSKRRT_OWNER.id, deny: (c, where) => o.auth?.deny(c, 403, 'admin-only', where), ...(log ? { log } : {}) })
  /**
   * T4 review: what a chat here shows a residual hold beyond its state (talk-residual.ts Seen). `live`: its own screen shows it working (its spinner,
   * or a prompt of its turn): a turn of this very run. `readBack`: the turn its record reads as running (or asking) began before this run started
   * (a chat started again at once reads the turn the stop cut off back from its record, until the resume writes its end): no turn of this run.
   */
  function residualSeen(sid: string): Seen {
    const run = chats.info(sid)
    if (!run) return {}
    const screen = chats.screenState?.(sid)
    const turn = turns?.turn(sid)
    return { live: screen === 'running' || screen === 'question', readBack: !!turn && turn.state !== 'idle' && Date.parse(turn.since) < Date.parse(run.startedAt) }
  }
  sawChats = states => {
    for (const sid of residual.held().keys()) if (states[sid] !== undefined) residual.saw(sid, states[sid], residualSeen(sid))
  }
  const spokenLatch = createSpokenLatch({ orders: () => orders.list(), residual: () => residual.held() })
  // F-221 (ob98a, T4): the latch mirrored into talk-latch/<session> for the voice lock below the model (latch-hook.ts reads it): rebuilt from the
  // saved orders as the agent starts (below the orders), written when a spoken line arms it (before the line is typed), and synced after every
  // orders tick (its reply, a chat that stopped) and when he lets go.
  const latchFiles = createLatchFiles({ dir: latchDir, held: () => spokenLatch.held(), ...(log ? { log } : {}) })
  const spokenLines = createLineQueue({ now: () => Date.now() })
  // Stage 1 (o400b, rule 4): each open order is followed in its target's own Claude transcript, wherever this PC has it (a member's copy on the hub too).
  const orderTurns = createOrderWatch({ find: sid => findClaudeTranscript(sid, projectsDir), target: sid => chats.claudeSession?.(sid) ?? sid })
  const orders = createOrders({
    now: Date.now,
    file: path.join(o.dir, 'orders.json'),
    log,
    stateOf: sid => whereAll()[sid]?.state,
    progress: p => fastLinks.onProgress?.(p),
    words: sid => readStatus(chats.screen(sid) ?? [])?.text,
    interrupt: sid => {
      if (!chats.info(sid)) return false
      chats.input(sid, String.fromCharCode(27), APP)
      return true
    },
    scan: (sid, id) => {
      const file = findTranscript(sid, projectsDir)
      return file ? scanMessages(readTranscriptFile(file), id) : { started: false, answer: '' }
    },
    // Stage 1 (o400b, rule 4): a Claude chat's order is answered from its transcript (the last words before the first turn end after the order
    // entered); Codex, OpenCode and "Old way" keep the rule above.
    turnOf: (sid, id, since) => (syncOld() || isCodexSession(sid) || isOpenCode(sid) ? null : orderTurns.turnOf(sid, id, since)),
    forget: id => orderTurns.forget(id),
    // F-221 (ob98a, fix round 2): what tells a spoken order's line can no longer run (orders.ts). Before start-up adoption and recovery are over, a
    // chat not seen is not known to have stopped (fix round 3: nor while a lost chat host link is settled); a chat on another PC that has not
    // reported it since may still run there; and only a resting chat with an empty box cannot submit a line that never entered.
    known: () => chatsKnown(),
    away: sid => awayChat(sid),
    boxEmpty: sid => boxEmpty(sid),
    // T4 phase 2: a spoken line closing for any reason but its reply being seen (or his Let go) leaves its chat held (a residual hold).
    residual: (od, why) => residual.make(od.to.sessionId, [od.id], `order ${od.id}: ${why}`),
    deliver: async (assistantSid, body, order) => {
      // F-087: the fast Assistant is a process, not a chat: its answer goes to the session (nothing is typed anywhere).
      if (order.from === FAST_FROM) return fastLinks.onReturn ? fastLinks.onReturn(order, body).catch(() => false) : false
      const w = whereAll()[assistantSid]
      // M1: typing ends with Enter, which would pick the highlighted option of a prompt nobody answered: kept, and tried again later.
      // Stage 1 (o400b): in the simple layer only Claude's own open question holds it (its transcript), never a draft read off the screen.
      if (w && (atPrompt(assistantSid) || (syncOld() && hasDraft(assistantSid)))) return false
      return w ? typeInto({ sessionId: assistantSid, id: w.id }, body).catch(() => false) : false
    },
    // Order-reply carrier (11 Nov): a typed reply is in only when the Assistant's claude reports it took exactly that text (its UserPromptSubmit hook).
    // Stage 1 (o400b): or its transcript has the row that took it (a user or enqueue row, or a queued_command): either one is enough.
    taken: (assistantSid, body, since) => {
      const hook = chats.promptTaken?.(assistantSid, body, since) ?? null
      if (hook === true || syncOld()) return hook
      const row = turns?.took(assistantSid, body, since) ?? null
      return row === true ? true : hook === false || row === false ? false : null
    },
    ...(o.orderReplyWaits ? { waits: o.orderReplyWaits } : {}),
  })
  function orderReplies(): boolean {
    return o.orderReplies ?? !(process.env.SAD_ORDER_REPLIES === '0' || existsSync(path.join(o.dir, 'order-replies.off')))
  }
  // F-221 (T4): after each tick the voice lock's files say what the latch holds now (an order answered or closed lets its chat go below the model too).
  // T4 phase 2: the residual holds are looked at after the orders (one let go when a turn end is seen in its chat), before the files are synced.
  const ordersTimer = setInterval(
    () =>
      void orders
        .tick()
        .then(() => residual.tick({ stateOf: sid => whereAll()[sid]?.state, boxEmpty: sid => boxEmpty(sid), seen: residualSeen }))
        .catch(e => log?.warn(`orders tick: ${message(e)}`))
        .finally(() => (closing ? undefined : latchFiles.sync())),
    1000,
  )
  ordersTimer.unref?.()
  // F-221 (T4): at start the files are made to match the saved orders: a spoken order still open holds its chat again (the chat host kept it running).
  latchFiles.sync()

  /**
   * F-221 (ob98a, fix round 2): a chat that another PC holds (its lease) and that PC has not reported running since: the PC is out of reach, or has
   * not said hello yet. The chat may still be running there, so a spoken order's hold stays (it is decided when that PC is back, by its transcript).
   */
  function awayChat(sid: string): boolean {
    const holder = held.get(sid)?.holder
    return !!holder && holder !== self().id && remote.get(holder)?.live[sid] === undefined
  }
  /** What counts as an empty box: nothing in it, or only Claude's own grey suggestion or hint (never text that Enter could send). */
  const EMPTY_BOX: readonly DraftKind[] = ['none', 'suggestion', 'hint']
  /**
   * F-221 (ob98a, fix round 2): the chat's input box holds nothing (no line of ours whose Enter was lost, no draft of his) and no paste of ours is on
   * its way, read where the chat runs (another PC: its draft-read, as "Inspect terminal" reads it). False when it cannot be read.
   * T4 review: a text of the app's that waits for its prompt (chats.ts typeWhenReady: a carry-on after a reopen, the watchdog's nudge, a hand-off's
   * line) is a paste on its way too, though nothing is drawn yet: a spoken line never goes in before it, and a residual hold never ends before it.
   */
  async function boxEmpty(sid: string): Promise<boolean> {
    const w = whereAll()[sid]
    if (!w) return false
    let v: DraftView | null = null
    if (w.id === self().id) {
      if ((chats.waiting?.(sid) ?? 0) > 0) return false
      v = chats.draftView?.(sid) ?? null
    } else {
      const link = team?.member(w.id)
      if (!link) return false
      v = readDraftView(await request<unknown>(link, 'draft-read', { sessionId: sid }, 3000).catch(() => null))
    }
    return !!v && EMPTY_BOX.includes(v.kind) && !v.busy
  }
  /**
   * F-221 (fix round 2): a chat here ended (chats.ts onEnded): a spoken order it had not answered is closed at the next tick (orders.ts chatEnded).
   * T4 phase 2: a residual hold on it is held again from now: what was seen working before the end was no turn end (a crash, a restart).
   */
  function spokenChatEnded(sid: string) {
    orders.chatEnded(sid)
    residual.again(sid, 'its chat ended or is being restarted')
  }
  /**
   * F-221 (T4 phase 2; T4 review): a chat that a spoken line holds (an open spoken order, or a residual hold) is being started, fresh or from its
   * conversation, by ANY path: the reopen loop and start-up recovery (told to carry on), the F-083 watchdog (its nudge), a hand-off or a phone ask
   * that starts it, the tools refresh, his own open. What it runs next may be that line's work, and a spoken order still open may close as answered
   * the moment its record shows the resume's end of its turn. So a residual hold is made (or made again) on it now, BEFORE it starts and before
   * anything is typed, holding until a turn end is seen there after it (or his Let go). Under the old rule what its orders were seen doing in the
   * run before counts for nothing in this one (orders.ts reopened). A chat nothing holds starts as it always did.
   */
  function heldStart(sid: string) {
    carryOnHeld(sid, 'started again while a spoken line held it')
    orders.reopened(sid)
  }
  /** The residual hold heldStart makes: on this chat, carrying every spoken order that holds it now (nothing when none does). */
  function carryOnHeld(sid: string, why: string) {
    const ids = spokenLatch.open(sid)
    if (ids.length === 0) return
    residual.make(sid, ids, why)
    latchFiles.sync()
  }

  // F-078: the heartbeat (heartbeat.ts): a plain check of every chat every few minutes; it starts a stopped
  // chat that has unfinished work, nudges it once, and wakes the Assistant only when there is news.
  const TRANSCRIPT_MAX_AGE_MS = 6 * 3_600_000
  const agentRefs = () =>
    floors.list().filter(f => !isPcControl(f)).flatMap(f => f.agents.map(a => ({ sessionId: a.sessionId, floorId: f.id, floorName: f.name, agentId: a.id, agentName: a.name, assistant: isOrchestratorAgent(f.name, a) })))
  const tailOf = (sid: string) => {
    const file = findTranscript(sid, projectsDir)
    // A conversation not written to for hours is history: not even read.
    if (!file || Date.now() - statSync(file).mtimeMs > TRANSCRIPT_MAX_AGE_MS) return null
    return readTranscriptFile(file)
      .slice(-3)
      .map(m => ({ id: m.id, role: m.role, text: m.text, tools: m.tools, timestamp: m.timestamp ?? '' }))
  }
  /**
   * F-083: why this chat has work to go on with, or null: an order from the Assistant is open for it, or its own last words
   * say it is unfinished (heartbeat.ts). The idle reaper keeps such a chat, and the watchdog starts such a chat again.
   */
  function workOf(sid: string): string | null {
    if (orders.list().some(x => x.to.sessionId === sid)) return 'an order from the Assistant is open'
    try {
      const rows = tailOf(sid)
      return rows ? (unfinishedWork(rows, { now: Date.now(), openOrder: false, running: false })?.why ?? null) : null
    } catch {
      return null
    }
  }
  const startedAtMs = Date.now()
  /**
   * Lead's order after Agent 19 (18 Nov): the model and effort a Codex chat on this PC RUNS on, from its own conversation file, against what the app started it with
   * (its profile) and what is saved (codex/drift.ts). Null when it cannot be told: not Codex, not on this PC, no conversation yet, nothing recorded since it started.
   * A row written a moment before the app noted the start still counts (the start is noted when the chat object is made, the row when Codex is up).
   */
  function codexDrift(sid: string): DriftReading | null {
    const at = floors.bySession(sid), info = chats.info(sid)
    if (!o.codex || !at || !info || info.engine !== 'codex') return null
    const thread = at.agent.codexThread
    const since = Date.parse(info.startedAt)
    if (!thread || !Number.isFinite(since)) return null
    const home = o.codex.paths.home
    const file = findRollout(home, thread)
    const running = file ? readRunning(file, since - 3000) : null
    if (!running) return null
    const d = defaultsNow()
    return { running, launched: readLaunched(home, sid), saved: { model: at.agent.codexModel || d.codexModel || '', effort: at.agent.codexEffort || d.codexEffort || '' } }
  }

  // F-083: the watchdog (watchdog.ts) is called by each beat of the heartbeat, so it needs no chat to be alive.
  const watchdogOn = o.watchdog ?? process.env.SAD_WATCHDOG !== '0'
  const watchdog = createWatchdog({
    now: Date.now,
    file: path.join(o.dir, 'watchdog.json'),
    log,
    agents: agentRefs,
    stateOf: sid => whereAll()[sid]?.state,
    events: since => chatLog.since(since),
    stoppedOnPurpose: sid => heartbeat.isStopped(sid),
    work: workOf,
    // F-058 recovery reopens the chats after an update first; the watchdog never races it (and does not wait for ever). F-221 (T4 review): nor the
    // reopen loop after a lost chat host link (hostSettling: until every lost chat was looked at): that loop tells a working chat to carry on.
    recoveryBusy: () => closing || hostSettling || (!recoveryDone && Date.now() - startedAtMs < 10 * 60_000),
    freeCommitMB: o.freeCommitMB ?? readFreeCommitMB,
    restart: async (floorId, agentId, text) => {
      try {
        const sid = floors.list().find(f => f.id === floorId)?.agents.find(a => a.id === agentId)?.sessionId
        if (sid) startCause.set(sid, 'watchdog')
        // On its home PC (F-064); offline: it is not started here, that is reported.
        const opened = await openChat(floorId, agentId, { say: text }, undefined, undefined, APP)
        if (!opened.on) chats.typeWhenReady(opened.sessionId, text, { holdForDraft: true })
        return null
      } catch (e) {
        return (e as { status?: unknown }).status === HOME_OFFLINE_STATUS ? `offline: ${message(e)}` : message(e)
      }
    },
    // Nothing is pressed: the chat is ended and opened again from its conversation, which discards the menu on its screen.
    restartClean: async sid => {
      if (mode() === 'member' || !floors.bySession(sid)) return false
      startCause.set(sid, 'watchdog')
      await stopAt(self().id, sid)
      return await resumeChat(sid)
    },
    local: sid => {
      const i = chats.info(sid)
      return i ? { watching: i.viewers > 0 } : null
    },
    screen: sid => chats.screen(sid),
    asking: sid => chats.asking(sid),
    press: (sid, keys) => chats.press(sid, keys),
    activity: sid => chats.activity(sid),
    drift: codexDrift,
    record: e => chatLog.append({ event: 'watch', sessionId: e.sessionId, agent: e.agent, floor: e.floor, cause: e.cause, what: e.what, did: e.did }),
  })

  // Orders o0c50 / o66aa / oa76b / o7e97: where each floor's decisions go (shared/question-routing.ts). A floor whose decisions go to people
  // is never pushed to him (the heartbeat below, Quick's snapshot and approvals_waiting, his overlay's cards and badge), at no time; he sees
  // it when he looks (GET /approvals ?scope=all or floor:<id>) and keeps every right. Its chosen people answer its prompts (decides()).
  const questionRouting = createQuestionRouting(path.join(o.dir, 'question-routing.json'))
  if (questionRouting.unreadable()) log?.warn('question routing: the saved choices (question-routing.json) could not be read; every floor\'s questions go to the owner until he chooses again')
  /** Every chat waiting at a question now. */
  function waitingQuestions(): WaitingQuestion[] {
    const where = whereAll()
    return floors.list().flatMap(f => f.agents.flatMap(a => (a.sessionId && where[a.sessionId]?.state === 'question' ? [{ sessionId: a.sessionId, floorId: f.id, floorName: f.name, agentId: a.id, agentName: a.name }] : [])))
  }
  /** The route in force for a floor NOW: its chosen people who still have a share on it (read from the floor as it is); nobody left, the owner. */
  const questionRouteOf = (floorId: string) => (floorRoutable(floors.list().find(f => f.id === floorId)) ? effectiveRoute(questionRouting.route(floorId), floors.list().find(f => f.id === floorId) ?? null) : OWNER_ROUTE)
  // floorRoutable and routableChat: decision-routing.ts (pure, each exclusion pinned on its own: PC control, a person's Assistant, the Orchestrator
  // and the phone's chats, Agent 3's F1).
  /** The route of one waiting question: its floor's in force, unless its chat's prompts stay the owner's whatever the floor's route. */
  const routeOfQuestion = (q: WaitingQuestion): QuestionRoute => {
    const f = floors.list().find(x => x.id === q.floorId), a = f?.agents.find(x => x.id === q.agentId)
    // F4 (Agent 14): a prompt goes to the people of its floor only where they can answer it: a chat on the Server (on the default typing choice) stays the OWNER's, so his list, his badge and his heartbeat count it and it is never left with nobody.
    return f && a && routableChat(f, a) && access.typingScopeOpen(a) ? questionRouteOf(f.id) : OWNER_ROUTE
  }
  /** The owner's share of the waiting questions (his floors' only) and a count of the ones with someone else, for when he looks. */
  const ownerQuestions = () => splitQuestions(waitingQuestions(), routeOfQuestion)
  /**
   * Orders o66aa / oa76b / o7e97 ("1A"): may this signed-in person, not the owner of the app, answer this chat's prompt as one of its floor's
   * decision-makers? The chat's floor is the one the hub has it on NOW (floors.bySession: never anything a request or a prompt's text names);
   * that floor's route in force now names them (a share taken away ends it at once, a floor with nobody left is the owner's); and never a
   * PC-control floor or slot, a person's own Assistant or the Orchestrator. Asked when listing, before an answer, and again right before the
   * key is written into the chat.
   */
  /** The words of a refused answer, Cancel or Ignore: when the person IS one of the floor's chosen people and only the typing choice stops them (a chat on the Server), say that, not that they were not chosen. */
  function decisionRefusedWords(c: Caller, at: { floor: Floor; agent: FloorAgent } | null): string {
    if (at && c.person && routableChat(at.floor, at.agent) && decidesOn(questionRouteOf(at.floor.id), c.person.id) && !access.typingScopeOpen(at.agent)) return 'This chat runs on the Server, and a chat on the Server is answered by the owner of this app unless he opens typing on every PC.'
    return "This is for the owner of this app, or for the people he chose to decide for this chat's floor; that is not you now."
  }
  function decides(c: Caller, at: { floor: Floor; agent: FloorAgent } | null): boolean {
    if (!at || !c.person || access.isAdmin(c) || !routableChat(at.floor, at.agent)) return false
    // F-300 S3 (Lead's safe default): their digit IS typing into that chat, so a chat that is the Server's is theirs only on the owner's wide typing choice (access.typingScopeOpen: the same terms as mayType's scope), never by default. Asked at the list, the
    // answer, the Cancel and the last check before the key is written, because they all come through here.
    if (!access.typingScopeOpen(at.agent)) return false
    return decidesOn(questionRouteOf(at.floor.id), c.person.id)
  }

  const heartbeat = createHeartbeat({
    now: Date.now,
    file: path.join(o.dir, 'heartbeat.json'),
    log,
    agents: agentRefs,
    stateOf: sid => whereAll()[sid]?.state,
    tail: tailOf,
    watch: watchdogOn ? () => watchdog.watch() : undefined,
    openOrder: sid => orders.list().some(x => x.to.sessionId === sid),
    restart: async (floorId, agentId) => {
      try {
        const sid = floors.list().find(f => f.id === floorId)?.agents.find(a => a.id === agentId)?.sessionId
        if (sid) startCause.set(sid, 'heartbeat')
        await openChat(floorId, agentId, {}, undefined, undefined, APP)
        return null
      } catch (e) {
        return message(e)
      }
    },
    nudge: async (sid, body) => {
      const w = whereAll()[sid]
      if (w && w.id !== self().id) return typeInto({ sessionId: sid, id: w.id }, body).catch(() => false)
      chats.typeWhenReady(sid, body, { holdForDraft: true })
      return true
    },
    wake: body => tellAssistant(body),
    news: items => {
      // F-083: no phone push between 23:00 and 07:00 for what the watchdog found; it is in the morning summary (chat-events.jsonl). A drift is STAGED: told to the
      // Assistant and logged at once, pushed to the phone only once <state>/agent/drift-push.on exists (heartbeat.ts phoneItems says why).
      const shown = phoneItems(items, { hour: new Date().getHours(), driftPush: driftPushOn(path.join(o.dir, '..')) })
      if (shown.length) voice.beat(shown.map(i => i.text).join(' '), shown.filter(i => i.agent).map(i => ({ floor: i.floor ?? '', agent: i.agent ?? '', what: i.kind })))
    },
    newerBuild: () => o.newerBuild?.() ?? null,
    alarms: () => o.alarms?.() ?? [],
    currentBuild: () => o.currentBuild?.() ?? null,
    overnight: since => describeEvents(chatLog.since(since)),
    waiting: async () => {
      const lines: string[] = []
      // o0c50 / oa76b: his own floors' questions only. A floor whose decisions go to people is never pushed to him here, at any time (his "2 No").
      const asking = ownerQuestions().mine.map(q => `${q.agentName} on ${q.floorName}`)
      if (asking.length) lines.push(`${asking.length} chat${asking.length === 1 ? '' : 's'} waiting at a question (the Approvals tab): ${asking.join(', ')}.`)
      // o66aa / o7e97: an answer whose record could not be written is told once, with who, which prompt and what they chose.
      if (unrecordedCount > unrecordedTold) {
        const fresh = unrecorded.slice(0, Math.min(unrecordedCount - unrecordedTold, unrecorded.length))
        lines.push(`${fresh.length} answer${fresh.length === 1 ? ' was' : 's were'} given but NOT written to the approvals record (the file could not be written): ${fresh.map(e => `${e.by} answered prompt ${e.promptId ?? '?'} in ${e.agent} on ${e.floor}: ${e.choice ?? e.detail}`).join('; ')}.`)
        unrecordedTold = unrecordedCount
      }
      // The floors' structural history: a change whose line could not be written is told once, with who did what (floor-events.ts).
      if (unrecordedFloorEventCount > unrecordedFloorEventTold) {
        const fresh = unrecordedFloorEvents.slice(0, Math.min(unrecordedFloorEventCount - unrecordedFloorEventTold, unrecordedFloorEvents.length))
        lines.push(`${fresh.length} floor change${fresh.length === 1 ? ' was' : 's were'} made but NOT written to the floors' record (the file could not be written): ${fresh.map(e => describeFloorEvent(e)).join('; ')}.`)
        unrecordedFloorEventTold = unrecordedFloorEventCount
      }
      // Who was present at a chat: a line that could not be written is told once, with who did what (chat-presence.ts).
      const lostPresence = presence.news()
      if (lostPresence.length) lines.push(`${lostPresence.length} presence line${lostPresence.length === 1 ? ' was' : 's were'} NOT written to the chats' presence record (the file could not be written): ${lostPresence.map(e => describePresence(e)).join('; ')}.`)
      // F-297: what a person's own Assistant sent, whose line could not be written: told once, with who and to which chat (staff-sends.ts; the words never).
      const lostStaffSends = staffSends.news()
      if (lostStaffSends.length) lines.push(`${lostStaffSends.length} staff Assistant send line${lostStaffSends.length === 1 ? ' was' : 's were'} NOT written to the staff-sends record (the file could not be written): ${lostStaffSends.map(e => describeStaffSend(e)).join('; ')}.`)
      if (prepared.size) lines.push(`${prepared.size} card${prepared.size === 1 ? ' is' : 's are'} prepared for you in the Send tab.`)
      const replies = orders.list().filter(x => x.pending).length
      if (replies) lines.push(`${replies} agent repl${replies === 1 ? 'y has' : 'ies have'} not reached the Assistant yet.`)
      const nb = o.newerBuild?.()
      if (nb) lines.push(`A newer build (${nb}) is waiting; only you press Update now.`)
      const open = (await tasks.counts()).open
      if (open) lines.push(`${open} open task${open === 1 ? '' : 's'} on your list.`)
      return lines
    },
    undeliveredReplies: () => orders.list().filter(x => x.pending).length,
  })
  /** F-083: what the overlay and the Assistant's watchdog_status tool show: it runs, the beat's times, what the last look found. */
  function watchdogView() {
    const hb = heartbeat.state()
    const w = watchdog.state()
    return {
      enabled: watchdogOn && hb.enabled,
      intervalMin: hb.intervalMin,
      lastBeatAt: hb.last?.at ?? null,
      nextBeatAt: hb.nextAt,
      chatsLooked: hb.last?.chats ?? 0,
      found: (hb.last?.findings ?? []).map(f => ({ kind: f.kind, text: f.text, did: f.did })),
      downNow: w.down.map(d => ({ agent: d.agent, floor: d.floor, downMin: Math.round((Date.now() - d.sinceMs) / 60_000), why: d.why })),
      restartsLastHour: w.restartsLastHour,
      // F-087: the fast Assistant's process (null while the feature is off): state, why, pid, memory numbers, turns served, cost.
      fast: fastHost?.status() ?? null,
      summary: !watchdogOn ? 'The watchdog is off (SAD_WATCHDOG=0).' : !hb.enabled ? 'The heartbeat is off, so the watchdog does not look.' : w.down.length ? `${w.down.length} chat${w.down.length === 1 ? ' is' : 's are'} down: ${w.down.map(d => d.agent).join(', ')}.` : hb.last ? `All chats looked at ${new Date(hb.last.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}: ${hb.last.findings.length ? `${hb.last.findings.length} thing${hb.last.findings.length === 1 ? '' : 's'} found.` : 'all well.'}` : 'No look yet since the app started.',
    }
  }

  const assistantAt = () =>
    floors
      .list()
      .flatMap(f => f.agents.map(a => ({ f, a })))
      .find(x => isOrchestratorAgent(x.f.name, x.a)) ?? null

  /** Types `body` into the Assistant's chat, starting it first when it is not running (the heartbeat and the phone's asks). */
  async function tellAssistant(text: string): Promise<boolean> {
    // F-221 (ob98a): the phone's asks and the heartbeat's news carry words from elsewhere: a lookalike of the tapped marker is made harmless.
    const body = neutralizeMarks(text)
    const at = assistantAt()
    if (!at) return false
    const sid = at.a.sessionId
    const w = sid ? whereAll()[sid] : undefined
    // M1 (a safety hole Mobile found): a line typed while the Assistant waits at a permission prompt or a menu ends with Enter,
    // which would pick the highlighted option: an approval nobody tapped. Phone asks get a 409, the heartbeat tries again next beat.
    if (w && sid && atPrompt(sid)) throw apiError(409, 'The Assistant is waiting for an answer on the PC')
    // His draft in the Assistant's box: the heartbeat and the morning summary try again later; a phone ask is told to.
    if (w && sid && hasDraft(sid)) throw apiError(409, "Shubham has unsent text in the Assistant's box on the PC; try again shortly")
    if (sid && w) return typeInto({ sessionId: sid, id: w.id }, body)
    try {
      const opened = await openChat(at.f.id, at.a.id, {})
      chats.typeWhenReady(opened.sessionId, body)
      return true
    } catch {
      return false
    }
  }

  // F-087: hand-offs from the fast Assistant to the Orchestrator (orders.ts has the order, its progress and its return). The same safe typing as
  // every message to a chat: a chat at a prompt or with Shubham's unsent text is a 409 at once, nothing is typed, no retry loop.
  const handoffTimes: number[] = []
  const HANDOFFS_PER_MIN = 6
  const HANDOFF_MAX = 4000
  type HandOffFail = { ok: false; status: number; reason: string }
  /**
   * The order a hand-off becomes, ready to type: the rate limit, the Orchestrator, its order id and the line. F-221 (ob98a): the sender label is the
   * hub's own words (only his tap's has "he tapped Send"); in the request a lookalike is made harmless. ", order <id>]" stays the last thing of the
   * marker: orders.ts scanMessages and turns.ts find the order by exactly that.
   */
  function handOffLine(clean: string, sender: string) {
    const now = Date.now()
    while (handoffTimes.length && now - handoffTimes[0] > 60_000) handoffTimes.shift()
    if (handoffTimes.length >= HANDOFFS_PER_MIN) return { ok: false, status: 429, reason: 'Too many hand-offs this minute. Wait a little.' } satisfies HandOffFail
    const at = assistantAt()
    if (!at) return { ok: false, status: 409, reason: 'There is no Orchestrator chat on this PC.' } satisfies HandOffFail
    const sid = at.a.sessionId
    const id = orders.plan(FAST_FROM, sid ?? 'orchestrator', clean)
    if (!id) return { ok: false, status: 400, reason: 'That is not something to hand off.' } satisfies HandOffFail
    return { ok: true as const, now, at, who: at.a.name, sid, id, line: `[message from ${sender}, ${orders.marker(id)}] ${neutralizeMarks(clean)}` }
  }
  /**
   * Review of T2: typed, not typed, or not known (a member PC's answer was lost after it was sent: the line may be in all the same). Fix round 3:
   * "not known" only for a caller that must never take a lost answer for "not typed" (`unsure`: the spoken line, his tap on a card); the plain old
   * way reads it as "not typed" (a 409, "could not take it"), as it did before T2.
   */
  const typeLine = (sid: string, pcId: string, line: string, unsure: boolean) =>
    unsure
      ? typeInto({ sessionId: sid, id: pcId }, line, { unconfirmedThrows: true }).catch((e: unknown) => (isObject(e) && e.code === 'delivery-unconfirmed' ? ('unknown' as const) : false))
      : typeInto({ sessionId: sid, id: pcId }, line).catch(() => false)

  /**
   * F-221 (ob98a, fix round 2: decisions 2 and 3): a spoken line he did not tap (live talk's direct line, the only one that holds). It is typed only
   * into an Orchestrator that rests (no turn running, no prompt, nothing in its box) and that no other spoken line holds: one at a time, in order.
   * Till then it waits here (at most 3 wait, each at most 2 minutes, then BUSY_WORDS for that line, nothing typed), so the latch covers that line's
   * own turn and never his typed work. Its order is opened and saved (queued, spoken) BEFORE the typing: the latch holds from before the line can be
   * submitted, and a restart between the typing and the save cannot lose it. It goes again only on a definite "not typed"; "unknown" keeps it.
   * Fix round 3: a save that did not land types nothing (503); the box is read where the chat runs (another PC: a round trip), so the rest is
   * looked at again right after that read, with nothing in between until the order is opened: a turn that started meanwhile gets no line.
   * T4 review: and only into a chat the voice lock reaches (voiceLockOn): the hub refuses the rest itself (a 409, nothing typed), whatever the page
   * read of GET /talk/caps before; a running one without it is refused at once, not waited for.
   */
  async function handOffSpoken(clean: string, origin: OrderOrigin, sender: string, opt: HandOffOptions): Promise<HandOffResult> {
    const ticket = spokenLines.join()
    if (!ticket) return { ok: false, status: 409, reason: BUSY_WORDS }
    /** T4 review: the chat would run the line without the voice lock below the model (here, or on another PC: `elsewhere`): nothing is typed. */
    const noLock = (who: string, elsewhere: boolean): HandOffFail => {
      log?.warn(`live talk: a spoken line was not typed: ${who} runs ${elsewhere ? 'on another PC' : 'here'} without the voice lock`)
      return { ok: false, status: 409, reason: noLockWords(who, elsewhere) }
    }
    try {
      let started = false
      for (;;) {
        // The app is stopping: a line still waiting goes no further (it would start the Orchestrator again in an agent that is closing).
        if (closing) return { ok: false, status: 503, reason: 'The app is stopping; say it again in a moment.' }
        if (ticket.first()) {
          const at = assistantAt()
          if (!at) return { ok: false, status: 409, reason: 'There is no Orchestrator chat on this PC.' }
          const sid = at.a.sessionId
          const where = sid ? whereAll()[sid] : undefined
          if (sid && where) {
            // Here or on another PC, running without the voice lock: no wait would give it one.
            if (!voiceLockOn(sid)) return noLock(at.a.name, where.id !== self().id)
            if (restsNow(sid) && (await boxEmpty(sid)) && restsNow(sid)) break
          } else if (sid && awayChat(sid)) {
            // Held by another PC that is out of reach: it may still run there, and a chat on another PC never has the voice lock.
            return noLock(at.a.name, true)
          } else if (!started && chatsKnown()) {
            // Not running anywhere (and not on a PC out of reach): started once, as a hand-off does; the line waits for it to rest at its prompt.
            started = true
            try {
              await openChat(at.f.id, at.a.id, {})
            } catch (e) {
              return { ok: false, status: 503, reason: `${at.a.name} could not be started: ${message(e)}` }
            }
            continue
          }
        }
        if (ticket.late()) {
          log?.info('live talk: a spoken line waited 2 minutes for the Orchestrator to rest; it was not typed')
          return { ok: false, status: 409, reason: BUSY_WORDS }
        }
        await new Promise(resolve => setTimeout(resolve, LINE_POLL_MS))
      }
      const p = handOffLine(clean, sender)
      if (!p.ok) return p
      const running = p.sid ? whereAll()[p.sid] : undefined
      if (!p.sid || !running) return { ok: false, status: 409, reason: `${p.who} could not take it right now.` }
      // T4 review: looked at again after the wait (it may have been restarted, moved to another PC or switched to Codex meanwhile); from here to the
      // typing nothing is awaited, so the line goes into the very run that was checked.
      if (!voiceLockOn(p.sid)) return noLock(p.who, running.id !== self().id)
      if (!orders.open(p.id, FAST_FROM, { sessionId: p.sid, agent: p.who, floor: p.at.f.name }, clean, { kind: 'handoff', origin, queued: true, spoken: true, ...(opt.direct ? { direct: true } : {}) })) {
        // Its hold would not outlive a restart of the agent (orders.json is what keeps it): nothing is typed.
        orders.discard(p.id)
        log?.warn('live talk: a spoken line was not typed: its order could not be saved')
        return { ok: false, status: 503, reason: 'The Server could not save this, so nothing was sent. Say it again in a moment.' }
      }
      // F-221 (ob98a, T4): the voice lock holds from before the line can be submitted too (its file, which latch-hook.ts reads): written now, or the
      // line is not typed at all.
      if (!latchFiles.sync()) {
        orders.discard(p.id)
        latchFiles.sync()
        log?.warn(`hand-off ${p.id}: the voice lock could not be set; the spoken line was not typed`)
        return { ok: false, status: 503, reason: 'The voice lock could not be set; say it again in a moment.' }
      }
      const typed = await typeLine(p.sid, running.id, p.line, true)
      if (typed === false) {
        orders.discard(p.id)
        latchFiles.sync()
        return { ok: false, status: 409, reason: `${p.who} could not take it right now.` }
      }
      handoffTimes.push(p.now)
      if (typed === 'unknown') {
        // It may be in: it stays an order waiting to be taken, and holds, until its turn (or its PC, once back) says otherwise. Never typed again.
        log?.warn(`hand-off ${p.id}: ${p.who}'s PC did not say whether the spoken line was typed; it is kept as an order waiting to be taken, and holds`)
        return { ok: true, orderId: p.id, phase: 'queued' }
      }
      orders.typed(p.id)
      return { ok: true, orderId: p.id, phase: 'typed' }
    } finally {
      ticket.leave()
    }
  }
  /**
   * F-221 (fix rounds 2 and 3, decision 2): the Orchestrator rests now, as far as can be told at once: it runs (here or on a PC that reports it) and
   * no turn is running; it is at no prompt (M1's own check: here its open question in its transcript, or a menu on its screen; on another PC the
   * 'question' it reports); and no spoken line holds it. Its box is the other half (boxEmpty: nothing in it, no paste on its way).
   */
  function restsNow(sid: string): boolean {
    // T4 phase 2: not before the hub knows its chats (start-up adoption and recovery, a lost chat host link until its reopen loop is over): a chat
    // reopened there rests at its prompt only until it is told to carry on, so a spoken line waits (and starts nothing) until that is over.
    if (!chatsKnown()) return false
    const st = whereAll()[sid]?.state
    if (st === undefined || st === 'running') return false
    if (atPrompt(sid)) return false
    // A spoken line, or a residual hold (T4 phase 2: its line's work may still run there), holds it: not at rest for another spoken line.
    return spokenLatch.open(sid).length === 0
  }

  const handoff: HandoffApi = {
    async handOff(text, origin, sender = 'the Assistant', opt = {}) {
      if (mode() === 'member') return { ok: false, status: 409, reason: 'Hand-offs are made on the hub.' }
      const max = opt.max ?? HANDOFF_MAX
      const clean = text.replace(/\s+/g, ' ').trim()
      if (!clean) return { ok: false, status: 400, reason: 'There is nothing to hand off.' }
      if (clean.length > max) return { ok: false, status: 413, reason: `That is longer than ${max} characters.` }
      // F-221 (fix round 2): his spoken words, untapped: one at a time, into a resting Orchestrator, its order saved first.
      if (opt.spoken) return handOffSpoken(clean, origin, sender, opt)
      const p = handOffLine(clean, sender)
      if (!p.ok) return p
      const { now, at, who, sid, id, line } = p
      const running = sid ? whereAll()[sid] : undefined
      const extra = { kind: 'handoff' as const, origin, ...(opt.direct ? { direct: true } : {}), ...(opt.untapped ? { untapped: opt.untapped } : {}) }
      if (sid && running) {
        if (atPrompt(sid)) return { ok: false, status: 409, reason: `${who} is waiting for an answer on the PC.` }
        if (hasDraft(sid)) return { ok: false, status: 409, reason: `Shubham has unsent text in ${who}'s box on the PC; try again shortly.` }
        // Fix round 3: "not known" only for his tap on a card (opt.unsure); a plain hand-off whose answer was lost is "could not take it", as before T2.
        const typed = await typeLine(sid, running.id, line, opt.unsure === true)
        if (typed === false) return { ok: false, status: 409, reason: `${who} could not take it right now.` }
        if (typed === 'unknown') {
          // His tap's line may be in: the order is opened as waiting to be taken, so its turn (or, if it never shows, its not-taken end) closes it.
          // It is never typed again: that could put it in twice.
          log?.warn(`hand-off ${id}: ${who}'s PC did not say whether the line was typed; it is kept as an order waiting to be taken`)
          orders.open(id, FAST_FROM, { sessionId: sid, agent: who, floor: at.f.name }, clean, { ...extra, queued: true })
          handoffTimes.push(now)
          return { ok: true, orderId: id, phase: 'queued' }
        }
        orders.open(id, FAST_FROM, { sessionId: sid, agent: who, floor: at.f.name }, clean, extra)
        handoffTimes.push(now)
        return { ok: true, orderId: id, phase: 'typed' }
      }
      // Not running: started, and the message is typed when it is ready (held back from a draft, as for every message). The order waits as 'queued'.
      let opened: ChatOpened
      try {
        opened = await openChat(at.f.id, at.a.id, {})
      } catch (e) {
        return { ok: false, status: 503, reason: `${who} could not be started: ${message(e)}` }
      }
      chats.typeWhenReady(opened.sessionId, line, { holdForDraft: true })
      orders.open(id, FAST_FROM, { sessionId: opened.sessionId, agent: who, floor: at.f.name }, clean, { ...extra, queued: true })
      handoffTimes.push(now)
      return { ok: true, orderId: id, phase: 'queued' }
    },
    status(orderId) {
      const od = orders.get(orderId)
      if (!od) return { orderId, open: false }
      const st = whereAll()[od.to.sessionId]?.state
      const age = Date.now() - od.at
      const phase = od.queued ? 'queued' : st === 'question' ? 'waiting-you' : st === 'running' ? (age > 15 * 60_000 ? 'slow' : 'working') : 'typed'
      return { orderId, open: true, phase, sec: Math.round(age / 1000), gist: od.gist, ...(st === 'running' ? { words: readStatus(chats.screen(od.to.sessionId) ?? [])?.text } : {}), ...(od.late ? { late: od.late } : {}) }
    },
    cancel: id => orders.cancel(id),
    releaseSpoken(orderId, why) {
      // F-221 (ob98a, fix round 2): his Let go (T4's route POST /talk/ask/<orderId>/let-go calls this, then stops the order): the hold goes.
      const ok = orders.letGo(orderId)
      // T4 phase 2: and a residual hold that carries this order (the line closed abnormally, or its chat was told to carry on while held).
      const rest = residual.letGo(orderId)
      // T4: below the model too, at once (its voice lock file goes).
      latchFiles.sync()
      log?.info(`spoken latch: order ${orderId} ${ok || rest ? `let go${rest ? ' (its residual hold too)' : ''}` : 'was not holding'} (${why})`)
      return ok || rest
    },
    listen(l) {
      fastLinks.onReturn = l.onReturn
      fastLinks.onProgress = l.onProgress
    },
  }

  // F-074: the hub's side of "Hey Chris" (voice.ts): pairing with a device key, asks to the Assistant,
  // what the phone's background service reads. A conversation file is read again only when it changed.
  const messageCache = new Map<string, { sig: string; msgs: ReturnType<typeof readTranscriptFile> }>()
  const messagesOf = (file: string) => {
    const st = statSync(file)
    const sig = `${st.mtimeMs}:${st.size}`
    const hit = messageCache.get(file)
    if (hit?.sig === sig) return hit.msgs
    const msgs = readTranscriptFile(file)
    messageCache.set(file, { sig, msgs })
    return msgs
  }
  const voice = createVoice({
    now: Date.now,
    file: path.join(o.dir, 'voice-devices.json'),
    speech: o.speech,
    fast: () => fastSession?.socket('phone') ?? null,
    fastInfo: () => fastHello(!!fastHost, fastHost?.state(), fastHost?.status().model),
    names: () => fastNames,
    orderAsk: id => orderAsk(id),
    log,
    assistant: () => {
      const sid = assistantAt()?.a.sessionId ?? null
      // A 'question' guessed from plain words is put right before the phone is told it is waiting.
      if (sid && whereAll()[sid]) atPrompt(sid)
      return assistantAt() ? { sessionId: sid, state: sid ? whereAll()[sid]?.state : undefined } : null
    },
    say: body => tellAssistant(body),
    proof: (_body, r) => {
      const by = humanProof('pair', [], undefined, r)
      deviceLog('A pair code for the phone app was made', by)
      return by
    },
    // Order oae15: phone control's own switch: ON needs a signed-in CRM administrator (never a chat's key, never a page nobody signed in on).
    controlProof: (_body, r) => {
      const human = requireCrmHuman(o.auth, r, true)
      // His phone: a second owner may not switch its control ON (the switch off and Stop always work, for any owner).
      firstOwnerOnly(human, 'POST /voice/control-switch', 'Switching phone control on is for the first owner of this app only: it is tied to his paired phone.')
      return describeHuman(human)
    },
    // Unpairing a phone is Shubham's by id: a second owner is an administrator and would pass the owner wall alone.
    revokeGate: r => firstOwnerOnly(callerOf(r), 'POST /voice/devices/revoke', "Unpairing the phone is for the first owner of this app only: it is his paired phone."),
    controlSwitched: (on, by) => deviceLog(on ? 'Phone control switched ON (the Assistant and the Mobile chat may use the phone through Chris)' : 'Phone control switched off', by),
    mode: () => mode(),
    feed: send => {
      const sid = assistantAt()?.a.sessionId
      return sid ? chatFeeds.attach(sid, send) : () => {}
    },
    history: (before, limit) => {
      const sid = assistantAt()?.a.sessionId
      return sid ? chatFeeds.history(sid, before, limit) : { items: [], before: null }
    },
    scan: (sid, id) => {
      const file = findTranscript(sid, projectsDir)
      return file ? scanMessages(messagesOf(file), id, 'ask') : { started: false, answer: '' }
    },
    interrupt: async () => {
      const sid = assistantAt()?.a.sessionId
      if (!sid || !chats.info(sid)) return false
      chats.input(sid, String.fromCharCode(27), APP)
      return true
    },
  })
  // F-087: the fast Assistant's warm process. Dark: nothing exists unless SAD_FAST_ASSISTANT=1 or <state>/agent/fast-assistant.on is there, and
  // only on the hub. The session around it (sockets, brief, tools) is fast.ts; this is the process, its supervision and its memory rules.
  // F-086: "What the chats are called" as the hub keeps it (the words the Assistant speaks follow it; default old). Set from the page; Chris reads it in hello.
  const fastNamesFile = path.join(o.dir, 'fast-names.json')
  let fastNames: NamesChoice = (() => {
    try {
      return namesChoice((JSON.parse(readFileSync(fastNamesFile, 'utf8')) as { choice?: unknown }).choice)
    } catch {
      return 'old'
    }
  })()
  const FAST_LABELS: Record<string, string> = { ui_control: 'Opening that', ui_screen: 'Looking at the screen', app_chats: 'Checking the chats', floor_roster: 'Checking the floor', app_read_chat: 'Reading that chat', app_read_conversation: 'Reading that chat', memory_search: 'Searching', memory_read: 'Searching', memory_recent: 'Searching', task_list: 'Checking your tasks', task_add: 'Adding a task', watchdog_status: 'Checking the chats', approvals_waiting: 'Checking Approvals', hand_off: 'Asking', order_status: 'Checking on it' }
  let fastSession: FastSession | undefined
  // Order ofedf (usage): who has the Assistant socket open now (a count per person). A turn's cost is filed under the one person connected; with two or more, or none, it is not filed (the reporter says so).
  const fastPeople = new Map<string, number>()
  const fastOwner = (): string | null => (fastPeople.size === 1 ? [...fastPeople.keys()][0] : null)
  /** Orders the Orchestrator's stop ended: GET /voice/ask/<orderId> says "It was stopped." (the order itself is gone once its reply is delivered). */
  const cancelledOrders = new Set<string>()
  /** The answers of handed-off orders, kept an hour for GET /voice/ask/<orderId> (the order itself is gone once its reply is delivered). */
  const orderAnswers = new Map<string, { text: string; at: number; cancelled: boolean }>()
  function orderAsk(id: string): AskView | null {
    // F-221 (T4 phase 2): an answer whose chat a residual hold still holds is kept past the hour (its page still shows the voice lock and Let go).
    for (const [k, v] of orderAnswers) if (Date.now() - v.at > 3_600_000 && !residual.carrying(k)) orderAnswers.delete(k)
    const a = orderAnswers.get(id)
    if (a) return a.cancelled ? { askId: id, state: 'error', error: 'It was stopped.' } : { askId: id, state: 'done', speak: a.text }
    const st = handoff.status(id)
    if (!st.open) return null
    if (st.phase === 'queued') return { askId: id, state: 'queued' }
    return { askId: id, state: 'working', ...(st.words ? { status: { text: st.words, secs: st.sec ?? null, tokens: null } } : {}) }
  }
  /** The host's context (its last turns as role/text) into the brief's pairs. F-221: an answer he spoke over keeps its mark (what he heard of it). */
  function fastBriefContext(ctx: { history: { role: 'user' | 'assistant'; text: string; interrupted?: boolean }[]; openOrders: string[] }) {
    const history: { user: string; assistant: string; interrupted?: boolean }[] = []
    for (const h of ctx.history) {
      if (h.role === 'user') history.push({ user: h.text, assistant: '' })
      else if (history.length && !history[history.length - 1].assistant) history[history.length - 1] = { ...history[history.length - 1], assistant: h.text, ...(h.interrupted ? { interrupted: true } : {}) }
    }
    return { history, openOrders: ctx.openOrders }
  }
  /** What the hub knows right now, for the Assistant's next turn (put in front of it only when it changed). */
  async function fastSnapshot(): Promise<string> {
    const where = whereAll()
    const agents = floors.list().flatMap(f => f.agents.map(a => ({ floor: f.name, name: a.name, role: a.role, state: a.sessionId ? (where[a.sessionId]?.state ?? 'not running') : 'never opened' })))
    // o0c50 / oa76b: his own floors' questions only; a floor whose decisions go to people is never pushed to him through Quick.
    const approvals = ownerQuestions().mine.map(q => ({ floor: q.floorName, agent: q.agentName }))
    const open = await tasks.list({ status: 'open', limit: 4 }).catch(() => [])
    const count = (await tasks.counts().catch(() => ({ open: 0 }))).open
    const phones = voice.phone.status().devices.map(d => ({ name: d.name, online: d.online, armed: d.armed }))
    const orders = (fastSession?.openOrderIds() ?? []).map(id => `${id}: ${handoff.status(id).phase ?? 'open'}`)
    const input: SnapshotInput = { agents, approvals, tasks: { open: count, first: open.map(t => t.text) }, phones, build: o.currentBuild?.() ?? null, orders }
    return buildSnapshot(input, namesFor(fastNames))
  }
  const quickSettings = createQuickSettings(path.join(o.dir, 'quick-settings.json'))
  if (quickSettings.unreadable()) log?.warn('keep Quick running: the saved choice (quick-settings.json) could not be read; Quick is warm only while open plus 10 minutes until he chooses again in Settings')
  // oc58f: the owner's hub choice "Quick sends without asking" (default on), the same for desktop and APK. It decides only whether Quick's
  // hand-off waits on a card; it never grants a tap, an approval or Send as me (hand_off below).
  const quickForwarding = createQuickForwarding(path.join(o.dir, 'quick-forwarding.json'))
  if (quickForwarding.unreadable()) log?.warn('quick forwarding: the saved choice (quick-forwarding.json) could not be read; Quick asks first (the card until his tap) until he chooses again in Settings')
  const fastOn = o.fastAssistant ?? (process.env.SAD_FAST_ASSISTANT === '1' || existsSync(path.join(o.dir, '..', 'fast-assistant.on')))
  // Order of130: the subscription key of the credential the Assistant's headless process was STARTED with (set in env() below, from the same read of the credential), under which its turns' cost is filed.
  let fastSubKey = ''
  // Disabled/member Quick must not evaluate host dependencies. Cache and freeze
  // the first permitted construction; previews still spread a fresh host object.
  let builtFastDeps: FastDeps | undefined
  const fastDeps = (): FastDeps => builtFastDeps ??= Object.freeze<FastDeps>({
    now: Date.now,
    spawn: (file, args, so) => spawn(file, args, { cwd: so.cwd, env: so.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }),
    claude: () => {
      const c = o.claude ?? findClaude()
      if (!c) return null
      return /\.cmd$/i.test(c) ? [process.env.ComSpec ?? 'cmd.exe', '/d', '/c', c] : [c]
    },
    env: () => {
      const cred = o.credential?.() ?? null
      fastSubKey = usageSubFor(cred)
      return librarianEnv(process.env, o.token?.() ?? null, cred)
    },
    dir: path.join(o.dir, 'fast'),
    history: quickHistory,
    toolsUrl: () => `${o.apiUrl()}${AGENTIC_PREFIX}/mcp`,
    shim,
    node: process.execPath,
    tools: () => FAST_TOOLS.map(t => `mcp__${MCP_SERVER_NAME}__${t.name}`),
    brief: ctx => buildBrief(fastBriefContext(ctx), namesFor(fastNames)),
    names: () => fastNames,
    toolLabel: name => FAST_LABELS[name] ?? 'One moment',
    onState: st => fastSession?.hostState(st),
    keepRunning: () => quickSettings.get().keepRunning,
    // Order ofedf (usage): the turn's running cost, filed under the one person whose Assistant is open (agent/usage; totals only, no text).
    onCost: r => usage?.reading({ ...r, userId: fastOwner(), orgId: null, subscriptionKey: fastSubKey }),
    context: () => (fastSession?.openOrderIds() ?? []).map(id => `${id}: ${handoff.status(id).gist ?? 'handed over'}`),
    memory: readMemory,
    kill: async (pid, startedAt) => {
      await killTree(pid, { since: startedAt })
    },
    log: o.log?.child?.('fast') ?? o.log,
    ...o.fastHostDeps,
  })
  const fastHost: FastHost | undefined = fastOn && mode() !== 'member' ? createFastHost(fastDeps()) : undefined
  // No process until V2 supplies a bounded partial. The factory is single-use;
  // neither its status nor its (absent) tool key joins the normal Quick host.
  const fastPreview = fastHost ? createFastPreview({
    now: Date.now,
    onFault: () => o.log?.warn(QUICK_PREVIEW_FAULT),
    context: () => `${fastNames}:${fastHost.contextVersion?.() ?? 0}`,
    createHost: model => {
      // Each disposable process captures its own credential once. A preview must
      // never relabel the still-running warm host's later usage (order of130).
      let previewSubKey = ''
      return createFastHost({
        ...fastDeps(),
        preview: true,
        model,
        env: () => {
          const cred = o.credential?.() ?? null
          previewSubKey = usageSubFor(cred)
          return librarianEnv(process.env, o.token?.() ?? null, cred)
        },
        dir: path.join(o.dir, 'fast-preview'),
        history: undefined,
        onState: undefined,
        log: undefined,
        keepRunning: () => false,
        // Same existing usage path; numeric totals only, including discarded drafts.
        onCost: r => usage?.reading({ ...r, userId: fastOwner(), orgId: null, subscriptionKey: previewSubKey }),
      })
    },
  }) : undefined
  // F-086/F-087: the session around the host (owners, the two sockets, hand-off routing); null host = the Assistant is off and its sockets are refused.
  // F-221 (ob98a): with the talk cards, so it can hold hand-offs (a connection's cards go with it).
  fastSession = createFastSession({ host: fastHost ?? null, snapshot: fastSnapshot, names: () => namesFor(fastNames), log: o.log?.child?.('fast') ?? o.log, cards: talkCards, preview: fastPreview })
  handoff.listen({
    onReturn: async (order, reply) => {
      // The reply arrives as '[reply from <name> on <floor> to order <id>] <answer>': the answer is what is shown and told.
      const text = reply.replace(/^\[reply from [^\]]*\]\s*/, '')
      if (order.cancelled) cancelledOrders.add(order.id)
      orderAnswers.set(order.id, { text, at: Date.now(), cancelled: order.cancelled === true })
      // F-221 (ob98a): live talk's direct line: the page speaks its answer itself (GET /talk/ask/<orderId>); the fast Assistant is never told it.
      if (order.direct) return true
      return fastSession!.answered(order.id, order.gist, text, order.cancelled === true) === 'told'
    },
    onProgress: p => fastSession!.progress(p.orderId, p.phase, p.sec, p.words),
  })
  // Order o5007: the old-app reader (the /old page). The Alt+K path again, not a new transport: a second warm process of fast-host.ts and a
  // session of fast.ts, the same frames (shared/fast.ts), with its own brief and four tools that only READ the old app's folder (old-reader.ts,
  // checked here by the process's key in callTool). Hub only, while its switch is on (Settings › Old app reader: old-reader.json, on to start
  // with) and the old app's folder is on this PC. The process starts when the page opens and ends 10 minutes after it was closed.
  const oldStore = createOldReaderStore(path.join(o.dir, 'old-reader.json'))
  // Order o7f34: the Anthropic API key (Settings › Old app reader): encrypted on this Server, never sent back.
  const modelKeys = createModelKeyStore(o.dir)
  const oldBriefFor = (ctx: { history: { role: 'user' | 'assistant'; text: string }[] }) =>
    oldBrief({ root: oldFiles.root(), outline: oldFiles.outline(), notes: readNotes(oldStore.configuredNotes() ?? notesPathOf(floors.list().flatMap(f => f.agents))), history: ctx.history })
  const oldApiTools: ToolSpec[] = OLD_TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))
  const oldRoot = (): string | null =>
    o.oldReader && 'root' in o.oldReader ? (o.oldReader.root ?? null) : findOldRoot(oldRootCandidates({ env: process.env.SAD_OLD_APP_DIR, configured: oldStore.configuredRoot(), home: os.homedir() }))
  const oldFiles = createOldFiles({ root: oldRoot })
  let oldHost: FastHost | undefined
  let oldSession: FastSession | undefined
  const oldLog = o.log?.child?.('old-reader')
  // The host's own lines say "fast assistant"; this one is the old-app reader.
  const oldLogger = oldLog ? { info: (m: string) => oldLog.info(m.replace(/fast assistant/g, 'old-app reader')), warn: (m: string) => oldLog.warn(m.replace(/fast assistant/g, 'old-app reader')) } : undefined
  function startOldReader() {
    if (oldHost || closing || mode() === 'member' || !oldStore.get().enabled || !oldFiles.root()) return
    const claudeOld = createFastHost({
      now: Date.now,
      spawn: (file, args, so) => spawn(file, args, { cwd: so.cwd, env: so.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }),
      claude: () => {
        const c = o.claude ?? findClaude()
        if (!c) return null
        return /\.cmd$/i.test(c) ? [process.env.ComSpec ?? 'cmd.exe', '/d', '/c', c] : [c]
      },
      env: () => librarianEnv(process.env, o.token?.() ?? null, o.credential?.() ?? null),
      dir: path.join(o.dir, 'old-reader'),
      toolsUrl: () => `${o.apiUrl()}${AGENTIC_PREFIX}/mcp`,
      shim,
      node: process.execPath,
      toolset: 'old',
      tools: () => OLD_TOOLS.map(t => `mcp__${MCP_SERVER_NAME}__${t.name}`),
      // The Old App Reader chat's own map goes in too (old-reader.json's `notes`, else the INDEX.md its brief names), so most answers need no lookup.
      brief: oldBriefFor,
      toolLabel: name => OLD_TOOL_LABELS[name] ?? 'Looking',
      onState: () => oldSession?.hostState({ state: oldHost?.state() ?? 'off' }),
      context: () => [],
      memory: readMemory,
      kill: async (pid, startedAt) => {
        await killTree(pid, { since: startedAt })
      },
      model: oldStore.get().model,
      ...(oldLogger ? { log: oldLogger } : {}),
      ...o.oldReader?.hostDeps,
    })
    // Order o7f34: the API twin (no process; its tools are the same read-only functions, run here) and the router that picks between them.
    const apiOld = createApiFastHost({
      now: Date.now,
      keys: modelKeys,
      ...(o.oldReader?.anthropicFetch ? { fetch: o.oldReader.anthropicFetch } : {}),
      brief: oldBriefFor,
      tools: oldApiTools,
      runTool: async (name, input) => oldCall(oldFiles, name, input),
      label: name => OLD_TOOL_LABELS[name] ?? 'Looking',
      ...(oldLogger ? { log: oldLogger } : {}),
    })
    oldHost = createSourceRouter({
      claude: claudeOld,
      api: apiOld,
      preferred: () => oldStore.get().source,
      fallback: () => oldStore.get().fallback,
      ...(oldLogger ? { log: oldLogger } : {}),
    })
    oldSession = createFastSession({ host: oldHost, snapshot: () => '', ...(oldLogger ? { log: oldLogger } : {}) })
  }
  function stopOldReader(why: string) {
    const s = oldSession
    const h = oldHost
    oldSession = undefined
    oldHost = undefined
    s?.close()
    void h?.stop(why)
  }
  function oldInfo(): OldReaderInfo {
    if (!oldHost) startOldReader()
    const root = oldFiles.root()
    return { settings: oldStore.get(), root, found: root !== null, files: root ? oldFiles.entries().length : null, serving: oldSession !== undefined, apiKey: modelKeys.status() }
  }
  startOldReader()
  const voiceTimer = setInterval(() => {
    if (mode() !== 'member') voice.tick()
    void fastHost?.tick()
    void oldHost?.tick()
    // F-221 (ob98a): cards past their 10 minutes go. (The spoken latch has no clock: its orders decide.)
    talkCards.sweep()
    // F-294: the ignores of chats that are no longer at a question go (contained: it only ever lets a hide go, and must never skip the housekeeping below).
    try { sweepIgnores() } catch { /* the records stay until the next second */ }
    // V2 is optional. Contain ONLY its call, after all existing V1 housekeeping:
    // a future preview fault must neither skip card expiry nor shut down the app.
    try { fastPreview?.tick() } catch { /* The coordinator also fails closed at every entry. */ }
  }, 1000)
  voiceTimer.unref?.()

  const heartbeatOn = o.heartbeat ?? process.env.SAD_HEARTBEAT !== '0'
  const heartbeatTimer = setInterval(() => {
    if (heartbeatOn && mode() !== 'member' && !closing) void heartbeat.tick()
  }, 15_000)
  heartbeatTimer.unref?.()

  // The Assistant's chat and the tool list: its MCP process reads the list when it starts, and the chat host keeps the chat through an
  // Update, so a tool added since never reached it (the crm_ tools of build 1108). A shim of this build asks again by itself (mcp-shim.ts,
  // /mcp/tools); one that does not (an older one, or claude not re-reading) is left a couple of minutes, and then the chat is restarted
  // when it is idle and has no unsent text (restartChat: told /exit, its conversation resumed with the new process). Once per list.
  const toolsRefreshOn = () => o.assistantToolsRefresh ?? !(process.env.SAD_ASSISTANT_TOOLS_REFRESH === '0' || existsSync(path.join(o.dir, 'assistant-tools-refresh.off')))
  const refreshedFor = new Set<string>()
  let refreshing = false
  async function refreshAssistantTools(): Promise<void> {
    if (refreshing || closing || mode() === 'member' || !toolsRefreshOn() || !recoveryDone) return
    const at = assistantAt()
    const sid = at?.a.sessionId
    if (!sid || refreshedFor.has(`${sid}:${TOOLS_NOW}`)) return
    const info = chats.info(sid)
    if (!info || info.engine !== 'claude') return
    if (!needsRefresh({ listed: toolsSeen.get(sid), current: TOOLS_NOW, state: info.state, upMs: Date.now() - upSince, graceMs: o.toolsRefreshGraceMs ?? 120_000 })) return
    refreshing = true
    try {
      if (await restartChat(sid)) {
        refreshedFor.add(`${sid}:${TOOLS_NOW}`)
        log?.info('The Assistant chat was restarted to take the current tool list')
      }
    } catch (e) {
      // An unsent draft (409) or a chat that would not stop: tried again at the next look.
      log?.warn(`couldn't restart the Assistant chat for its tool list: ${message(e)}`)
    } finally {
      refreshing = false
    }
  }
  const toolsRefreshTimer = setInterval(() => void refreshAssistantTools(), o.toolsRefreshEveryMs ?? 60_000)
  toolsRefreshTimer.unref?.()

  // ---------------------------------------------------------------------------------------
  // F-297 stage B (Lead approved f297-design.md; his orders o7712, odbb7 and od8e2)

  /** Kept once the one-time seed below has been decided (seeded, or a choice was already there): never again after it, whatever the owner does to the row. */
  const staffSeedFile = path.join(o.dir, 'staff-send-seed.json')
  let staffSeedSaid = false
  /**
   * His order od8e2, "yes let ravis be on since start": ONCE, at the build's first start on the Server (and only when the real app asks for it: `staffSendSeed`, set by main.ts), Ravi's `assistant-send` switch is turned ON in
   * Settings > Access, logged there as a change by the app that cites his orders. It never overwrites a choice (the access store refuses), and the owner changes or removes it like any other with one tap; once it
   * has been decided it is never made again, so turning Ravi off stays off. With no `rteja` in the CRM directory yet nothing is turned on, and that is said in the log (it is looked for again).
   */
  function seedStaffSend(): void {
    if (!o.staffSendSeed || !o.featureAccess || !o.auth || mode() === 'member' || existsSync(staffSeedFile)) return
    try {
      const ravi = o.auth.directory().find(u => u.username.toLowerCase() === 'rteja')
      if (!ravi) {
        if (!staffSeedSaid) log?.warn("staff send: Ravi's switch was NOT turned on from the start: there is no `rteja` in the CRM directory yet (it is looked for again)")
        staffSeedSaid = true
        return
      }
      const done = o.featureAccess.seed(STAFF_SEND_FEATURE, { mode: 'people', people: [ravi.id.toLowerCase()] }, { id: 'system', name: 'the app (F-297: his orders o7712, odbb7 and od8e2)' })
      if (done === 'refused') {
        log?.warn('staff send: the first-start seed of the switch was refused by the access store; nothing was turned on')
        return
      }
      writeAtomic(staffSeedFile, `${JSON.stringify({ at: new Date().toISOString(), outcome: done, person: ravi.id.toLowerCase() })}\n`)
      log?.info(done === 'seeded' ? "staff send: Ravi's switch was turned on from the start (his orders o7712, odbb7 and od8e2); the owner can turn it off in Settings > Access" : "staff send: the 'assistant-send' row already had a choice, so nothing was turned on")
    } catch (e) {
      log?.warn(`staff send: the first-start seed of the switch could not be made (${message(e)})`)
    }
  }

  /** A policy the switch no longer matches, tried at most once in a while per chat. */
  const staffConvergeTried = new Map<string, number>()
  /** How often it looks, how long an Assistant must have been quiet, and when a try that did not work is made again: the app's options (tests shorten them) or the stated times (staff-send.ts). */
  const converge = staffConvergeTimes(o)
  /** When each running staff Assistant was first seen QUIET (idle, nothing in flight) by the looks below: cleared at the first look that finds it anything else. */
  const staffQuietSince = new Map<string, number>()
  /**
   * A person's Assistant is started under the policy its switch asks for at that moment, and a chat records it. When the owner turns the switch on (or off) while the Assistant runs, its recorded policy no longer
   * matches. THE COST, said plainly: that person's Assistant chat is RESTARTED, once, and its conversation is resumed. It is done only when the chat has been QUIET for at least a minute (60 s by default,
   * seen on consecutive looks that are 20 s apart): idle, with no question on its screen, no unsent words in its box and none of the app's own texts waiting to be typed into it (so no send to it, and no send
   * from it, is in flight); never while it is working or asking. The restart is the app's own (restartChat) and its start line says why (cause `switch`; the presence record's `by: app` is restartChat's default). Once
   * per chat and change, tried again after five minutes if that did not work; never a chat that is not a staff Assistant or runs under a policy this build does not know.
   */
  async function convergeStaffPolicies(): Promise<void> {
    if (closing || mode() === 'member' || !recoveryDone) return
    const live = nativeChats.live()
    for (const sid of [...staffQuietSince.keys()]) if (!live.some(run => run.sessionId === sid)) staffQuietSince.delete(sid)
    for (const run of live) {
      if (!isStaffPolicy(run.policy)) continue
      let at: { floor: Floor; agent: FloorAgent } | null = null
      try { at = bySession(run.sessionId) } catch { at = null }
      if (!at || !isStaffAssistant(at.agent)) continue
      if (staffPolicyFor(at.agent) === run.policy) {
        staffConvergeTried.delete(run.sessionId)
        staffQuietSince.delete(run.sessionId)
        continue
      }
      // Quiet: idle, no question (the state says it), no unsent words in its box, nothing of the app's waiting to be typed into it.
      if (run.state !== 'idle' || hasDraft(run.sessionId) || (chats.waiting?.(run.sessionId) ?? 0) > 0) {
        staffQuietSince.delete(run.sessionId)
        continue
      }
      const since = staffQuietSince.get(run.sessionId) ?? Date.now()
      staffQuietSince.set(run.sessionId, since)
      if (Date.now() - since < converge.idle) continue
      const last = staffConvergeTried.get(run.sessionId)
      if (last !== undefined && Date.now() - last < converge.retry) continue
      staffConvergeTried.set(run.sessionId, Date.now())
      staffQuietSince.delete(run.sessionId)
      startCause.set(run.sessionId, 'switch')
      try {
        if (await restartChat(run.sessionId)) log?.info(`staff send: ${at.agent.name}'s chat ${run.sessionId.slice(0, 8)} was restarted to start under the policy its switch asks for now`)
      } catch (e) {
        log?.warn(`staff send: couldn't restart chat ${run.sessionId.slice(0, 8)} for its switch: ${message(e)}`)
      } finally {
        // The start that took it has already used it; one that never happened must not leave it for the next start of this chat.
        startCause.delete(run.sessionId)
      }
    }
  }
  seedStaffSend()
  const staffConvergeTimer = setInterval(() => {
    seedStaffSend()
    void convergeStaffPolicies()
  }, converge.every)
  staffConvergeTimer.unref?.()

  /** The id of the order a message from `agent` to `toSid` is, or null when it is none (not the Assistant's, or an acknowledgement or a reply). */
  function orderFrom(floor: Floor, agent: FloorAgent, sid: string, toSid: string, body: string): string | null {
    if (!orderReplies() || mode() === 'member' || !isOrchestratorAgent(floor.name, agent)) return null
    const target = bySession(toSid)
    if (!target || isOrchestratorAgent(target.floor.name, target.agent)) return null
    return orders.plan(sid, toSid, body)
  }
  function openOrder(id: string, fromSid: string, toSid: string, body: string, untapped?: Untapped | null) {
    const target = bySession(toSid)
    if (target) orders.open(id, fromSid, { sessionId: toSid, agent: target.agent.name, floor: target.floor.name }, body, untapped ? { untapped } : undefined)
  }
  /**
   * oc58f follow-up (Agent 3's B2): the marker of an order the Orchestrator gives. While a request Quick passed on by itself is open on that
   * Orchestrator (orders.untappedFor), the marker says so: "Quick request (spoken, not tapped), order <id>", so the fact travels with the order and
   * does not depend on how the Orchestrator retells it. His tap on a held message (tapped) is his own confirmation of those words: no mark. A wider
   * mark (several requests open, or his own words in the same turn) only lowers trust; ", order <id>" stays last for scanMessages and turns.ts.
   * NOT marked, on purpose (Lead, 16 Nov): an order given in a later turn, after the request was answered; why: orders.ts untappedFor.
   */
  function orderMarker(order: string, fromSid: string, tapped: boolean): { marker: string; untapped: Untapped | null } {
    const untapped = tapped ? null : orders.untappedFor(fromSid)
    return { marker: `${untapped ? `${untappedMark(untapped)}, ` : ''}${orders.marker(order)}`, untapped }
  }

  // ---------------------------------------------------------------------------------------
  // F-221 (ob98a): live talk. Quick's hand-offs held as cards, his tap that sends a card, the direct line to the Orchestrator, and its spoken latch.

  /** Where an order was asked, as orders.ts keeps it. */
  const orderOrigin = (o: Origin): OrderOrigin => ({ kind: o.kind, client: o.clientId, askId: o.askId })

  /** A hand-off from a connection that holds: a card on its screen with the cleaned words; nothing is typed until his tap. */
  function holdHandoff(text: string, origin: Origin, names: ReturnType<typeof namesFor>) {
    const nothing = 'Nothing was handed over. Tell him why in one sentence; do not try again yourself.'
    // The same words would be refused when typed: say so now, not after his tap.
    const plain = text.replace(/\s+/g, ' ').trim()
    if (!plain) return { ok: false, reason: 'There is nothing to hand off.', note: nothing }
    if (isReply(plain) || isAcknowledgement(plain)) return { ok: false, reason: 'That is not something to hand off.', note: nothing }
    const words = cleanCardText(plain)
    if (!words) return { ok: false, reason: 'There is nothing to hand off.', note: nothing }
    if (words.length > CARD_TEXT_MAX) return { ok: false, reason: `That is longer than ${CARD_TEXT_MAX} characters.`, note: nothing }
    const card = talkCards.create({ kind: 'handoff', to: names.big, text: words, via: origin.via, conn: origin.conn, origin })
    log?.info(`fast Assistant: a hand-off of ${origin.kind}:${origin.clientId} is held as card ${card.id}; his tap sends it`)
    return { ok: true, held: true, note: `It is on his screen as a card; he taps Send to give it to ${names.big}. Tell him so in one short sentence. Do not say it is done.` }
  }

  /** Live talk's routes are his page's: a chat's key, or the fast Assistant's (both come as x-sad-chat-key), is refused before anything runs. */
  function talkPage(r: MountRequest) {
    if (r.headers['x-sad-chat-key'] !== undefined) throw authError(403, 'Only his own page may do this; not a chat tool.', 'not-yours')
    appOwnerOnly(callerOf(r), `${r.method} ${AGENT_API_PREFIX}${AGENTIC_PREFIX}${r.rest}`)
  }
  /**
   * oc65c / F-051 S2 (Lead's ruling on Agent 7's F6): Quick and live talk are the APP OWNER's (one journal, one Orchestrator chat), not any administrator's. The open
   * app and the PC's own program are the owner (access.ownerOf). The same 403 an administrator-only route gives a person who is not one.
   */
  function appOwnerOnly(c: Caller, where: string) {
    firstOwnerOnly(c, where)
  }
  /**
   * A second owner (the owners file, Shubham's orders o4e4e and o2f32) is an administrator, but these stay SHUBHAM'S BY HIS ID: Quick and live talk, his phone (its pair code and its control switch ON, and the phone
   * tools), his CRM sign-in (the crm_* tools, the CRM page's proxy, the CRM files on this PC's session), Update and Publish. This is the one test for all of them (the app owner by id; the open app and the PC's own
   * program are the owner, access.ownerOf), and the same 403 an administrator-only route gives a person who is not one.
   */
  function isFirstOwner(c: Caller): boolean {
    return access.ownerOf(c).id.toLowerCase() === SBSKRRT_OWNER.id
  }
  function firstOwnerOnly(c: Caller, where: string, words = 'This is for the owner of this app.') {
    if (isFirstOwner(c)) return
    o.auth?.deny(c, 403, 'admin-only', where)
    throw authError(403, words, 'admin-only')
  }
  /**
   * F-309 N1: the owner's view of the agent notebooks, and THE ONLY place `notebooks.asOwner(` is called. A chat's key (an agent calling these routes itself) is refused, and so is every
   * administrator who is not the first owner by id: the notebooks hold what an agent was told, a second owner included does not read or erase them. The six /notebooks routes call this.
   */
  /**
   * F-309 N2: a chat's start brief gets its notebook's section after the memory's (the four chat starts: Claude, Codex, OpenCode and the Claude Code harness of a Codex execution). THE ONLY place
   * a brief asks the notebook. With no notebook for the chat (off, no row, another person's, PC Control, a member PC) the memory's section comes back as it was, byte for byte (joinSections).
   */
  function withNotebook(memorySection: string, floor: Floor, agent: FloorAgent): string {
    if (mode() === 'member') return memorySection
    // notebook-door: K11
    const nb = notebooks.forChat(floor, agent)
    return joinSections(memorySection, nb.ok ? nb.chat.brief() : '')
  }
  function notebookOwner(r: MountRequest) {
    if (r.headers['x-sad-chat-key'] !== undefined) throw authError(403, "Only the owner's page may do this; not a chat tool.", 'not-yours')
    firstOwnerOnly(callerOf(r), `${r.method} ${AGENT_API_PREFIX}${AGENTIC_PREFIX}${r.rest}`)
    return notebooks.asOwner()
  }

  /**
   * POST /talk/cards/<id>/send {version, text?}: his tap. His signed-in CRM session (requireCrmHuman: a chat's key or the fast key is refused, as on
   * the approvals and send-as-me routes) and the owner of the app; the version he was shown; once. A hand-off card is typed as an order marked "he
   * tapped Send" (and never arms the spoken latch: he confirmed it); a relay card carries out the held message as the Orchestrator's chat. The
   * Orchestrator at a prompt or with his unsent text (M1) is a 409 and the card stays, so he can tap again. The log has ids and times, never words.
   */
  async function sendTalkCard(id: string, raw: unknown, r: MountRequest) {
    const caller = requireCrmHuman(o.auth, r, true)
    r.caller = caller
    appOwnerOnly(caller, `${r.method} ${AGENT_API_PREFIX}${AGENTIC_PREFIX}${r.rest}`)
    if (mode() === 'member') throw Object.assign(apiError(409, 'Sign in on the Server page for this action.'), { code: 'hub-sign-in-required', hubOrigin: null })
    if (!isObject(raw) || typeof raw.version !== 'number' || !Number.isInteger(raw.version)) throw apiError(400, 'Expected {version, text?}')
    if (raw.text !== undefined && typeof raw.text !== 'string') throw apiError(400, 'text is the words to send')
    const took = talkCards.take(id, raw.version)
    if (!took.ok) throw apiError(took.status, took.reason)
    const rec: CardRecord = took.rec
    const started = Date.now()
    const by = describeHuman(caller)
    let sent = false
    let orderId: string | undefined
    try {
      if (rec.card.kind === 'handoff') {
        const origin = rec.origin
        if (!origin) throw apiError(409, 'That card has lost where it was asked; ask again.')
        const words = typeof raw.text === 'string' ? cleanCardText(raw.text) : rec.card.text
        if (!words) throw apiError(400, 'There is nothing to send.')
        if (words.length > CARD_TEXT_MAX) throw apiError(413, `That is longer than ${CARD_TEXT_MAX} characters.`)
        const names = namesFor(fastNames)
        // The only place "he tapped Send" is written: in the sender label, so the line ends ", order oX]" as every order does.
        const label = `${names.fast} (${rec.card.via === 'voice' ? 'spoken' : 'typed'}, he tapped Send)`
        // His tap is never sent twice: a member PC's lost answer is "not known" (the card is used up), not "not typed" (fix round 3: only here
        // and for the spoken line; the plain old way keeps its 409).
        const res = await handoff.handOff(words, orderOrigin(origin), label, { unsure: true })
        if (!res.ok) throw apiError(res.status, res.reason)
        sent = true
        orderId = res.orderId
        talkCards.settle(id, true, res.orderId)
        // The connection it was asked on: card-gone (sent, above), then the usual hand-off, its progress, the answer and the o: telling.
        fastSession?.handedOff(res.orderId, origin, `Asked ${names.big}: ${handoff.status(res.orderId).gist ?? words.slice(0, 80)}`)
        return { ok: true, kind: 'handoff', orderId: res.orderId, phase: res.phase }
      }
      const relay = rec.relay
      if (!relay) throw apiError(409, 'That card has lost what it was holding; ask again.')
      // A relay goes with its words exactly as they were held (lines and all); his edit is cleaned the same way as a hand-off card's.
      const words = typeof raw.text === 'string' ? cleanCardText(raw.text) : rec.card.text
      if (!words) throw apiError(400, 'There is nothing to send.')
      if (typeof raw.text === 'string' && words.length > CARD_TEXT_MAX) throw apiError(413, `That is longer than ${CARD_TEXT_MAX} characters.`)
      let said: string
      try {
        // memory-identity: W1 (a relay card's tool call, carried out on his tap as the chat that held it)
        said = await toolFor(relay.from, relay.tool, { sessionId: relay.sessionId, text: words }, undefined, { tapped: true })
      } catch (e) {
        // A delivery that may have gone (its receipt is not final) is never sent twice: the card is used up.
        const code = isObject(e) ? e.code : undefined
        if (code === 'delivery-unconfirmed' || code === 'delivery-pending') sent = true
        throw e
      }
      sent = true
      return { ok: true, kind: 'relay', said }
    } finally {
      talkCards.settle(id, sent, orderId)
      log?.info(`talk card ${id} (${rec.card.kind}): ${sent ? 'sent' : 'not sent'} by ${by}${orderId ? ` as order ${orderId}` : ''} in ${Date.now() - started} ms`)
    }
  }

  /**
   * POST /talk/ask {id, text}: live talk's direct line ("Send straight to the Assistant chat"). His spoken words, cleaned like a card's, typed into
   * the Orchestrator as "[message from Live voice (spoken, not tapped), order oX]" through the hand-off's own safe typing, with its tools held by the
   * spoken latch until its line can no longer run. Fix round 2: typed only into a resting Orchestrator, one line at a time; the request waits for
   * that (up to 2 minutes, then a 409 BUSY_WORDS). Review of T4: and only into one the voice lock reaches (handOffSpoken: a 409 at once otherwise).
   * The answer is kept for the page (GET /talk/ask/<orderId>), never told by the fast Assistant.
   */
  async function talkAsk(raw: unknown, r: MountRequest) {
    talkPage(r)
    if (!isObject(raw) || typeof raw.id !== 'string' || !ID_RE.test(raw.id) || raw.id.startsWith('o:') || typeof raw.text !== 'string') throw apiError(400, 'Expected {id, text}')
    const words = cleanCardText(raw.text)
    if (!words) return { ok: false, status: 400, reason: 'There is nothing to send.' }
    if (words.length > MAX_TEXT) return { ok: false, status: 413, reason: `That is longer than ${MAX_TEXT} characters.` }
    const res = await handoff.handOff(words, { kind: 'web', askId: raw.id }, 'Live voice (spoken, not tapped)', { max: MAX_TEXT, direct: true, spoken: true })
    if (!res.ok) return { ok: false, status: res.status, reason: res.reason }
    log?.info(`live talk: a spoken line went to the Orchestrator as order ${res.orderId} (not tapped: its tools are held)`)
    return { ok: true, orderId: res.orderId, phase: res.phase }
  }

  /**
   * GET /talk/ask/<orderId>: where a direct line is (queued, working with the status words, done with the answer to speak, error), and the cards it
   * holds. Review of T2: while it is open, `phase` too (handoff.status: 'waiting-you' = the Orchestrator waits for HIS answer on the PC), which a
   * direct line has no other way to learn (it has no socket for handoff-progress).
   */
  function talkAskView(orderId: string, r: MountRequest) {
    talkPage(r)
    const v = orderAsk(orderId) ?? askLeftHeld(orderId)
    if (!v) throw apiError(404, 'No such ask')
    const st = v.state === 'queued' || v.state === 'working' ? handoff.status(orderId) : null
    // Fix round 3: past 3 hours its turn still runs and it still holds: the words he is told (the page has no socket for the progress line). T4
    // phase 2: `held`: the Assistant chat is held for this line now (its order, or the residual hold it left), so the page shows the voice lock and
    // Let go exactly while it is true, also after the answer (a residual hold), and drops them the moment it is false (after his Let go too).
    return { ...v, ...(st?.phase ? { phase: st.phase } : {}), ...(st?.late ? { late: st.late } : {}), held: spokenHolds(orderId), cards: talkCards.list({ order: orderId }) }
  }
  /**
   * F-221 (T4 review): a line whose order closed before a restart of the agent (its answer was kept in memory only, orderAnswers) while the residual
   * hold it left is still on (talk-residual.json outlives the restart): it is answered as over, with a short line in place of the answer, so the page
   * keeps its voice lock and Let go (`held`) instead of dropping them on a 404 while the Assistant chat stays held. Null when nothing carries it.
   */
  function askLeftHeld(orderId: string): AskView | null {
    if (!residual.carrying(orderId)) return null
    return { askId: orderId, state: 'done', speak: `The app restarted since; its answer is in ${namesFor(fastNames).big} chat.` }
  }
  /** F-221 (T4 phase 2): does this spoken line hold the Assistant chat now: its order (open, not let go), or a residual hold that carries it? */
  function spokenHolds(orderId: string): boolean {
    const od = orders.get(orderId)
    return (!!od && holdsChat(od)) || residual.carrying(orderId) !== null
  }

  /**
   * F-221 (ob98a, T4): how far a direct line's hold reaches. 'full': the Orchestrator's chat running on this PC now was started with the voice lock
   * (hooks-orchestrator.json: Claude Code itself refuses its shell, file edits, agents and other MCP servers while a spoken line holds it), so the
   * page may offer the direct line. 'app-tools': only the app's own tools would be held (it runs elsewhere, as Codex, not at all, or was started
   * before the lock existed: it needs a restart), so the page keeps to Quick.
   */
  function voiceLockNow(): 'full' | 'app-tools' {
    return mode() !== 'member' && voiceLockOn(assistantAt()?.a.sessionId) ? 'full' : 'app-tools'
  }
  /**
   * F-221 (T4 review): does the voice lock reach this chat now? It runs on THIS PC (a chat on another PC never has it: a member starts its chats
   * without it, and the lock's files are this PC's), as Claude Code (not Codex, not Codex in Claude Code), and this very run was started with
   * hooks-orchestrator.json (kept by start time: a run started before the lock existed, or whose file could not be written, was not). The caps
   * route answers by it, and handOffSpoken types a spoken line only into such a chat.
   */
  function voiceLockOn(sid: string | null | undefined): boolean {
    const run = sid ? chats.info(sid) : null
    return !!sid && !!run && run.engine === 'claude' && !run.execution && voiceLocks.has(sid, run.startedAt)
  }

  /**
   * F-221 (ob98a, T4): POST /talk/ask/<orderId>/let-go: his Let go on a direct line that holds the Orchestrator (the voice lock's strip shows it).
   * His own tap: his signed-in CRM session (requireCrmHuman, as a card's Send; a chat's key or the fast key is refused). T4 review: the line is
   * stopped FIRST, while its hold is still on (handoff.cancel: Esc into the Orchestrator's chat, so the Esc lands with the voice lock on; and as for
   * any spoken order, Esc alone does not close it: it stays open until its turn is really over, and its reply then says "(cancelled: Shubham
   * stopped it)", which the page reads as the line's answer). Only then does his tap let the hold go (T2's releaseSpoken: the latch and its voice
   * lock file). An order that holds nothing any more (answered, or let go before) is not stopped again: no Esc goes into the chat for it. 404 for an
   * order that is not a spoken one. Logged, never with words.
   */
  async function talkLetGo(orderId: string, r: MountRequest) {
    const caller = requireCrmHuman(o.auth, r, true)
    r.caller = caller
    appOwnerOnly(caller, `${r.method} ${AGENT_API_PREFIX}${AGENTIC_PREFIX}${r.rest}`)
    if (mode() === 'member') throw Object.assign(apiError(409, 'Sign in on the Server page for this action.'), { code: 'hub-sign-in-required', hubOrigin: null })
    const od = orders.get(orderId)
    // T4 phase 2: a line that closed abnormally is gone from the orders, but the residual hold it left (or one made while it held) carries it.
    const rest = residual.carrying(orderId)
    if ((!od || od.spoken !== true) && !rest) throw apiError(404, 'No such spoken line')
    const holding = (!!od && holdsChat(od)) || !!rest
    let stopped = false
    if (od && holdsChat(od)) stopped = await handoff.cancel(orderId)
    else if (rest) stopped = stopHeldTurn(rest.sessionId)
    const released = holding ? handoff.releaseSpoken(orderId, 'let-go') : false
    log?.info(`live talk: order ${orderId} let go by ${describeHuman(caller)}: ${released ? `${stopped ? 'it was stopped, then ' : ''}its hold went` : 'it held nothing any more'}`)
    return { ok: true, released }
  }
  /**
   * F-221 (T4 phase 2): his Let go on a residual hold stops the turn it holds first, as for an order (T4 review: the Esc lands while the voice lock is
   * still on): Esc into the chat while it works here (a turn running, or a prompt of it open), nothing when it rests. True when Esc was sent.
   */
  function stopHeldTurn(sid: string): boolean {
    const st = chats.info(sid) ? whereAll()[sid]?.state : undefined
    if (st !== 'running' && st !== 'question') return false
    chats.input(sid, String.fromCharCode(27), APP)
    log?.info(`live talk: Esc into chat ${sid.slice(0, 8)} before its residual hold went (his Let go)`)
    return true
  }

  /** F-086/F-087: a call from the fast Assistant's process. Its list is fast-tools.ts and is checked here, by the key, at every call. */
  async function fastCall(name: string, rawArgs: unknown): Promise<string> {
    const names = namesFor(fastNames)
    const denied = fastDenied(name, rawArgs, names)
    if (denied) throw apiError(403, denied)
    const args = isObject(rawArgs) ? rawArgs : {}
    switch (name) {
      case 'hand_off': {
        const text = typeof args.text === 'string' ? args.text : ''
        const origin = fastSession?.currentOrigin() ?? null
        // F-221 (ob98a): fail closed, for every client (the page, the Alt+K bar, Chris). No current ask (a cancelled turn, the o: turn that tells an
        // answer, a closed socket), or a cut-off turn the process is still stopping (its late call would be credited to the new ask): nothing typed.
        if (!origin || fastHost?.stopping()) return json({ ok: false, reason: 'There is no current question to hand off from.' })
        // oc58f: one owner choice applies to Quick on every device, including
        // older clients that still send their former default hold=true. Off is
        // the old tap-to-send card. Existing cards are NEVER submitted here.
        // F-267 (order o088b): and the Quick page's every hand-off is a card, whatever that choice says (its start said page 'quick': fast.ts).
        // The page's own word, so it only ever makes this stricter; every other connection follows the owner's choice as before.
        if (origin.page === 'quick') return json(holdHandoff(text, origin, names))
        if (!quickForwarding.get().sendsWithoutAsking) return json(holdHandoff(text, origin, names))
        // This passes a REQUEST only. Neither the words nor a client hold frame
        // grant a human tap, approval, Send-as-me, publish or native permission.
        // Keep the source label and all existing human/native-write checks.
        const r = await handoff.handOff(text, orderOrigin(origin), quickUntappedSender(names.fast, origin.via), { untapped: origin.via === 'voice' ? 'spoken' : 'typed' })
        if (!r.ok) return json({ ok: false, reason: r.reason, note: 'Nothing was handed over. Tell him why in one sentence; do not try again yourself.' })
        fastSession?.handedOff(r.orderId, origin, `Asked ${names.big}: ${handoff.status(r.orderId).gist ?? text.slice(0, 80)}`)
        return json({ ok: true, orderId: r.orderId, phase: r.phase, note: `Handed to ${names.big}. Tell him in one short sentence that you have asked and will come back with the answer; do not say it is done.` })
      }
      case 'order_status': {
        const id = typeof args.orderId === 'string' ? args.orderId : ''
        const ids = id ? [id] : (fastSession?.openOrderIds() ?? [])
        return json({ orders: ids.map(i => (cancelledOrders.has(i) ? { orderId: i, open: false, phase: 'cancelled' } : handoff.status(i))) })
      }
      case 'approvals_waiting': {
        // o0c50 / oa76b: his own floors' questions; the ones whose floor's decisions go to other people, as counts only, never pushed to him.
        const { mine, elsewhere } = ownerQuestions()
        const waiting = mine.map(q => ({ agent: q.agentName, floor: q.floorName }))
        const routed = elsewhere.map(e => ({ floor: e.floorName, to: e.to, count: e.count }))
        return json({ count: waiting.length, waiting, ...(routed.length ? { routedElsewhere: routed } : {}), note: 'He answers these himself in Approvals; you cannot. routedElsewhere: floors whose decisions he gave to other people; they answer them. Never bring those up yourself; tell him only if he asks.' })
      }
      default: {
        // The reads and task_add: run as an agent that belongs to the Orchestrator's floor (its memory, its floor's roster), under the Assistant's own name.
        const at = assistantAt()
        if (!at) throw apiError(409, 'There is no Orchestrator chat on this PC yet.')
        const agent = { ...at.a, id: FAST_AGENT_ID, name: names.fastName, role: 'Fast assistant', isBoss: false, sessionId: null } as unknown as FloorAgent
        // oc65c / F-051 S2 (Lead's rulings on Agent 7's F1/F6): Quick's tools run as a copy of the Orchestrator's agent, but WHO TALKS TO QUICK is not its owner (a phone
        // records no person; a web talker is whoever is signed in). So the call carries the talker, and the LAYER (hits, memory_read) is offered only to the app owner
        // on a web page (chatLayer / quickMayUseMemory); the floor notes and memory_recent stay as they were.
        // memory-door: Q1
        // memory-identity: W2 (Quick's reads: as a copy of the Orchestrator's agent)
        return toolFor('', name, rawArgs, { floor: at.f, agent, quick: { talker: fastSession?.talker() ?? null } })
      }
    }
  }

  /** Order o7e6d: a tool call a staff Assistant may not make (nothing was done). F-297: under staff-v2 the words also say it sends messages to its person's chats. */
  function staffDenied(name: string, policy?: unknown) {
    log?.info(`staff policy: tool ${String(name).slice(0, 60)} refused`)
    return Object.assign(apiError(403, policy === STAFF_POLICY_V2 ? "This Assistant only talks, reads its own chats, looks at its own page and sends messages to the chats its person may type into; that tool is not open to it." : 'This Assistant only talks, reads its own chats and looks at its own page; that tool is not open to it.'), { code: 'staff-policy' })
  }

  /**
   * Order o7e6d (o4002): a staff Assistant (isStaffAssistant), and any chat started under a policy, gets the staff tools only, deny by default:
   * only from a chat running in THIS PC's own pool that was started under the staff policy (never a member's chat, an older run, an unknown
   * policy), and only the four tools by exact name (staff-policy.ts). It decides before every other rule of the call; the CLI's allow-list only
   * mirrors it. An administrator's own Assistant, the Orchestrator and the workers are not touched.
   */
  function staffGate(sid: string, agent: FloorAgent, name: string) {
    const run = sid ? chats.info(sid) : null
    // A fenced run stays fenced even when its agent is now someone else's or no staff Assistant (Lead, 15 Nov); S1, B3: the one check (runFenced).
    if (!isStaffAssistant(agent) && !run?.policy && !(sid && runFenced(sid))) return
    const policy = run?.policy
    if (!isStaffPolicy(policy)) throw fencedToolError(sid, name, agent)
    if (!staffToolAllowed(name, policy)) throw staffDenied(name, policy)
  }

  /** Order o7e6d S1: the open of an agent whose chat runs here fenced is refused (409, code staff-policy); nothing is stopped or started. */
  function fencedOpenError(sid: string) {
    log?.warn(`staff policy: chat ${sid.slice(0, 8)} runs here fenced; the open is refused until it is stopped`)
    return staffError('Restart required: this chat has known unsafe staff/policy provenance. It takes no messages and no tools until it is stopped; stop it, then open it again.')
  }

  /** Order o7e6d: the refusal of a tool to a fenced run (403, code staff-policy): a staff Assistant's in its own words, any other plainly. */
  function fencedToolError(sid: string, name: string, agent: FloorAgent | null) {
    let staff = false
    try {
      const a = agent ?? bySession(sid)?.agent
      staff = !!a && isStaffAssistant(a)
    } catch { /* the plain words */ }
    log?.warn(`staff policy: chat ${sid.slice(0, 8)} asked for ${String(name).slice(0, 60)} with known unsafe staff/policy provenance; refused`)
    return Object.assign(apiError(403, staff ? "This Assistant's chat was not started with its restrictions, so its tools are off. Open it again." : "This chat has known unsafe staff/policy provenance, so its tools are off. Stop it, then open it again."), { code: 'staff-policy' })
  }

  /** Order o7e6d: what a staff Assistant's read tools show is that person's own chats only (own-assistant.ts ownAssistantMayUse); null: not a staff chat. */
  function staffPerson(sid: string, agent: FloorAgent): string | null {
    return sid && isStaffPolicy(chats.info(sid)?.policy) ? agent.owner?.id ?? '' : null
  }

  // ---------------------------------------------------------------------------------------
  // F-297 (stage A; Lead approved f297-design.md): a person's own Assistant under staff-v2 sends ONE message to a chat its person may type into. The decision is made HERE, on the hub, at every send, by the page's own
  // typing rule; the Assistant's words are checked (staff-send.ts), the line the chat sees is the hub's and never the sender's, and the send is written AHEAD (staff-sends.ts) and fails closed.

  /** The owner's per-person switch (Settings > Access, 'assistant-send'): is it open to this person NOW? Missing, unreadable or no sign-in wired = off. */
  function staffSendOn(c: Caller): boolean {
    return o.featureAccess?.allows(c, STAFF_SEND_FEATURE) === true
  }
  /** The policy a person's own Assistant STARTS under: v2 when sending is on for them now, else v1 (the old way, byte for byte). The chat records it; the hub asks the switch again at every send. */
  function staffPolicyFor(agent: FloorAgent): StaffPolicy {
    return staffSendOn(access.asChat(agent)) ? STAFF_POLICY_V2 : STAFF_POLICY
  }
  /** The person's own count of sends (5 a minute, 60 an hour), in memory. */
  const staffRate = createStaffRate()
  /** What staff Assistants sent and where, never the text (staff-sends.ts); GET /staff-sends. */
  const staffSends = createStaffSendRecord({ file: path.join(o.dir, 'staff-sends.jsonl'), error: m => log?.error(m) })
  /**
   * Whether this person may SEND to that agent's chat: the page's own typing rule (an agent they own, or a share "Can type", under the owner's staff-typing choice: access.mayType) on an agent they can see at all;
   * never a PC-control slot or a person's Assistant. The Assistant never has more than its person: a "Can view" share is not sendable because they cannot type there either.
   */
  const staffMaySendTo = (me: Caller, target: FloorAgent): boolean => !target.pcControlSlot && !isPersonAssistant(target) && access.rights(me, target) !== null && access.mayType(me, target)
  /** A staff-v2 chat whose person's switch is ON now: what the widened lists (and the send) are for. With the switch off the lists are v1's own-chats-only ones again. */
  const staffScoped = (sid: string, me: Caller): boolean => !!sid && chats.info(sid)?.policy === STAFF_POLICY_V2 && staffSendOn(me)

  /**
   * A READ WIDENING, NAMES ONLY (Lead: said in the commit and tested on its own): what a staff-v2 Assistant sees of the live chats is every chat its person can see on the Agents page, as a floor, an agent, a role, what it is doing
   * (working, asking, idle), a PC and `canSend`. Never a word of any chat. A PC-control slot and a person's Assistant are not listed.
   */
  function staffScopeChats(sid: string, agent: FloorAgent, me: Caller) {
    const out: { sessionId: string; floor: string; agent: string; role: string; doing: string; pc: string; canSend: boolean }[] = []
    for (const [s, w] of Object.entries(whereAll())) {
      if (s === sid) continue
      const at = bySession(s)
      if (!at || at.agent.pcControlSlot || isPersonAssistant(at.agent) || access.rights(me, at.agent) === null) continue
      out.push({ sessionId: s, floor: at.floor.name, agent: at.agent.name, role: at.agent.role ?? '', doing: w.state, pc: w.name, canSend: staffMaySendTo(me, at.agent) })
    }
    return { you: agent.name, scope: 'every chat that is yours or was shared with you: names and states only; canSend says whether you may send to it', chats: out }
  }
  /** The roster of the same scope (names only): every floor with something the person can see, each agent online, offline or never opened, and `canSend`. */
  function staffScopeRoster(me: Caller) {
    const where = whereAll()
    const out: { floor: string; total: number; online: number; agents: { name: string; role: string; status: string; doing: string | null; pc: string | null; sessionId: string | null; canSend: boolean }[] }[] = []
    for (const f of allFloors()) {
      const seen = f.agents.filter(a => !a.pcControlSlot && !isPersonAssistant(a) && access.rights(me, a) !== null)
      if (!seen.length) continue
      const agents = seen.map(a => {
        const live = a.sessionId ? where[a.sessionId] : undefined
        return { name: a.name, role: a.role ?? '', status: live ? 'online' : a.sessionId ? 'offline' : 'never opened', doing: live ? live.state : null, pc: live ? live.name : null, sessionId: live ? (a.sessionId ?? null) : null, canSend: staffMaySendTo(me, a) }
      })
      out.push({ floor: f.name, total: agents.length, online: agents.filter(a => a.status === 'online').length, agents })
    }
    return { scope: 'the floors that are yours or were shared with you: names and states only', floors: out }
  }

  /**
   * The send itself, in the order the design says: the person's switch; the chat (running, not the sender's own); the scope (access.mayType, the page's own rule); the words; the chat's screen (a question, unsent text: a staff
   * send NEVER joins a person's unsent words); the person's rate and today's pair and target cooldowns; the ATTEMPT line written ahead (nothing is typed if it cannot be); then the hub's line and, as the very last step, the
   * checks again. Every refusal is one record line and plain words that say nothing was sent. The Assistant is told where the answer is: it does not come back here (stage 1).
   */
  async function staffSendToChat(sid: string, floor: Floor, agent: FloorAgent, me: Caller, args: Record<string, unknown>): Promise<string> {
    const personName = agent.owner?.name || agent.owner?.username || 'its person'
    const person = { id: agent.owner?.id ?? '', name: personName }
    const from = { id: sid.slice(0, 8), agent: agent.name, floor: floor.name }
    const named = typeof args.sessionId === 'string' && UUID_RE.test(args.sessionId) ? args.sessionId.toLowerCase() : null
    let at: { floor: Floor; agent: FloorAgent } | null = null
    try { at = named ? bySession(named) : null } catch { at = null }
    const refuse = (reason: StaffSendRefusal, status: number, words: string): never => {
      staffSends.refused({ kind: 'send-refused', reason, person, from, ...(named && at ? { to: { id: named.slice(0, 8), agent: at.agent.name, floor: at.floor.name } } : {}) })
      throw Object.assign(apiError(status, words), { code: 'staff-send', reason })
    }
    if (!staffSendOn(me)) return refuse('switch-off', 403, staffSendWords('switch-off'))
    const w = named ? whereAll()[named] : undefined
    if (!named || !at || !w) return refuse('chat-gone', 404, staffSendWords('chat-gone'))
    if (named === sid || !staffMaySendTo(me, at.agent)) {
      access.deny(me, 'tool send_to_chat (staff)', named)
      return refuse('not-in-scope', 403, staffSendWords('not-in-scope'))
    }
    const checked = staffSendText(args.text)
    if (!checked.ok) return refuse('text', 400, staffSendTextWords(checked.why))
    // M1, first: a refusal from here on starts no cooldown and counts nothing.
    if (atPrompt(named)) return refuse('at-prompt', 409, promptWords(named))
    if (hasDraft(named)) return refuse('draft', 409, draftWords(named))
    const taken = staffRate.take(person.id)
    if ('limited' in taken) return refuse('rate', 429, staffSendWords('rate', taken.limited))
    let undoRelay: () => void
    try {
      undoRelay = relayAllowed(sid, named)
    } catch (e) {
      taken.undo()
      return refuse('rate', 429, message(e))
    }
    const undo = () => {
      taken.undo()
      undoRelay()
    }
    const target = { id: named.slice(0, 8), agent: at.agent.name, floor: at.floor.name }
    try {
      staffSends.attempt({ kind: 'send-attempt', person, from, to: target, pc: w.name })
    } catch (e) {
      undo()
      log?.error(`staff sends: the attempt could not be written, so nothing was sent (${message(e)})`)
      return refuse('record-failed', 409, staffSendWords('record-failed'))
    }
    const ended = (outcome: StaffSendOutcome) => staffSends.outcome({ kind: 'send-outcome', outcome, person, from, to: target, pc: w.name })
    const line = neutralizeMarks(`${staffSendPrefix({ assistant: agent.name, floor: floor.name, sid, person: personName })} ${checked.text}`)
    /** The checks again (fail closed: any error is "no"): the person's switch, this chat's policy, and the person's right on the target as it is NOW. */
    const still = () => {
      try {
        const live = bySession(named)
        return staffSendOn(me) && chats.info(sid)?.policy === STAFF_POLICY_V2 && !!live && staffMaySendTo(me, live.agent)
      } catch {
        return false
      }
    }
    // From here on the checks above are asked AGAIN at the last step before the write (typeInto's stillAllowed; deliveryAcl for a confirmed delivery), so a right taken away between the first look and the write stops the send.
    liveChecks.set(me, still)
    await o.staffSendGap?.()
    let delivered = false
    try {
      delivered = await typeIntoOrUndo(undo, { sessionId: named, id: w.id }, line, undefined, me)
    } catch (e) {
      const code = (e as { code?: string } | null)?.code
      ended(code === 'delivery-unconfirmed' || code === 'delivery-pending' ? 'handed-over' : still() ? 'blocked' : 'revoked-mid-send')
      throw e
    }
    if (!delivered) {
      const revoked = !still()
      // Unsent words appeared in the box after the first look: the pool refused the write (typeInto asks it to for a staff send) and typed nothing.
      if (!revoked && hasDraft(named)) {
        ended('blocked')
        throw Object.assign(apiError(409, draftWords(named)), { code: 'staff-send', reason: 'draft' })
      }
      ended(revoked ? 'revoked-mid-send' : 'stopped')
      throw Object.assign(apiError(revoked ? 403 : 409, revoked ? STAFF_SEND_REVOKED_WORDS : 'That chat stopped before the message reached it. Nothing was sent.'), { code: 'staff-send', reason: revoked ? 'not-in-scope' : 'chat-gone' })
    }
    ended('delivered')
    log?.info(`staff send: chat ${sid.slice(0, 8)} sent a message to chat ${named.slice(0, 8)}`)
    return staffSendDone(named, personName)
  }

  async function callTool(key: string, name: string, rawArgs: unknown): Promise<string> {
    // memory-identity: W3 (the key of Quick's process: fastCall)
    if (fastHost?.keyOwns(key)) return fastCall(name, rawArgs)
    // Order o5007: the old-app reader's process: its four read-only tools on the old app's folder, nothing else (old-reader.ts).
    if (oldHost?.keyOwns(key)) return oldCall(oldFiles, name, rawArgs)
    const me = chats.byKey(key)
    if (!me) throw apiError(401, "This chat's key isn't known: its terminal was closed or the agent restarted. Open the chat from the floor again.")
    // Order o7e6d: a chat started under a policy is held to it here too, before anything is passed on (staffGate decides for this pool's chats).
    if (me.policy && (!isStaffPolicy(me.policy) || !staffToolAllowed(name, me.policy))) throw staffDenied(name, me.policy)
    // C0: known runtime provenance is checked before forwarding, regardless of current binding or Server availability.
    if (runFenced(me.sessionId)) throw fencedToolError(me.sessionId, name, null)
    if (mode() === 'member' && !isLocalSession(me.sessionId)) {
      // C0: normal forwarding needs a reachable Server, as before S1; it does NOT require a fresh administrator class for ordinary chats.
      // Only a staff-policy run's Server tools wait for fresh remote state. A local own-store origin stays independent of freshness.
      const link = needHub()
      if (isStaffPolicy(me.policy) && !originInOwnStore(me) && !replicaIsFresh()) throw Object.assign(apiError(503, `${team?.hub()?.name ?? 'The Server'} has just been reached again and its floors are not known fresh here yet, so this Assistant's Server tools wait; try again in a moment.`), { code: 'hub-offline' })
      return request<string>(link, 'tool', { sessionId: me.sessionId, name, arguments: rawArgs }).catch(error => {
        if (['send_to_chat', 'app_send_to_chat', 'broadcast_to_chats'].includes(name) && [502, 504].includes(error?.status)) throw Object.assign(apiError(409, 'Delivery is not confirmed after the connection failed; pending messages may already be submitted or may still complete. Inspect the destination; do not automatically press Enter or resend.'), { code: 'delivery-unconfirmed' })
        throw error
      })
    }
    // S1, B3: this PC's own chat: the one check, judged here (no Server needed); staffGate asks it again inside the tool.
    // memory-identity: W4 (a chat of this PC, by its own key: the agent that holds that session)
    return toolFor(me.sessionId, name, rawArgs)
  }

  /** A tool call from the chat `sid` (running here, or on a member that passed it on). F-221: `tapped` = his tap on a relay card carries it out. */
  async function toolFor(sid: string, name: string, rawArgs: unknown, as?: { floor: Floor; agent: FloorAgent; quick?: { talker: QuickTalker | null } }, opt: { tapped?: boolean } = {}): Promise<string> {
    // F-127: on a member this is a chat of a floor made here: what lives on the Server (the task list, the phone, WhatsApp, the screen, the memory layer) is not here.
    if (mode() === 'member' && NEEDS_SERVER.has(name)) {
      throw Object.assign(apiError(503, `That needs the Server (${team?.hub()?.name ?? 'the hub'}), which this chat's floor is not on yet. It joins the Server's list when the Server is back.`), { code: 'hub-offline' })
    }
    const mine = as ?? floors.bySession(sid)
    if (!mine) throw apiError(409, "This chat isn't an agent on a floor any more.")
    const { floor, agent } = mine
    // Order o7e6d: deny by default for a person's own Assistant and every chat with a policy, before any other rule (staffGate).
    staffGate(sid, agent, name)
    const args = isObject(rawArgs) ? rawArgs : {}
    const tag = `${agent.name}, chat ${sid.slice(0, 8)}`
    // F-118: a chat does what its OWNER may. The owner of the app (every chat there was before) is unchanged.
    const me = access.asChat(agent)
    const toolWhere = `tool ${name}`
    if (ADMIN_TOOLS.has(name) && !access.isAdmin(me)) {
      o.auth?.deny(me, 403, 'admin-only', toolWhere, sid)
      throw authError(403, 'That tool is for the owner of this app.', 'admin-only')
    }
    // A second owner is an administrator but not Shubham: his phone and his CRM sign-in are tools of Shubham's own chats only (by id, as Quick is).
    if (FIRST_OWNER_TOOLS.has(name) && !isFirstOwner(me)) {
      o.auth?.deny(me, 403, 'admin-only', toolWhere, sid)
      throw authError(403, "That tool is for the first owner of this app only: it uses his phone and his CRM sign-in.", 'admin-only')
    }
    /** The agent that holds chat `sessionId`, and whether `me` has this much on it (a chat on no floor is the owner of the app's). */
    const mayOn = (sessionId: unknown, need: Need) => {
      const at = typeof sessionId === 'string' ? bySession(sessionId) : null
      if (at) return access.needChat(me, at.agent, need, toolWhere)
      if (!access.isAdmin(me)) throw authError(403, "That chat isn't yours.", 'not-yours')
    }

    // F-221 (ob98a): the spoken latch. While a spoken order he did not tap holds THIS chat (live talk's direct line, the only one that holds: fix
    // round 2), the tool decides, never the words: reads, notes and prepared cards run; a message to another chat waits as a card on his page; anything
    // else is refused. Another chat is never affected; his tap on a relay card comes back here with `tapped`. (It sees the app's tools only:
    // talk-latch.ts.)
    const ids = sid && !opt.tapped ? spokenLatch.open(sid) : []
    if (ids.length) {
      const v = latchVerdict(name, args)
      if (!v.go && !v.hold) {
        log?.info(`spoken latch: ${name} refused for chat ${sid.slice(0, 8)} (orders ${ids.join(', ')})`)
        throw apiError(403, REFUSED_WORDS)
      }
      if (!v.go) {
        // The exact words and target, checked as the send would check them; nothing is typed anywhere.
        const target = name === 'send_to_chat' ? siblingOf(floor, args.sessionId) : anyChat(args.sessionId)
        if (target.sessionId === sid) throw apiError(400, "That's your own chat")
        mayOn(target.sessionId, 'type')
        const body = text(args.text, 'text')
        const at = bySession(target.sessionId)
        const card = talkCards.create({
          kind: 'relay',
          to: at ? `${at.agent.name} on ${at.floor.name}` : `chat ${target.sessionId.slice(0, 8)}`,
          text: neutralizeMarks(body),
          via: 'voice',
          // Filed with the hub, not with a socket: the page lists it with its order (GET /talk/ask/<orderId>) and with all cards (GET /talk/cards).
          conn: null,
          relay: { tool: name === 'send_to_chat' ? 'send_to_chat' : 'app_send_to_chat', from: sid, sessionId: target.sessionId },
          orders: ids,
        })
        log?.info(`spoken latch: a message from chat ${sid.slice(0, 8)} to chat ${target.sessionId.slice(0, 8)} is held as card ${card.id}`)
        return HELD_WORDS
      }
    }

    switch (name) {
      // F-029: the whole app.
      case 'app_chats': {
        const where = whereAll()
        const last = lastAll()
        const rows = floors.list().flatMap(f =>
          f.agents.filter(a => access.rights(me, a) !== null).map(a => {
            const w = a.sessionId ? where[a.sessionId] : undefined
            return {
              floor: f.name,
              agent: a.name,
              role: a.role,
              isBoss: a.isBoss,
              sessionId: a.sessionId,
              status: w ? 'running' : a.sessionId ? 'not running' : 'never opened',
              doing: w?.state ?? null,
              pc: w?.name ?? null,
              lastOn: !w && a.sessionId ? (last[a.sessionId]?.pc ?? null) : null,
              isYou: a.sessionId === sid,
            }
          }),
        )
        return json({ you: `${agent.name} on ${floor.name}`, pcs: pcs().map(p => p.name), chats: rows })
      }
      case 'app_read_chat': {
        const target = anyChat(args.sessionId)
        mayOn(target.sessionId, 'view')
        return readChat(target, typeof args.lines === 'number' ? Math.min(500, args.lines) : 100)
      }
      case 'app_read_conversation': {
        if (typeof args.sessionId !== 'string' || !args.sessionId) throw apiError(400, 'sessionId is missing')
        mayOn(args.sessionId, 'view')
        const file = findTranscript(args.sessionId, projectsDir)
        if (!file) throw apiError(404, `There is no conversation ${args.sessionId} on the hub`)
        const n = typeof args.last === 'number' ? Math.max(1, Math.min(200, args.last)) : 20
        return json(readTranscriptFile(file).slice(-n).map(m => ({ role: m.role, at: m.timestamp, text: m.text.length > 4000 ? `${m.text.slice(0, 4000)}…` : m.text, tools: m.tools })))
      }
      case 'app_send_to_chat': {
        const target = anyChat(args.sessionId)
        if (target.sessionId === sid) throw apiError(400, "That's your own chat")
        mayOn(target.sessionId, 'type')
        const body = text(args.text, 'text')
        // M1: first, so a refusal starts no cooldown and opens no order.
        if (atPrompt(target.sessionId)) throw apiError(409, promptWords(target.sessionId))
        // 10 Nov 2026, Shubham: unsent text in a Claude chat's box no longer refuses a message (typeInto sends it the old direct way after the text).
        if (!joinsDraft(target.sessionId) && hasDraft(target.sessionId)) throw apiError(409, draftWords(target.sessionId))
        const undo = relayAllowed(sid, target.sessionId)
        // F-072: an order from the Assistant is recorded, and its answer comes back by itself.
        const order = orderFrom(floor, agent, sid, target.sessionId, body)
        const mark = order ? orderMarker(order, sid, opt.tapped === true) : null
        // F-221 (ob98a): a relayed message never carries the tapped marker (its words, or a name). His tap on a held one never sends it twice.
        if (!(await typeIntoOrUndo(undo, target, neutralizeMarks(`[message from ${agent.name} on ${floor.name}, chat ${sid.slice(0, 8)}${mark ? `, ${mark.marker}` : ''}] ${body}`), () => { if (order) openOrder(order, sid, target.sessionId, body, mark?.untapped) }, me, opt.tapped === true))) throw apiError(409, atPrompt(target.sessionId) ? promptWords(target.sessionId) : 'That chat stopped before the message reached it')
        if (order) openOrder(order, sid, target.sessionId, body, mark?.untapped)
        log?.info(`${agent.name} → chat ${target.sessionId.slice(0, 8)} (another floor or PC): a message`)
        return order ? `Sent to chat ${target.sessionId} as order ${order}. Its answer at the end of its turn comes back to you here by itself ("[reply from ...]"): do not wait for it, and do not ask it to answer.` : `Sent to chat ${target.sessionId}.`
      }
      case 'app_open_chat': {
        requireHostAdoption()
        const { floor: f, agent: a } = findAgent(args.floor, args.agent)
        access.needChat(me, a, 'owner', toolWhere)
        // Order o7e6d (H1, Agent 3's review): a staff Assistant opens only as native Claude under the staff policy: no profile asked for, none it
        // has itself (its own codex-in-claude-v1 would take the managed branch below, select/seal/commit, before any later refusal), no other PC.
        // Refused here, before that branch: nothing is selected, sealed, committed or launched (openChat checks the rest).
        if (isStaffAssistant(a) && (args.executionProfile !== undefined || args.restoreHistory !== undefined || executionIdentityOf(a, defaultsNow()).profile !== 'claude-native-v1' || (typeof args.pc === 'string' && args.pc.trim() !== '' && args.pc !== self().id && args.pc.trim().toLowerCase() !== self().name.toLowerCase()))) throw staffError("A person's own Assistant opens on the Server only, as native Claude.")
        const explicitProfile = args.executionProfile
        if (args.restoreHistory !== undefined && (args.restoreHistory !== true || explicitProfile !== 'codex-native-v1')) throw executionHttpError('execution-invalid', 'selection')
        // Order occ4c: claude-native-v1 is the way back to native Claude for a managed conversation (the service refuses it for a plain one).
        if (explicitProfile !== undefined && explicitProfile !== 'codex-in-claude-v1' && explicitProfile !== 'codex-native-v1' && explicitProfile !== 'claude-native-v1') throw executionHttpError('execution-invalid', 'open')
        if (explicitProfile || executionIdentityOf(a, defaultsNow()).profile === 'codex-in-claude-v1') {
          workflowExecutionAgent(f.id, a.id)
          if (!executionService || !me.person || !a.owner || !a.homePc || a.homePc !== self().id
            || (args.pc !== undefined && args.pc !== self().id && String(args.pc).toLowerCase() !== self().name.toLowerCase())) throw executionHttpError('execution-capability-required', 'open')
          const scope = { actorId: me.person.id, ownerId: a.owner.id, floorId: f.id, agentId: a.id, targetPcId: a.homePc }
          executionService.bindActor(scope, chatExecutionActor({ floorId: floor.id, agentId: agent.id }, scope,
            { floors, access, target: workflowExecutionAgent }))
          const operationId = typeof args.operationId === 'string' ? args.operationId : explicitProfile ? '' : randomUUID()
          const reply = await executionService.openTool(scope, operationId, explicitProfile === 'codex-in-claude-v1',
            explicitProfile === 'codex-native-v1' || explicitProfile === 'claude-native-v1' ? explicitProfile : 'codex-in-claude-v1', args.restoreHistory === true)
          return json({ ...reply, sessionId: reply.committed.sessionId, agent: a.name, floor: f.name, pc: self().name })
        }
        const pcName = typeof args.pc === 'string' && args.pc.trim() ? args.pc.trim().toLowerCase() : null
        const pc = pcName ? pcs().find(p => p.name.toLowerCase() === pcName || p.id === args.pc) : null
        if (pcName && !pc) throw apiError(404, `No PC called ${String(args.pc)} within reach; app_chats lists them`)
        const opened =
          pc && !pc.here
            ? await openOnPeer(peerOf(pc.id), f, a, undefined, terminalClaimLine(me, access.isAdmin(me)))
            : await openChat(f.id, a.id, { takeOver: args.takeOver === true }, undefined, undefined, { kind: 'chat', chat: presenceChat(sid) })
        return json({ ...opened, agent: a.name, floor: f.name, pc: pc?.name ?? self().name })
      }
      case 'prepare_send': {
        // F-076: only the overlay Assistant, and only a proposal: nothing is typed anywhere. Shubham sees the card and sends it with his own tap.
        if (!isOrchestratorAgent(floor.name, agent)) throw apiError(403, 'Only the overlay assistant prepares cards for Shubham to send.')
        const card = prepareCard(args.floor, args.agent, args.text, args.why)
        log?.info(`${agent.name} prepared a card for ${card.agentName} on ${card.floorName}`)
        return `Prepared for Shubham: "${card.text.slice(0, 120)}" to ${card.agentName} on ${card.floorName}. It is on his Send tab; only his own tap sends it.`
      }
      case 'app_set_effort': {
        // F-049: kept on the agent (its chat starts with --effort every time) and, when its chat
        // is running and waiting, typed into it as /effort, which sets this session's at once.
        const { floor: f, agent: a } = findAgent(args.floor, args.agent)
        access.needChat(me, a, 'owner', toolWhere)
        const raw = typeof args.level === 'string' ? args.level.trim().toLowerCase() : ''
        const level = (raw === 'default' ? '' : raw) as AgentEffort
        if (!(AGENT_EFFORTS as readonly string[]).includes(level)) throw apiError(400, 'level is low, medium, high, xhigh, max, or default')
        floors.patch(f.id, { agents: f.agents.map(x => (x.id === a.id ? { ...x, effort: level } : x)) })
        const w = a.sessionId ? whereAll()[a.sessionId] : undefined
        const kept = level ? `${a.name} on ${f.name} starts on ${level} effort from now on` : `${a.name} on ${f.name} starts on the CLI's own effort from now on`
        if (!w || !a.sessionId) return `${kept}; its chat isn't running, so that is when it next starts.`
        if (!level) return `${kept}; its running chat keeps the effort it has until it starts again.`
        if (a.sessionId === sid) return `${kept}. This is your own chat: it keeps its effort until it starts again (type /effort ${level} in it to change it now).`
        if (w.state === 'running') return `${kept}. Its chat is working right now, so it keeps its effort until it starts again; ask again once it is waiting to set it at once.`
        if (atPrompt(a.sessionId)) return `${kept}. ${promptWords(a.sessionId)}`
        // F-302 (Agent 14's L5): typed into the chat only where its owner may type (mayType, with the Server scope); otherwise it is kept for the chat's next start.
        if (!access.mayType(me, a)) return `${kept}. Typing into its running chat is not open to its owner (Settings > Access, who may type in chats), so it keeps its effort until it starts again.`
        if (!(await typeInto({ sessionId: a.sessionId, id: w.id }, `/effort ${level}`, { human: true }))) return `${kept}; its chat stopped before it could be set now.`
        log?.info(`${agent.name} set ${a.name}'s effort to ${level}`)
        return `${kept}, and its running chat (on ${w.name}) is on ${level} now: /effort ${level} was typed into it.`
      }
      case 'app_stop_chat': {
        if (args.sessionId === sid) throw apiError(400, "That's your own chat")
        const at=typeof args.sessionId==='string'?bySession(args.sessionId):null
        if(at?.agent.homePc===self().id&&executionIdentityOf(at.agent,defaultsNow()).profile==='codex-in-claude-v1'
          &&!executionService?.runtime.matches(snapshotAgentExecution(at.agent,defaultsNow()))) {
          access.needChat(me,at.agent,'owner',toolWhere)
          workflowExecutionAgent(at.floor.id,at.agent.id)
          if(!executionService)throw executionHttpError('execution-capability-required','runtime')
          const expected=snapshotAgentExecution(at.agent,defaultsNow())
          await executionService.runtime.cancelUnstarted(expected,()=>{
            const source=floors.bySession(sid),fresh=workflowExecutionAgent(at.floor.id,at.agent.id)
            if(!source||access.asChat(source.agent).person?.id!==me.person!.id)throw executionHttpError('execution-forbidden','authorization')
            assertExecutionCAS(expected,snapshotAgentExecution(fresh,defaultsNow()))
            access.needChat(access.asChat(source.agent),fresh,'owner',toolWhere)
          })
          return `The exact unconfirmed managed start for ${at.agent.sessionId} was stopped and its end verified.`
        }
        const target = anyChat(args.sessionId)
        mayOn(target.sessionId, 'owner')
        stopAnywhere(target.sessionId)
        return `Stopping chat ${target.sessionId}.`
      }
      case 'list_chats': {
        // F-297: a staff-v2 Assistant with its person's switch ON sees the chats of its person's scope, NAMES AND STATES ONLY (staffScopeChats); with the switch off it is v1's own-chats-only list again.
        if (staffScoped(sid, me)) return json(staffScopeChats(sid, agent, me))
        const byId = new Map(floor.agents.map(a => [a.id, a]))
        // o7e6d: a staff Assistant sees its person's own chats only (never one shared with them).
        const person = staffPerson(sid, agent)
        const others = Object.entries(whereAll())
          .filter(([s]) => s !== sid)
          .map(([s, w]) => ({ s, w, at: floors.bySession(s) }))
          .filter(x => x.at?.floor.id === floor.id && access.rights(me, x.at.agent) !== null && (person === null || ownAssistantMayUse(x.at.agent.owner?.id, person)))
          .map(({ s, w, at }) => ({ sessionId: s, agent: at!.agent.name, role: byId.get(at!.agent.id)?.role ?? '', doing: w.state, pc: w.name }))
        return json({ floor: floor.name, you: agent.name, chats: others })
      }
      case 'floor_roster': {
        // F-297: the same widening, names only (staffScopeRoster), for a staff-v2 Assistant whose switch is ON.
        if (staffScoped(sid, me)) return json(staffScopeRoster(me))
        // o7e6d: a staff Assistant sees its person's own agents only.
        const person = staffPerson(sid, agent)
        return json(rosterOf({ ...floor, agents: floor.agents.filter(a => a.id === agent.id || (access.rights(me, a) !== null && (person === null || ownAssistantMayUse(a.owner?.id, person)))) }, agent))
      }
      case 'watchdog_status':
        return json(watchdogView())
      // Order o16d2: a picture or a video shown in this chat (media.ts). The answer is the JSON line the page draws it from (shared/media.ts).
      // A file has to be on the PC that serves the page: a chat running on another PC has its files there, so only an https address works from it.
      case 'show_media': {
        const w = whereAll()[sid]
        const fromFile = typeof args.path === 'string' && args.path.trim() !== ''
        if (fromFile && (mode() === 'member' || (w && w.id !== self().id))) {
          throw apiError(409, `A file can be shown from chats running on the main PC (the Server) for now; this chat runs on ${w?.name ?? self().name}. Copy the file to the Server, or give an https:// address.`)
        }
        return json({ media: await mediaShelf.share(args, { sessionId: sid, agent: agent.name }), shown: 'It is in the chat now, as a picture or a video he can open, play and save.' })
      }
      // Order o3963: a button for a PC's Control screen (shared/screen-bubble.ts). Only names the PC: nothing connects until his tap opens the screen.
      // Order o68f0 (Shubham: "We need you to have tools to do this please, so the users I give this access to can control this PC."): the overlay
      // Assistant reads and types in an SSH terminal on the Server (pc-ssh-term.ts SshAssist, by the rules of shared/ssh-assist.ts: never at a secret
      // or host-key question; what deletes recursively, shuts down, deletes a user or wipes a disk waits as a card for his own tap). For now the
      // owner of the app's Assistant on every PC, in his scope; slice 3: a person's own Assistant only on the PCs SSH is open to that person on (Settings ›
      // Access, 'pc-ssh@<pcId>'), in that person's own scope (their sessions only). Every answer carries the private mark.
      case 'ssh_open':
      case 'ssh_read':
      case 'ssh_type':
      case 'ssh_close': {
        if (!isOrchestratorAgent(floor.name, agent)) throw apiError(403, 'Only the overlay Assistant uses SSH terminals; ask it (it is the sparkle button in the app).')
        const admin = access.isAdmin(me)
        if (!admin && !me.person) throw authError(403, 'SSH terminals are for a signed-in person’s own Assistant.', 'admin-only')
        const ssh = o.ssh?.() ?? null
        if (!ssh) throw apiError(503, 'SSH terminals are not available here (they run on the Server).')
        const as = admin ? { scope: '@owner', who: `${agent.name} on ${floor.name} (the Assistant)` } : { scope: `person:${me.person!.id.toLowerCase()}`, who: `${agent.name} on ${floor.name} (the Assistant of ${me.person!.username})` }
        /** A person who is not the owner: only on a PC SSH is open to them on, checked at every call (it can be taken away). */
        const mayOnPc = (id: string) => {
          if (admin || o.featureAccess?.allows(me, 'pc-ssh', id) === true) return
          o.auth?.deny(me, 403, 'not-allowed', toolWhere, sid)
          throw authError(403, 'SSH to that PC is not open to the person this Assistant belongs to. The owner of this app opens it, PC by PC, in Settings › Access.', 'not-allowed')
        }
        const pcs = controlDeviceCatalogue()
        const pcId = (): string | undefined => {
          const want = typeof args.pc === 'string' ? args.pc.trim() : ''
          if (!want) return undefined
          const pc = pcs.find(p => p.id === want) ?? pcs.find(p => p.name.toLowerCase() === want.toLowerCase())
          if (!pc) throw apiError(404, `There is no PC called "${want}". The PCs are: ${pcs.map(p => p.name).join(', ') || 'none'}.`)
          mayOnPc(pc.id)
          return pc.id
        }
        const pick = () => {
          const p = { session: typeof args.session === 'string' ? args.session : undefined, pcId: pcId() }
          // A session named by its id: its PC is checked too.
          if (!admin && p.session !== undefined && p.pcId === undefined) mayOnPc(ssh.read(as, { session: p.session }, 1).pcId)
          return p
        }
        const lines = typeof args.lines === 'number' ? args.lines : 40
        if (name === 'ssh_open') {
          const id = pcId()
          if (!id) throw apiError(400, 'Say which PC: pc is its name (like Z800) or its id.')
          return sshAnswer(sshWords(await ssh.open(as, id, { user: args.user, host: args.host, port: args.port })))
        }
        if (name === 'ssh_read') return sshAnswer(sshWords(ssh.read(as, pick(), lines)))
        if (name === 'ssh_close') return sshAnswer(sshWords(ssh.close(as, pick())))
        return sshAnswer(sshWords(await ssh.type(as, pick(), { text: args.text, enter: args.enter, key: args.key, wait: args.wait, lines: args.lines })))
      }
      case 'show_screen': {
        const want = typeof args.pc === 'string' ? args.pc.trim() : ''
        if (!want) throw apiError(400, 'Say which PC: pc is its name (like Server) or its id.')
        const pcs = controlDeviceCatalogue()
        const pc = pcs.find(p => p.id === want) ?? pcs.find(p => p.name.toLowerCase() === want.toLowerCase())
        if (!pc) throw apiError(404, `There is no PC called "${want}". The PCs are: ${pcs.map(p => p.name).join(', ') || 'none'}.`)
        const caption = typeof args.caption === 'string' && args.caption.trim() ? args.caption.trim().slice(0, 300) : null
        return json({ screen: { pc: pc.id, name: pc.name, caption, online: pc.online }, shown: `A button for ${pc.name}'s screen is in the chat now${pc.online ? '' : ` (${pc.name} is offline right now)`}. Nothing connects until he taps it.` })
      }
      // Order o528e: the CRM's files (agent/crm-files/find.ts), as the CRM signed in on this PC lists them. Read only.
      case 'crm_files': {
        const words = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined)
        const ask = { query: words(args.query), project: words(args.project), folder: words(args.folder), type: words(args.type), limit: typeof args.limit === 'number' ? args.limit : undefined }
        if (!ask.query && !ask.project && !ask.folder && !ask.type) throw apiError(400, 'Say what to look for: query (words of the name), project, folder or type.')
        return json(await crmFiles.service.find(ask))
      }
      // Order o5dc4: the Browser (agent/browser/host.ts): open an address and read it, or read what is open. Nothing is clicked or typed by an agent.
      case 'browser_open': {
        const url = typeof args.url === 'string' ? args.url.trim() : ''
        if (!url) throw apiError(400, 'Say which address: url is an address on his tailnet, like https://<machine>.<tailnet>.ts.net:<port> or http://100.x.y.z:<port>.')
        const r = await browser.open(url, { max: typeof args.max === 'number' ? args.max : undefined })
        // Order o7e1e: the answer carries the private mark (its transcript rows are blanked in the CRM drive's copy, conversations.ts).
        return json({ ...r, shown: 'It is open in the Browser page (Shubham sees it live there).', privacy: BROWSER_PRIVATE_NOTE })
      }
      case 'browser_read': {
        const r = await browser.read(typeof args.max === 'number' ? args.max : undefined)
        if (!r) throw apiError(409, 'No browser is open now. browser_open starts one with an address.')
        return json({ ...r, privacy: BROWSER_PRIVATE_NOTE })
      }
      // Order o528e: one CRM file in the chat (media.ts): a picture, a video, a PDF (its pages drawn here) or a file to download. Read only.
      case 'show_crm_file': {
        const media = await mediaShelf.shareCrm(args, { sessionId: sid, agent: agent.name })
        const words = media.kind === 'pdf' ? 'a PDF he can open page by page (pinch to zoom) and download' : media.kind === 'file' ? 'a file he can download' : media.kind === 'video' ? 'a video he can play and save' : 'a picture he can open and save'
        return json({ media, shown: `${media.name} is in the chat now, as ${words}.` })
      }
      // F-085: the Update button's push, from the PC. The overlay assistant and the Mobile chat (floor Final), as for the phone's hands.
      case 'phone_update': {
        if (!phoneUser(floor.name, agent)) {
          throw apiError(403, "Only the overlay assistant and the Mobile chat can ask Shubham's phone to update.")
        }
        if (mode() === 'member') throw apiError(409, 'The phone is reached through the hub; ask from the hub.')
        return json(await voice.updatePhones())
      }
      case 'read_chat': {
        const c = siblingOf(floor, args.sessionId)
        mayOn(c.sessionId, 'view')
        // o7e6d: a staff Assistant reads its person's own chats only.
        const person = staffPerson(sid, agent)
        if (person !== null && !ownAssistantMayUse(bySession(c.sessionId)?.agent.owner?.id, person)) throw staffDenied(name)
        return readChat(c, typeof args.lines === 'number' ? args.lines : 100)
      }
      case 'send_to_chat': {
        // F-297: a person's own Assistant under staff-v2 sends by its own rules (staffSendToChat); staffGate already refused v1 and every other policy.
        if (chats.info(sid)?.policy === STAFF_POLICY_V2) return staffSendToChat(sid, floor, agent, me, args)
        const c = siblingOf(floor, args.sessionId)
        if (c.sessionId === sid) throw apiError(400, "That's your own chat")
        mayOn(c.sessionId, 'type')
        const body = text(args.text, 'text')
        // M1: first, so a refusal starts no cooldown and opens no order.
        if (atPrompt(c.sessionId)) throw apiError(409, promptWords(c.sessionId))
        // 10 Nov 2026, Shubham: unsent text in a Claude chat's box no longer refuses a message (typeInto sends it the old direct way after the text).
        if (!joinsDraft(c.sessionId) && hasDraft(c.sessionId)) throw apiError(409, draftWords(c.sessionId))
        const undo = relayAllowed(sid, c.sessionId)
        const order = orderFrom(floor, agent, sid, c.sessionId, body)
        const mark = order ? orderMarker(order, sid, opt.tapped === true) : null
        // F-221 (ob98a): a relayed message never carries the tapped marker (its words, or a name). His tap on a held one never sends it twice.
        if (!(await typeIntoOrUndo(undo, c, neutralizeMarks(`[message from ${tag}${mark ? `, ${mark.marker}` : ''}] ${body}`), () => { if (order) openOrder(order, sid, c.sessionId, body, mark?.untapped) }, me, opt.tapped === true))) throw apiError(409, atPrompt(c.sessionId) ? promptWords(c.sessionId) : 'That chat stopped before the message reached it')
        if (order) openOrder(order, sid, c.sessionId, body, mark?.untapped)
        log?.info(`${agent.name} → chat ${c.sessionId.slice(0, 8)}: a message`)
        return order ? `Sent to chat ${c.sessionId} as order ${order}. Its answer at the end of its turn comes back to you here by itself ("[reply from ...]"): do not wait for it, and do not ask it to answer.` : `Sent to chat ${c.sessionId}.`
      }
      case 'broadcast_to_chats': {
        const body = text(args.text, 'text')
        const t = Date.now()
        if (t - (broadcastLast.get(floor.id) ?? 0) < BROADCAST_COOLDOWN_MS) throw apiError(429, 'This floor just had a broadcast; wait a few seconds.')
        broadcastLast.set(floor.id, t)
        // of95c (Agent 3's F1): only chats its owner may type into now, by the one typing rule and his choice (broadcast-targets.ts).
        const all = broadcastTargets(Object.entries(whereAll()), sid, floor.id, s => floors.bySession(s), a => access.mayType(me, a))
          .map(([s, w]) => ({ sessionId: s, id: w.id, asking: atPrompt(s), drafting: hasDraft(s) }))
        // M1: a chat at a prompt is skipped, not pressed Enter on. 10 Nov 2026 (Shubham): a chat with unsent text in its box is NOT skipped
        // any more; the message goes in after the text the old direct way.
        // (A Codex chat's native sender never types over text it did not paste, so a Codex chat with a draft is still skipped, honestly.)
        const to = all.filter(c => !c.asking && (!c.drafting || joinsDraft(c.sessionId)))
        const skipped = all.filter(c => c.asking)
        const drafts = all.filter(c => !c.asking && c.drafting && !joinsDraft(c.sessionId))
        // A chat on a member PC reports a draft back (409): it is counted with the skipped ones.
        const outcomes = await Promise.all(to.map(async c => {
          try { return { c, sent: await typeInto(c, neutralizeMarks(`[broadcast from ${tag}] ${body}`), { confirmed: true, caller: me }), unknown: false, pending: false, draft: false } }
          catch (e) { return { c, sent: false, unknown: isObject(e) && e.code === 'delivery-unconfirmed', pending: isObject(e) && e.code === 'delivery-pending', draft: e instanceof Error && /unsent text in its box/.test(e.message) } }
        }))
        const uncertain = outcomes.filter(r => r.unknown).map(r => r.c)
        const progressing = outcomes.filter(r => r.pending).map(r => r.c)
        const refused = outcomes.filter(r => !r.sent && !r.unknown && !r.pending).map(r => r.c)
        const failed = outcomes.filter(r => !r.sent && !r.unknown && !r.pending && !r.draft).map(r => r.c)
        if (refused.length || uncertain.length || progressing.length) {
          drafts.push(...outcomes.filter(r => r.draft).map(r => r.c))
          to.splice(0, to.length, ...to.filter(c => !refused.includes(c) && !uncertain.includes(c) && !progressing.includes(c)))
        }
        const nameOf = (c: { sessionId: string }) => floors.bySession(c.sessionId)?.agent.name ?? c.sessionId.slice(0, 8)
        return `Sent to ${to.length} chat${to.length === 1 ? '' : 's'}.${skipped.length ? ` Skipped ${skipped.length} waiting at a prompt (Approvals tab): ${skipped.map(nameOf).join(', ')}.` : ''}${drafts.length ? ` Skipped ${drafts.length} with unsent text in the box (try again shortly): ${drafts.map(nameOf).join(', ')}.` : ''}${failed.length ? ` Not submitted to ${failed.map(nameOf).join(', ')}: blocked or unavailable.` : ''}${progressing.length ? ` Delivery still in progress for ${progressing.map(nameOf).join(', ')}; the observation window ended, not the native sends. Wait for those same operations; never resend or automatically press Enter.` : ''}${uncertain.length ? ` Delivery not confirmed for ${uncertain.map(nameOf).join(', ')}; the pending messages may already be submitted or may still complete. Inspect those chats; do not automatically press Enter or resend.` : ''}`
      }
      case 'memory_save': {
        const entry = memory.save(floor.id, {
          text: text(args.text, 'text'),
          tags: Array.isArray(args.tags) ? (args.tags as string[]) : [],
          sessionId: sid,
          authorName: agent.name,
        })
        memoryChanged(floor.id)
        return json({ saved: entry.id })
      }
      case 'memory_search': {
        const query = typeof args.query === 'string' ? args.query : ''
        const limit = typeof args.limit === 'number' ? args.limit : 10
        const entries = memory.search(floor.id, query, limit)
        // F-051: the floor's notes by keyword as before, and hits from all of the memory beside
        // them once the layer is switched on (until then, the answer is exactly as it was).
        if (args.mode === 'keyword' || !memoryOn || mode() === 'member' || !access.isAdmin(me)) return json({ entries })
        // S2: the hits are the chat's OWNER's memory, and only while the chat is not shared (the administrator test above stays: S2 only narrows).
        // memory-door: T1
        const layer = await chatLayer(agent, as?.quick)
        if (!layer) return json({ entries })
        const hits = query.trim() ? await layer.search(query, { limit, excludeSession: sid }) : []
        return json({ entries, hits })
      }
      case 'memory_recent':
        return json({ entries: memory.recent(floor.id, typeof args.limit === 'number' ? args.limit : 10) })
      case 'memory_read': {
        if (!memoryOn) throw apiError(409, "The app's memory (F-051) isn't switched on yet; memory_search finds the floor's notes.")
        // S2: the chat's OWNER's memory (ADMIN_TOOLS above already refused a non-administrator); another administrator's chat, or a shared one, is refused.
        // memory-door: T2
        const layer = await chatLayer(agent, as?.quick)
        if (!layer) throw memoryDenied(agent, name, as?.quick)
        return layer.read(typeof args.ref === 'string' ? args.ref : '')
      }
      // F-309 N1: the agent's NOTEBOOK (memory-notebook.ts). The notebook is found from this chat's floor and agent by the owner's table: a call never names a notebook, an owner or an
      // instance, and a chat the table does not cover (off, no row, another person's, PC Control) is told so and saves or reads nothing. Each case has its marker (notebook-door: K1..K3).
      case 'notebook_add': {
        // notebook-door: K1
        const nb = notebooks.forChat(floor, agent)
        if (!nb.ok) return json({ status: 'off', saved: false, why: nb.why })
        return json({ ...nb.chat.add(args), notebook: nb.chat.template.name, instance: nb.chat.instance.name })
      }
      case 'notebook_search': {
        // notebook-door: K2
        const nb = notebooks.forChat(floor, agent)
        if (!nb.ok) return json({ status: 'off', why: nb.why, hits: [] })
        const found = nb.chat.search(typeof args.query === 'string' ? args.query : '', {
          limit: typeof args.limit === 'number' ? args.limit : undefined,
          only: typeof args.only === 'string' ? args.only : undefined,
          history: args.history === true,
        })
        return json({ notebook: nb.chat.template.name, instance: nb.chat.instance.name, ...found })
      }
      case 'notebook_read': {
        // notebook-door: K3
        const nb = notebooks.forChat(floor, agent)
        if (!nb.ok) throw apiError(409, nb.why)
        return nb.chat.read(typeof args.ref === 'string' ? args.ref : '')
      }
      // F-051: not a tool the chats see: a member's /mcp/recall, passed to the hub (or this PC's own).
      case 'memory_recall': {
        // S2: the chat's OWNER's recall, and '' for a chat that is shared, whose owner has no memory yet, or whose owner is not an administrator. Never on a member PC:
        // a chat of a floor made there would make and start a layer on that PC (the hub answers the chats it holds).
        // memory-door: T3
        const layer = memoryOn && mode() !== 'member' && access.isAdmin(me) ? await chatLayer(agent) : null
        const fromMemory = layer ? await layer.recall({ sessionId: sid, prompt: typeof args.prompt === 'string' ? args.prompt : '' }) : ''
        // F-309 N2: then the notebook's own line for this prompt (the chat's own notebook, found as for its tools); with none, the answer is the memory's, exactly as it was (joinSections).
        // notebook-door: K12
        const nb = mode() === 'member' ? null : notebooks.forChat(floor, agent)
        return joinSections(fromMemory, nb && nb.ok ? nb.chat.recall({ sessionId: sid, prompt: typeof args.prompt === 'string' ? args.prompt : '' }) : '')
      }
      // F-056: the app's one task list (the Tasks tab), for every chat.
      case 'task_add': {
        const body = taskText(args.text)
        // The same task added twice within minutes (a retry, a chat repeating itself) is the one that is there.
        const same = (await tasks.list({ status: 'open', limit: 100 })).find(t => t.text === body && Date.now() - Date.parse(t.createdAt) < 10 * 60_000)
        if (same) return json({ id: same.id, note: 'That task is already on the list.' })
        const task = await tasks.add({ text: body, by: { kind: 'agent', name: agent.name, floor: floor.name } })
        return json({ added: task.id, text: task.text })
      }
      case 'task_list': {
        const s = args.status
        const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(Math.floor(args.limit), 100) : 30
        const list = await tasks.list({ status: s === 'done' || s === 'all' ? s : 'open', query: typeof args.query === 'string' ? args.query : undefined, limit })
        return json({
          tasks: list.map(t => ({ id: t.id, text: t.text, done: t.done, added: t.createdAt, by: t.by.kind === 'agent' ? `${t.by.name ?? 'an agent'}${t.by.floor ? ` on ${t.by.floor}` : ''}` : 'Shubham' })),
          counts: await tasks.counts(),
        })
      }
      case 'task_update': {
        const id = typeof args.id === 'string' ? args.id : ''
        if (!id) throw apiError(400, 'id is missing: task_list gives it')
        const patch = taskPatch({
          ...(args.text !== undefined ? { text: args.text } : {}),
          ...(args.done !== undefined ? { done: args.done } : {}),
          ...(args.delete === true ? { deleted: true } : {}),
        })
        const task = await tasks.update(id, patch)
        return json({ id: task.id, text: task.text, done: task.done, deleted: task.deletedAt !== null })
      }
      // The CRM's goals (the Goals page's own list), by the person signed in to the CRM on this PC: the owner of the app, so ADMIN_TOOLS above.
      case 'crm_whoami':
        return crmGoals.whoami()
      case 'crm_members':
        return crmGoals.members(args)
      case 'crm_goals':
        return crmGoals.list(args)
      case 'crm_goal_add': {
        const out = await crmGoals.add(args)
        log?.info(`${agent.name} added a CRM goal`)
        return out
      }
      case 'crm_goal_update': {
        const out = await crmGoals.update(args)
        log?.info(`${agent.name} changed a CRM goal`)
        return out
      }
      // The rest of the CRM, read only (crm-reads.ts): the boards, one board's cards, what the CRM has, and any of it that may be read.
      case 'crm_scopes':
        return crmReads.scopes(args)
      case 'crm_board':
        return crmReads.board(args)
      case 'crm_catalog':
        return crmReads.catalog(args)
      case 'crm_query':
        return crmReads.query(args)
      // A production write to anything else in the CRM the tools do not have a name for (crm-write.ts keeps out deletes, money and people's access): the log says only that one was made.
      case 'crm_write': {
        const out = await crmWrite.write(args)
        log?.info(`${agent.name} wrote to the CRM`)
        return out
      }
      // F-070: the overlay assistant's hands. Only that agent (duty orchestrator); order o355e: each person's own Assistant, on that person's own pages only.
      case 'ui_screen':
      case 'ui_control':
      case 'ui_modules':
      case 'ui_invoke': {
        // F-162 slice B: a person's own Assistant too; its calls reach only that person's own pages (the bridge scopes by the chat's owner).
        if (!isOrchestratorAgent(floor.name, agent) && !isPersonAssistant(agent)) throw apiError(403, "Only the overlay assistant moves the screen; ask it (it is the sparkle button in the app).")
        // o7e6d: a staff member's own Assistant (not the owner) looks at the screen only (ui_screen), and only the app's main pages.
        const staff = isPersonAssistant(agent) && !access.isAdmin(access.asChat(agent))
        if (staff && name !== 'ui_screen') throw apiError(403, 'Your Assistant can only look at the screen (ui_screen).')
        // "Goals on mobile: use the API" (Settings › Assistant, on unless turned off): on a phone the CRM Goals page is not driven. What opens
        // it, or its handlers, is refused here; the page refuses a press or typing while it is on the Goals page (told to by goalsApi).
        if (name === 'ui_invoke') {
          const climb = pathClimb(args.args)
          if (climb) throw apiError(400, `ui_invoke: an argument may not climb out of a path ("${climb.slice(0, 60)}"): give plain ids and words.`)
        }
        // Order o355e (+ oe3b1): the chat's own person's pages only (its owner's; the owner of the app's own pages and open app on any of his PCs).
        const as = uiWho(me)
        const goalsApi = ui.onPhone(as) === true && assistantSettings.get().goalsOnMobile
        if (goalsApi) {
          const why = goalsPageCall(name, args)
          if (why) throw apiError(409, why)
        }
        // Presence (chat-presence.ts): from here the call REACHES the screen bridge, so it is recorded: which Assistant, what kind of act, how it ended. A refusal above this
        // line is told to the chat and is not recorded (an argument that climbs out of a path is the one somebody might want later: a second hook, not a widening of this).
        // The only reading of `args` is the closed act (screenActOf): never a path, url, ref, text, key, handler or argument.
        const tool = screenToolOf(name)
        const by = screenActorOf(floor, agent, sid)
        let failure: unknown = null
        try {
          const out = await ui.call(
            name === 'ui_screen' ? 'screen' : name === 'ui_modules' ? 'modules' : name === 'ui_invoke' ? 'invoke' : typeof args.action === 'string' ? args.action : '',
            goalsApi ? { ...args, goalsApi: true } : args,
            undefined,
            as,
            staff ? staffMayScreen : undefined,
          )
          return typeof out === 'string' ? out : json(out)
        } catch (e) {
          failure = e
          throw e
        } finally {
          if (tool) presence.screen(by, tool, screenActOf(tool, args.action), screenOutcomeOf(failure))
        }
      }
      // F-082: the overlay assistant's hands on the phone; F-084 H2: the Mobile agent's chat (floor Final) too, nobody else. The hub
      // (phone.ts) carries the phone's own answers. Who asked is taken from the chat's identity (phoneUser), never from an argument, and goes
      // with the command to the phone's action log and notification.
      case 'phone_screen':
      case 'phone_control': {
        const by = phoneUser(floor.name, agent)
        if (!by) throw apiError(403, "Only the overlay assistant and the Mobile agent use Shubham's phone; ask the Assistant (it is the sparkle button in the app).")
        if (mode() === 'member') throw apiError(409, 'The phone is reached through the hub; ask from the hub.')
        const device = typeof args.device === 'string' ? args.device : undefined
        const op = name === 'phone_screen' ? 'screen' : typeof args.action === 'string' ? args.action : ''
        // Order oae15: an answer with the phone's words in it carries the private mark (first), so the CRM's copy of this chat leaves it out
        // (F-211, conversations.ts), and it is cut short of what Claude Code would move into a side file; a bare "Done." holds nothing.
        return phoneAnswer(await voice.phone.call(device, op, args, by))
      }
      case 'agent_hire': {
        if (!agent.isBoss) throw apiError(403, "Only the floor's boss can hire; ask them.")
        // R1b: a personal Assistant's floor takes no other chats, from a chat either (its owner's rights are the chat's, not the app's).
        refuseAssistantFloorChange(me, floor)
        const model = args.model
        if (model !== undefined && !(AGENT_MODELS as readonly unknown[]).includes(model)) throw apiError(400, 'model is opus, sonnet or haiku')
        // F-049: hired onto an effort, as on a model.
        const effort = args.effort
        if (effort !== undefined && !(AGENT_EFFORTS as readonly unknown[]).includes(effort)) throw apiError(400, 'effort is low, medium, high, xhigh or max')
        const { agent: hired, floor: after } = floors.addAgent(floor.id, {
          name: typeof args.name === 'string' ? args.name : '',
          role: typeof args.role === 'string' ? args.role : '',
          md: typeof args.md === 'string' ? args.md : undefined,
          reportsTo: typeof args.reportsTo === 'string' && args.reportsTo.trim() ? args.reportsTo : agent.id,
          model: model as AgentModel | undefined,
          effort: effort as AgentEffort | undefined,
        }, access.ownerOf(me), agent.sessionId?.slice(0, 8))
        log?.info(`${agent.name} hired ${hired.name} on ${floor.name}`)
        return json({ hired: hired.name, role: hired.role, effort: hired.effort || 'inherit', total: after.agents.length, note: 'No chat is started yet; the human opens it from the floor.' })
      }
      // F-079: Shubham's WhatsApp. Only the overlay assistant, and it only reads and drafts (agent/whatsapp/tools.ts).
      case 'wa_status':
      case 'wa_chats':
      case 'wa_read':
      case 'wa_prepare_send': {
        if (!isOrchestratorAgent(floor.name, agent)) throw apiError(403, "Only the overlay assistant uses Shubham's WhatsApp; ask it (it is the sparkle button in the app).")
        const wa = o.whatsapp?.()
        if (!wa) throw apiError(409, "WhatsApp isn't on in this app: it runs on the hub.")
        return waTool(wa, name, args)
      }
      default:
        throw apiError(404, `No tool called ${name}`)
    }
  }

  /** F-056: the task list changed: every page here, and every member's, is told to ask for it again. */
  function tasksChanged() {
    emit({ t: 'tasks' })
    for (const s of subs.values()) writeLine(s, { t: 'tasks' })
  }

  /** F-056: the list the Tasks tab shows (also what the chats' task_list reads). */
  async function answerTasks(query: URLSearchParams): Promise<TasksAnswer> {
    const s = query.get('status')
    const status: TaskStatus = s === 'open' || s === 'done' ? s : 'all'
    const limit = Number(query.get('limit'))
    return { tasks: await tasks.list({ status, query: query.get('q') ?? undefined, limit: Number.isFinite(limit) && limit > 0 ? limit : undefined }), counts: await tasks.counts() }
  }

  /**
   * F-054: the CRM's address and what this PC found when it asked that site, kept 30 seconds
   * (`fresh` asks again). `origin` is the page's own, to read a frame-ancestors list against.
   */
  async function answerCrm(query: URLSearchParams, fresh = false): Promise<CrmAnswer> {
    const { url, mode } = crm.get()
    // Built into the page, there is no site to look at: the address matters only for the frame.
    if (!url || mode !== 'frame') return { mode, url, check: null }
    let app: string | null = null
    try {
      const u = new URL(query.get('origin') ?? '')
      if (u.protocol === 'https:' || u.protocol === 'http:') app = u.origin
    } catch {
      // No origin, or not one: the list can only be judged without it.
    }
    const now = Date.now()
    if (!fresh && crmChecked && crmChecked.url === url && crmChecked.app === app && now - crmChecked.at < 30_000) return { mode, url, check: crmChecked.check }
    const check = await checkCrm(url, { app })
    crmChecked = { url, app, at: now, check }
    return { mode, url, check }
  }

  function memoryChanged(floorId: string) {
    emit({ t: 'memory', floorId })
    for (const s of subs.values()) writeLine(s, { t: 'memory', floorId })
    // F-051: searched at once (once the layer has started). Asking never makes the layer: one that was never made has nothing to update, and nothing comes back
    // (the registry does the telling: no door holds a layer here). Only the app owner's layer is told (the only one that exists until S9); a floor's notes are
    // the floor's, and no person's layer is made for them here.
    // memory-door: E1
    memoryPeople.notesChanged(SBSKRRT_OWNER.id, floorId)
  }

  // ---------------------------------------------------------------------------------------
  // The page's routes

  /** The floors, live states and the rest as one caller may see them (F-118): their own and the shared ones, or all for sbskrrt. */
  function answerFloors(c: Caller = OPEN, scope?: string | null): FloorsAnswer {
    const want = scope === 'mine' || scope === 'shared' || scope === 'all' ? scope : undefined
    const all = allFloors()
    const seen = access.visible(c, all)
    const mine = <T>(m: Record<string, T>) => (seen ? Object.fromEntries(Object.entries(m).filter(([sid]) => seen.has(sid))) : m)
    return { floors: access.scope(c, all.filter(f => !isPcControl(f)), want), live: mine(chats.states()), elsewhere: mine(elsewhere()), last: mine(lastAll()), team: teamInfo(), defaultCodeDir,
      engineSwitchContinuity: mode() === 'member' ? replica.engineSwitchContinuity : { version: 1, failClosed: true, homePcPreparation: true } }
  }

  /** F-118: replaces who a chat is shared with. People are named by CRM id; their names are the CRM's, from the sign-in directory. */
  function shareChat(floorId: string, agentId: string, body: unknown, caller: Caller) {
    if (!isObject(body) || !Array.isArray(body.users)) throw apiError(400, "Expected {users: [{id, can: 'view' | 'type'}]}")
    if (body.users.length > 64) throw apiError(400, 'At most 64 people')
    const known = new Map((o.auth?.directory() ?? []).map(u => [u.id, u]))
    const list: ChatShare[] = []
    for (const u of body.users) {
      if (!isObject(u) || typeof u.id !== 'string' || !u.id) throw apiError(400, 'Each person is {id, can}')
      if (u.can !== 'view' && u.can !== 'type') throw apiError(400, "can is 'view' or 'type'")
      const who = known.get(u.id.toLowerCase())
      if (!who && o.auth) throw apiError(404, `Nobody with id ${u.id.slice(0, 40)} in the CRM's member list`)
      list.push({ id: u.id.toLowerCase(), username: who?.username ?? '', name: who?.name ?? '', can: u.can })
    }
    // of95c, the share clamp (Agent 3's smallest version; Shubham's "yes", Lead o7e97): a "Can type" share lets that person type with the chat
    // OWNER's powers, so only the owner of the app makes one or raises one to it. Judged against the list as it is NOW, and the list as it will
    // be saved (the last word for each person, the chat's owner left out), since setShare replaces it whole: resubmitting cannot slip a raise in.
    // Anyone else who may share this chat (its non-admin owner) keeps the rest: view shares, lowering, removing, the type shares already there.
    if (!access.isAdmin(caller)) {
      const agent = agentOf(floorOf(floorId), agentId)
      const ownerId = agent.owner?.id.toLowerCase()
      const now = new Map((agent.sharedWith ?? []).map(s => [s.id.toLowerCase(), s.can]))
      const after = new Map(list.filter(x => x.id !== ownerId).map(x => [x.id, x.can]))
      if ([...after].some(([id, can]) => can === 'type' && now.get(id) !== 'type')) {
        throw authError(403, 'Only the owner of this app lets someone type in a chat. You can share it to view.', 'admin-only')
      }
    }
    const floor = floors.setShare(floorId, agentId, list, access.ownerOf(caller))
    log?.info(`chat ${(agentOf(floor, agentId).sessionId ?? '-').slice(0, 8)} is shared with ${list.map(x => `${x.username || x.id.slice(0, 8)} (${x.can})`).join(', ') || 'nobody'}`)
    return { agent: agentOf(floor, agentId) }
  }

  const preparedSwitches = new Map<string, ConversationBinding>()
  const floorMutations = new Map<string, Promise<unknown>>()

  /** Conversions are prepared before the atomic chart commit; never substitute an empty binding. */
  function carryConversation(_floor: Floor, previous: FloorAgent, _to: 'claude' | 'codex' | 'opencode') {
    requireLegacyExecution(previous, defaultsNow())
    const result = preparedSwitches.get(previous.id)
    if (!result) throw Object.assign(apiError(409, 'History was not prepared. The current conversation is unchanged.'), { code: 'engine-change-conversion-failed' })
    return { sessionId: result.sessionId, codexThread: result.codexThread, opencodeSession: result.opencodeSession, homePc: result.homePc, homePcName: result.homePcName }
  }

  function localSwitchSource(previous: FloorAgent): string | null {
    const source = switchSourceState(previous)
    if (source.empty) throw neverHeld(previous)
    return source.file
  }

  /** oc66d: where nothing can be switched without a conversation (a PC Control slot, or a conversion asked for anyway). */
  const neverHeld = (previous: FloorAgent) => Object.assign(apiError(409, `${previous.name}'s chat has never held a conversation, so there is nothing to carry over. The current engine and conversation are unchanged.`), { code: 'engine-change-conversion-failed' })

  /** oc66d: the patch as the page sent it, its expected conversation now without the unused session that was let go just before. */
  function withoutFreshSessions(body: FloorPatch, fresh: ReadonlySet<string>): FloorPatch {
    const e = body.expectedConversation
    if (!e || !fresh.has(e.agentId)) return body
    return { ...body, expectedConversation: { ...e, sessionId: null, ...(e.codexThread !== undefined ? { codexThread: null } : {}), ...(e.opencodeSession !== undefined ? { opencodeSession: null } : {}) } }
  }

  /**
   * The conversation an engine switch carries, on the PC that holds it: its file, or `empty` when the chat never held one.
   * oc66d (14 Nov 2026, Shubham: "Find out why, and this error should not come again"): Marketing (Codex, home the Z800) never started,
   * so no Codex conversation of it existed anywhere, and the switch failed with "source transcript is unavailable on its home PC".
   * - Codex: its rollout by the thread recorded for it; none recorded (the chat ran but its id never reached the floor: the start-up
   *   discovery waits for the hub), by the marker every chat of ours writes into its first lines ([sad-chat <id>]). A thread recorded whose
   *   file is gone, or Codex not set up on this PC: refused, saying which, where it looked, and on which PC.
   * - Claude: its transcript (every PC keeps a copy of a floor chat's, F-021).
   * - `empty` only when the chat is not running here and nothing of it exists (Codex: no thread recorded and no rollout with its marker;
   *   Claude: no transcript): nothing to lose. A running chat whose file is not written yet is refused (fail closed).
   */
  function switchSourceState(previous: FloorAgent): { file: string | null; empty: boolean } {
    requireLegacyExecution(previous, defaultsNow())
    const sid = previous.sessionId!
    const current = bySession(sid)
    if (current && isPcControl(current.floor) && chats.info(sid)) requireRunningEngine(engineFor(previous), chats.info(sid)!.engine)
    const refuse = (words: string) => Object.assign(apiError(409, `${previous.name}: ${words} The current engine and conversation are unchanged.`), { code: 'engine-change-conversion-failed' })
    if (engineFor(previous) === 'opencode') {
      if (!chats.info(sid) && (!openCode.install() || !previous.opencodeSession)) throw Object.assign(apiError(409, 'OpenCode history is unavailable on its home PC. The current conversation is unchanged.'), { code: 'engine-change-conversion-failed' })
      return { file: null, empty: false }
    }
    const running = !!chats.info(sid)
    if (engineFor(previous) === 'codex') {
      if (!o.codex) throw refuse(`Codex is not set up on ${self().name}, so its conversation cannot be read here.`)
      const home = o.codex.paths.home
      if (previous.codexThread) {
        const file = findRollout(home, previous.codexThread)
        if (!file) throw refuse(`its Codex conversation ${previous.codexThread} is not in ${path.join(home, 'sessions')} on ${self().name}.`)
        return { file, empty: false }
      }
      const found = discoverThread(home, sid, 0)
      if (found) {
        log?.info(`engine switch: ${previous.name}'s Codex conversation was never recorded on its floor; found by its chat marker (${found.thread.slice(0, 8)})`)
        return { file: found.file, empty: false }
      }
      if (running) throw refuse(`its Codex chat is running on ${self().name} but has not written its conversation yet. Try again in a moment.`)
      return { file: null, empty: true }
    }
    const file = findClaudeTranscript(sid, projectsDir)
    if (file) return { file, empty: false }
    if (running) throw refuse(`its Claude chat is running on ${self().name} but has not written its conversation yet. Try again in a moment.`)
    // A Claude chat that ran somewhere (the hub saw where it ran last) and has no transcript here: refused, as before (fail closed).
    if (lastAll()[sid]) throw refuse(`its conversation is not on ${self().name} (looked for ${sid}.jsonl under ${projectsDir}).`)
    return { file: null, empty: true }
  }

  function switchSourcePc(previous: FloorAgent) {
    const managed = allFloors().find(f => isPcControl(f) && f.agents.some(a => a.id === previous.id))
    if (isPcControl(managed)) {
      assertPcControlTarget(managed, managed.targetPcId, {})
      return { id: managed.targetPcId, name: managed.name }
    }
    const active = whereAll()[previous.sessionId!]
    if (active) return active
    const last = lastAll()[previous.sessionId!]?.pc
    if (last) {
      const known = pcs().filter(p => p.name === last)
      if (known.length === 1) return known[0]
      if (known.length > 1) throw Object.assign(apiError(409, 'More than one PC has the last source PC name. Resume the original conversation on its PC before switching.'), { code: 'engine-change-conversion-failed' })
      if (previous.homePc && previous.homePcName === last) return { id: previous.homePc, name: last }
      throw Object.assign(apiError(424, `The newest history is on ${last}, which is offline. The current conversation is unchanged.`), { code: 'engine-change-home-offline' })
    }
    return previous.homePc ? { id: previous.homePc, name: previous.homePcName ?? previous.homePc } : self()
  }

  async function prepareLocalSwitch(floor: Floor, previous: FloorAgent, next: FloorAgent, switchId: string) {
    assertPcControlTarget(floor, self().id, {})
    requireLegacyExecution(previous, defaultsNow())
    requireLegacyExecution(next, defaultsNow())
    if (isPcControl(floor) && previous.sessionId && chats.info(previous.sessionId)) requireRunningEngine(engineFor(previous), chats.info(previous.sessionId)!.engine)
    const file = localSwitchSource(previous)
    const sid = previous.sessionId!, from = engineFor(previous), to = engineFor(next)
    conversionProgress.begin(floor.id, previous.id, switchId)
    conversionProgress.update(floor.id, previous.id, 'stopping')
    switchFences.begin(sid, switchId)
    if (from !== 'opencode' && chats.info(sid)) {
      chats.kill(sid, 'engine-change')
      await chats.waitStopped?.(sid)
      if (file) await settled(file)
    }
    if (file) switchFences.snapshot(sid, switchId, file)
    if (to === 'opencode') {
      const { provider, model } = openCodeSelection(next, defaultsNow())
      if (!openCode.install() || (provider !== 'opencode' && !o.openCodeCredential)) throw apiError(503, 'OpenCode is not configured on this PC.')
      if (provider === 'opencode') freeModel(model)
      else await o.openCodeCredential!(provider)
      if (openCode.status().live >= 2) throw apiError(503, 'OpenCode is at this PC’s two-backend limit.')
    }
    let cwd = chats.info(sid)?.cwd || (file && conversationCwd(file)) || codeDirOf(floor)
    let result: PreparedConversation
    if (from !== 'opencode' && to !== 'opencode') {
      if (!file) throw apiError(409, 'Source transcript is unavailable')
      cwd = chats.info(sid)?.cwd || conversationCwd(file) || cwd
      const converted = await switchConversationComplete({ to, file, cwd, codexHome: o.codex?.paths.home, projectsDir,
        onProgress: (stage, transfer) => conversionProgress.update(floor.id, previous.id, stage, transfer) })
      result = { sessionId: to === 'claude' ? converted.id : randomUUID(), codexThread: to === 'codex' ? converted.id : null, opencodeSession: null, file: converted.file }
    } else {
      let source: unknown
      let sourceEngine = from
      if (from === 'opencode') {
        if (chats.info(sid)) { await openCode.abort(sid); chats.kill(sid, 'engine-change'); await openCode.waitStopped(sid) }
        source = JSON.parse(await interchange(openCode.install()!, openCode.rootOf(sid), cwd, ['export', previous.opencodeSession!]))
        const mirror = openCode.file(sid)
        if (!mirror) throw apiError(409, 'The stopped OpenCode source has no verified history mirror')
        switchFences.snapshot(sid, switchId, mirror)
        if (isObject(source) && isObject(source.info) && typeof source.info.directory === 'string' && path.isAbsolute(source.info.directory)) cwd = source.info.directory
      } else {
        if (!file) throw apiError(409, 'Source transcript is unavailable')
        cwd = chats.info(sid)?.cwd || conversationCwd(file) || cwd
        // Normalize only bounded current context, never read a whole large JSONL into the heap.
        const timestamp = new Date().toISOString()
        source = from === 'claude'
          ? convertClaude(claudeFileContext(file).lines, { id: randomUUID(), cwd, timestamp }).lines
          : toClaude(conversationLines(file), { sessionId: sid, cwd, timestamp })
        sourceEngine = from === 'claude' ? 'codex' : 'claude'
      }
      result = await prepareConversation({ from: sourceEngine, to, source, cwd, projectsDir, codexHome: o.codex?.paths.home, openCodeRoot: openCode.rootOf, install: openCode.install() })
    }

    return { ...result, homePc: self().id, homePcName: self().name }
  }

  /** Only the authenticated hub can ask a member to prepare its own current native history. No floor mutation here. */
  async function prepareSwitchPeer(raw: unknown) {
    if (!isObject(raw) || typeof raw.floorId !== 'string' || typeof raw.agentId !== 'string' || !isObject(raw.expected) || !isObject(raw.next) ||
      !['claude', 'codex', 'opencode'].includes(String(raw.next.engine))) throw apiError(400, 'Expected an engine-switch preparation')
    const floor = floorOf(raw.floorId), previous = agentOf(floor, raw.agentId), expected = raw.expected
    requireLegacyExecution(previous, defaultsNow())
    const nextRaw = raw.next
    if (['executionProfile', 'executionRevision', 'execution', 'provider', 'harness', 'transcript'].some(k => Object.hasOwn(nextRaw, k))) throw executionHttpError('execution-capability-required', 'selection')
    const matches = () => {
      const current = agentOf(floorOf(floor.id), previous.id)
      return current.sessionId === expected.sessionId && engineFor(current) === expected.engine &&
        (current.codexThread ?? null) === (expected.codexThread ?? null) && (current.opencodeSession ?? null) === (expected.opencodeSession ?? null)
    }
    if (!matches()) throw Object.assign(apiError(409, 'The source conversation changed on its home PC. Refresh and confirm again.'), { code: 'engine-change-stale' })
    if (!previous.sessionId || (!chats.info(previous.sessionId) && previous.homePc && previous.homePc !== self().id && lastAll()[previous.sessionId]?.pc !== self().name)) throw apiError(409, 'This PC does not hold the source conversation')
    // oc66d: the check says when the chat never held a conversation here (`empty`): the hub then switches it with nothing to carry.
    const source = switchSourceState(previous)
    if (raw.checkOnly === true) return { ready: true, ...(source.empty ? { empty: true } : {}) }
    const next = { ...previous, engine: raw.next.engine, opencodeProvider: raw.next.opencodeProvider, opencodeModel: raw.next.opencodeModel } as FloorAgent
    if (typeof raw.switchId !== 'string') throw apiError(400, 'Expected an engine-switch operation id')
    const binding = await prepareLocalSwitch(floor, previous, next, raw.switchId)
    if (!matches()) throw Object.assign(apiError(409, 'The source conversation changed during conversion. Refresh and confirm again.'), { code: 'engine-change-stale' })
    return { binding, sourceSessionId: previous.sessionId, to: engineFor(next) }
  }

  async function finishSwitchPeer(raw: unknown) {
    if (!isObject(raw) || typeof raw.sessionId !== 'string' || typeof raw.switchId !== 'string') throw apiError(400, 'Expected a source session and operation id')
    if (raw.action === 'seal') switchFences.seal(raw.sessionId, raw.switchId)
    else if (raw.action === 'retire') switchFences.retire(raw.sessionId, raw.switchId)
    else if (raw.action === 'cancel') { if (!chats.info(raw.sessionId)) await chats.waitStopped?.(raw.sessionId); switchFences.cancel(raw.sessionId, raw.switchId) }
    else throw apiError(400, 'Expected seal, retire or cancel')
    return { ok: true }
  }

  let reconcilingSwitches = false
  async function reconcileSwitchFences() {
    if (reconcilingSwitches || closing) return
    reconcilingSwitches = true
    try {
      for (const fence of switchFences.pending()) {
        if (activeSwitches.has(fence.token)) continue
        let action: string
        if (mode() === 'member') {
          const link = team?.hub()?.link
          if (!link || !sub) continue
          try { action = (await request<{ state: string }>(link, 'engine-switch-status', { sessionId: fence.sessionId, switchId: fence.token })).state }
          catch { continue /* Keep a durable fence until the authoritative hub can answer. */ }
        } else action = bySession(fence.sessionId) ? 'cancel' : 'retire'
        if (action === 'cancel') { if (!chats.info(fence.sessionId)) await chats.waitStopped?.(fence.sessionId); switchFences.cancel(fence.sessionId, fence.token) }
        else if (action === 'retire') { switchFences.retire(fence.sessionId, fence.token); chats.kill(fence.sessionId, 'engine-switch-retired') }
      }
    } finally { reconcilingSwitches = false }
  }
  setImmediate(() => { void reconcileSwitchFences().catch(error => log?.warn('Engine-switch recovery remains fenced: ' + message(error))) })

  /**
   * R1b (order o3b2f; Agent 3's design, adopted by Lead 17 Nov as a hard prerequisite before staff Assistants are activated): the agent LIST of a
   * floor currently holding a person's own Assistant ("My Assistant", duty 'person-assistant', set ONLY by own-assistant.ts's
   * setPersonAssistantDuty; floors.ts:613 copies duty forward from `before` on every chart, so a chart can neither set nor clear it) changes for
   * nobody but the owner of this app. Its maker keeps floor('manage') there whatever Settings › Access says (the `share` rules, shared/access.ts),
   * and a chat added there would be an ordinary chat of theirs: with C0 and of95c's "A" live, one typed into with the Server's own tools is a
   * shell on the Server as its Windows user.
   * Keyed on the duty (the Server's own, never the subject's to clear) and read from the floor's state BEFORE the change: a drop of the Assistant
   * itself is an agent-LIST change, caught by the very read that would otherwise let a later add through. The condition can never be falsified by
   * the request trying to act on it.
   * Every way the list changes, each call site below: POST /floors/:id/agents (an add), a chart (PATCH /floors/:id) that adds or drops an agent,
   * a move onto or off the floor (moveAgent, when the target floor differs: a same-floor reorder changes neither floor's agent set), and
   * agent_hire (a chat's own tool, "me" is the hiring chat's caller). A floor that cannot be read is refused before this (floorOf throws 404).
   */
  function refuseAssistantFloorChange(c: Caller, floor: Floor) {
    if (!access.isAdmin(c) && floor.agents.some(a => isPersonAssistant(a))) {
      throw authError(403, "Only the owner of this app changes who is on a personal Assistant's floor.", 'admin-only')
    }
  }
  /**
   * Whether a chart's `agents` would change WHICH agents are on the floor (never mind a field edited on one that stays): a rename or a model
   * change, with every current id present once and nothing else, is not a change. Anything this cannot tell for certain — not a list, a missing
   * or non-string id, a repeated id — counts as a change (refused on an Assistant floor), never as "the same": an ambiguous chart must not be the
   * way around the guard above it.
   */
  function agentListChanges(before: readonly FloorAgent[], rawAgents: unknown): boolean {
    if (!Array.isArray(rawAgents)) return true
    const ids = rawAgents.map(a => (isObject(a) && typeof a.id === 'string' && a.id ? a.id : null))
    if (ids.some(id => id === null)) return true
    const next = new Set(ids as string[])
    if (next.size !== ids.length) return true
    const have = new Set(before.map(a => a.id))
    return next.size !== have.size || [...have].some(id => !next.has(id))
  }

  function patchFloor(id: string, body: unknown, as?: ChatOwner) {
    const pending = (floorMutations.get(id) ?? Promise.resolve()).catch(() => {}).then(() => patchFloorPrepared(id, body, as))
    floorMutations.set(id, pending)
    void pending.finally(() => { if (floorMutations.get(id) === pending) floorMutations.delete(id) }).catch(() => {})
    return pending
  }

  async function patchFloorPrepared(id: string, body: unknown, as?: ChatOwner) {
    if (!isObject(body)) throw apiError(400, 'Expected {name?, globalPrompt?, codeDir?, agents?}')
    const before = floorOf(id)
    if (typeof body.codeDir === 'string' && body.codeDir.trim()) checkFolder(body.codeDir)
    const preview = floors.validatePatch(id, body as FloorPatch, as)
    const fingerprint = JSON.stringify(before), defaultEngine = defaultsNow().engine
    const switchId = randomUUID(), peers = new Map<string, LinkPeer>()
    const changes = before.agents.flatMap(previous => {
      const next = preview.agents.find(a => a.id === previous.id)
      return next && previous.sessionId && engineFor(previous) !== engineFor(next) ? [{ previous, next }] : []
    })
    const peerBody = (previous: FloorAgent, next: FloorAgent) => ({ floorId: id, agentId: previous.id, switchId,
      expected: { sessionId: previous.sessionId, engine: engineFor(previous), codexThread: previous.codexThread ?? null, opencodeSession: previous.opencodeSession ?? null },
      next: { engine: engineFor(next), opencodeProvider: next.opencodeProvider, opencodeModel: next.opencodeModel } })
    const finishPeer = (previous: FloorAgent, action: string) => {
      const peer = peers.get(previous.id)
      return peer ? request(peer, 'engine-switch-finish', { sessionId: previous.sessionId, switchId, action }, 10_000) : Promise.resolve()
    }
    let committed: Floor | undefined
    activeSwitches.add(switchId)
    for (const {previous} of changes) conversionProgress.begin(id, previous.id, switchId)
    try {
      // Hub lease/open/input barrier begins before any async preparation. The source host also fences itself.
      for (const { previous } of changes) switchFences.begin(previous.sessionId!, switchId)
      // oc66d: a chat that never held a conversation (checked on the PC where it would be) has nothing to carry: no conversion and no seal;
      // at the commit its unused session is let go (kept in its history list), so the engine changes as for an agent with no chat. A PC
      // Control slot keeps its pinned conversation rule (refused as before).
      const fresh = new Set<string>()
      for (const { previous, next } of changes) {
        const location = switchSourcePc(previous)
        if (location.id !== self().id) {
          const peer = team?.member(location.id)
          if (!peer) throw Object.assign(apiError(424, `${previous.name}'s newest history is on ${location.name}, which is offline. The current conversation is unchanged.`), { code: 'engine-change-home-offline' })
          peers.set(previous.id, peer)
          const check = await request<unknown>(peer, 'engine-switch-prepare', { ...peerBody(previous, next), checkOnly: true }, 120_000)
          if (isObject(check) && check.empty === true) {
            if (isPcControl(before)) throw neverHeld(previous)
            peers.delete(previous.id)
            fresh.add(previous.id)
          }
        } else if (switchSourceState(previous).empty) {
          if (isPcControl(before)) throw neverHeld(previous)
          fresh.add(previous.id)
        }
      }
      for (const { previous, next } of changes) {
        if (fresh.has(previous.id)) continue
        const peer = peers.get(previous.id)
        let raw: unknown
        if (peer) {
          conversionProgress.update(id, previous.id, 'converting')
          const reply = await request<{ binding: unknown; sourceSessionId: string; to: string }>(peer, 'engine-switch-prepare', peerBody(previous, next), 120_000)
          if (reply.sourceSessionId !== previous.sessionId || reply.to !== engineFor(next)) throw new Error('Home PC returned a mismatched source or target')
          raw = reply.binding
        } else raw = await prepareLocalSwitch(before, previous, next, switchId)
        preparedSwitches.set(previous.id, validatePreparedConversation(raw, engineFor(next), previous, peer?.id ?? self().id, allFloors().flatMap(f => f.agents), [...preparedSwitches.values()]))
      }
      // Seal remote source hashes while every old session remains fenced, then check local sources synchronously.
      for (const { previous } of changes) if (peers.has(previous.id)) await finishPeer(previous, 'seal')
      for (const { previous } of changes) if (!peers.has(previous.id) && !fresh.has(previous.id)) switchFences.seal(previous.sessionId!, switchId)
      if (JSON.stringify(floorOf(id)) !== fingerprint || defaultsNow().engine !== defaultEngine) throw Object.assign(apiError(409, 'This floor changed while the conversation was prepared. Refresh and confirm again.'), { code: 'engine-change-stale' })
      for (const {previous} of changes) conversionProgress.update(id, previous.id, 'saving')
      for (const { previous } of changes) {
        if (!fresh.has(previous.id)) continue
        floors.bindSession(id, previous.id, null)
        log?.info(`engine switch: ${previous.name}'s chat never held a conversation; its unused session ${previous.sessionId!.slice(0, 8)} is let go and the engine changes with nothing to carry`)
      }
      committed = floors.patch(id, withoutFreshSessions(body as FloorPatch, fresh), as)
      // Never release an old session after success, even while the member still has a debounced old replica.
      for (const { previous } of changes) {
        try { switchFences.retire(previous.sessionId!, switchId) } catch (error) { log?.warn('Could not persist retirement; durable preparation fence remains: ' + message(error)) }
        await finishPeer(previous, 'retire').catch(error => log?.warn('Home PC retirement awaits reconnect; source remains fenced: ' + message(error)))
      }
      const kept = new Set(committed.agents.map(a => a.id))
      for (const old of before.agents) {
        const after = committed.agents.find(a => a.id === old.id)
        if (old.sessionId && (!kept.has(old.id) || after?.sessionId !== old.sessionId || (engineFor(old) === 'opencode' && (old.opencodeProvider !== after?.opencodeProvider || old.opencodeModel !== after?.opencodeModel)))) stopAnywhere(old.sessionId)
      }
      for (const {previous} of changes) conversionProgress.update(id, previous.id, 'complete')
      return { floor: committed }
    } catch (error) {
      for (const {previous} of changes) conversionProgress.update(id, previous.id, committed ? 'complete' : 'failed')
      if (committed) { log?.warn('Conversation switch committed; cleanup will be retried: ' + message(error)); return { floor: committed } }
      if (isObject(error) && ['engine-change-stale', 'engine-change-home-offline', 'engine-change-in-progress', 'engine-runtime-mismatch', 'pc-control-wrong-device', 'pc-control-update-required'].includes(String(error.code))) throw error
      log?.warn('Engine switch blocked: ' + message(error))
      throw Object.assign(apiError(409, 'History could not be carried over: ' + message(error) + '. The current engine and conversation are unchanged; resume it or retry after fixing the source.'), { code: 'engine-change-conversion-failed' })
    } finally {
      if (!committed) for (const { previous } of changes) {
        try { switchFences.cancel(previous.sessionId!, switchId) } catch (error) { log?.warn('Original conversation unlock awaits recovery: ' + message(error)) }
        await finishPeer(previous, 'cancel').catch(error => log?.warn('Home PC unlock awaits reconnect: ' + message(error)))
      }
      for (const { previous } of changes) preparedSwitches.delete(previous.id)
      activeSwitches.delete(switchId)
    }
  }

  // ---------------------------------------------------------------------------------------
  // F-069: the files sent to a chat. The page sends one to the PC it is on; that PC passes it to the PC the
  // chat runs on (or, if it is not running, lives on) a megabyte at a time through the hub, where claude is
  // told to read it by its path. One already sent is fetched the same way for its thumbnail.

  /** The PC a file for this agent's chat goes to: where it runs, else where it lives (its home), else this one. */
  function attachTarget(agent: FloorAgent): { id: string; name: string } {
    const w = agent.sessionId ? whereAll()[agent.sessionId] : undefined
    if (w) return { id: w.id, name: w.name }
    if (agent.homePc && agent.homePc !== self().id) {
      const home = pcs().find(p => p.id === agent.homePc)
      if (!home) throw apiError(HOME_OFFLINE_STATUS, `${agent.homePcName ?? 'Its PC'} is offline, and ${agent.name}'s chat lives there, so a file can't be sent to it now`)
      return { id: home.id, name: home.name }
    }
    return { id: self().id, name: self().name }
  }

  /** Where the pieces of a file for `to` are sent from this PC: straight to it, or (a member) through the hub. */
  function attachLink(to: string): LinkPeer {
    return mode() === 'member' ? needHub() : peerOf(to)
  }

  async function deliverFile(to: { id: string; name: string }, file: string, bytes: Buffer): Promise<string> {
    const n = Math.max(1, Math.ceil(bytes.length / PIECE_BYTES))
    if (to.id === self().id) {
      for (let i = 0; i < n; i++) uploads.put(file, i, n, bytes.subarray(i * PIECE_BYTES, (i + 1) * PIECE_BYTES))
      return uploads.pathOf(file)
    }
    const link = attachLink(to.id)
    let where = ''
    for (let i = 0; i < n; i++) {
      const data = bytes.subarray(i * PIECE_BYTES, (i + 1) * PIECE_BYTES).toString('base64')
      const r = await request<{ done: boolean; path?: string }>(link, 'attach-put', { to: to.id, file, i, n, data }, 60_000).catch((e: unknown) => {
        throw apiError(503, `${to.name} can't take the file now: ${message(e)}`)
      })
      if (r.path) where = r.path
    }
    return where
  }

  /** A piece of a file arriving over the link: kept here, or (the hub, for another PC) passed on. */
  async function attachPutPeer(raw: unknown): Promise<{ done: boolean; path?: string }> {
    if (!isObject(raw) || typeof raw.file !== 'string' || typeof raw.data !== 'string' || typeof raw.i !== 'number' || typeof raw.n !== 'number') throw apiError(400, 'Expected {file, i, n, data}')
    if (typeof raw.to === 'string' && raw.to !== self().id) {
      if (mode() !== 'hub') throw apiError(403, 'Only the hub passes files on')
      return request(peerOf(raw.to), 'attach-put', raw, 60_000)
    }
    if (!isStoredName(raw.file)) throw apiError(400, 'That is not a name this PC keeps files under')
    const done = uploads.put(raw.file, raw.i, raw.n, Buffer.from(raw.data, 'base64'))
    return done ? { done, path: uploads.pathOf(raw.file) } : { done }
  }

  async function attachGetPeer(raw: unknown): Promise<{ data: string; size: number }> {
    if (!isObject(raw) || typeof raw.file !== 'string' || typeof raw.offset !== 'number') throw apiError(400, 'Expected {file, offset}')
    if (typeof raw.to === 'string' && raw.to !== self().id) {
      if (mode() !== 'hub') throw apiError(403, 'Only the hub passes files on')
      return request(peerOf(raw.to), 'attach-get', raw, 60_000)
    }
    const size = uploads.size(raw.file)
    if (size === null) throw apiError(404, "That file isn't here")
    return { data: uploads.read(raw.file, raw.offset, PIECE_BYTES).toString('base64'), size }
  }

  async function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > max) throw apiError(413, `A file may be ${Math.round(max / 1024 / 1024)} MB at most`)
      chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks)
  }

  const reply = (res: ServerResponse, status: number, data: unknown) => {
    const body = JSON.stringify(data)
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) })
    res.end(body)
  }

  /**
   * Order o7e6d (Lead, 15 Nov: chat-only scope): a staff Assistant takes no file and serves none. The raw file routes skip the route runner: an
   * upload writes a file and answers its path on the PC (a line that could then reach the CLI), a download looks files up here or on another PC.
   * So for a staff Assistant (isStaffAssistant), a chat of it running under a policy, or a fenced run of it, both are refused before any body is
   * read, any file written or looked up, or anything passed to another PC, whoever asks, the owner too. Every other chat exactly as before.
   */
  function refuseStaffFiles(agent: FloorAgent) {
    const sid = agent.sessionId
    const run = sid ? chats.info(sid) : null
    if (isStaffAssistant(agent) || run?.policy !== undefined) throw staffError("A person's own Assistant takes plain messages only: no file is sent to it or served from it.")
    // S1, B3: the chat bound to it now is a fenced run (its lineage, an earlier finding, an untrusted record): no file either.
    if (sid && runFenced(sid)) throw staffError('This chat has known unsafe staff/policy provenance: no file is sent to it or served from it. Stop it, then open it again.')
  }

  /** POST …/agents/:id/attach?name=photo.jpg, the file as the body: kept on the chat's PC; answers where. */
  async function attachUpload(req: IncomingMessage, res: ServerResponse, floorId: string, agentId: string, url: URL) {
    if (req.method !== 'POST') throw apiError(405, 'POST the file')
    const agent = agentOf(floorOf(floorId), agentId)
    const bytes = await readBody(req, ATTACH_MAX_BYTES)
    if (!bytes.length) throw apiError(400, 'That file is empty')
    const name = safeName(url.searchParams.get('name') ?? 'file')
    const to = attachTarget(agent)
    const file = storedName(name)
    const where = await deliverFile(to, file, bytes)
    log?.info(`a file for ${agent.name}'s chat (${bytes.length} bytes) kept on ${to.name}`)
    reply(res, 200, { file, path: where, name, size: bytes.length, pc: to.name })
  }

  /** GET …/agents/:id/attachment/:file: a file sent to that chat: from this PC, else from the PC the chat is on. */
  async function attachDownload(req: IncomingMessage, res: ServerResponse, floorId: string, agentId: string, file: string) {
    if (req.method !== 'GET') throw apiError(405, 'GET the file')
    if (!isStoredName(file)) throw apiError(400, 'That is not a name this PC keeps files under')
    const agent = agentOf(floorOf(floorId), agentId)
    const { type, inline } = contentTypeOf(file)
    const headers = {
      'Content-Type': type,
      'Cache-Control': 'private, max-age=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${file.replace(/^[^-]+-[^-]+-/, '').replace(/"/g, '')}"`,
    }
    const size = uploads.size(file)
    if (size !== null) {
      res.writeHead(200, { ...headers, 'Content-Length': size })
      createReadStream(uploads.pathOf(file)).pipe(res)
      return
    }
    // Not here: the PC the chat runs on, or lives on, may have it.
    const w = agent.sessionId ? whereAll()[agent.sessionId] : undefined
    const holders = [w?.id, agent.homePc].filter((id, i, all): id is string => !!id && id !== self().id && all.indexOf(id) === i)
    for (const id of holders) {
      let link: LinkPeer
      try {
        link = attachLink(id)
      } catch {
        continue
      }
      try {
        const parts: Buffer[] = []
        let total = 0
        for (;;) {
          const r = await request<{ data: string; size: number }>(link, 'attach-get', { to: id, file, offset: total }, 60_000)
          const buf = Buffer.from(r.data, 'base64')
          parts.push(buf)
          total += buf.length
          if (!buf.length || total >= r.size) break
        }
        res.writeHead(200, { ...headers, 'Content-Length': total })
        res.end(Buffer.concat(parts))
        return
      } catch {
        // That PC hasn't got it (or can't be reached): the next.
      }
    }
    throw apiError(404, "That file isn't on this PC or the one the chat is on")
  }

  // ---------------------------------------------------------------------------------------
  // F-076: approvals and send-as-me. Human-only: these routes take the page's own request; a request that carries
  // a chat's key (what an agent's tools use) is refused here, and no MCP tool answers a prompt or sends as the person.

  function humanOnly(r: MountRequest) { r.caller = requireCrmHuman(o.auth, r) }
  const byOf = (r: MountRequest) => `the app (${String(r.headers['user-agent'] ?? 'a browser').replace(/\s+/g, ' ').slice(0, 90)})`
  const promptActions = createPromptActions()
  const promptEpoch = randomUUID()
  const approvalLinks = new WeakMap<object, string>()
  const approvalRuntime = (sid: string, pc: string) => {
    if (pc === self().id) return chats.info(sid)?.startedAt
    const token = team?.member(pc)?.token
    if (!token) return undefined
    if (!approvalLinks.has(token)) approvalLinks.set(token, randomUUID())
    return approvalLinks.get(token)
  }
  const nativePromptActions = createPromptActions()
  const approvalGrants = new Map<string, { proof: NativeApprovalProof; hubToken: object | null }>()
  function approvalGeneration(sid: string): string {
    const info = chats.info(sid)
    if (!info) throw apiError(409, 'That native chat is no longer running.')
    const pool = chats as ChatPool & { generation?: (sid: string) => string | null }
    if (pool.generation) {
      const value = pool.generation(sid)
      if (!value) throw apiError(409, 'Native generation is unavailable; update this PC.')
      return `pool:${value}`
    }
    // Older pool API: onEnded deletes this record even for same-SID/same-timestamp restarts.
    const fingerprint = JSON.stringify([info.startedAt, info.engine, info.floorId, info.agentId])
    const previous = approvalNativeRuntimes.get(sid)
    if (previous?.fingerprint !== fingerprint) approvalNativeRuntimes.set(sid, { fingerprint, generation: randomUUID() })
    return approvalNativeRuntimes.get(sid)!.generation
  }
  function requireApprovalHub(token: object | null, expectedId = team?.hub()?.id) {
    if (!token || mode() !== 'member' || team?.hub()?.id !== expectedId || team?.hub()?.link?.token !== token) throw apiError(409, 'The current pinned Server connection is required for approval.')
  }
  function sweepApprovalGrants() {
    for (const [id, grant] of approvalGrants) if (grant.proof.expiresAt < Date.now()) approvalGrants.delete(id)
  }
  function localApprovalSnapshot(sid: string, hubToken: object | null): NativeApprovalSnapshot {
    assertLegacySid(sid)
    if (hubToken) requireApprovalHub(hubToken)
    const info = chats.info(sid), at = floors.bySession(sid), screen = chats.screen(sid)
    if (!info || !at || !screen || info.floorId !== at.floor.id || info.agentId !== at.agent.id || (at.agent.homePc && at.agent.homePc !== self().id) || (isPcControl(at.floor) && at.floor.targetPcId !== self().id)) throw apiError(409, 'The native approval target changed.')
    sweepApprovalGrants()
    if (approvalGrants.size >= 4096) throw apiError(429, 'Too many approval snapshots; wait one minute and refresh.')
    const p = promptOf(screen.join('\n'), menuOpts())
    if (hubToken && !approvalLinks.has(hubToken)) approvalLinks.set(hubToken, randomUUID())
    const proof: NativeApprovalProof = { version: 1, grantId: randomUUID(), pcId: self().id, sessionId: sid, floorId: at.floor.id, agentId: at.agent.id,
      generation: approvalGeneration(sid), targetEpoch: promptEpoch, hubEpoch: hubToken ? approvalLinks.get(hubToken)! : null, hubId: hubToken ? team!.hub()!.id : null, promptId: p.id, expiresAt: Date.now() + APPROVAL_GRANT_MS }
    approvalGrants.set(proof.grantId, { proof, hubToken })
    return { proof, menu: p.menu, context: p.context, cancellable: p.cancellable }
  }
  async function commitNativeApproval(raw: unknown, hubToken: object | null, validateLocal?: (agent: FloorAgent) => void): Promise<{ version: 1; committed: true }> {
    if (!isNativeApprovalCommit(raw)) throw apiError(400, 'Expected a versioned, target-bound approval commit.')
    if (hubToken) requireApprovalHub(hubToken, raw.proof.hubId ?? undefined)
    else if (!validateLocal) throw authError(401, 'A current CRM session is required.', 'sign-in')
    const proof = raw.proof, grant = approvalGrants.get(proof.grantId)
    if (!grant || grant.hubToken !== hubToken || JSON.stringify(grant.proof) !== JSON.stringify(proof)) throw apiError(409, 'The native approval grant is not current.')
    return nativePromptActions.run(JSON.stringify([proof.sessionId, proof.generation, proof.promptId]), JSON.stringify([raw.action, raw.n ?? null]), async markNativeAttempt => {
      if (hubToken) requireApprovalHub(hubToken, proof.hubId ?? undefined)
      const at = floors.bySession(proof.sessionId), info = chats.info(proof.sessionId), screen = chats.screen(proof.sessionId)
      assertLegacySid(proof.sessionId)
      if (proof.expiresAt < Date.now() || proof.targetEpoch !== promptEpoch || proof.pcId !== self().id || !at || !info || !screen ||
          at.floor.id !== proof.floorId || at.agent.id !== proof.agentId || info.floorId !== proof.floorId || info.agentId !== proof.agentId || (at.agent.homePc && at.agent.homePc !== self().id) || (isPcControl(at.floor) && at.floor.targetPcId !== self().id) ||
          info.state !== 'question' || approvalGeneration(proof.sessionId) !== proof.generation) throw apiError(409, 'The native approval target or grant changed before input.')
      const p = promptOf(screen.join('\n'), menuOpts())
      if (p.id !== proof.promptId || (raw.action === 'cancel' ? !p.cancellable : !answerable(p.menu) || !p.menu!.options.some(x => x.n === raw.n))) throw apiError(409, 'The native prompt changed before input.')
      // Order o5d4e: an unnumbered select takes no digit. The pointer is moved with the arrow keys, the screen is read again, and Enter is pressed
      // only when the pointer is SEEN on the chosen option (arrow-select.ts). That takes a few looks, so the last word (the person's rights now, the
      // grant, the same run, still a question) is asked again right before Enter, in the same turn, and the once-only claim is made there and only there.
      if (raw.action === 'answer' && p.menu?.keys === 'arrows') {
        await chooseByArrows(
          { screen: () => chats.screen(proof.sessionId), typed: () => chats.typedScreen?.(proof.sessionId) ?? null, press: data => chats.input(proof.sessionId, data) },
          { promptId: proof.promptId, n: raw.n! },
          {
            beforeEnter: () => {
              const now = floors.bySession(proof.sessionId), live = chats.info(proof.sessionId)
              if (proof.expiresAt < Date.now() || !now || !live || now.agent.id !== proof.agentId || now.floor.id !== proof.floorId || live.state !== 'question' || approvalGeneration(proof.sessionId) !== proof.generation) throw apiError(409, 'The native approval target or grant changed before input.')
              validateLocal?.(now.agent)
              markNativeAttempt()
            },
          },
        )
        return { version: 1, committed: true }
      }
      // No await between the final target/human check and the receiving native write.
      validateLocal?.(at.agent)
      markNativeAttempt()
      // The key is the app's, for an answer given in the Approvals tab: the presence record names the Approvals route (approvals.jsonl says who gave the answer).
      if (!chats.input(proof.sessionId, raw.action === 'cancel' ? ESC_KEY : String(raw.n), { kind: 'approvals' })) throw apiError(409, 'Native approval was not confirmed; do not retry automatically.')
      return { version: 1, committed: true }
    })
  }
  function humanProof(kind: SignedKind, _fields: (string | number | boolean)[], _legacySignature: unknown, r?: ProofRequest): string {
    // F158: never inspect old device keys, settings, signatures or unsigned flags.
    const caller = requireCrmHuman(o.auth, r, ['autoupdate', 'pair', 'wa-send'].includes(kind))
    // A second owner may not pair a phone or switch the app's updates: the phone is tied to Shubham's own paired phone, and Update is his (his orders o4e4e, o2f32).
    if (kind === 'pair' || kind === 'autoupdate') firstOwnerOnly(caller, `proof ${kind}`, "Pairing the phone and the app's updates are for the first owner of this app only.")
    return describeHuman(caller)
  }
  function humanTarget(r: ProofRequest | undefined, agent: FloorAgent, need: 'type' | 'owner' = 'type', decisions = false) {
    const caller = requireCrmHuman(o.auth, r)
    if (r) r.caller = caller
    // o7e6d (refinement2 line 56): approvals and Send as me are the owner's. A non-admin (a staff Assistant or any other person) is refused here,
    // before any native write; every approval and cancel recheck after an await calls this again (the typeKeys callbacks).
    // Orders o66aa / oa76b / o7e97 ("1A"): except a prompt (an answer or a cancel only: `decisions`; Send as me never passes it) of a chat whose
    // floor's decisions go to this person NOW. decides() reads the chat's floor from the hub at this very call (floors.bySession) and the route
    // in force now, so a share taken away, a floor given back to him or a chat moved off the floor refuses even an answer already on its way,
    // at the last check before the key is written. Their right is the floor's, not a share of the chat (his "1A": unshared chats too).
    if (!access.isAdmin(caller)) {
      const at = decisions && agent.sessionId ? floors.bySession(agent.sessionId) : null
      if (!at || at.agent.id !== agent.id || !decides(caller, at)) throw authError(403, decisions ? decisionRefusedWords(caller, at) : 'This is for the owner of this app.', 'admin-only')
    } else access.needChat(caller, agent, need, 'human approval/send')
    const at = agent.sessionId ? whereAll()[agent.sessionId] : null
    if (mode() === 'member' && (at?.id ?? agent.homePc) !== self().id) throw Object.assign(apiError(409, 'Sign in on the Server page to act on a chat running on another PC.'), { code: 'hub-sign-in-required', hubOrigin: null })
    return caller
  }
  function setAutoUpdate(raw: unknown, by: string, r?: ProofRequest) {
    if (!isObject(raw) || typeof raw.on !== 'boolean') throw apiError(400, 'Expected {on}')
    // F-173a: the choice is recorded with WHO made it (an administrator's current CRM session, never a chat or a machine) and when.
    const caller = requireCrmHuman(o.auth, r, true)
    // Update is Shubham's by his id (his order o2f32): a second owner does not switch the automatic update either.
    firstOwnerOnly(caller, 'POST /auto-update', "The app's updates are for the first owner of this app only.")
    const who = describeHuman(caller)
    const st = autoUpdate.set(raw.on, `${who} via ${by}`, caller.person?.id ?? null)
    deviceLog(`Automatic updates when quiet switched ${raw.on ? 'ON' : 'off'}`, `${who} via ${by}`)
    o.onAutoUpdateChanged?.()
    return withRun(st, o.updateRun?.() ?? null)
  }
  const deviceLog = (detail: string, by: string) => approvalLog.add({ kind: 'device', floor: '', agent: '', pc: self().name, sessionId: '', detail, by })
  function retiredApprovalDevices(): never { throw Object.assign(apiError(410, 'Approval-device enrollment was removed. Sign in through CRM; no device registration is used.'), { code: 'approval-devices-retired' }) }

  /** One durable intent; neither a timeout nor reopening the chat replays its paste. */
  async function sayTo(id: string, agentId: string, body: string, intent: Omit<SayRequest, 'text'> = {}, actor: Caller = OPEN, onSent?: (sid: string) => void, humanAuthority?: () => boolean): Promise<SayAnswer> {
    const owner = deliveryActor({ caller: actor })
    const receipt = messageReceipts.begin({ id: intent.messageId, owner, floorId: id, agentId, text: body, expectedSessionId: intent.expectedSessionId }, async (bind, noteBlocked, note) => {
      let mayHaveSubmitted = false, observedSid = intent.expectedSessionId ?? null
      let reason: DeliveryBlockReason | undefined
      const refuse = (code: DeliveryBlockReason, pcName?: string) => { logDeliveryBlock(observedSid, code); return noteBlocked(code, pcName) }
      try {
      if (humanAuthority?.() === false) return refuse('authorization-revoked')
      let agent = agentOf(floorOf(id), agentId)
      observedSid = agent.sessionId
      if (intent.expectedSessionId !== undefined && agent.sessionId !== intent.expectedSessionId) return refuse('stale-session')
      try { access.needChat(actor, agent, 'type', 'message delivery') } catch { return refuse('access-denied') }
      let sid = agent.sessionId, pc = sid ? whereAll()[sid]?.id : undefined, started = false
      if (!sid || !pc) {
        if (access.rights(actor, agent)?.can !== 'owner') return refuse('owner-required')
        const requestedHome = agent.homePc
        // Opening never carries text. Only the receipt-owned transaction can submit it afterwards.
        const opened = await openChat(id, agentId, {})
        sid = opened.sessionId; started = opened.started
        pc = chats.info(sid) ? self().id : whereAll()[sid]?.id
        // The authenticated open can precede the debounced live advertisement. Its home is
        // usable only when the canonical binding still agrees with the requested home.
        if (!pc && opened.on && requestedHome && agentOf(floorOf(id), agentId).homePc === requestedHome) pc = requestedHome
      }
      agent = agentOf(floorOf(id), agentId)
      if (!sid || !pc) return refuse('target-unavailable')
      if (agent.sessionId !== sid) return refuse('binding-changed')
      observedSid = sid
      const targetSid = sid
      let binding = deliveryBinding(agent)
      const invalid = (code: DeliveryBlockReason) => { reason = code; return false }
      const valid = () => {
        try {
          const current = agentOf(floorOf(id), agentId)
          const advanced = advanceDeliveryBinding(binding, current)
          if (!advanced) return invalid('binding-changed')
          binding = advanced
          try { access.needChat(actor, current, 'type', 'message delivery') } catch { return invalid('access-denied') }
          if (switchFences.blocked(targetSid)) return invalid('switch-in-progress')
          if (humanAuthority?.() === false) return invalid('authorization-revoked')
          return true
        } catch { return invalid('target-unavailable') }
      }
      if (!valid()) return refuse(reason ?? 'preflight-failed')
      let final: DeliveryReceipt | null
      if (pc === self().id) {
        const generation = chats.generation?.(sid)
        if (!generation) return refuse('runtime-unavailable')
        bind(sid, generation, started)
        const native = beginNativeDelivery(sid, body, owner, receiptId(), binding, valid)
        mayHaveSubmitted = true
        do { final = await nativeReceipts.wait(native.id, owner, id, agentId, 15_000) } while (final?.state === 'pending' && !closing)
      } else {
        mayHaveSubmitted = true
        final = await remoteNativeDelivery(pc, sid, body, owner, receiptId(), binding, actor, humanAuthority ? valid : undefined)
        if (final?.generation) bind(sid, final.generation, started)
      }
      if (final?.state === 'sent') onSent?.(sid)
      if (final?.state === 'blocked') return refuse(reason ?? final.reason ?? 'peer-blocked', final.targetPcName)
      // Diagnostics: the native receipt (here or on the member PC) already says which branch ended it; the hub's own endings say theirs.
      if (final?.diag) note(final.diag)
      else if (final?.state === 'pending') note({ cause: closing ? 'agent-closing' : 'exception', marks: [] })
      return final?.state === 'pending' ? 'unconfirmed' : final?.state ?? 'unconfirmed'
      } catch { if (mayHaveSubmitted) note({ cause: 'exception', marks: [] }); return mayHaveSubmitted ? 'unconfirmed' : refuse(reason ?? 'preflight-failed') }
    })
    // The send callback is always a microtask, after this stable ID has been allocated.
    function receiptId() { return receipt.id }
    const final = await messageReceipts.wait(receipt.id, owner, id, agentId)
    if (final?.state === 'sent') return { ok: true, started: final.started, receipt: final }
    const state = final?.state ?? 'unconfirmed'
    const description = state === 'pending'
      ? 'The one message is still awaiting submission confirmation and may still complete. Observe its receipt; do not press Enter or resend.'
      : state === 'blocked' || state === 'gone'
        ? blockDescription(final)
        : 'Delivery is not confirmed. The one message may already have been submitted or may remain in the composer. Inspect the destination; do not press Enter or resend.'
    throw Object.assign(apiError(409, description), { code: `delivery-${state}` })
  }

  /** The keys of a numbered choice, into a chat anywhere (this PC's, or through the link). */
  async function typeKeys(c: { sessionId: string; id: string }, data: string, proof: NativeApprovalProof, validateLocal: (agent: FloorAgent) => void, markDispatch: () => void): Promise<boolean> {
    const command: NativeApprovalCommit = { version: 1, proof, action: data === ESC_KEY ? 'cancel' : 'answer', ...(data === ESC_KEY ? {} : { n: Number(data) }) }
    if (c.id === self().id) return (await commitNativeApproval(command, null, current => { validateLocal(current); markDispatch() })).committed
    const link = team?.member(c.id)
    if (!link) throw apiError(409, 'The pinned PC disconnected before approval dispatch.')
    // Human authentication/ACL linearizes at authenticated dispatch. Never forward cookies or raw claimed people.
    const at = floors.bySession(c.sessionId)
    if (!at) throw apiError(409, 'The approval target changed before dispatch.')
    validateLocal(at.agent)
    const dispatchPeer: LinkPeer = { ...link, open: async meta => {
      const stream = await link.open(meta), end = stream.end
      stream.end = function (...args: unknown[]) {
        try {
          if (team?.member(c.id)?.token !== link.token) throw apiError(409, 'The pinned PC changed before dispatch.')
          const latest = floors.bySession(c.sessionId)
          if (!latest) throw apiError(409, 'The approval target changed before dispatch.')
          validateLocal(latest.agent)
          markDispatch()
          return Reflect.apply(end, stream, args)
        } catch (error) { stream.destroy(); throw error }
      } as typeof stream.end
      return stream
    } }
    const result = await request<{ version: number; committed: boolean }>(dispatchPeer, 'approval-commit-v1', command)
    if (result?.version !== 1 || result.committed !== true) throw apiError(409, 'Approval commit was not confirmed; inspect the prompt and do not retry automatically.')
    return true
  }

  /**
   * F-294: whether this person is shown this chat's prompt at all: the owner of the app, for a chat he may type into; anyone else, only for a floor whose decisions go to them NOW
   * (decides()). Which floors the owner's LIST covers (scope) is the list's own business; Ignore asks this and no more, so it hides exactly what the list would show.
   */
  function seesPrompt(caller: Caller, admin: boolean, f: Floor, a: FloorAgent): boolean {
    if (!admin) return decides(caller, { floor: f, agent: a })
    const rights = access.rights(caller, a)
    return !!rights?.can && rights.can !== 'view'
  }
  /** The list's own gate (o7e6d): someone who is not the owner and decides for no floor now is refused (403 admin-only), not shown an empty list. */
  function requireDecider(caller: Caller, admin: boolean) {
    if (!admin && !floors.list().some(f => caller.person && floorRoutable(f) && decidesOn(questionRouteOf(f.id), caller.person.id))) throw authError(403, 'This is for the owner of this app.', 'admin-only')
  }

  /**
   * Every chat waiting at a prompt, on every floor and PC, with what its screen says.
   * The owner of the app (o0c50): `scope` chooses which floors' prompts are listed, never who may answer them: 'mine' (the default) leaves
   * out the floors whose decisions go to people (nothing of theirs is pushed to him, ever: oa76b); 'all' is every floor, the old list;
   * 'floor:<id>' one floor. What waits on those floors is counted in `elsewhere`, for when he looks. With no floor routed, 'mine' is the old list.
   * A floor's decision-maker (o66aa / oa76b / o7e97, "1A"): the prompts of the floors they decide for now (decides()), in that floor's
   * unshared chats too, and nothing else: no other scope, no prepared sends, no counts.
   */
  async function listApprovals(r?: ProofRequest, scope: ApprovalsScope = 'mine'): Promise<ApprovalsAnswer> {
    const caller = requireCrmHuman(o.auth, r)
    const admin = access.isAdmin(caller)
    if (!admin && scope !== 'mine') throw authError(403, 'Only the owner of this app looks at other floors.', 'admin-only')
    // Someone who decides for no floor now: refused as before (o7e6d), not an empty list.
    requireDecider(caller, admin)
    // F-294: the ignores of chats that have left their question go first, so an answered prompt's record is never read as hiding a later one.
    sweepIgnores()
    const where = whereAll()
    const { mine, elsewhere } = ownerQuestions()
    const own = new Set(mine.map(q => q.sessionId))
    const listed = (f: Floor, a: FloorAgent, sid: string) => seesPrompt(caller, admin, f, a) && (!admin || (scope === 'all' ? true : scope === 'mine' ? own.has(sid) : scope === `floor:${f.id}`))
    const waiting = floors.list().flatMap(f => f.agents.flatMap(a => (a.sessionId && where[a.sessionId]?.state === 'question' && listed(f, a, a.sessionId) ? [{ f, a, w: where[a.sessionId], sid: a.sessionId }] : [])))
    const everything = await Promise.all(
      waiting.map(async ({ f, a, w, sid }): Promise<ApprovalItem> => {
        const p = await promptOfChat({ sessionId: sid, id: w.id })
        // On his list, a floor whose decisions go to people says whose they are.
        const route = admin && routableChat(f, a) && access.typingScopeOpen(a) ? questionRouteOf(f.id) : OWNER_ROUTE
        return { sessionId: sid, floorId: f.id, floorName: f.name, agentId: a.id, agentName: a.name, pc: w.name, state: w.state, menu: p.menu, context: p.context, id: p.id, answerable: answerable(p.menu), cancellable: p.cancellable, ...(route.to === 'people' ? { routedTo: routeNames(route) } : {}) }
      }),
    )
    // F-294 (his o8c55): this person's ignored prompts (exactly this prompt of this chat) are kept out of `items` and listed apart, so the cards and the badge leave them out and the page can show
    // them under "Ignored (n)". Any other prompt of the same chat has another id and stays a new card. Nothing about the chat is touched.
    const personId = caller.person!.id
    const items = everything.filter(i => !ignores.has(personId, i.sessionId, i.id))
    const ignored = everything.filter(i => ignores.has(personId, i.sessionId, i.id))
    return {
      items,
      ...(ignored.length ? { ignored } : {}),
      prepared: admin ? [...prepared.values()].filter(card => { const a = allFloors().find(f => f.id === card.floorId)?.agents.find(a => a.id === card.agentId); const rights = a ? access.rights(caller, a) : null; return rights && rights.can !== 'view' }).sort((x, y) => y.at.localeCompare(x.at)) : [],
      ...(admin && elsewhere.length ? { elsewhere } : {}),
      // o66aa / o7e97: answers given whose record could not be written, for him to see (his overlay's cards).
      ...(admin && unrecorded.length ? { unrecorded: unrecorded.slice(0, 10) } : {}),
      scope,
    }
  }

  /** o0c50 / o66aa: GET /question-routing: every floor's decision-makers (saved and in force), who may be chosen, and what his badge leaves out. Owner only. */
  function questionRoutingView(): QuestionRoutingAnswer {
    const list = floors.list()
    const answer: QuestionRoutingAnswer = {
      floors: list.map(f => ({ floorId: f.id, floorName: f.name, route: questionRouting.route(f.id), effective: questionRouteOf(f.id), routable: floorRoutable(f), candidates: candidatesOf(f, SBSKRRT_OWNER.id) })),
      routedFloorIds: list.filter(f => questionRouteOf(f.id).to === 'people').map(f => f.id),
    }
    return questionRouting.unreadable() ? { ...answer, unreadable: true } : answer
  }

  /**
   * o0c50 / o66aa: PUT /question-routing/<floorId>: the owner's again, or one or more people this floor's chats are shared with. Owner only. The
   * floor's menu ("Decisions go to…") changes it here. Only on the Server, by the person signed in through CRM on its own page (requireCrmHuman:
   * never a chat's key, the machine's token, the open app or a member PC's word for its page; Lead / Agent 3: "admin" alone would be any chat
   * he owns); who chose is that caller, never the body. A member PC's page is told to change it on the Server's page.
   */
  function setQuestionRoute(floorId: string, r: MountRequest): QuestionRoutingAnswer {
    if (mode() === 'member') throw Object.assign(apiError(409, "Where a floor's decisions go is changed on the Server's page."), { code: 'hub-sign-in-required', hubOrigin: null })
    const by = requireCrmHuman(o.auth, r, true)
    const f = floors.list().find(x => x.id === floorId)
    if (!f) throw apiError(404, 'No such floor')
    // A floor whose decisions stay his whatever is chosen (PC control, a person's Assistant, the Orchestrator) takes no people; going back to him always works.
    if (!floorRoutable(f) && !(isObject(r.body) && r.body.to === 'owner')) throw apiError(409, "This floor's decisions stay yours: it is PC control, or it holds an Assistant or the phone's chat.")
    const people = candidatesOf(f, SBSKRRT_OWNER.id)
    const saved = questionRouting.set(floorId, r.body, id => people.find(p => p.id === id)?.name ?? null)
    log?.info(`question routing: ${describeHuman(by)} chose: ${f.name}'s decisions now go to ${saved.to === 'people' ? routeNames(saved) : 'the owner'}`)
    return questionRoutingView()
  }

  /** Order o5d4e: GET /approvals/arrow-prompts: whether claude's unnumbered selects get buttons (the old way, none, is the switch). Owner only. */
  const arrowPromptsView = () => ({ on: arrowPrompts.on(), ...(arrowPrompts.unreadable() ? { unreadable: true } : {}) })
  /** Order o5d4e: PUT /approvals/arrow-prompts {on}. By the person signed in through CRM on the Server's own page, as the other approval settings are. */
  function setArrowPrompts(r: MountRequest) {
    if (mode() === 'member') throw Object.assign(apiError(409, "Buttons for arrow-select prompts are switched on the Server's page."), { code: 'hub-sign-in-required', hubOrigin: null })
    const by = requireCrmHuman(o.auth, r, true)
    arrowPrompts.set(isObject(r.body) ? r.body.on : undefined)
    log?.info(`arrow-select prompts: ${describeHuman(by)} switched the buttons ${arrowPrompts.on() ? 'on' : 'off'}`)
    return arrowPromptsView()
  }

  /** His tap on option n of the prompt he was shown: typed into that chat exactly as pressing it there. Refused when the prompt has changed since. */
  async function answerApproval(raw: unknown, by: string, r?: ProofRequest) {
    if (!isObject(raw) || typeof raw.sessionId !== 'string' || typeof raw.id !== 'string' || typeof raw.n !== 'number') throw apiError(400, 'Expected {sessionId, id, n}')
    const req = raw as unknown as AnswerRequest
    // Only the current CRM session and current target rights authorize this action.
    by = `${humanProof('answer', [req.sessionId, req.id, req.n], undefined, r)} via ${by}`
    const at = floors.bySession(req.sessionId)
    const w = whereAll()[req.sessionId]
    if (!at || !w) throw apiError(404, "That chat isn't running any more")
    // o66aa / o7e97: the owner of the app, or one of the people deciding for this chat's floor now (decides(), asked again at every step below).
    const caller = humanTarget(r, at.agent, 'type', true)
    const actor = promptActor(caller)
    const key = JSON.stringify([req.sessionId, req.id])
    // First answer wins: someone else already holds this prompt's answer (the screen may have moved on since): say who, plainly.
    const holder = promptActions.actorOf(key)
    if (holder && holder.id !== actor.id) throw answeredByAnother(holder)
    const runtime = w.id === self().id ? chats.info(req.sessionId)?.startedAt : team?.member(w.id)?.token
    if (w.state !== 'question') throw apiError(409, 'That chat is no longer waiting at a prompt; look again.')
    const p = await promptOfChat({ sessionId: req.sessionId, id: w.id })
    if (!p.native) throw Object.assign(apiError(409, 'That PC needs an app update before native approval can be verified.'), { code: 'approval-peer-update-required' })
    if (!answerable(p.menu)) throw apiError(409, 'That prompt can only be answered in the chat itself.')
    if (p.id !== req.id) throw apiError(409, 'That prompt has changed since you looked at it; look again.')
    const option = p.menu!.options.find(x => x.n === req.n)
    if (!option) throw apiError(400, `The prompt has no option ${req.n}`)
    const latest = floors.bySession(req.sessionId)
    const current = whereAll()[req.sessionId]
    if (!latest || latest.agent.id !== at.agent.id || current?.id !== w.id || (w.id === self().id ? chats.info(req.sessionId)?.startedAt : team?.member(w.id)?.token) !== runtime) throw apiError(409, 'The running target changed; refresh the prompt.')
    humanTarget(r, latest.agent, 'type', true)
    return promptActions.run(key, JSON.stringify(['answer', req.n]), async markNativeAttempt => {
      const now = await promptOfChat({ sessionId: req.sessionId, id: w.id })
      if (!now.native || now.id !== req.id || !answerable(now.menu) || !now.menu!.options.some(x => x.n === req.n)) throw apiError(409, 'That prompt changed before the answer could be committed; refresh it.')
      const target = floors.bySession(req.sessionId), live = whereAll()[req.sessionId]
      if (!target || target.agent.id !== at.agent.id || live?.id !== w.id || live.state !== 'question' || (w.id === self().id ? chats.info(req.sessionId)?.startedAt : team?.member(w.id)?.token) !== runtime) throw apiError(409, 'The running target changed before the answer could be committed; refresh it.')
      humanTarget(r, target.agent, 'type', true)
      if (!(await typeKeys({ sessionId: req.sessionId, id: w.id }, String(req.n), now.native.proof, current => humanTarget(r, current, 'type', true), markNativeAttempt))) throw apiError(409, `${at.agent.name}'s chat on ${w.name} can't be answered right now`)
      const detail = `${p.menu!.question || 'A prompt'} → ${option.n}. ${option.label}${p.context ? ` | ${p.context.split('\n').slice(-3).join(' / ')}` : ''}`
      // o66aa / o7e97: the record names the human who gave it (an action taken with the chat owner's powers must never pass for his own).
      recordAnswer({ kind: 'answer', floor: at.floor.name, agent: at.agent.name, pc: w.name, sessionId: req.sessionId, detail, by, ...promptRecord(caller, at.floor.id, req.id, `${option.n}. ${option.label}`) })
      log?.info(`approved for ${at.agent.name} on ${at.floor.name}: option ${option.n}${access.isAdmin(caller) ? '' : `, by ${describeHuman(caller)} for the floor`}`)
      return { ok: true, answered: `${option.n}. ${option.label}`, agent: at.agent.name, floor: at.floor.name }
    }, actor)
  }

  /** o66aa / o7e97: who holds a prompt's answer (the once-only claim), from the caller requireCrmHuman proved. */
  const promptActor = (c: Caller): PromptActor => ({ id: c.person!.id, name: c.person!.name || c.person!.username })
  /** o66aa / o7e97: the durable part of an answer's record: which person, as what, on which floor, which prompt, and what they chose. */
  const promptRecord = (c: Caller, floorId: string, promptId: string, choice: string) =>
    ({ personId: c.person!.id, role: access.isAdmin(c) ? 'owner' as const : 'decision-maker' as const, floorId, promptId, choice })

  /**
   * His tap on Cancel (Esc) for the prompt he was shown: one Escape key into that chat, only while its screen still shows the same prompt
   * and its footer says "Esc to cancel". CRM-authorized like an answer. On a permission prompt Esc means No.
   */
  async function cancelApproval(raw: unknown, by: string, r?: ProofRequest) {
    if (!isObject(raw) || typeof raw.sessionId !== 'string' || typeof raw.id !== 'string') throw apiError(400, 'Expected {sessionId, id}')
    const req = raw as unknown as CancelRequest
    by = `${humanProof('cancel', [req.sessionId, req.id], undefined, r)} via ${by}`
    // F-294a (Agent 14's R1, Lead's ruling): the list's own gate FIRST, before the chat is looked up, as in the list, Restore and Ignore: someone who is not the owner and decides for no floor now is refused 403
    // admin-only for ANY session id, so the status never says which chats exist (before this, an id that is not there was 404 and a known one 403).
    const human = requireCrmHuman(o.auth, r)
    requireDecider(human, access.isAdmin(human))
    const at = floors.bySession(req.sessionId)
    const w = whereAll()[req.sessionId]
    if (!at || !w) throw apiError(404, "That chat isn't running any more")
    // o66aa / o7e97: as an answer (this IS one: the prompt's own Esc, "No" on a permission prompt): the owner, or one of the floor's people now.
    const caller = humanTarget(r, at.agent, 'type', true)
    const actor = promptActor(caller)
    const key = JSON.stringify([req.sessionId, req.id])
    const holder = promptActions.actorOf(key)
    if (holder && holder.id !== actor.id) throw answeredByAnother(holder)
    const runtime = w.id === self().id ? chats.info(req.sessionId)?.startedAt : team?.member(w.id)?.token
    if (w.state !== 'question') throw apiError(409, 'That chat is no longer waiting at a prompt; look again.')
    const p = await promptOfChat({ sessionId: req.sessionId, id: w.id })
    if (!p.native) throw Object.assign(apiError(409, 'That PC needs an app update before native approval can be verified.'), { code: 'approval-peer-update-required' })
    if (!p.cancellable) throw apiError(409, 'Esc is not offered for that prompt (its keys are not known here, or Esc is its exit); answer it in the chat itself.')
    if (p.id !== req.id) throw apiError(409, 'That prompt has changed since you looked at it; look again.')
    const latest = floors.bySession(req.sessionId)
    const current = whereAll()[req.sessionId]
    if (!latest || latest.agent.id !== at.agent.id || current?.id !== w.id || (w.id === self().id ? chats.info(req.sessionId)?.startedAt : team?.member(w.id)?.token) !== runtime) throw apiError(409, 'The running target changed; refresh the prompt.')
    humanTarget(r, latest.agent, 'type', true)
    return promptActions.run(key, 'cancel', async markNativeAttempt => {
      const now = await promptOfChat({ sessionId: req.sessionId, id: w.id })
      if (!now.native || now.id !== req.id || !now.cancellable) throw apiError(409, 'That prompt changed before Cancel could be committed; refresh it.')
      const target = floors.bySession(req.sessionId), live = whereAll()[req.sessionId]
      if (!target || target.agent.id !== at.agent.id || live?.id !== w.id || live.state !== 'question' || (w.id === self().id ? chats.info(req.sessionId)?.startedAt : team?.member(w.id)?.token) !== runtime) throw apiError(409, 'The running target changed before Cancel could be committed; refresh it.')
      humanTarget(r, target.agent, 'type', true)
      if (!(await typeKeys({ sessionId: req.sessionId, id: w.id }, ESC_KEY, now.native.proof, current => humanTarget(r, current, 'type', true), markNativeAttempt))) throw apiError(409, `${at.agent.name}'s chat on ${w.name} can't be cancelled right now`)
      const detail = `${p.menu?.question || 'A prompt'} → Esc (cancel)${p.context ? ` | ${p.context.split('\n').slice(-3).join(' / ')}` : ''}`
      recordAnswer({ kind: 'answer', floor: at.floor.name, agent: at.agent.name, pc: w.name, sessionId: req.sessionId, detail, by, ...promptRecord(caller, at.floor.id, req.id, 'Esc (cancel)') })
      log?.info(`cancelled (Esc) for ${at.agent.name} on ${at.floor.name}${access.isAdmin(caller) ? '' : `, by ${describeHuman(caller)} for the floor`}`)
      return { ok: true, agent: at.agent.name, floor: at.floor.name }
    }, actor)
  }

  /**
   * F-294: the record of an ignore or a restore, written FIRST: ids, names and a fixed sentence, never what the prompt said, how long it was or how many options it had. A record that
   * cannot be written means nothing changes (no hide, no restore) and he is told. A row crediting a person for a call that was refused would be wrong, so a refused call never gets here.
   */
  function recordIgnore(kind: 'ignore' | 'restore', caller: Caller, by: string, rec: IgnoreRecord) {
    try {
      approvalLog.add({ kind, floor: rec.floor, agent: rec.agent, pc: rec.pc, sessionId: rec.sessionId, detail: kind === 'ignore' ? IGNORE_DETAIL : RESTORE_DETAIL, by: `${describeHuman(caller)} via ${by}`, ...promptRecord(caller, rec.floorId, rec.promptId, kind === 'ignore' ? 'Ignored' : 'Restored') })
    } catch (err) {
      log?.error(`approvals: the record of an ${kind} could not be written (${message(err)}); nothing was changed`)
      throw apiError(503, `The record of this could not be written, so nothing was ${kind === 'ignore' ? 'hidden' : 'restored'}. Try again.`)
    }
  }

  /**
   * F-294 (his o8c55, "and give button ignroe pleae"): his tap on Ignore. This card is hidden from HIM, the signed-in person, until the chat's question is a new one. It NEVER answers anything:
   * no key is typed, no option is chosen, nothing is sent, and the agent that asked keeps waiting (Cancel, or an answer, are what end that). The proof is Cancel's: a current CRM session
   * (a chat's key is refused, an open app is 401) and rights on that chat's floor NOW (the owner, or one of its decision-makers). The prompt must be the chat's CURRENT one, the id GET
   * /approvals listed. The record (who, when, which chat and prompt id) is written first.
   */
  async function ignoreApproval(raw: unknown, by: string, r?: ProofRequest) {
    if (!isObject(raw) || typeof raw.sessionId !== 'string' || typeof raw.id !== 'string') throw apiError(400, 'Expected {sessionId, id}')
    const req = raw as unknown as IgnoreRequest
    const caller = requireCrmHuman(o.auth, r)
    // F-294a (Agent 14's R1, Lead's ruling): the list's own gate FIRST, before the chat is looked up (as in Restore and the list): someone who decides for no floor is refused 403 admin-only for ANY session id,
    // so the status never says which chats exist (before this, an id that is not there was 404 and a known one 403). The owner and a person who decides for some floor are as they were.
    requireDecider(caller, access.isAdmin(caller))
    const at = floors.bySession(req.sessionId)
    const w = whereAll()[req.sessionId]
    if (!at || !w) throw apiError(404, "That chat isn't running any more")
    humanTarget(r, at.agent, 'type', true)
    if (w.state !== 'question') throw apiError(409, 'That chat is no longer waiting at a prompt; look again.')
    const p = await promptOfChat({ sessionId: req.sessionId, id: w.id })
    if (p.id !== req.id) throw apiError(409, 'That prompt has changed since you looked at it; look again.')
    // After the await: the same chat on the same PC, still at a question, and still this person's to see.
    const latest = floors.bySession(req.sessionId)
    const live = whereAll()[req.sessionId]
    if (!latest || latest.agent.id !== at.agent.id || live?.id !== w.id || live.state !== 'question') throw apiError(409, 'That chat changed while this was checked; look again.')
    humanTarget(r, latest.agent, 'type', true)
    const personId = caller.person!.id
    // Ignoring what is already ignored changes nothing, so it adds no record: one tap's worth of record however many taps or retries come.
    if (!ignores.has(personId, req.sessionId, req.id)) {
      const rec: IgnoreRecord = { personId, sessionId: req.sessionId, promptId: req.id, floorId: at.floor.id, agentId: at.agent.id, floor: at.floor.name, agent: at.agent.name, pc: w.name, at: new Date().toISOString() }
      recordIgnore('ignore', caller, by, rec)
      ignores.add(rec)
      log?.info(`a card of ${at.agent.name} on ${at.floor.name} was hidden by ${describeHuman(caller)} (nothing was typed; the chat keeps waiting)`)
    }
    return { ok: true, agent: at.agent.name, floor: at.floor.name }
  }

  /** F-294: his tap on Restore in "Ignored (n)": the card comes back. Only this person's own record, found by exactly this chat and prompt; the record of it is written first. */
  function restoreApproval(raw: unknown, by: string, r?: ProofRequest) {
    if (!isObject(raw) || typeof raw.sessionId !== 'string' || typeof raw.id !== 'string') throw apiError(400, 'Expected {sessionId, id}')
    const req = raw as unknown as RestoreRequest
    const caller = requireCrmHuman(o.auth, r)
    // The list's own gate, as for every approvals route: someone who is not the owner and decides for no floor now is refused (403 admin-only) before anything is looked up.
    requireDecider(caller, access.isAdmin(caller))
    // A prompt that was answered, or whose chat is gone, has no record any more: so there is nothing to restore (404), however long ago it was.
    sweepIgnores()
    const rec = ignores.list(caller.person!.id).find(x => x.sessionId === req.sessionId && x.promptId === req.id)
    if (!rec) throw apiError(404, 'That card is not ignored (any more).')
    recordIgnore('restore', caller, by, rec)
    ignores.remove(rec.personId, rec.sessionId, rec.promptId)
    log?.info(`a card of ${rec.agent} on ${rec.floor} was brought back by ${describeHuman(caller)}`)
    return { ok: true, agent: rec.agent, floor: rec.floor }
  }

  /**
   * F-294: GET /approvals/ignored: which of THEIR ignored prompts are still their chat's current prompt (ids only), for the badge, which leaves exactly those out. The list's own gate
   * (the owner, or a person who decides for some floor now); nothing is read of any other person's.
   */
  async function listIgnored(r?: ProofRequest): Promise<IgnoredAnswer> {
    const caller = requireCrmHuman(o.auth, r)
    const admin = access.isAdmin(caller)
    requireDecider(caller, admin)
    sweepIgnores()
    const where = whereAll()
    const found = await Promise.all(
      ignores.list(caller.person!.id).map(async rec => {
        const w = where[rec.sessionId]
        const at = floors.bySession(rec.sessionId)
        if (!w || w.state !== 'question' || !at || !seesPrompt(caller, admin, at.floor, at.agent)) return null
        const p = await promptOfChat({ sessionId: rec.sessionId, id: w.id })
        return p.id === rec.promptId ? { sessionId: rec.sessionId, id: rec.promptId } : null
      }),
    )
    return { ignored: found.filter((x): x is { sessionId: string; id: string } => x !== null) }
  }

  /** His own words, into a chosen agent's chat as plain input: no "[message from ...]", as if typed there. */
  async function sendAsMe(raw: unknown, by: string, rq?: ProofRequest) {
    if (!isObject(raw) || typeof raw.floorId !== 'string' || typeof raw.agentId !== 'string') throw apiError(400, 'Expected {floorId, agentId, text}')
    const req = raw as unknown as SendAsMeRequest
    const body = text(req.text, 'text', MAX_SAY_TEXT)
    // Cached legacy signature fields are ignored, never an alternative to a CRM session.
    by = `${humanProof('send', [req.floorId, req.agentId, createHash('sha256').update(body, 'utf8').digest('hex'), typeof req.card === 'string' ? req.card : ''], undefined, rq)} via ${by}`
    const at = agentOf(floorOf(req.floorId), req.agentId)
    const person = humanTarget(rq, at, at.sessionId && whereAll()[at.sessionId] ? 'type' : 'owner')
    const humanAuthority = () => {
      // o7e6d: the owner only, rechecked at the native write (after sayTo's awaits), not just the same person.
      try { const current = requireCrmHuman(o.auth, rq); return current.sid === person.sid && current.person?.id === person.person?.id && access.isAdmin(current) }
      catch { return false }
    }
    const floor = floorOf(req.floorId)
    const r = await sayTo(req.floorId, req.agentId, body, sayIntent(raw), rq?.caller ?? OPEN, sid => {
      const w = whereAll()[sid]
      approvalLog.add({ kind: 'send', floor: floor.name, agent: at.name, pc: w?.name ?? self().name, sessionId: sid, detail: body, by })
      if (typeof req.card === 'string') prepared.delete(req.card)
      log?.info(`sent as the person to ${at.name} on ${floor.name}`)
    }, humanAuthority)
    return { ...r, agent: at.name, floor: floor.name }
  }

  /** The assistant's proposal: stored, shown to the person, never sent by anything but his tap. */
  function prepareCard(floorRef: unknown, agentRef: unknown, textArg: unknown, why: unknown): PreparedCard {
    const { floor: f, agent: a } = findAgent(floorRef, agentRef)
    const card: PreparedCard = {
      id: randomUUID(),
      floorId: f.id,
      floorName: f.name,
      agentId: a.id,
      agentName: a.name,
      text: text(textArg, 'text', MAX_SAY_TEXT),
      why: typeof why === 'string' ? why.trim().slice(0, 300) : '',
      at: new Date().toISOString(),
    }
    prepared.set(card.id, card)
    while (prepared.size > PREPARED_MAX) prepared.delete(prepared.keys().next().value as string)
    emit({ t: 'floors', floors: allFloors() })
    return card
  }

  type Row = Record<string, unknown>
  /** F-067: pauses between the commands typed into one chat, so claude has taken the first before the next arrives. */
  const TUNE_GAP_MS = o.tuneGapMs ?? 800

  /**
   * F-067: changes an agent's model, effort and/or ultracode (kept on the agent: its chat starts with them every time)
   * and, when its chat runs and is waiting for the person, types the commands that change them in that chat now
   * (`/model`, `/effort`, `/effort ultracode`). A chat that is working, or at a question, or stopped, takes
   * them at its next start; the answer says which.
   */
  async function tuneAgent(floorId: string, agentId: string, raw: unknown, caller?: Caller): Promise<TuneAnswer> {
    requireLegacyExecution(agentOf(floorOf(floorId), agentId), defaultsNow())
    if (!isObject(raw)) throw apiError(400, 'Expected {model?, effort?, ultracode?}')
    if (raw.codexModel !== undefined || raw.codexEffort !== undefined) return tuneCodex(floorId, agentId, raw)
    const req: TuneRequest = {}
    if (raw.model !== undefined) {
      if (!(AGENT_MODELS as readonly unknown[]).includes(raw.model)) throw apiError(400, 'model is opus, sonnet, haiku, or "" for the default')
      req.model = raw.model as AgentModel
    }
    if (raw.effort !== undefined) {
      if (!(AGENT_EFFORTS as readonly unknown[]).includes(raw.effort)) throw apiError(400, 'effort is low, medium, high, xhigh, max, or "" for the default')
      req.effort = raw.effort as AgentEffort
    }
    if (raw.ultracode !== undefined) {
      if (!(AGENT_ULTRACODES as readonly unknown[]).includes(raw.ultracode)) throw apiError(400, 'ultracode is "on", "off", or "" for the default')
      req.ultracode = raw.ultracode as AgentUltracode
    }
    if (req.model === undefined && req.effort === undefined && req.ultracode === undefined) throw apiError(400, 'Nothing to change: give model, effort or ultracode')
    const before = floorOf(floorId)
    const a = agentOf(before, agentId)
    if (engineFor(a) !== 'claude') throw apiError(400, `${a.name} runs ${engineFor(a)}: use that engine’s provider/model settings.`)
    const model = req.model ?? a.model
    const effort = req.effort ?? a.effort
    const ultracode = req.ultracode ?? a.ultracode
    const floor = floors.patch(before.id, { agents: before.agents.map(x => (x.id === a.id ? { ...x, model, effort, ultracode } : x)) })

    const d = defaultsNow()
    const effUltra = ultracode ? ultracode === 'on' : d.ultracode
    // What to type: a /effort level turns ultracode off, so with ultracode wanted it is asked for again after one.
    const commands: string[] = []
    if (req.model !== undefined) commands.push(`/model ${model || d.model || 'default'}`)
    if (req.effort !== undefined) {
      commands.push(`/effort ${effort || d.effort || 'auto'}`)
      if (effUltra) commands.push('/effort ultracode')
    } else if (req.ultracode !== undefined) commands.push(effUltra ? '/effort ultracode' : '/effort ultracode off')
    const what = [req.model !== undefined && 'model', req.effort !== undefined && 'effort', req.ultracode !== undefined && 'ultracode'].filter(Boolean).join(' and ')

    const w = a.sessionId ? whereAll()[a.sessionId] : undefined
    if (!w || !a.sessionId) return { floor, applied: 'next', detail: `${a.name}'s ${what} is kept; its chat isn't running, so it applies when the chat next starts.` }
    if (w.state === 'running') return { floor, applied: 'next', detail: `${a.name}'s ${what} is kept; its chat is working right now, so it applies at its next start. Change it again once the chat is waiting to apply it at once.` }
    if (w.state === 'question') return { floor, applied: 'next', detail: `${a.name}'s ${what} is kept; its chat is at a question, so it applies at its next start. Answer it, then change it again to apply it at once.` }
    // F-302 (Agent 14's L5): /model and /effort are TYPED into the running chat, so a caller who is not an administrator needs the typing right on it (mayType, with the Server scope). The setting itself is theirs as the
    // chat's owner and is kept; it applies at the chat's next start.
    if (caller && !access.mayType(caller, a)) return { floor, applied: 'next', detail: `${a.name}'s ${what} is kept; typing into its running chat is not open to you on this chat, so it applies at its next start.` }
    for (const [i, c] of commands.entries()) {
      if (i > 0) await new Promise(r => setTimeout(r, TUNE_GAP_MS))
      if (!(await typeInto({ sessionId: a.sessionId, id: w.id }, c, { human: true }))) return { floor, applied: 'next', detail: `${a.name}'s ${what} is kept; its chat stopped before it could be set now, so it applies at its next start.` }
    }
    log?.info(`${a.name}: ${commands.join(', ')}`)
    return { floor, applied: 'now', detail: `${a.name}'s ${what} is set in its running chat (on ${w.name}) now: ${commands.join(', ')} ${commands.length > 1 ? 'were' : 'was'} typed into it.` }
  }

  /**
   * F-134: a Codex agent's model and effort. They are kept on the agent and used at its chat's next start (a running Codex chat is not typed into: its model and
   * reasoning level are read from its profile when it starts).
   */
  async function tuneCodex(floorId: string, agentId: string, raw: Row): Promise<TuneAnswer> {
    const before = floorOf(floorId)
    const a = agentOf(before, agentId)
    requireLegacyExecution(a, defaultsNow())
    if (engineFor(a) !== 'codex') throw apiError(409, `${a.name} runs Claude: change its model and effort with model and effort, or change its engine first.`)
    if (raw.codexModel !== undefined && typeof raw.codexModel !== 'string') throw apiError(400, 'codexModel is a model name, or "" for the one Codex chooses')
    if (raw.codexEffort !== undefined && !(CODEX_EFFORTS as readonly unknown[]).includes(raw.codexEffort)) throw apiError(400, 'codexEffort is low, medium, high, xhigh, max, or "" for the one Codex chooses')
    const codexModel = raw.codexModel !== undefined ? String(raw.codexModel).trim().slice(0, CODEX_MODEL_MAX) : (a.codexModel ?? '')
    const codexEffort = raw.codexEffort !== undefined ? (raw.codexEffort as CodexEffort) : (a.codexEffort ?? '')
    const floor = floors.patch(before.id, { agents: before.agents.map(x => (x.id === a.id ? { ...x, codexModel, codexEffort } : x)) })
    const running = !!a.sessionId && !!whereAll()[a.sessionId]
    return {
      floor,
      applied: 'next',
      detail: running
        ? `${a.name}'s Codex model and effort are kept; its chat is running, so they apply when the chat next starts.`
        : `${a.name}'s Codex model and effort are kept; they apply when its chat next starts.`,
    }
  }

  function checkFolder(raw: string) {
    const dir = raw.trim()
    if (!path.isAbsolute(dir)) throw apiError(400, 'Give the folder as a full path, like C:\\Users\\you\\code')
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw apiError(400, `There is no folder ${dir}${mode() === 'member' ? ' on this PC' : ''}`)
  }

  // ---------------------------------------------------------------------------------------
  // F-022: Claude conversations on the hub's other PCs: listed, brought onto a floor, copied here

  /** Which PC each conversation copied here came from (origins.json); one not in it is this PC's own. */
  const originsFile = path.join(o.dir, 'origins.json')
  const origins = new Map<string, string>(Object.entries(readJson(originsFile)).filter((e): e is [string, string] => typeof e[1] === 'string'))
  let originsTimer: NodeJS.Timeout | null = null
  function setOrigin(sid: string, pc: string) {
    if (origins.get(sid) === pc) return
    origins.set(sid, pc)
    if (originsTimer) return
    originsTimer = setTimeout(() => {
      originsTimer = null
      writeAtomic(originsFile, `${json(Object.fromEntries(origins))}\n`)
    }, 1000)
    originsTimer.unref()
  }

  /** The PCs whose conversations this one can reach now: itself, and those linked (the hub's members, or a member's hub). */
  function pcs(): { id: string; name: string; here: boolean }[] {
    const me = self()
    const out = [{ ...me, here: true }]
    if (mode() === 'hub') for (const [id, r] of remote) out.push({ id, name: r.name, here: false })
    else if (mode() === 'member' && sub) {
      const h = team!.hub()
      if (h) out.push({ id: h.id, name: h.name, here: false })
    }
    return out
  }

  /** The link to another PC of the hub's, by id. */
  function peerOf(pc: string): LinkPeer {
    const link = mode() === 'hub' ? team?.member(pc) : mode() === 'member' && team?.hub()?.id === pc ? (team.hub()?.link ?? null) : null
    if (!link) throw apiError(503, "That PC can't be reached right now")
    return link
  }

  const pageOf = (q: URLSearchParams | Record<string, unknown>) => {
    const get = (k: string) => (q instanceof URLSearchParams ? q.get(k) : typeof q[k] === 'string' || typeof q[k] === 'number' || typeof q[k] === 'boolean' ? String(q[k]) : null)
    // F-235: one project folder's (a folder name, never a path), and the folders themselves.
    const dir = get('dir') ?? ''
    return {
      q: get('q') ?? '',
      limit: Number(get('limit')) || 60,
      offset: Number(get('offset')) || 0,
      dir: dir && !/[\\/]/.test(dir) && dir !== '.' && dir !== '..' ? dir : '',
      folders: get('folders') === '1' || get('folders') === 'true',
    }
  }

  /** This PC's own conversations, each saying which PC it belongs to (its own, or the one it was copied from). */
  async function ownSessions(page: ReturnType<typeof pageOf>) {
    const found = await listSessions(projectsDir, page)
    return { sessions: found.sessions.map(x => ({ ...x, pc: origins.get(x.sessionId) ?? self().name })), total: found.total, ...(found.folders ? { folders: found.folders } : {}) }
  }

  /** F-235: the hub's PCs that can't be reached now, known by their PC Control workspace (one is made for every PC the hub knows). */
  function offlinePcs(reachable: { id: string }[]): { id: string; name: string }[] {
    const out: { id: string; name: string }[] = []
    for (const f of allFloors())
      if (isPcControl(f) && f.targetPcId && !reachable.some(p => p.id === f.targetPcId) && !out.some(p => p.id === f.targetPcId)) out.push({ id: f.targetPcId, name: f.name })
    return out
  }

  /** This PC's (or, with `pc`, another's) Claude Code conversations, each with the agent it already is on a floor, if any. */
  async function sessions(r: MountRequest): Promise<SessionsAnswer> {
    const query = r.query
    // F-235: a member reaches only its hub; the hub reaches every PC. So a member asks the hub, which asks the PC named (this one too, for
    // its own list, so every PC the hub can reach is named). Without its hub: this PC's own, as before.
    if (mode() === 'member' && sub && team?.hub()?.link) {
      const q = new URLSearchParams(query)
      if (!q.get('pc')) q.set('pc', self().id)
      const there = q.get('pc') !== self().id
      let got: SessionsAnswer | null = null
      try {
        got = (await toHub({ ...r, query: q })) as SessionsAnswer
      } catch (e) {
        if (there) throw e
      }
      if (got) {
        const me = self()
        const list = got.pcs.map(p => ({ ...p, here: p.id === me.id }))
        if (!list.some(p => p.here)) list.unshift({ ...me, here: true })
        return {
          ...got,
          // "Copied here" is this PC's own word: whether it has a copy.
          sessions: got.sessions.map(x => ({ ...x, here: there ? findTranscript(x.sessionId, projectsDir) !== null : undefined })),
          pcs: [...list.filter(p => p.here), ...list.filter(p => !p.here)],
        }
      }
    }
    const pc = query.get('pc')
    const page = pageOf(query)
    const there = pc && pc !== self().id
    const found = there
      ? await request<{ sessions: Omit<ClaudeSession, 'agent'>[]; total: number; folders?: ClaudeProjectFolder[] }>(peerOf(pc), 'sessions', page, 60_000)
      : await ownSessions(page)
    // F-235: every PC keeps a copy of every floor's chat (F-021), so another PC's list names whose chat it is too.
    const bound = new Map<string, ClaudeSession['agent']>()
    for (const f of allFloors()) for (const a of f.agents) if (a.sessionId) bound.set(a.sessionId, { floorId: f.id, floorName: f.name, agentId: a.id, name: a.name })
    const copied = new Set(there ? found.sessions.filter(x => findTranscript(x.sessionId, projectsDir)).map(x => x.sessionId) : [])
    const reachable = pcs()
    return {
      sessions: found.sessions.map(x => ({ ...x, agent: bound.get(x.sessionId) ?? null, ...(there ? { here: copied.has(x.sessionId) } : {}) })),
      total: found.total,
      pcs: reachable,
      ...(Array.isArray(found.folders) ? { folders: found.folders } : {}),
      ...(mode() === 'hub' ? { offline: offlinePcs(reachable) } : {}),
    }
  }

  /** Another PC's conversation, brought here (into the same project folder name) or brought up to date. */
  async function fetchFrom(pc: string, sid: string): Promise<string> {
    const link = peerOf(pc)
    const [one] = (await request<{ files: SessionFile[] }>(link, 'session-files', { sessionId: sid })).files
    if (!one) throw apiError(404, `${link.name} has no conversation ${sid}`)
    const file = findTranscript(sid, projectsDir) ?? path.join(projectsDir, one.dir, `${sid}.jsonl`)
    if (markOf(file).bytes < one.bytes) await pullFrom(link, sid, file)
    setOrigin(sid, link.name)
    return file
  }

  /** Copy all: every conversation on another PC that this one hasn't got (or has less of), one at a time. */
  let copyAll: CopyAllState | null = null
  function startCopyAll(pc: string): CopyAllState {
    if (copyAll?.state === 'running') throw apiError(409, `Already copying from ${copyAll.pc}`)
    const link = peerOf(pc)
    const job: CopyAllState = { pc: link.name, state: 'running', total: 0, done: 0, copied: 0, bytes: 0, error: null, startedAt: new Date().toISOString() }
    copyAll = job
    void (async () => {
      try {
        const { files } = await request<{ files: SessionFile[] }>(link, 'session-files', {}, 120_000)
        job.total = files.length
        for (const f of files) {
          if (!chats.info(f.sessionId)) {
            const mine = findTranscript(f.sessionId, projectsDir)
            const file = mine ?? path.join(projectsDir, f.dir, `${f.sessionId}.jsonl`)
            const had = markOf(file).bytes
            if (had < f.bytes) {
              try {
                const m = await pullFrom(peerOf(pc), f.sessionId, file)
                job.copied++
                job.bytes += Math.max(0, m.bytes - had)
                // A floor's session (F-021) is every PC's; any other first came from there.
                if (!mine && !bySession(f.sessionId)) setOrigin(f.sessionId, link.name)
              } catch (e) {
                log?.warn(`copy all from ${link.name}: ${f.sessionId.slice(0, 8)} not copied: ${message(e)}`)
              }
            }
          }
          job.done++
        }
        job.state = 'done'
        log?.info(`copied ${job.copied} of ${job.total} conversations from ${link.name} (${Math.round(job.bytes / 1e6)} MB)`)
      } catch (e) {
        job.state = 'failed'
        job.error = message(e)
      }
    })()
    return job
  }

  /**
   * A copy of one of this PC's conversations under a new id, for a floor's agent (transcripts.ts says why a copy): beside the original,
   * so it resumes in the folder it was held in; or, held in a folder this PC hasn't got (one copied from another PC), under the floor's
   * folder here (`floorFolder`, looked up only then). The original is only read. `brought`: it was just brought over from another PC (F-022).
   */
  async function copyForFloor(from: string, sid: string, floorFolder: () => string, brought: boolean): Promise<{ file: string; cwd: string }> {
    let cwd = findTranscriptCwd(from, projectsDir)
    let intoDir: string | undefined
    if (!cwd || !existsSync(cwd)) {
      // Held in a folder this PC hasn't got (one copied from another PC): its copy goes under the floor's folder here.
      if (!cwd && !findTranscript(from, projectsDir)) throw apiError(404, `There is no conversation ${from} on this PC`)
      if (cwd && !origins.has(from) && !brought) throw apiError(409, `That conversation was held in ${cwd}, which isn't there any more`)
      cwd = floorFolder()
      intoDir = path.join(projectsDir, encodeProjectPath(cwd))
    }
    try {
      return { file: (await copyTranscript(from, sid, projectsDir, intoDir)).file, cwd }
    } catch (e) {
      throw apiError(500, `Couldn't copy that conversation: ${message(e)}`)
    }
  }

  /** A copy of a conversation becomes an agent's chat (transcripts.ts says why a copy): a new agent's, or the one named's. */
  async function importChat(floorId: string, body: unknown, as?: ChatOwner, r?: MountRequest): Promise<ChatImported> {
    if (!isObject(body) || typeof body.sessionId !== 'string' || !UUID_RE.test(body.sessionId)) throw apiError(400, 'Expected {sessionId, agentId?, name?, role?}')
    if (['executionProfile', 'executionRevision', 'execution', 'provider', 'harness', 'transcript'].some(k => Object.hasOwn(body, k))) throw executionHttpError('execution-capability-required', 'selection')
    const from = body.sessionId
    if (isPcControl(floorOf(floorId)) || controlAlias(from)) throw immutablePcControl()
    // F-235: Import agent from a conversation, run on the PC chosen.
    if (body.runOn !== undefined) return importAgent(floorId, body, from, as, r)
    const intoId = typeof body.agentId === 'string' && body.agentId ? body.agentId : null
    const floor = floorOf(floorId)
    if (intoId) requireLegacyExecution(agentOf(floor, intoId), defaultsNow())
    const previousBinding = bySession(from)
    if (previousBinding) requireLegacyExecution(previousBinding.agent, defaultsNow())
    if (intoId) agentOf(floor, intoId)
    const link = mode() === 'member' ? needHub() : null
    // F-022: from another PC: brought here first.
    const pc = typeof body.pc === 'string' && body.pc && body.pc !== self().id ? body.pc : null
    if (pc) await fetchFrom(pc, from)
    const sid = randomUUID()
    const { file: copy, cwd } = await copyForFloor(from, sid, () => codeDirOf(floor), pc !== null)
    try {
      let agentId = intoId
      let after: Floor
      const name = typeof body.name === 'string' ? body.name : ''
      const role = typeof body.role === 'string' ? body.role.trim() : ''
      if (link) {
        // The hub keeps the floors: it seats the copy, and then brings its own copy over (marks).
        if (!agentId) agentId = (await request<{ agent: FloorAgent }>(link, 'http', { method: 'POST', rest: `/floors/${enc(floorId)}/agents`, body: { name, role } })).agent.id
        after = (await request<{ floor: Floor }>(link, 'http', { method: 'POST', rest: `/floors/${enc(floorId)}/agents/${enc(agentId)}/session`, body: { sessionId: sid } })).floor
        replica.floors = replica.floors.map(f => (f.id === after.id ? after : f))
        if (sub) writeLine(sub.stream, { t: 'marks', marks: { [sid]: markOf(copy) } })
        after = floorOf(floorId)
      } else {
        // Looked up again: the floor may have changed while it copied.
        if (agentId) {
          const before = agentOf(floorOf(floorId), agentId).sessionId
          if (before) stopAnywhere(before)
        } else agentId = floors.addAgent(floorId, { name, role }, as).agent.id
        after = floors.bindSession(floorId, agentId, sid)
      }
      const agent = agentOf(after, agentId)
      log?.info(`brought a copy of conversation ${from.slice(0, 8)} onto ${after.name} as ${agent.name}'s chat (${sid.slice(0, 8)})`)
      return { floor: after, agent, sessionId: sid, cwd }
    } catch (e) {
      rmSync(copy, { force: true })
      throw e
    }
  }

  /**
   * F-235 (order o7c1c), Import agent from a conversation: a new agent on the floor whose chat resumes a conversation held on any of the
   * hub's PCs, on the PC chosen (its home from then on, F-064). The original file is only ever read: the agent gets a copy under a new id.
   * Run on the PC that holds it, that PC makes the copy beside the original (op `session-copy`), so it resumes in the folder it was held
   * in, and the hub's own copy is brought up at once (F-021). Run on another, the hub brings the conversation over (F-022) and copies it,
   * and that PC gets the copy through the F-021 sync when it opens it (in its folder for the floor). A member asks the hub, which reaches
   * every PC and keeps the floors.
   */
  async function importAgent(floorId: string, body: Record<string, unknown>, from: string, as: ChatOwner | undefined, r: MountRequest | undefined): Promise<ChatImported> {
    if (body.agentId !== undefined) throw apiError(400, 'runOn is for a new agent: leave agentId out')
    if (typeof body.runOn !== 'string' || !body.runOn) throw apiError(400, 'runOn is the id of the PC its chat runs on')
    const runOn = body.runOn
    const holder = typeof body.pc === 'string' && body.pc ? body.pc : self().id
    if (mode() === 'member') {
      if (!r) throw apiError(503, "Server (the hub) can't be reached")
      // "This PC" said by its id: the hub asks it for the copy. A long conversation may take a while to bring over or copy.
      return (await toHub({ ...r, body: { ...body, pc: holder } }, IMPORT_TIMEOUT_MS)) as ChatImported
    }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const role = typeof body.role === 'string' ? body.role.trim() : ''
    const floor = floorOf(floorId)
    // As before (importChat): a conversation that is an agent's chat under another way of running is not copied from.
    const previousBinding = bySession(from)
    if (previousBinding) requireLegacyExecution(previousBinding.agent, defaultsNow())
    // Before any copy is made: a name already on the floor.
    if (name && floor.agents.some(a => a.name.trim().toLowerCase() === name.toLowerCase())) throw apiError(409, `There is already an agent called "${name}" on this floor`)
    const holderLink = holder === self().id ? null : peerOf(holder)
    const runLink = runOn === self().id ? null : peerOf(runOn)
    const nameOf = (id: string, link: LinkPeer | null) => (link ? link.name : id === self().id ? self().name : id)
    const on = { id: runOn, name: nameOf(runOn, runLink) }
    const sid = randomUUID()
    let cwd: string
    let drop: () => Promise<void>
    if (runOn === holder && holderLink) {
      // On the PC that holds it: copied there, beside the original.
      let made: { cwd: string }
      try {
        made = await request<{ bytes: number; cwd: string }>(holderLink, 'session-copy', { sessionId: from, newId: sid, floorId }, IMPORT_TIMEOUT_MS)
      } catch (e) {
        if (/doesn't do session-copy/.test(message(e))) throw apiError(409, `${holderLink.name} needs the update first: it can't make the copy itself yet. Run it on another PC, or update ${holderLink.name}.`)
        throw e
      }
      cwd = made.cwd
      drop = () => request(holderLink, 'session-copy', { drop: sid }).then(() => undefined, () => undefined)
    } else {
      // Here: brought over first when another PC holds it (F-022), then copied beside it, or under the floor's folder here.
      if (holderLink) await fetchFrom(holder, from)
      const made = await copyForFloor(from, sid, () => codeDirOf(floor), holderLink !== null)
      // Run on another PC: it opens in that PC's folder for the floor, which this one may not know.
      cwd = runLink ? (floor.folders[runOn] ?? '') : made.cwd
      drop = async () => rmSync(made.file, { force: true })
    }
    try {
      const agentId = floors.addAgent(floorId, { name, role }, as).agent.id
      floors.bindSession(floorId, agentId, sid)
      const after = mode() === 'hub' ? floors.setHome(floorId, agentId, on) : floorOf(floorId)
      // Copied on the PC that holds it: this PC's own copy, brought up now (F-021 keeps it so after).
      if (runOn === holder && holderLink) backfill(holderLink, sid)
      const agent = agentOf(after, agentId)
      log?.info(`imported conversation ${from.slice(0, 8)} from ${nameOf(holder, holderLink)} onto ${after.name} as ${agent.name} (${sid.slice(0, 8)}), running on ${on.name}`)
      return { floor: after, agent, sessionId: sid, cwd, on }
    } catch (e) {
      await drop()
      throw e
    }
  }

  /** F-235, a member: waits (5 s at most) for a floor and agent the hub has just made to reach this PC's copy of the floors (sent 150 ms after a change). */
  async function knownSoon(floorId: string, agentId: string, ms = 5000) {
    const end = Date.now() + ms
    while (!allFloors().some(f => f.id === floorId && f.agents.some(a => a.id === agentId)) && Date.now() < end) await new Promise(r => setTimeout(r, 50))
  }

  /** F-235: how long an import may take (a conversation of hundreds of MB brought over, then copied). */
  const IMPORT_TIMEOUT_MS = 10 * 60_000

  /** F-235: the copies this PC made for the hub's Import agent (op `session-copy`), so only those can be taken back. */
  const importCopies = new Map<string, string>()

  /**
   * F-235, op `session-copy`, asked by the hub: a copy of one of this PC's conversations under a new id, for the floor's new agent (beside
   * the original, which is only read; see copyForFloor). `{drop}` takes back a copy this PC made for an import that failed after.
   */
  async function sessionCopy(raw: unknown): Promise<{ bytes: number; cwd: string } | { dropped: boolean }> {
    if (!isObject(raw)) throw apiError(400, 'Expected {sessionId, newId, floorId} or {drop}')
    if (typeof raw.drop === 'string') {
      const file = importCopies.get(raw.drop)
      importCopies.delete(raw.drop)
      // Only a copy made here for an import, and only while no floor has it.
      if (!file || bySession(raw.drop)) return { dropped: false }
      rmSync(file, { force: true })
      return { dropped: true }
    }
    const { sessionId, newId, floorId } = raw
    if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId) || typeof newId !== 'string' || !UUID_RE.test(newId) || typeof floorId !== 'string') throw apiError(400, 'Expected {sessionId, newId, floorId}')
    if (findTranscript(newId, projectsDir)) throw apiError(409, `There is already a conversation ${newId}`)
    if (!findTranscript(sessionId, projectsDir)) throw apiError(404, `${self().name} has no conversation ${sessionId}`)
    // The floor's folder here only when its own folder is gone (this PC may not have the newest floors yet).
    const made = await copyForFloor(sessionId, newId, () => codeDirOf(floorOf(floorId)), false)
    importCopies.set(newId, made.file)
    log?.info(`copied conversation ${sessionId.slice(0, 8)} as ${newId.slice(0, 8)} for the hub's Import agent (the original only read)`)
    return { bytes: statSync(made.file).size, cwd: made.cwd }
  }

  const openRequest = (b: unknown): OpenChatRequest => {
    const r = isObject(b) ? b : {}
    return { cols: typeof r.cols === 'number' ? r.cols : undefined, rows: typeof r.rows === 'number' ? r.rows : undefined, takeOver: r.takeOver === true, here: r.here === true }
  }

  /**
   * Order oa09e: his overlay Assistant (the hub's one Orchestrator chat, F-086), found or made HERE from the hub's whole list, never by a page from the list
   * it was sent. A page whose list lacked it made a new "Assistant" floor at each load: four empty ones on 14 Nov 2026, never opened (it could not see
   * the ones it made either). The chat with the duty (whatever it is called now) is the answer; with none, the first floor named "Assistant" gets the
   * chat, else a new floor "Assistant" whose boss becomes it, and save() gives it the duty (ensureDuty). Nothing awaits from the look to the write, so two
   * pages asking at once get the same chat. `role` and `md` are the page's (its brief); the name is "Assistant", the one ensureDuty knows.
   */
  function ensureHubAssistant(raw: unknown, as: ChatOwner): { floor: string; agent: string; created: boolean } {
    const b = isObject(raw) ? raw : {}
    const want = { name: 'Assistant', role: typeof b.role === 'string' ? b.role : '', md: typeof b.md === 'string' ? b.md : '' }
    const list = floors.list().filter(f => !isPcControl(f))
    for (const f of list) {
      const a = f.agents.find(x => isOrchestratorAgent(f.name, x))
      if (a) return { floor: f.id, agent: a.id, created: false }
    }
    const named = list.find(f => f.name.trim().toLowerCase() === 'assistant')
    if (named) return { floor: named.id, agent: floors.addAgent(named.id, want, as).agent.id, created: true }
    const made = floors.create('Assistant', as)
    const boss = made.agents.find(a => a.isBoss) ?? made.agents[0]
    if (!boss) return { floor: made.id, agent: floors.addAgent(made.id, want, as).agent.id, created: true }
    floors.patch(made.id, { agents: made.agents.map(a => (a.id === boss.id ? { ...a, ...want } : a)) }, as)
    return { floor: made.id, agent: boss.id, created: true }
  }

  type Handler = (m: string[], r: MountRequest) => unknown
  /** `local`: a member answers it itself; the rest it passes to its hub, which keeps the floors. */
  const routes: [string, RegExp, Handler, 'local'?][] = [
    ['GET', /^\/pc-control$/, (_, r) => controlAnswer(callerOf(r))],
    ['GET', /^\/pc-control\/pcs\/([^/]+)$/, async ([device], r) => {
      const w = (await controlAnswer(callerOf(r))).workspaces.find(w => w.device.id === device)
      if (!w) throw pcControlError('pc-control-forbidden', 'That PC workspace is unavailable to you.', 403)
      return { workspace: w }
    }],
    ['POST', /^\/pc-control\/pcs\/([^/]+)\/slots\/([^/]+)\/open$/, ([device, agent], r) => controlMutate(device, agent, 'open', r)],
    ['POST', /^\/pc-control\/pcs\/([^/]+)\/slots\/([^/]+)\/stop$/, ([device, agent], r) => controlMutate(device, agent, 'stop', r)],
    ['POST', /^\/pc-control\/pcs\/([^/]+)\/slots\/([^/]+)\/engine$/, ([device, agent], r) => controlMutate(device, agent, 'engine', r)],
    // F-083: the watchdog: whether it runs, the heartbeat's last and next beat, and the chats it holds down now.
    ['GET', /^\/watchdog$/, () => watchdogView()],
    // Orders of95c / o9ccb / ocf0e: which chats a non-owner may type into; the owner's only (access.ts POLICY). A member PC's page reads the
    // Server's (passed on), and is told to change it on the Server's page.
    ['GET', /^\/staff-typing$/, () => staffTyping.answer()],
    ['PUT', /^\/staff-typing$/, (_, r) => {
      if (mode() === 'member') throw Object.assign(apiError(409, "Who may type in chats is changed on the Server's page."), { code: 'hub-sign-in-required', hubOrigin: null })
      // Who chose is the caller, never the body: a person signed in through CRM on this page, an administrator (requireCrmHuman refuses a chat's
      // key, the open app and a member PC's word for its page); the body is the two words and nothing else (staff-typing.ts).
      const by = requireCrmHuman(o.auth, r, true)
      const next = staffTyping.set(r.body)
      log?.info(`staff typing: ${describeHuman(by)} chose: non-owners type into ${next.settings.rule === 'own-assistant-only' ? 'their own Assistant only (the 15 Nov rule)' : `chats they own and chats shared to them as Can type${next.settings.scope === 'not-on-server' ? ', not on the Server' : ', on every PC'}`}`)
      // The members type by this choice: they have it in the next state frame.
      pushState()
      return next
    }, 'local'],
    // F-302 L4 (Agent 14's R2): the PCs the owner marks as HIS, so that an unsigned page there (sign-in off) counts as the app's owner on a member's terminal stream. The owner's only (access.ts POLICY) and a signed-in human's, as the staff-typing choice.
    ['GET', /^\/owner-pcs$/, () => ({ pcs: ownerPcs.list(), ...(ownerPcs.unreadable() ? { unreadable: true as const } : {}) })],
    ['PUT', /^\/owner-pcs$/, (_, r) => {
      if (mode() === 'member') throw Object.assign(apiError(409, "The owner's PCs are marked on the Server's page."), { code: 'hub-sign-in-required', hubOrigin: null })
      const by = requireCrmHuman(o.auth, r, true)
      const next = ownerPcs.set(r.body)
      log?.info(`owner PCs: ${describeHuman(by)} marked ${next.pcs.length} PC(s) as his`)
      return next
    }, 'local'],
    // F-086: "What the chats are called": old (the big chat is the Assistant, the fast one Quick) or new (Orchestrator / Assistant). The page sets it; the Assistant's words follow.
    // oc58f follow-up: the answer says when the saved choice could not be read (the card is in force until he chooses again).
    // o0c50: where each floor's questions are pushed to the owner (owner only, access.ts POLICY); rights are unchanged.
    ['GET', /^\/approvals\/arrow-prompts$/, (_, r) => (humanOnly(r), arrowPromptsView())],
    ['PUT', /^\/approvals\/arrow-prompts$/, (_, r) => setArrowPrompts(r), 'local'],
    ['GET', /^\/question-routing$/, () => questionRoutingView()],
    ['PUT', /^\/question-routing\/([^/]+)$/, ([floorId], r) => setQuestionRoute(floorId, r), 'local'],
    ['GET', /^\/fast\/forwarding$/, () => quickForwarding.answer()],
    ['PUT', /^\/fast\/forwarding$/, (_, r) => quickForwarding.set(r.body)],
    ['GET', /^\/fast\/names$/, () => ({ choice: fastNames })],
    // o1cfa: the owner's hub preference, shared by desktop and APK; not a client ownership or microphone switch.
    // Lead (16 Nov): like /fast/forwarding, the answer says when the saved choice could not be read (the old way is in force until he chooses again).
    ['GET', /^\/fast\/settings$/, () => quickSettings.answer(!!fastHost)],
    ['PUT', /^\/fast\/settings$/, (_, r) => (quickSettings.set(r.body), quickSettings.answer(!!fastHost))],
    [
      'POST',
      /^\/fast\/names$/,
      (_p, r) => {
        const choice = isObject(r.body) ? r.body.choice : undefined
        if (choice !== 'old' && choice !== 'new') throw apiError(400, "choice is 'old' or 'new'")
        fastNames = choice
        writeAtomic(fastNamesFile, JSON.stringify({ choice }))
        return { choice: fastNames }
      },
      'local',
    ],
    // F-078: the heartbeat's setting and its last and next beat (the overlay shows them); a beat now.
    ['GET', /^\/heartbeat$/, () => heartbeat.state()],
    // F-078: the overlay was opened: the morning summary goes now when it is the first time after 06:00 today.
    ['POST', /^\/heartbeat\/morning$/, async () => ({ sent: await heartbeat.morning({ atOpen: true }) })],
    [
      'PATCH',
      /^\/heartbeat$/,
      (_, r) => {
        if (!isObject(r.body)) throw apiError(400, 'Expected {enabled?, intervalMin?}')
        if (r.body.intervalMin !== undefined && !Number.isInteger(r.body.intervalMin)) throw apiError(400, 'intervalMin is a whole number of minutes (1 to 120)')
        return heartbeat.set({ enabled: typeof r.body.enabled === 'boolean' ? r.body.enabled : undefined, intervalMin: typeof r.body.intervalMin === 'number' ? r.body.intervalMin : undefined })
      },
    ],
    ['POST', /^\/heartbeat\/beat$/, async () => {
        await heartbeat.beat()
        return heartbeat.state()
      }],
    ['GET', /^\/floors$/, (_, r) => answerFloors(callerOf(r), r.query.get('scope')), 'local'],
    // F-127: this PC's setting for new chats while the Server is down, and how the floors made then are joining the Server's list.
    ['GET', /^\/offline-chats$/, () => offlineAnswer(), 'local'],
    // F-211: how far each chat's conversation is in the CRM drive's "Conversations" (the owner's: it names every chat and folder).
    ['GET', /^\/conversations-drive$/, () => conversations.status(), 'local'],
    // F-134: Codex on this PC.
    ['GET', /^\/opencode\/status$/, () => openCode.status(), 'local'],
    ['GET', /^\/codex\/status$/, () => codexAnswer(), 'local'],
    // F-165: what Codex in Claude Code needs on this PC and on each PC within reach, read-only.
    ['GET', /^\/dependencies$/, () => dependenciesAnswer(), 'local'],
    // F-168 part 2: every MCP server on each PC within reach, and the register-only install. A signed-in app administrator only (the CRM cookie).
    ['GET', /^\/mcp-inventory$/, (_, r) => (requireCrmHuman(o.auth, r, true), mcpInventoryAnswer()), 'local'],
    ['POST', /^\/mcp-install\/plan$/, (_, r) => (requireCrmHuman(o.auth, r, true), mcpPlanAnswer(r.body)), 'local'],
    ['POST', /^\/mcp-install$/, (_, r) => (requireCrmHuman(o.auth, r, true), mcpApply('register', r.body)), 'local'],
    ['POST', /^\/mcp-remove$/, (_, r) => (requireCrmHuman(o.auth, r, true), mcpApply('remove', r.body)), 'local'],
    ['POST', /^\/codex\/refresh$/, async () => {
        await o.codex?.check()
        return codexAnswer()
      }, 'local'],
    ['GET', /^\/codex\/settings$/, () => ({ enabled: true }), 'local'],
    ['PUT', /^\/codex\/settings$/, (_, r) => retireCodexSettings(r), 'local'],
    ['PUT', /^\/offline-chats$/, (_, r) => setOfflineChats(r.body, r), 'local'],
    // Stage 1 (o400b): the "Old way" switch of this PC's chat-terminal layer (Web's Settings › Chats).
    ['GET', /^\/sync-mode$/, () => syncModeAnswer(), 'local'],
    ['POST', /^\/sync-mode$/, (_, r) => setSyncMode(r.body, r), 'local'],
    ['GET', /^\/sessions$/, (_, r) => sessions(r), 'local'],
    ['GET', /^\/sessions\/copy-all$/, () => ({ job: copyAll }), 'local'],
    [
      'POST',
      /^\/sessions\/copy-all$/,
      (_, r) => {
        if (!isObject(r.body) || typeof r.body.pc !== 'string') throw apiError(400, 'Expected {pc}')
        return { job: startCopyAll(r.body.pc) }
      },
      'local',
    ],
    ['POST', /^\/floors$/, (_, r) => ({ floor: floors.create(isObject(r.body) && typeof r.body.name === 'string' ? r.body.name : undefined, access.ownerOf(callerOf(r))) })],
    // Order oa09e: the overlay asks for its Assistant here (a member passes it on: the hub decides, from its whole list). His only (POLICY).
    ['POST', /^\/assistant$/, (_, r) => ensureHubAssistant(r.body, access.ownerOf(callerOf(r)))],
    // oc65c: the caller chooses a saved binding of their OWN Assistant, never a filesystem path or another person.
    ['GET', /^\/assistant-history$/, (_, r) => {
      const index = assistantHistory(callerOf(r))
      const id = r.query.get('source')
      if (!id) return index
      const source = index.sources.find(s => s.id === id)
      if (!source) throw apiError(404, 'That conversation is not part of your Assistant or Quick history.')
      if (!source.available || !source.file) throw apiError(404, 'The saved conversation is unavailable on this PC. Its binding is kept, not replaced by an empty session.')
      return readAssistantHistory(source.file, Number(r.query.get('offset') ?? 0), r.query.get('view') === 'jsonl')
    }],
    // Order o7e6d (H2, S1): every unsafe staff Assistant run and the fence record's own problems (staffPreflight), read only, the owner's only
    // (agent/agentic/access.ts: OWNER; a member's page asks the Server, which sees every PC). Empty, with sign-in on, before staff access opens.
    ['GET', /^\/staff\/preflight$/, () => ({ unsafe: staffPreflight() })],
    // F-162 slice A: a person's own Assistant floor ("My Assistant", their boss), made on their first open. Feature 'assistant' (shared/access.ts ROUTES).
    ['GET', /^\/own-assistant$/, (_, r) => ({ floor: ownAssistantFloor(floors.list(), callerOf(r).person?.id ?? '')?.id ?? null })],
    [
      'POST',
      /^\/own-assistant$/,
      (_, r) => {
        const c = callerOf(r)
        if (!c.person) throw apiError(400, 'Sign in first.')
        const have = ownAssistantFloor(floors.list(), c.person.id)
        if (have) return { floor: have.id, created: false }
        // F-162 slice B: its boss is that person's Assistant (duty 'person-assistant', never the hub's Orchestrator).
        const made = floors.create(OWN_ASSISTANT_FLOOR, access.ownerOf(c))
        const boss = made.agents.find(a => a.isBoss) ?? made.agents[0]
        // Order o7e6d (Lead, 15 Nov): a staff member's new Assistant is native Claude by the Server's own rule, its engine set here, never the PC's
        // default engine (Codex, OpenCode). Not an administrator's own (it is an owner's chat and follows the defaults as every other does). Only a
        // new one: an existing Assistant's record is never switched (an incompatible one is refused when it opens, before any seal).
        if (!access.isAdmin(c)) floors.patch(made.id, { agents: made.agents.map(a => (a.id === boss.id ? { ...a, engine: 'claude' as const } : a)) }, access.ownerOf(c))
        return { floor: floors.setPersonAssistantDuty(made.id, boss.id, access.ownerOf(c)).id, created: true }
      },
    ],
    [
      'POST',
      /^\/floors\/reorder$/,
      (_, r) => {
        if (!isObject(r.body) || !Array.isArray(r.body.order) || r.body.order.some(x => typeof x !== 'string')) throw apiError(400, 'Expected {order: [floor ids]}')
        return { floors: floors.reorder(r.body.order as string[]) }
      },
    ],
    ['PATCH', /^\/floors\/([^/]+)$/, ([id], r) => {
      // R1b: a chart that would change WHICH agents are on a personal Assistant's floor is refused the same as an add or a drop is below; a
      // rename, or a chart naming the exact same agents, passes (agentListChanges decides; anything ambiguous counts as a change).
      const before = floorOf(id)
      if (isObject(r.body) && r.body.agents !== undefined && agentListChanges(before.agents, r.body.agents)) refuseAssistantFloorChange(callerOf(r), before)
      return patchFloor(id, r.body, access.ownerOf(callerOf(r)))
    }],
    [
      // F-067: Settings › Chats: what an agent set to Default gets. Read from this PC's copy; changed on the hub.
      'GET',
      /^\/defaults$/,
      () => ({ defaults: defaultsNow() }),
      'local',
    ],
    ['PUT', /^\/defaults$/, (_, r) => {
      if (isObject(r.body) && typeof r.body.engine === 'string' && ['', 'claude', 'codex', 'opencode'].includes(r.body.engine) &&
        engineOf(r.body.engine as AgentEngine, '') !== engineOf(defaultsNow().engine, '') &&
        allFloors().some(f => f.agents.some(a => !a.engine && a.sessionId))) {
        throw Object.assign(apiError(409, 'Some existing conversations follow the default engine. Choose an explicit engine for those agents with conversation carry-over before changing the default.'), { code: 'engine-change-conversion-failed' })
      }
      return { defaults: chatDefaults.set(r.body) }
    }],
    // Settings › Assistant: "Goals on mobile: use the API". Kept on the hub: a member's page asks the hub (not 'local').
    ['GET', /^\/assistant-settings$/, () => ({ settings: assistantSettings.get() })],
    ['PUT', /^\/assistant-settings$/, (_, r) => ({ settings: assistantSettings.set(r.body) })],
    // Order o5007: Settings › Old app reader: the switch and the model (the hub's, so every device agrees) and the old app's folder it reads.
    // Switched off, its process ends and its socket is refused (the /old page, its menu entry and Alt+O go too); on again, it is back.
    ['GET', /^\/old\/settings$/, () => oldInfo()],
    [
      'PUT',
      /^\/old\/settings$/,
      (_, r) => {
        const was = oldStore.get()
        const now = oldStore.set(r.body)
        if (!now.enabled && was.enabled) stopOldReader('switched off in Settings')
        return oldInfo()
      },
    ],
    // Order o7f34: the Anthropic API key for the efficient route. Saved here, encrypted; the answer says only whether one is saved and when (the
    // key is never sent back, never logged, and no error names it). Test makes one tiny call with it and says the plain result.
    ['PUT', /^\/old\/api-key$/, (_, r) => (modelKeys.set(isObject(r.body) ? r.body.key : undefined), oldInfo())],
    ['DELETE', /^\/old\/api-key$/, () => (modelKeys.clear(), oldInfo())],
    [
      'POST',
      /^\/old\/api-key\/test$/,
      async () => {
        const key = modelKeys.use()
        if (!key) throw apiError(409, 'No API key is saved yet. Save one first.')
        try {
          const t = await testKey({ key, model: API_MODEL_IDS.haiku, ...(o.oldReader?.anthropicFetch ? { fetch: o.oldReader.anthropicFetch } : {}) })
          return { ok: true, ms: t.ms, message: `The API answered in ${(t.ms / 1000).toFixed(1)} s.` }
        } catch (e) {
          if (e instanceof ApiFailure) return { ok: false, ms: null, message: apiWords(e.kind) }
          throw e
        }
      },
    ],
    // Forwarded on members: an old hub must answer 404, rather than a new member promising safety for it.
    ['GET', /^\/engine-switch-capabilities$/, () => ({ version: 1, failClosed: true, homePcRouting: true })],
    // F-067: the long-press menu: an agent's model, effort and ultracode, applied now to a chat that waits.
    ['POST', /^\/floors\/([^/]+)\/agents\/([^/]+)\/tune$/, ([id, agentId], r) => tuneAgent(id, agentId, r.body, callerOf(r))],
    // F-076: human-only. Answer a waiting chat's prompt from one place; say something as the person. Never a chat's key (it has no route here).
    // o0c50: ?scope=mine (the default) | all | floor:<id> (shared/question-routing.ts); anything else is refused, never widened.
    ['GET', /^\/approvals$/, (_, r) => {
      humanOnly(r)
      const scope = parseApprovalsScope(r.query.get('scope'))
      if (!scope) throw apiError(400, 'scope is mine, all or floor:<id>')
      return listApprovals(r, scope)
    }, 'local'],
    ['POST', /^\/approvals\/answer$/, (_, r) => (humanOnly(r), answerApproval(r.body, byOf(r), r)), 'local'],
    ['POST', /^\/approvals\/cancel$/, (_, r) => (humanOnly(r), cancelApproval(r.body, byOf(r), r)), 'local'],
    // F-294 (his o8c55): Ignore and Restore on a card, and the read of what a person has ignored (the badge). Human-only exactly as Cancel is (humanOnly first: a chat's key is 403, the open app 401);
    // nothing is ever typed into a chat. Left as they are, by Lead's ruling: the heartbeat line, Quick's snapshot and the Assistant's approvals_waiting still count an ignored prompt.
    ['POST', /^\/approvals\/ignore$/, (_, r) => (humanOnly(r), ignoreApproval(r.body, byOf(r), r)), 'local'],
    ['POST', /^\/approvals\/restore$/, (_, r) => (humanOnly(r), restoreApproval(r.body, byOf(r), r)), 'local'],
    ['GET', /^\/approvals\/ignored$/, (_, r) => (humanOnly(r), listIgnored(r)), 'local'],
    ['POST', /^\/send-as-me$/, (_, r) => (humanOnly(r), sendAsMe(r.body, byOf(r), r)), 'local'],
    // F-221 (ob98a): live talk, the owner's page only (POLICY), never a chat's key nor the fast Assistant's. The cards wait for his tap, and Send
    // takes his signed-in CRM session as the approvals do; the direct line types his spoken words untapped, with the Orchestrator's tools held.
    // The hub's own: a member answers itself (no cards there; Send says to sign in on the Server's page; the direct line says hub only).
    ['GET', /^\/talk\/cards$/, (_, r) => (talkPage(r), { cards: talkCards.list() }), 'local'],
    ['POST', /^\/talk\/cards\/([^/]+)\/send$/, ([id], r) => sendTalkCard(id, r.body, r), 'local'],
    ['POST', /^\/talk\/cards\/([^/]+)\/drop$/, ([id], r) => (talkPage(r), { ok: true, dropped: talkCards.dropCard(id, 'dropped') }), 'local'],
    ['POST', /^\/talk\/ask$/, (_, r) => talkAsk(r.body, r), 'local'],
    ['GET', /^\/talk\/ask\/([^/]+)$/, ([id], r) => talkAskView(id, r), 'local'],
    // F-221 (T4): his Let go (his CRM session, as Send), and whether the Orchestrator runs with the voice lock (the page offers the direct line only then).
    ['POST', /^\/talk\/ask\/([^/]+)\/let-go$/, ([id], r) => talkLetGo(id, r), 'local'],
    ['GET', /^\/talk\/caps$/, (_, r) => (talkPage(r), { holds: true, voiceLock: voiceLockNow() }), 'local'],
    ['GET', /^\/auto-update$/, (_, r) => (humanOnly(r), withRun(autoUpdate.read(), o.updateRun?.() ?? null))],
    ['POST', /^\/auto-update$/, (_, r) => (humanOnly(r), setAutoUpdate(r.body, byOf(r), r))],
    ['GET', /^\/approvals\/devices$/, () => retiredApprovalDevices()],
    ['POST', /^\/approvals\/devices\/code$/, () => retiredApprovalDevices()],
    ['POST', /^\/approvals\/devices\/register$/, () => retiredApprovalDevices()],
    ['GET', /^\/approvals\/devices\/recover$/, () => retiredApprovalDevices()],
    ['POST', /^\/approvals\/devices\/recover\/start$/, () => retiredApprovalDevices()],
    ['POST', /^\/approvals\/devices\/recover\/finish$/, () => retiredApprovalDevices()],
    ['POST', /^\/approvals\/devices\/remove$/, () => retiredApprovalDevices()],
    ['POST', /^\/approvals\/devices\/unsigned$/, () => retiredApprovalDevices()],
    // o66aa / o7e97: with the answers given whose record could not be written (who, which prompt, what they chose), since this run.
    ['GET', /^\/approvals\/log$/, (_, r) => (humanOnly(r), { entries: approvalLog.list(Math.min(500, Number(r.query.get('limit')) || 100)), ...(unrecorded.length ? { unrecorded } : {}) })],
    // The floors' structural history (floor-events.ts): newest first, with the changes whose line could not be written since this run started. The owner's only
    // (POLICY; no ROUTES rule opens it to anyone else) AND a signed-in human's (humanOnly: R6): a chat's key, the app token alone (a program on this PC, an Assistant's shell) and a member
    // PC's pass-on (which carries no cookie) are refused, so what the record says cannot be read by a tool; it is read on the Server's own page.
    ['GET', /^\/floor-events$/, (_, r) => (humanOnly(r), { events: floorEventLog.list(Math.min(500, Number(r.query.get('limit')) || 100)), ...(unrecordedFloorEvents.length ? { unrecorded: unrecordedFloorEvents } : {}) })],
    // Who was present at a chat (chat-presence.ts): newest first, with the lines that could not be written since this run started, and WHAT THE RECORD DOES NOT COVER (`notRecorded`, a
    // constant: an empty stretch is "nothing listed as recorded", never "nothing happened"). The owner's only (POLICY; no ROUTES rule) AND a signed-in human's (humanOnly: R6, as floor-events above).
    ['GET', /^\/chat-presence$/, (_, r) => (humanOnly(r), { presence: presence.list(Math.min(500, Number(r.query.get('limit')) || 100)), notRecorded: NOT_RECORDED, ...(presence.unrecorded().length ? { unrecorded: presence.unrecorded() } : {}) })],
    // F-297: what a person's own Assistant sent and where, NEVER the text (staff-sends.ts): newest first, what the record does not cover (`notRecorded`, a constant), and the lines that could not be written since this run
    // started. The owner's only: an OWNER row in POLICY AND humanOnly from the start (a chat's key, even the owner's own chat's, is refused, as is a program with only the app's token).
    ['GET', /^\/staff-sends$/, (_, r) => (humanOnly(r), { sends: staffSends.list(Math.min(500, Number(r.query.get('limit')) || 100)), notRecorded: STAFF_SEND_NOT_RECORDED, ...(staffSends.unrecorded().length ? { unrecorded: staffSends.unrecorded() } : {}) })],
    [
      'DELETE',
      /^\/floors\/([^/]+)$/,
      ([id], r) => {
        const f = floorOf(id)
        for (const a of f.agents) if (a.sessionId) stopAnywhere(a.sessionId)
        floors.remove(id, access.ownerOf(callerOf(r)))
        memory.drop(id)
        return { ok: true }
      },
    ],
    [
      'POST',
      /^\/floors\/([^/]+)\/agents$/,
      ([id], r) => {
        const b = isObject(r.body) ? r.body : {}
        if (b.model !== undefined && !(AGENT_MODELS as readonly unknown[]).includes(b.model)) throw apiError(400, 'model is opus, sonnet or haiku')
        // R1b: an add to a personal Assistant's floor is refused the same as agent_hire's.
        refuseAssistantFloorChange(callerOf(r), floorOf(id))
        return floors.addAgent(id, b as NewAgent, access.ownerOf(callerOf(r)))
      },
    ],
    [
      'POST',
      /^\/floors\/([^/]+)\/agents\/([^/]+)\/move$/,
      ([id, agentId], r) => {
        // F-033: dragged: reordered on its floor, or onto another (its chat goes on as it is).
        const b = isObject(r.body) ? r.body : {}
        const to = typeof b.floorId === 'string' && b.floorId ? b.floorId : id
        // R1b: onto another floor changes BOTH floors' agent lists (a same-floor reorder changes neither, so it is not guarded).
        if (to !== id) { const c = callerOf(r); refuseAssistantFloorChange(c, floorOf(id)); refuseAssistantFloorChange(c, floorOf(to)) }
        return floors.moveAgent(id, agentId, to, typeof b.before === 'string' ? b.before : null, access.ownerOf(callerOf(r)))
      },
    ],
    [
      // F-118: who a chat is shared with: the whole list, each person 'view' or 'type'. The owner's or sbskrrt's (the rule says so).
      'POST',
      /^\/floors\/([^/]+)\/agents\/([^/]+)\/share$/,
      ([id, agentId], r) => shareChat(id, agentId, r.body, callerOf(r)),
    ],
    ['POST', /^\/floors\/([^/]+)\/import$/, ([id], r) => importChat(id, r.body, access.ownerOf(callerOf(r)), r), 'local'],
    ['POST', /^\/floors\/([^/]+)\/agents\/([^/]+)\/chat$/, ([id, agentId], r) => {
      const body = r.body
      if (isObject(body) && ['executionVersion', 'openIntentId', 'expectedExecution'].some(k => Object.hasOwn(body, k))) {
        const request = requireExecutionOpenRequest(r.body), agent = workflowExecutionAgent(id, agentId)
        assertExecutionCAS(request.expectedExecution, snapshotAgentExecution(agent, defaultsNow()))
        if (!executionService) throw executionHttpError('execution-capability-required', 'open', request.openIntentId)
        return executionService.open(executionScope(id, agentId, r), request)
      }
      // Order o7e6d (plan A, Lead's GO): a never-run staff Assistant of the Server's, opened from this member PC's page, is opened BY the Server.
      if (mode() === 'member' && !isLocalFloor(id) && staffFreshHere(id, agentId)) return forwardFirstOpen(id, agentId, r)
      return openChat(id, agentId, openRequest(r.body), undefined, undefined, actorOfCaller(callerOf(r)))
    }, 'local'],
    [
      'POST',
      /^\/floors\/([^/]+)\/agents\/([^/]+)\/run-on$/,
      async ([id, agentId], r) => {
        // F-025, Run on; F-064, Switch computer: the chat moved to the PC named (taken over there, from wherever it
        // runs), and that PC is its home from then on. A member asks the hub, which can reach every PC.
        const pc = (isObject(r.body) && typeof r.body.pc === 'string' ? r.body.pc : '') || self().id
        // A message to type once it is up (a message sent to a stopped chat that lives on another PC).
        const say = isObject(r.body) && typeof r.body.say === 'string' ? r.body.say.slice(0, MAX_SAY_TEXT) : undefined
        if (mode() === 'member') return await request<ChatOpened>(needHub(), 'http', { method: 'POST', rest: `/floors/${enc(id)}/agents/${enc(agentId)}/run-on`, body: { pc, say } }, 60_000)
        const agent = agentOf(floorOf(id), agentId)
        // F-302 (Agent 14's L2): a message typed with the start IS typing: it needs the typing right on the chat as it will be, on the PC it is asked to run on (a chat that runs on the Server now counts as the
        // Server's even while it moves). A start without words stays the owner's, as the route table says.
        if (say) access.needChat(callerOf(r), { ...agent, homePc: pc }, 'type', 'run-on with a message')
        if (engineFor(agent) === 'opencode' && agent.opencodeSession && agent.homePc && agent.homePc !== pc) throw apiError(409, 'OpenCode conversations resume on their home PC. Switch engines to carry the conversation to another PC.')
        let opened: ChatOpened
        let name = self().name
        if (pc === self().id) {
          opened = await openChat(id, agentId, { takeOver: true, here: true }, undefined, undefined, actorOfCaller(callerOf(r)))
          if (say && opened.started) chats.typeWhenReady(opened.sessionId, say)
        } else {
          const link = mode() === 'hub' ? (team?.member(pc) ?? null) : null
          if (!link) throw apiError(HOME_OFFLINE_STATUS, `${homeName(agent, pc)} can't be reached right now, so ${agent.name}'s chat can't move there.`)
          name = link.name
          opened = { ...(await openOnPeer(link, floorOf(id), agent, say)), on: link.name }
        }
        if (mode() === 'hub') floors.setHome(id, agentId, { id: pc, name })
        return opened
      },
      'local',
    ],
    [
      'POST',
      /^\/floors\/([^/]+)\/agents\/([^/]+)\/terminate$/,
      ([id, agentId]) => {
        const a = agentOf(floorOf(id), agentId)
        if (!a.sessionId) return { killed: false }
        heartbeat.stoppedOnPurpose(a.sessionId) // F-078: his own stop: the heartbeat leaves it alone
        if (chats.info(a.sessionId)) return { killed: chats.kill(a.sessionId) }
        const running = !!whereAll()[a.sessionId]
        stopAnywhere(a.sessionId)
        return { killed: running }
      },
    ],
    [
      'POST',
      /^\/floors\/([^/]+)\/agents\/([^/]+)\/restart$/,
      async ([id, agentId], r) => {
        // Claude subscription failover: this agent's chat, running on the hub, stopped gently (told /exit) and started
        // again on the token in place now, its conversation resumed (restartChat above). A member's call goes to the hub.
        // The start line names whoever made THIS call (a person's Restart is not "the app"); the failover and the other internal callers keep the default, the app.
        const a = agentOf(floorOf(id), agentId)
        if (!a.sessionId || !chats.info(a.sessionId)) return { sessionId: a.sessionId, restarted: false }
        return { sessionId: a.sessionId, restarted: await restartChat(a.sessionId, actorOfCaller(callerOf(r))) }
      },
    ],
    [
      'POST',
      /^\/floors\/([^/]+)\/agents\/([^/]+)\/session$/,
      ([id, agentId], r) => {
        if (!isObject(r.body) || typeof r.body.sessionId !== 'string') throw apiError(400, "Expected {sessionId}, '' to unbind")
        const floor = floorOf(id)
        const a = agentOf(floor, agentId)
        const next = r.body.sessionId.trim()
        if (keepsAssistantHistory(a) && a.sessionId && next !== a.sessionId) {
          if (next) throw apiError(409, 'The Assistant keeps its conversation when closed. Replacing its session here is refused; use a checked engine conversion to carry history.')
          stopAnywhere(a.sessionId)
          return { floor, hasTranscript: !!historyFile(a.sessionId), preserved: true }
        }
        if (a.sessionId && a.sessionId !== next) stopAnywhere(a.sessionId)
        const after = floors.bindSession(id, agentId, next || null)
        return { floor: after, hasTranscript: next ? !!findTranscript(next, projectsDir) : false }
      },
    ],
    [
      'GET',
      /^\/floors\/([^/]+)\/agents\/([^/]+)\/messages$/,
      ([id, agentId]) => {
        const a = agentOf(floorOf(id), agentId)
        if (!a.sessionId) return { sessionId: null, messages: [] }
        const file = findTranscript(a.sessionId, projectsDir)
        return { sessionId: a.sessionId, messages: file ? readTranscriptFile(file) : [] }
      },
      'local',
    ],
    // Order obb81 (the Agents page, /agent-directory): one agent's floor notes, its Claude project folder's memory files and its last few replies,
    // read-only, secrets masked (agent-brain.ts). The owner's only: OWNER in access.ts POLICY and in no shared/access.ts ROUTES rule. 'local':
    // read where its conversation is kept.
    [
      'GET',
      /^\/floors\/([^/]+)\/agents\/([^/]+)\/brain$/,
      ([id, agentId]) => {
        const floor = floorOf(id)
        return readAgentBrain(agentOf(floor, agentId), memory.all(floor.id), projectsDir)
      },
      'local',
    ],
    [
      'GET',
      /^\/floors\/([^/]+)\/transcripts$/,
      ([id], r) => {
        const out: Record<string, { exists: boolean; bytes: number }> = {}
        const seen = access.visible(callerOf(r), allFloors())
        for (const a of floorOf(id).agents) {
          if (!a.sessionId || (seen && !seen.has(a.sessionId))) continue
          const file = findTranscript(a.sessionId, projectsDir)
          out[a.id] = file ? { exists: true, bytes: statSync(file).size } : { exists: false, bytes: 0 }
        }
        return { transcripts: out }
      },
      'local',
    ],
    // F-056: the task list. The hub keeps it, so a member passes these on (no `local`), like the floors.
    ['GET', /^\/tasks$/, (_, r) => answerTasks(r.query)],
    [
      'POST',
      /^\/tasks$/,
      async (_, r) => {
        const body = isObject(r.body) ? r.body : {}
        return { task: await tasks.add({ text: taskText(body.text), id: taskId(body.id), by: { kind: 'you', name: null, floor: null } }) }
      },
    ],
    ['PATCH', /^\/tasks\/([^/]+)$/, async ([id], r) => ({ task: await tasks.update(id, taskPatch(r.body)) })],
    ['DELETE', /^\/tasks\/([^/]+)$/, async ([id]) => ({ task: await tasks.update(id, { deleted: true }) })],
    // F-054: where the CRM's website is, and whether it can be shown. The hub keeps it; a member passes these on.
    ['GET', /^\/crm$/, (_, r) => answerCrm(r.query, r.query.get('fresh') === '1')],
    [
      'PATCH',
      /^\/crm$/,
      async (_, r) => {
        if (!isObject(r.body) || (!('url' in r.body) && !('mode' in r.body))) throw apiError(400, 'Expected {url?, mode?}')
        crm.set({
          ...('url' in r.body ? { url: crmAddress(r.body.url) } : {}),
          ...('mode' in r.body ? { mode: crmMode(r.body.mode) } : {}),
        })
        crmChecked = null
        return answerCrm(r.query, true)
      },
    ],
    // Whether the CRM is signed in on THIS PC (the session is per PC, as Devices signs in): never the session itself.
    // Shubham's order o2f32: it names who is signed in to the CRM on this PC (his login), so a second owner does not read it (the first owner by id; the machine and the open app are the owner).
    ['GET', /^\/crm\/session$/, (_, r): CrmSessionInfo => (firstOwnerOnly(callerOf(r), 'GET /crm/session', "This is for the first owner of this app only: it is the PC's CRM sign-in."), crmProxy.session()), 'local'],
    // order o57e2, o4d14: the email accounts for the Accounts page's Email tab, from the new Supabase project: address, note, switched off, where used. Never a password. The owner's (POLICY).
    // Slice D (disable, never delete): `disabled=1` is the page's "Show disabled"; without it a disabled account is not in the list.
    ['GET', /^\/accounts\/email$/, (_, r) => accountsEmail.list(access.ownerOf(callerOf(r)).id, { disabled: r.query.get('disabled') === '1' }), 'local'],
    // Order ofd53: the email edit modal. The owner's only (POLICY); the database's rules check the owner again (accounts-email-write.ts).
    ['POST', /^\/accounts\/email$/, (_, r) => (humanOnly(r), accountsEmailWrite.create(access.ownerOf(callerOf(r)).id, r.body)), 'local'],
    ['PUT', /^\/accounts\/email\/([^/]+)$/, ([id], r) => (humanOnly(r), accountsEmailWrite.update(access.ownerOf(callerOf(r)).id, id, r.body)), 'local'],
    // Slice D: there is no delete anywhere on the Accounts page; an account is disabled and enabled again (the same humanOnly rule the delete had).
    ['POST', /^\/accounts\/email\/([^/]+)\/disable$/, ([id], r) => (humanOnly(r), accountsEmailWrite.disable(access.ownerOf(callerOf(r)).id, id)), 'local'],
    ['POST', /^\/accounts\/email\/([^/]+)\/enable$/, ([id], r) => (humanOnly(r), accountsEmailWrite.enable(access.ownerOf(callerOf(r)).id, id)), 'local'],
    // Order o8ebe: the password reveal (owner only; logged by the agent, never the password).
    // SLICE S (18 Nov): every email route that writes or returns a sealed password goes through humanOnly: "owner" says WHOSE data, not WHICH CALLER. A program holding only the app's token is a machine, a machine is an
    // administrator, and the owner of what a person-less caller makes is sbskrrt, so without humanOnly any process that could read the token was the owner. accounts-human-only.test.ts pins every such route.
    ['POST', /^\/accounts\/email\/([^/]+)\/reveal$/, ([id], r) => (humanOnly(r), accountsEmailWrite.reveal(access.ownerOf(callerOf(r)).id, id)), 'local'],
    // Accounts edit slice: the platform accounts (owner only; soft delete).
    // Add account (order oc35dc): a platform account made in the app, with its codebases (the owner's only; nothing is written to the CRM).
    ['POST', /^\/accounts\/platforms$/, (_, r) => accountsPlatformWrite.create(access.ownerOf(callerOf(r)).id, r.body), 'local'],
    ['PUT', /^\/accounts\/platforms\/([^/]+)$/, ([id], r) => accountsPlatformWrite.update(access.ownerOf(callerOf(r)).id, id, r.body), 'local'],
    ['POST', /^\/accounts\/platforms\/([^/]+)\/disable$/, ([id], r) => accountsPlatformWrite.disable(access.ownerOf(callerOf(r)).id, id), 'local'],
    ['POST', /^\/accounts\/platforms\/([^/]+)\/enable$/, ([id], r) => accountsPlatformWrite.enable(access.ownerOf(callerOf(r)).id, id), 'local'],
    // Codebase details slice: the codebase's details (owner only).
    ['PUT', /^\/accounts\/codebases\/([^/]+)$/, ([id], r) => accountsCodebaseWrite.update(access.ownerOf(callerOf(r)).id, id, r.body), 'local'],
    // Add codebase: a codebase made in the app (the owner's only; nothing is written to the CRM).
    ['POST', /^\/accounts\/codebases$/, (_, r) => accountsCodebaseWrite.create(access.ownerOf(callerOf(r)).id, r.body), 'local'],
    // Databases section: the two fixed databases (owner only); a ping checks one and says what it checked.
    ['GET', /^\/accounts\/databases$/, (_, r) => accountsDatabases.list(access.ownerOf(callerOf(r)).id), 'local'],
    ['POST', /^\/accounts\/databases\/([^/]+)\/ping$/, ([key], r) => accountsDatabases.ping(access.ownerOf(callerOf(r)).id, key), 'local'],
    // order o5c4d: "apply" false (the default) only counts and compares; true copies. Counts only come back, never a row. The owner's (POLICY).
    // The two imports read the CRM on THIS PC's saved sign-in (Shubham's): the first owner's by id, a second owner does not (his order o2f32).
    ['POST', /^\/accounts\/email\/import$/, (_, r) => (humanOnly(r), firstOwnerOnly(callerOf(r), 'POST /accounts/email/import', "This is for the first owner of this app only: it reads the CRM on the PC's sign-in."), accountsImport.run({ person: access.ownerOf(callerOf(r)).id, apply: isObject(r.body) && r.body.apply === true })), 'local'],
    // orders o0e2a, oc2db: the codebases for the Accounts page's Codebases tab (with their detail rows and platform accounts; no .env, no password). The owner's (POLICY).
    // order o4029: the platform accounts (the CRM's Code > Accounts page) with their codebases; no password, only that one is stored. The owner's (POLICY).
    ['GET', /^\/accounts\/platforms$/, (_, r) => accountsPlatforms.list(access.ownerOf(callerOf(r)).id, { disabled: r.query.get('disabled') === '1' }), 'local'],
    ['GET', /^\/accounts\/codebases$/, (_, r) => accountsCodebases.list(access.ownerOf(callerOf(r)).id), 'local'],
    // The copy from the CRM, counts only back; apply false (the default) only counts and compares. The owner's (POLICY).
    ['POST', /^\/accounts\/codebases\/import$/, (_, r) => (firstOwnerOnly(callerOf(r), 'POST /accounts/codebases/import', "This is for the first owner of this app only: it reads the CRM on the PC's sign-in."), codebaseImport.run({ person: access.ownerOf(callerOf(r)).id, apply: isObject(r.body) && r.body.apply === true })), 'local'],
    // Order ocf00: the codebase tabs. The owner's only (POLICY); every write is checked by the database's rules too (codebase-tabs.ts).
    // Order o94f3 (Shubham: values are never for agents, Assistants or chats): everything that reads or writes a VARIABLE (the tabs read, the sets, the variables, the reveal, the "+" and the paste box) is also
    // humanOnly: his own signed-in page session, never a chat's key and never a program that has only the app's token. A chat sees names and counts through the list; nothing here.
    ['GET', /^\/accounts\/codebases\/([^/]+)\/tabs$/, ([id], r) => (humanOnly(r), codebaseTabs.read(access.ownerOf(callerOf(r)).id, id, { disabled: r.query.get('disabled') === '1' })), 'local'],
    ['PUT', /^\/accounts\/codebases\/([^/]+)\/sections\/([^/]+)$/, ([id, section], r) => codebaseTabs.setSection(access.ownerOf(callerOf(r)).id, id, section, isObject(r.body) ? r.body.description : undefined), 'local'],
    ['POST', /^\/accounts\/codebases\/([^/]+)\/links$/, ([id], r) => codebaseTabs.addLink(access.ownerOf(callerOf(r)).id, id, r.body), 'local'],
    ['PUT', /^\/accounts\/links\/([^/]+)$/, ([id], r) => codebaseTabs.updateLink(access.ownerOf(callerOf(r)).id, id, r.body), 'local'],
    ['POST', /^\/accounts\/links\/([^/]+)\/disable$/, ([id], r) => codebaseTabs.disableLink(access.ownerOf(callerOf(r)).id, id), 'local'],
    ['POST', /^\/accounts\/links\/([^/]+)\/enable$/, ([id], r) => codebaseTabs.enableLink(access.ownerOf(callerOf(r)).id, id), 'local'],
    ['POST', /^\/accounts\/codebases\/([^/]+)\/subsets$/, ([id], r) => (humanOnly(r), codebaseTabs.addSubset(access.ownerOf(callerOf(r)).id, id, isObject(r.body) ? r.body.name : undefined)), 'local'],
    ['PUT', /^\/accounts\/subsets\/([^/]+)$/, ([id], r) => (humanOnly(r), codebaseTabs.renameSubset(access.ownerOf(callerOf(r)).id, id, isObject(r.body) ? r.body.name : undefined)), 'local'],
    ['POST', /^\/accounts\/subsets\/([^/]+)\/disable$/, ([id], r) => (humanOnly(r), codebaseTabs.disableSubset(access.ownerOf(callerOf(r)).id, id)), 'local'],
    ['POST', /^\/accounts\/subsets\/([^/]+)\/enable$/, ([id], r) => (humanOnly(r), codebaseTabs.enableSubset(access.ownerOf(callerOf(r)).id, id)), 'local'],
    ['POST', /^\/accounts\/subsets\/([^/]+)\/vars$/, ([id], r) => (humanOnly(r), codebaseTabs.addVar(access.ownerOf(callerOf(r)).id, id, r.body)), 'local'],
    ['PUT', /^\/accounts\/vars\/([^/]+)$/, ([id], r) => (humanOnly(r), codebaseTabs.updateVar(access.ownerOf(callerOf(r)).id, id, r.body)), 'local'],
    ['POST', /^\/accounts\/vars\/([^/]+)\/disable$/, ([id], r) => (humanOnly(r), codebaseTabs.disableVar(access.ownerOf(callerOf(r)).id, id)), 'local'],
    ['POST', /^\/accounts\/vars\/([^/]+)\/enable$/, ([id], r) => (humanOnly(r), codebaseTabs.enableVar(access.ownerOf(callerOf(r)).id, id)), 'local'],
    ['POST', /^\/accounts\/vars\/([^/]+)\/reveal$/, ([id], r) => (humanOnly(r), codebaseTabs.reveal(access.ownerOf(callerOf(r)).id, id)), 'local'],
    // Order o94f3 "show all": every value of one set in one call, for his own tap (or his device setting); humanOnly like reveal, logged as a count only.
    ['POST', /^\/accounts\/subsets\/([^/]+)\/reveal$/, ([id], r) => (humanOnly(r), codebaseTabs.revealSet(access.ownerOf(callerOf(r)).id, id)), 'local'],
    // Order o94f3: the Env tab's "+" and its ".env" paste box: one call adds one variable or many to the set named in the body (made when it is not there yet). Names and counts only come back.
    ['POST', /^\/accounts\/codebases\/([^/]+)\/env$/, ([id], r) => (humanOnly(r), codebaseTabs.addEnv(access.ownerOf(callerOf(r)).id, id, r.body)), 'local'],
    // F-050: the chat view. History pages and previews read this PC's copy of a conversation.
    [
      'GET',
      /^\/floors\/([^/]+)\/agents\/([^/]+)\/chat$/,
      ([id, agentId], r) => {
        const a = agentOf(floorOf(id), agentId)
        const before = Number(r.query.get('before'))
        if (!a.sessionId || !Number.isFinite(before)) return { items: [], before: null }
        return chatFeeds.history(a.sessionId, before, Number(r.query.get('limit')) || undefined)
      },
      'local',
    ],
    [
      'GET',
      /^\/previews$/,
      (_, r): PreviewsAnswer => {
        const previews: PreviewsAnswer['previews'] = {}
        const seen = access.visible(callerOf(r), allFloors())
        for (const f of allFloors()) {
          for (const a of f.agents) {
            if (seen && (!a.sessionId || !seen.has(a.sessionId))) continue
            const p = a.sessionId ? chatFeeds.preview(a.sessionId) : null
            if (p) previews[a.id] = p
          }
        }
        return { previews }
      },
      'local',
    ],
    [
      // F-062: what each chat really runs on (its conversation file says), for the chips on every chat.
      'GET',
      /^\/runs$/,
      (_, r): RunsAnswer => {
        const live = chats.states()
        const runs: Record<string, ChatRun> = {}
        let inherited: { model: string; mtimeMs: number } | null = null
        // One copy of the floors per request (it was two here, and two more per agent through bySession: the profile of 16 Nov). access.visible only reads it.
        const all = allFloors()
        const seen = access.visible(callerOf(r), all)
        for (const f of all) {
          for (const a of f.agents) {
            if (seen && (!a.sessionId || !seen.has(a.sessionId))) continue
            const file = a.sessionId ? findTranscript(a.sessionId, projectsDir) : null
            const r = file ? readFileRun(file) : null
            const l = a.sessionId && live[a.sessionId] !== undefined ? launched.get(a.sessionId) : undefined
            if (!r && !l) continue
            runs[a.id] = {
              model: r?.model ?? null,
              effort: r?.effort ?? null,
              effortAt: r?.effortAt ?? null,
              launchedEffort: l?.effort ?? null,
              startedAt: l?.at ?? null,
              ultracode: r?.ultracode ?? null,
              ultracodeAt: r?.ultracodeAt ?? null,
              launchedUltracode: l?.ultracode ?? null,
            }
            // A chat that chose its own model shows what the CLI chose: the newest of them says what the default is.
            if (!a.model && !defaultsNow().model && r?.model && (!inherited || r.mtimeMs > inherited.mtimeMs)) inherited = { model: r.model, mtimeMs: r.mtimeMs }
          }
        }
        const defaultModel: DefaultModel | null = configuredModel() ?? (inherited ? { model: inherited.model, from: 'a chat that inherited it' } : null)
        return { runs, defaultModel, defaults: defaultsNow() }
      },
      'local',
    ],
    [
      'POST',
      /^\/floors\/([^/]+)\/agents\/([^/]+)\/say$/,
      ([id, agentId], r): Promise<SayAnswer> => {
        const body = text(isObject(r.body) ? r.body.text : undefined, 'text', MAX_SAY_TEXT)
        // F-118: typing into a chat that is running is for whoever may type; starting a stopped one is the owner's.
        const a = agentOf(floorOf(id), agentId)
        if (!(a.sessionId && whereAll()[a.sessionId]) && access.rights(callerOf(r), a)?.can !== 'owner') {
          access.deny(callerOf(r), `POST say`, a.sessionId)
          throw authError(403, 'That chat is not running, and only its owner can start it.', 'not-yours')
        }
        return sayTo(id, agentId, body, sayIntent(r.body), callerOf(r))
      },
    ],
    [
      // Settings > Chats > direct send (default off, per person and device): the OLD way. Exactly one typeInto{human,confirmed:false} into a
      // RUNNING native Claude chat: one paste, one Enter, no receipt, no fence, no confirmation, no retry. It never starts or resumes a chat and
      // never answers for a Codex-in-Claude bridge chat (guardWorkflowExecution + requireMessageExecution refuse that profile); the same
      // access rule as /say (chat('type')), the captured session must still be the chat's, and an engine switch in progress refuses it.
      'POST',
      /^\/floors\/([^/]+)\/agents\/([^/]+)\/say-direct$/,
      async ([id, agentId], r): Promise<SayDirectAnswer> => {
        const caller = callerOf(r), body = text(isObject(r.body) ? r.body.text : undefined, 'text', MAX_SAY_TEXT)
        const expected = isObject(r.body) ? r.body.expectedSessionId : undefined
        if (typeof expected !== 'string' || !validTransferSid(expected)) throw apiError(400, 'expectedSessionId must be the captured session ID')
        const refuse = (status: number, code: string, words: string) => Object.assign(apiError(status, words), { code })
        const agent = agentOf(floorOf(id), agentId)
        access.needChat(caller, agent, 'type', 'direct send')
        requireLegacyExecution(agent, defaultsNow())
        if (executionIdentityOf(agent, defaultsNow()).engine !== 'claude') throw refuse(409, 'direct-send-unsupported', 'Direct send is only for native Claude chats.')
        if (agent.sessionId !== expected) throw refuse(409, 'stale-session', 'This chat changed since the page captured it. Nothing was typed.')
        const live = whereAll()[expected]
        if (!live) throw refuse(409, 'not-running', "This chat isn't running. Resume it first: a direct send never starts one. Nothing was typed.")
        if (switchFences.blocked(expected)) throw refuse(409, 'switch-in-progress', 'This chat is changing engines. Nothing was typed.')
        log?.info(`chat ${expected.slice(0, 8)}: direct send without a delivery check (${caller.person ? `person ${caller.person.id}` : 'app'})`)
        if (!(await typeInto({ sessionId: expected, id: live.id }, body, { human: true, confirmed: false, caller }))) throw refuse(409, 'direct-not-typed', 'The terminal could not take the message (it is asking a question, has a send in progress, or is gone). Nothing was confirmed.')
        return { ok: true, sent: true }
      },
    ],
    // o4743: what the chat's input line holds as the draft check reads it (the page's "Inspect terminal"), and one tap that clears an unsent
    // draft there (Ctrl+U / Ctrl+K, never Esc or Ctrl+C; nothing is sent). Whoever may type in the chat; a chat on another PC is asked over the link.
    ['GET', /^\/floors\/([^/]+)\/agents\/([^/]+)\/draft$/, async ([id, agentId], r) => ({ draft: await draftAt(id, agentId, r, 'draft-read') })],
    ['POST', /^\/floors\/([^/]+)\/agents\/([^/]+)\/draft\/clear$/, ([id, agentId], r) => clearDraftAt(id, agentId, r)],
    ['GET', /^\/floors\/([^/]+)\/agents\/([^/]+)\/deliveries$/, () => ({ version: 1, idempotent: true, expectedSessionId: true, receipts: true })],
    ['GET', /^\/floors\/([^/]+)\/agents\/([^/]+)\/deliveries\/([^/]+)$/, ([id, agentId, messageId], r) => {
      const receipt = messageReceipts.lookup(messageId, deliveryActor(r), id, agentId)
      if (!receipt) throw apiError(404, 'No delivery receipt for this person and agent.')
      return { receipt }
    }],
    ['GET', /^\/floors\/([^/]+)\/memory$/, ([id], r) => ({ entries: memory.search(floorOf(id).id, r.query.get('q') ?? '', 100) })],
    [
      'POST',
      /^\/floors\/([^/]+)\/memory$/,
      ([id], r) => {
        const b = isObject(r.body) ? r.body : {}
        const entry = memory.save(floorOf(id).id, { text: text(b.text, 'text', 4000), tags: Array.isArray(b.tags) ? (b.tags as string[]) : [] })
        memoryChanged(id)
        return { entry }
      },
    ],
    [
      'PATCH',
      /^\/floors\/([^/]+)\/memory\/([^/]+)$/,
      ([id, noteId], r) => {
        const b = isObject(r.body) ? r.body : {}
        const entry = memory.edit(floorOf(id).id, noteId, text(b.text, 'text', 4000))
        memoryChanged(id)
        return { entry }
      },
    ],
    [
      'DELETE',
      /^\/floors\/([^/]+)\/memory\/([^/]+)$/,
      ([id, noteId]) => {
        if (!memory.remove(floorOf(id).id, noteId)) throw apiError(404, 'No such note')
        memoryChanged(id)
        return { ok: true }
      },
    ],
    [
      'POST',
      /^\/mcp\/call$/,
      async (_, r) => {
        const key = r.headers['x-sad-chat-key']
        if (typeof key !== 'string' || !key) throw apiError(401, 'Missing x-sad-chat-key')
        if (!isObject(r.body) || typeof r.body.name !== 'string') throw apiError(400, 'Expected {name, arguments}')
        // memory-identity: W5 (POST /mcp/call: the chat's own key)
        return { text: await callTool(key, r.body.name, r.body.arguments) }
      },
      'local',
    ],
    // The tool list now, for the chat's MCP process (mcp-shim.ts): it asks when claude asks, and now and then, and tells claude when it
    // changed. What each chat was given is written down (tools-seen.ts). Answered here, from this build's TOOLS, whoever the hub is.
    [
      'GET',
      /^\/mcp\/tools$/,
      (_, r) => {
        const key = r.headers['x-sad-chat-key']
        if (typeof key !== 'string' || !key) throw apiError(401, 'Missing x-sad-chat-key')
        const me = chats.byKey(key)
        if (!me) throw apiError(401, "This chat's key isn't known: its terminal was closed or the agent restarted. Open the chat from the floor again.")
        // Order o7e6d: a chat with a policy, or a staff Assistant's quarantined run, is told the staff tools only (none unless it runs under the
        // staff policy). Its shim does not ask.
        if (me.policy || isStaffSid(me.sessionId)) {
          // F-297: each staff policy has its own list and stamp; no policy, or one this build does not know, keeps v1's stamp and an empty list, as before.
          const known = isStaffPolicy(me.policy) ? me.policy : null
          const version = staffToolsStampOf(known ?? STAFF_POLICY)
          return r.query.get('stamp') === '1' ? { version } : { version, tools: known ? staffToolsOf(known) : [] }
        }
        // Only a request that says it is asking for the list (not just checking its stamp) is a chat given the list.
        if (r.query.get('given') === '1') toolsSeen.note(me.sessionId, TOOLS_NOW)
        return r.query.get('stamp') === '1' ? { version: TOOLS_NOW } : { version: TOOLS_NOW, tools: TOOLS }
      },
      'local',
    ],
    // F-051: the memory's hook (memory-hook.ts) for a chat's prompt, with that chat's key, as /mcp/call.
    [
      'POST',
      /^\/mcp\/recall$/,
      async (_, r) => {
        const key = r.headers['x-sad-chat-key']
        if (typeof key !== 'string' || !key) throw apiError(401, 'Missing x-sad-chat-key')
        if (!isObject(r.body) || typeof r.body.prompt !== 'string') throw apiError(400, 'Expected {prompt}')
        // o655f (Stage 1): claude's UserPromptSubmit hook is the proof that this chat TOOK the prompt (10-110 ms after Enter, with the exact text),
        // so a send waiting on it is confirmed at once: no screen reading. Noted before the recall below, which may take seconds.
        const info = chats.byKey(key)
        // Order o7e6d (Lead, 15 Nov): a chat with a policy, or a staff Assistant's quarantined run. Its report confirms a send of that chat only
        // (a staff-policy run), never moves it to another session (no session id is taken from the report), and gets an empty answer BEFORE any
        // recall: shared memory is never read for it, and its 4-tool gate is not bypassed (memory_* stay refused).
        if (info && (info.policy || isStaffSid(info.sessionId))) {
          if (isStaffPolicy(info.policy)) chats.promptSeen?.(info.sessionId, r.body.prompt, typeof r.body.promptLength === 'number' ? r.body.promptLength : r.body.prompt.length, typeof r.body.promptId === 'string' ? r.body.promptId.slice(0, 80) : null, null)
          return { text: '' }
        }
        if (info) {
          // oc65c: the owner's Assistant's native session as its own hook reports it, kept so a /clear or /resume outlives a stop (metadata only; never
          // a prompt, a path or a tool payload). One that is another chat's is not kept. A receipt that can't be written never stops the prompt.
          const native = typeof r.body.sessionId === 'string' && UUID_RE.test(r.body.sessionId) ? r.body.sessionId.toLowerCase() : null
          const at = native ? floors.bySession(info.sessionId) : null
          const binding = at && info.engine === 'claude' && !info.execution && !info.policy && !at.agent.executionProfile
            ? ownerAssistantBinding(at.floor, at.agent, info.sessionId) : null
          if (binding && native) {
            try {
              if (nativeClaimedElsewhere(native, binding.agentId, info.sessionId)) log?.warn(`assistant history: ${at!.agent.name} reported a native session that is another chat's; not kept as its own`)
              else assistantNativeHistory.observe(binding, native)
            } catch (e) {
              log?.warn(`assistant history: a native-session receipt could not be saved (${message(e)})`)
            }
          }
          chats.promptSeen?.(info.sessionId, r.body.prompt, typeof r.body.promptLength === 'number' ? r.body.promptLength : r.body.prompt.length, typeof r.body.promptId === 'string' ? r.body.promptId.slice(0, 80) : null, typeof r.body.sessionId === 'string' ? r.body.sessionId : null)
        }
        // memory-identity: W6 (POST /mcp/recall, the hook: the chat's own key)
        return { text: await callTool(key, 'memory_recall', { prompt: r.body.prompt.slice(0, 20_000) }) }
      },
      'local',
    ],
    // F-051: the memory layer for the page (the Memory tab); a member's go to the hub, which keeps it.
    // S2: each of the eight answers from the CALLER'S OWN person's layer (routeLayer: the app owner, or 409 memory-others-not-built for anyone else, a second
    // administrator included); none takes a person from its path, query or body. Each has its marker, so a ninth route is a red test until it is in the matrix.
    // memory-door: R1
    ['GET', /^\/memory\/status$/, async (_, r) => (await routeLayer(r)).status()],
    [
      'GET',
      /^\/memory\/search$/,
      async (_, r) => {
        const kinds = (r.query.get('kinds') ?? '').split(',').filter((k): k is MemoryKind => k === 'wiki' || k === 'note' || k === 'turn')
        const limit = Number(r.query.get('limit')) || 20
        // memory-door: R2
        return { hits: await (await routeLayer(r)).search(r.query.get('q') ?? '', { limit, kinds }) }
      },
    ],
    // memory-door: R3
    ['GET', /^\/memory\/wiki$/, async (_, r) => ({ pages: (await routeLayer(r)).pages() })],
    [
      'GET',
      /^\/memory\/page$/,
      async (_, r) => {
        // memory-door: R4
        const page = (await routeLayer(r)).page(r.query.get('path') ?? '')
        if (!page) throw apiError(404, 'No such page in the wiki')
        return { page }
      },
    ],
    // memory-door: R5
    ['GET', /^\/memory\/read$/, async (_, r) => ({ text: (await routeLayer(r)).read(r.query.get('ref') ?? '') })],
    // memory-door: R6
    ['GET', /^\/memory\/brief$/, async (_, r) => ({ text: (await routeLayer(r)).brief() })],
    [
      'POST',
      /^\/memory\/compile$/,
      async (_, r) => {
        const b = isObject(r.body) ? r.body : {}
        // memory-door: R7
        return { run: (await routeLayer(r)).compile(b.mode === 'tidy' ? 'tidy' : 'ingest', 'now') }
      },
    ],
    // memory-door: R8
    ['PATCH', /^\/memory\/settings$/, async (_, r) => ({ settings: (await routeLayer(r)).setSettings(r.body) })],
    // F-309 N1: the agent notebooks, the OWNER's (notebookOwner: never a chat's key, the first owner by id). Each has its marker (notebook-door: K4..K9), so a tenth route is a red test.
    // notebook-door: K4
    ['GET', /^\/notebooks$/, (_, r) => notebookOwner(r).status()],
    // notebook-door: K5
    ['PATCH', /^\/notebooks\/settings$/, (_, r) => ({ settings: notebookOwner(r).setSettings(r.body) })],
    [
      'GET',
      /^\/notebooks\/([a-z0-9-]+)\/(notes|held|log)$/,
      ([t, what], r) => {
        // notebook-door: K6
        const nb = notebookOwner(r)
        if (what === 'notes') return { notes: nb.notes(t) }
        if (what === 'held') return { held: nb.held(t) }
        return { log: nb.log(t, Number(r.query.get('limit')) || 200) }
      },
    ],
    [
      'POST',
      /^\/notebooks\/([a-z0-9-]+)\/held\/([^/]+)$/,
      ([t, heldId], r) => {
        const b = isObject(r.body) ? r.body : {}
        // notebook-door: K7
        const nb = notebookOwner(r)
        if (b.action === 'delete') {
          nb.deleteHeld(t, heldId)
          return { deleted: heldId }
        }
        if (b.action === 'release') return { result: nb.releaseHeld(t, heldId, { text: b.text }) }
        throw apiError(400, 'action is release or delete')
      },
    ],
    // notebook-door: K8
    ['POST', /^\/notebooks\/([a-z0-9-]+)\/notes\/([^/]+)\/share$/, ([t, noteId], r) => ({ note: notebookOwner(r).share(t, noteId) })],
    [
      'DELETE',
      /^\/notebooks\/([a-z0-9-]+)\/notes\/([^/]+)$/,
      ([t, noteId], r) => {
        // notebook-door: K9
        notebookOwner(r).erase(t, noteId)
        return { erased: noteId }
      },
    ],
  ]

  const callerOf = (r: MountRequest): Caller => r.caller ?? OPEN

  function workflowExecutionAgent(id: string, agentId: string): FloorAgent {
    const floor = floorOf(id), agent = agentOf(floor, agentId)
    if (isPcControl(floor) || [agent.id, agent.sessionId, agent.codexThread, agent.opencodeSession].some(x => typeof x === 'string' && controlAlias(x))) throw immutablePcControl()
    executionIdentityOf(agent, defaultsNow())
    return agent
  }
  function targetExecution(profile: ReturnType<typeof requireExecutionCapabilityQuery>['profile'], agent: FloorAgent): ExecutionIdentity {
    const engine = profile === 'codex-native-v1' ? 'codex' : profile === 'opencode-native-v1' ? 'opencode' : 'claude'
    return normalizeExecution({ engine, executionProfile: profile, opencodeProvider: agent.opencodeProvider }, defaultsNow())
  }
  function executionScope(id: string, agentId: string, r: MountRequest): ExecutionIntentScope {
    const agent = workflowExecutionAgent(id, agentId), caller = callerOf(r)
    // Order o7e6d: a staff Assistant has no managed execution (open, select, verify, status, capability): refused before any dispatch.
    if (isStaffAssistant(agent)) throw executionHttpError('execution-forbidden', 'authorization')
    if (!executionService || !caller.person || !agent.homePc) throw executionHttpError('execution-forbidden', 'authorization')
    const ownerId = agent.owner?.id
    if (!ownerId) throw executionHttpError('execution-forbidden', 'authorization')
    const scope = { actorId: caller.person.id, ownerId, floorId: id, agentId, targetPcId: agent.homePc }
    executionService.bindActor(scope, () => {
      const latest = o.auth ? o.auth.caller(r.headers) : caller
      if (latest.person?.id !== caller.person!.id || latest.sid !== caller.sid) throw executionHttpError('execution-forbidden', 'authorization')
      access.needChat(latest, workflowExecutionAgent(id, agentId), 'owner', 'execution')
    })
    return scope
  }
  async function executionCapability(id: string, agentId: string, r: MountRequest): Promise<ExecutionCapabilityReply> {
    const agent = workflowExecutionAgent(id, agentId), query = requireExecutionCapabilityQuery(Object.fromEntries(r.query))
    const current = snapshotAgentExecution(agent, defaultsNow()), target = targetExecution(query.profile, agent)
    if (!current.homePc) throw executionHttpError('execution-capability-required', 'capability')
    if (executionService && current.homePc === self().id) {
      try { return await executionService.capability(executionScope(id, agentId, r), query) }
      catch (error) { if ((error as { code?: string }).code !== 'execution-capability-required') throw error }
    }
    return { version: 1, current, target, targetPcId: current.homePc, available: false, unavailableCode: 'execution-capability-required' }
  }
  type ProfileRoute = [string, RegExp, Handler, 'local', Rule]
  const profileOwner: Rule = { kind: 'chat', need: 'owner', floor: 0, agent: 1 }
  // The separately-owned legacy access/POLICY file is outside this allocation. These explicit owner rules
  // pass through the SAME PC Control/SID/ACL dispatcher; there is no unguarded raw/forwarding shortcut.
  const executionRoutes: ProfileRoute[] = [
    ['GET', /^\/floors\/([^/]+)\/agents\/([^/]+)\/conversion-progress$/, ([id, agentId]) => ({ progress: conversionProgress.get(id, agentId) }), 'local', profileOwner],
    ['GET', /^\/floors\/([^/]+)\/agents\/([^/]+)\/execution-capability$/, ([id, agentId], r) => executionCapability(id, agentId, r), 'local', profileOwner],
    ['POST', /^\/floors\/([^/]+)\/agents\/([^/]+)\/execution-selection$/, ([id, agentId], r) => {
      const agent = workflowExecutionAgent(id, agentId), request = requireExecutionSelectionRequest(r.body)
      if ([request.expected.agentId, request.expected.sessionId, request.expected.codexThread, request.expected.opencodeSession].some(x => typeof x === 'string' && controlAlias(x))) throw immutablePcControl()
      assertExecutionCAS(request.expected, snapshotAgentExecution(agent, defaultsNow()))
      if (!executionService) throw executionHttpError('execution-capability-required', 'selection', request.selectionIntentId)
      return executionService.select(executionScope(id, agentId, r), request)
    }, 'local', profileOwner],
    ['POST', /^\/floors\/([^/]+)\/agents\/([^/]+)\/execution-verify$/, ([id, agentId], r) => {
      const agent = workflowExecutionAgent(id, agentId)
      if (!isObject(r.body) || r.body.version !== 1 || Object.keys(r.body).some(key => !['version', 'expected'].includes(key))) throw executionHttpError('execution-invalid', 'capability')
      assertExecutionCAS(r.body.expected, snapshotAgentExecution(agent, defaultsNow()))
      if (!executionService) throw executionHttpError('execution-capability-required', 'capability')
      return executionService.verify(executionScope(id, agentId, r))
    }, 'local', profileOwner],
    ['GET', /^\/floors\/([^/]+)\/agents\/([^/]+)\/execution-intents\/([^/]+)$/, ([id, agentId, intent], r) => {
      workflowExecutionAgent(id, agentId)
      if (!executionIntentId(intent)) throw executionHttpError('execution-invalid', 'status')
      if (!executionService) throw executionHttpError('execution-capability-required', 'status', intent)
      return executionService.status(executionScope(id, agentId, r), intent)
    }, 'local', profileOwner],
  ]
  function guardWorkflowExecution(r: MountRequest, params: string[], profile: boolean): void {
    if (profile) { workflowExecutionAgent(params[0], params[1]); return }
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method)) return
    const body = r.body
    if (isObject(body) && ['executionProfile', 'executionRevision', 'execution', 'provider', 'harness', 'transcript'].some(k => Object.hasOwn(body, k))) throw executionHttpError('execution-capability-required', 'selection')
    if (isObject(body) && typeof body.sessionId === 'string') {
      const source = bySession(body.sessionId)
      if (source) requireLegacyExecution(source.agent, defaultsNow())
    }
    if (/^\/floors\/[^/]+\/agents\/[^/]+\//.test(r.rest) && !r.rest.endsWith('/share')) {
      const agent = agentOf(floorOf(params[0]), params[1])
      if(r.method==='POST'&&r.rest.endsWith('/say')&&isObject(body)&&typeof body.messageId==='string'&&UUID_RE.test(body.messageId)
        &&typeof body.expectedSessionId==='string'&&body.expectedSessionId===agent.sessionId){
        assertMessageRuntime(body.expectedSessionId,self().id,true);return
      }
      // Stop only ends the chat's process: its binding, profile and history stay as they are, and the bridge retires the
      // run once its exact processes are gone (as app_stop_chat's stop of a proved chat does). It is the owner's (POLICY).
      // Refusing it left a Codex in Claude Code chat unstoppable from the page ("has not proved this execution capability").
      const stopOnly = r.method === 'POST' && /^\/floors\/[^/]+\/agents\/[^/]+\/terminate$/.test(r.rest)
      if (!stopOnly && !(r.rest.endsWith('/chat') && isObject(r.body) && Object.hasOwn(r.body, 'executionVersion'))) requireLegacyExecution(agent, defaultsNow())
    }
    if (r.method === 'DELETE' && /^\/floors\/[^/]+$/.test(r.rest)) for (const agent of floorOf(params[0]).agents) requireLegacyExecution(agent, defaultsNow())
  }

  /**
   * F-300 S0 (the census, person-assistant-doors.ts): a person (not the owner of the app) keeps on their own Assistant only the doors the table marks 'allow'. Any other door under
   * /floors/:floor/agents/:agent/, and every door nobody has classified, is refused when that agent is a person's own Assistant. Any other agent, and the owner of the app: nothing changes.
   */
  function refusePersonDoor(c: Caller, r: MountRequest, where: string) {
    if (access.isAdmin(c)) return
    const door = personDoorOf(r.method, r.rest)
    if (!door || door.verdict === 'allow') return
    const m = /^\/floors\/([^/]+)\/agents\/([^/]+)\//.exec(r.rest)
    if (!m) return
    let agent: FloorAgent
    try {
      agent = agentOf(floorOf(decodeURIComponent(m[1])), decodeURIComponent(m[2]))
    } catch {
      return
    }
    if (!isPersonAssistant(agent)) return
    // A person's own Assistant lives on the Server: asking it to open THERE (a member PC's page reaches it at its home through the Server's run-on) names no new place, so it passes. Any other PC is refused here (and assertStaffStart holds it too).
    if (door.tail === 'run-on' && isObject(r.body) && r.body.pc === serverPcId()) return
    o.auth?.deny(c, 403, 'admin-only', where)
    throw authError(403, PERSON_DOOR_REFUSED, 'admin-only')
  }

  /** F-118: what a route's rule needs of its caller, checked before anything runs. A route with no rule is for the owner of the app. */
  function checkRule(rule: Rule | undefined, params: string[], r: MountRequest) {
    const c = callerOf(r)
    const where = `${r.method} ${AGENT_API_PREFIX}${AGENTIC_PREFIX}${r.rest}`
    // Order o9465: Settings › Access, for every route of this mount, also when a member PC passes its page's person on (that request never went
    // through this PC's own gate): the same check as api.ts gate(), so a person reaches only what is open to them (or shared with them) here.
    if (o.featureAccess && c.person && !access.isAdmin(c) && !o.featureAccess.opensRoute(c, r.method, `${AGENTIC_PREFIX}${r.rest}`)) {
      o.auth?.deny(c, 403, 'not-allowed', where)
      throw authError(403, 'This is not open to you. The owner of this app opens pages and features in Settings › Access.', 'not-allowed')
    }
    refusePersonDoor(c, r, where)
    if (rule === undefined || rule.kind === 'owner') {
      if (access.isAdmin(c)) return
      // Order o9465: a feature's own routes (shared/access.ts ROUTES, e.g. Tasks) open to someone Settings › Access opened that feature to. Only
      // the routes listed for it: never another owner route, and never through a share.
      const opened = routeRule(r.method, `${AGENTIC_PREFIX}${r.rest}`)
      if (c.person && opened && opened.features.some(f => o.featureAccess?.allows(c, f) === true)) return
      o.auth?.deny(c, 403, 'admin-only', where)
      throw authError(403, 'This is for the owner of this app.', 'admin-only')
    }
    switch (rule.kind) {
      case 'signed':
      case 'create':
      case 'self':
        return
      case 'floor': {
        const f = floorOf(params[rule.floor])
        access.needFloor(c, f, rule.need, where)
        // F-300 S0: a floor with a person's own Assistant on it: its chart (PATCH) may rename the Assistant and move its box and change nothing that decides how it runs (the floor's name, and every field in
        // person-assistant-doors.ts CHART_LOCKED, are the owner of the app's); writing its memory is the owner of the app's; deleting it stays its maker's (floor('delete'), o3b2f: the record keeps who removed it). (An add or a drop is refuseAssistantFloorChange's.)
        if (rule.need !== 'view' && !access.isAdmin(c) && f.agents.some(a => isPersonAssistant(a))) {
          const chart = /^\/floors\/[^/]+$/.test(r.rest)
          const touched = r.method === 'PATCH' && chart ? personChartTouches(f, r.body) : r.method === 'DELETE' && chart ? null : 'the floor'
          if (touched !== null) {
            o.auth?.deny(c, 403, 'admin-only', where)
            throw authError(403, PERSON_DOOR_REFUSED, 'admin-only')
          }
        }
        return
      }
      case 'chat': {
        const f = floorOf(params[rule.floor])
        return access.needChat(c, agentOf(f, params[rule.agent]), rule.need, where)
      }
      case 'move': {
        const f = floorOf(params[rule.floor])
        access.needChat(c, agentOf(f, params[rule.agent]), 'owner', where)
        access.needFloor(c, f, 'manage', where)
        const to = isObject(r.body) && typeof r.body.floorId === 'string' && r.body.floorId ? r.body.floorId : f.id
        if (to !== f.id) access.needFloor(c, floorOf(to), 'manage', where)
      }
    }
  }

  /**
   * F-127: a member runs this route itself instead of passing it to a hub that can't answer: any route of a floor made here (it is not on the Server yet),
   * and a NEW floor while the Server has been out of reach and offline chats are allowed. A new floor while the Server answers goes to the Server as ever.
   */
  function runsHere(method: string, pattern: RegExp, params: string[]): boolean {
    if (mode() !== 'member') return false
    if (method === 'POST' && pattern.source === '^\\/floors$') {
      if (!offlineActive()) return false
      needClaudeHere()
      return true
    }
    return pattern.source.startsWith('^\\/floors\\/([^/]+)') && params.length > 0 && isLocalFloor(params[0])
  }

  /** Runs the route `rest` names; `forward` (a member) passes a non-local one to its hub instead. */
  async function route(r: MountRequest, forward?: (r: MountRequest) => Promise<unknown>): Promise<unknown> {
    let methodMismatch = false
    for (const [method, pattern, run, where, profileRule] of [...executionRoutes, ...routes]) {
      const m = pattern.exec(r.rest)
      if (!m) continue
      if (r.method !== method) {
        methodMismatch = true
        continue
      }
      let params: string[]
      try {
        params = m.slice(1).map(decodeURIComponent)
      } catch {
        throw apiError(400, 'Malformed path')
      }
      guardPcControlRoute(r, params)
      const versionedOpen = r.method === 'POST' && /^\/floors\/[^/]+\/agents\/[^/]+\/chat$/.test(r.rest)
        && isObject(r.body) && ['executionVersion', 'openIntentId', 'expectedExecution'].some(k => Object.hasOwn(r.body as object, k))
      if ((profileRule || versionedOpen) && !callerOf(r).person) throw authError(401, 'Sign in before using execution selection.', 'sign-in')
      checkRule(profileRule ?? ruleOf(method, pattern), params, r)
      guardWorkflowExecution(r, params, profileRule !== undefined)
      if (forward && where !== 'local' && !runsHere(method, pattern, params)) return await forward(r)
      if(r.method==='POST'&&/^\/floors\/[^/]+\/agents\/[^/]+\/(?:chat|execution-selection)$/.test(r.rest))requireHostAdoption()
      return await run(params, r)
    }
    throw apiError(methodMismatch ? 405 : 404, methodMismatch ? `${r.method} is not allowed here` : `No such path: ${AGENTIC_PREFIX}${r.rest}`)
  }

  /** A member's change, passed to the hub; its own folder for a floor becomes `folderFor` (checked here, where it is). */
  async function toHub(r: MountRequest, timeoutMs?: number): Promise<unknown> {
    if (/^\/(?:approvals|send-as-me|auto-update)(?:\/|$)/.test(r.rest)) { requireCrmHuman(o.auth, r); throw Object.assign(apiError(409, 'Sign in on the Server page for this action.'), { code: 'hub-sign-in-required', hubOrigin: null }) }
    const link = needHub()
    let body = r.body
    if (r.method === 'PATCH' && /^\/floors\/[^/]+$/.test(r.rest) && isObject(body) && body.codeDir !== undefined) {
      const { codeDir, ...rest } = body
      if (typeof codeDir === 'string' && codeDir.trim()) checkFolder(codeDir)
      body = { ...rest, folderFor: { id: self().id, dir: typeof codeDir === 'string' && codeDir.trim() ? codeDir.trim() : null } }
    }
    const value = await request<unknown>(link, 'http', { method: r.method, rest: r.rest, query: r.query.toString(), body, by: callerOf(r).person }, timeoutMs)
    // What the hub answers about a floor is in the next state push too; it is on screen now.
    const floor = isObject(value) && isObject(value.floor) ? (value.floor as unknown as Floor) : null
    if (!floor) return value
    replica.floors = replica.floors.some(f => f.id === floor.id) ? replica.floors.map(f => (f.id === floor.id ? floor : f)) : [floor, ...replica.floors]
    emitFloors()
    // As this PC sees it: its own folder as codeDir.
    return { ...(value as Record<string, unknown>), floor: allFloors().find(f => f.id === floor.id) ?? floor }
  }

  /** The hub: a member's page change, run here as its own page's would be. */
  function fromMember(from: { id: string; name: string }, raw: unknown): Promise<unknown> {
    if (!isObject(raw) || typeof raw.method !== 'string' || typeof raw.rest !== 'string') throw apiError(400, 'Expected {method, rest, body}')
    if (raw.rest === '/mcp/call' || raw.rest === '/mcp/tools') throw apiError(403, 'Tool calls come as tool')
    const body = raw.body
    if (isObject(body) && isObject(body.folderFor) && body.folderFor.id !== from.id) throw apiError(403, "A PC sets only its own folder for a floor")
    if (isObject(body) && body.codeDir !== undefined) throw apiError(403, "The hub's own folder is set on the hub")
    // F-118: the person the member's page signed in (a member speaks for its own pages, as for its own chats); nobody: the open app.
    const by = isObject(raw.by) && typeof raw.by.id === 'string' && raw.by.id ? raw.by : null
    const id = by ? String(by.id).toLowerCase().slice(0, 64) : ''
    const caller: Caller = by
      ? { person: { id, username: String(by.username ?? '').slice(0, 80), name: String(by.name ?? '').slice(0, 120), canSeeAll: (o.auth?.admins() ?? []).includes(id) }, via: 'local', sid: null }
      : OPEN
    return route({ method: raw.method, rest: raw.rest, query: new URLSearchParams(typeof raw.query === 'string' ? raw.query : ''), body, headers: {}, caller })
  }

  /**
   * Order o355e (Shubham: "When people use their screen they will be using localhost"): on a member PC, a page's screen socket (localhost:5173 on
   * that PC, or its own tailnet address) is passed on to the Server, whose bridge the Assistant's ui tools use, with whoever is signed in on the page.
   * One stream per page, its lines {m: text} both ways; either end closing closes the other. With no link to the Server the page is told to try again
   * later (its socket reconnects by itself).
   */
  function relayUiPage(ws: WsSocket, caller: Caller) {
    const link = team?.hub()?.link ?? null
    if (!link) {
      ws.close(1013, 'The Server is not reachable from this PC right now')
      return
    }
    let stream: Duplex | null = null
    let closed = false
    const early: string[] = []
    ws.onText(t => {
      if (stream) writeLine(stream, { m: t })
      else if (early.length < 50) early.push(t)
    })
    ws.onClose(() => {
      closed = true
      stream?.destroy()
    })
    const by = caller.person ? { id: caller.person.id, username: caller.person.username, name: caller.person.name } : null
    link.open({ op: 'ui-page', by }).then(
      s => {
        if (closed) return void s.destroy()
        stream = s
        for (const t of early.splice(0)) writeLine(s, { m: t })
        readLines(s, v => {
          if (!isObject(v) || typeof v.m !== 'string') return
          try {
            ws.sendText(v.m)
          } catch {
            // the page went; its close ends the stream
          }
        })
        s.on('close', () => {
          if (!closed) ws.close(1012, 'The link to the Server closed')
        })
      },
      () => ws.close(1013, 'The Server turned the screen link down'),
    )
  }

  /** Order o355e: the Server's end of relayUiPage: the member's page as one of the bridge's own, tagged with the person signed in on it there. */
  function serveUiPage(raw: unknown): (stream: Duplex) => void {
    const by = isObject(raw) && typeof raw.id === 'string' && raw.id ? raw : null
    // As for every request a member passes on for its own pages (fromMember): the person its page signed in; nobody: the owner's open app there.
    const caller: Caller = by
      ? { person: { id: String(by.id).toLowerCase().slice(0, 64), username: String(by.username ?? '').slice(0, 80), name: String(by.name ?? '').slice(0, 120), canSeeAll: (o.auth?.admins() ?? []).includes(String(by.id).toLowerCase()) }, via: 'local', sid: null }
      : OPEN
    return stream => {
      let onText: (t: string) => void = () => undefined
      let onClose: () => void = () => undefined
      let gone = false
      const end = () => {
        if (gone) return
        gone = true
        onClose()
      }
      const page: WsSocket = {
        sendText: t => void writeLine(stream, { m: t }),
        onText: cb => void (onText = cb),
        onClose: cb => void (onClose = cb),
        close: () => {
          stream.end()
          end()
        },
      }
      ui.socket()(page, uiWho(caller))
      readLines(stream, v => {
        if (isObject(v) && typeof v.m === 'string') onText(v.m)
      })
      stream.on('close', end)
      stream.on('end', end)
    }
  }

  // ---------------------------------------------------------------------------------------
  // F-021: what the other PCs ask of this one

  function serve(meta: Record<string, unknown>): (stream: Duplex) => void {
    const from = isObject(meta.from) && typeof meta.from.id === 'string' && typeof meta.from.name === 'string' ? { id: meta.from.id, name: meta.from.name } : null
    if (!from) throw new Error('which PC is asking?')
    const op = meta.op
    const m = mode()
    if (m === 'hub') {
      switch (op) {
        // Order o355e: a member's page (localhost there, or its tailnet address) joins this bridge, as the person signed in on it.
        case 'ui-page':
          return serveUiPage(meta.by)
        // F-165: a member's Dependencies page asks for the hub's checks.
        case 'dependencies':
          return answer(() => localDependencies())
        // F-168 part 2: a member's MCP page asks for the hub's own servers (reading only; changes to the hub's list are made on the hub).
        case 'mcp-inventory':
          return answer(() => localMcpInventory())
        case 'delivery-capabilities':
          return answer(() => ({ version: 1, idempotent: true, receipts: true, humanInputAuthorization: 1 }))
        // Order o7e6d (plan A): a member asks, before it passes a staff Assistant's first open here, whether this Server runs the staff policy.
        case 'staff-policy':
          return answer(() => ({ version: 1, policy: STAFF_POLICY }))
        case 'delivery-authorize':
          return answer(raw => humanInputGrants.authorize(from.id, team?.member(from.id)?.token, raw))
        case 'pc-control-capabilities':
          return answer(() => ({ version: 1, pinnedWorkspace: true, actualEngineProof: true, engines: ['claude', 'codex'] }))
        case 'pc-control-runtime':
          return answer(localControlRuntime)
        case 'engine-open-capabilities':
          return answer(() => ({ version: 1, engines: ['claude', 'codex', 'opencode'] }))
        case 'engine-switch-status':
          return answer(raw => {
            if (!isObject(raw) || typeof raw.sessionId !== 'string' || typeof raw.switchId !== 'string') throw apiError(400, 'Expected source and operation id')
            return { state: activeSwitches.has(raw.switchId) ? 'active' : bySession(raw.sessionId) ? 'cancel' : 'retire' }
          })
        case 'subscribe':
          return stream => onSubscribe(from, stream)
        case 'adopt':
          // F-127: floors a member made while it could not reach this PC, taken in whole.
          return answer(raw => adoptFloors(from, raw))
        case 'opencode-bind':
          return answer(raw => {
            if (!isObject(raw) || typeof raw.sessionId !== 'string' || typeof raw.native !== 'string') throw apiError(400, 'Expected OpenCode binding')
            const at = bySession(raw.sessionId)
            if (!at || engineFor(at.agent) !== 'opencode' || held.get(raw.sessionId)?.holder !== from.id) throw apiError(403, 'This PC does not hold that OpenCode conversation')
            floors.setOpenCodeSession(at.floor.id, at.agent.id, raw.native)
            return { ok: true }
          })
        case 'codex-bind':
          return answer(raw => {
            if (!isObject(raw) || typeof raw.sessionId !== 'string' || typeof raw.native !== 'string') throw apiError(400, 'Expected Codex binding')
            const at = bySession(raw.sessionId)
            if (at && isPcControl(at.floor)) assertPcControlTarget(at.floor, from.id, {})
            if (!at || engineFor(at.agent) !== 'codex' || (held.get(raw.sessionId)?.holder !== from.id && at.agent.homePc !== from.id)) throw apiError(403, 'This PC does not hold that Codex conversation')
            if (at.agent.codexThread && at.agent.codexThread !== raw.native) throw apiError(409, 'The native Codex binding changed')
            floors.setCodexThread(at.floor.id, at.agent.id, raw.native)
            if (at.agent.homePc !== from.id) floors.setHome(at.floor.id, at.agent.id, from)
            return { ok: true }
          })
        case 'http':
          return answer(body => fromMember(from, body))
        case 'lease':
          return answer(async raw => {
            if (!isObject(raw) || typeof raw.sessionId !== 'string') throw apiError(400, 'Expected {sessionId, takeOver}')
            const at = floors.bySession(raw.sessionId)
            if (!at) throw apiError(404, "That chat isn't an agent's on a floor")
            const expected = engineFor(at.agent)
            if (raw.expectedEngine === undefined && expected !== 'claude') throw engineUpdateRequired(from.name)
            if (raw.expectedEngine !== undefined) requireRunningEngine(expected, raw.expectedEngine as RuntimeEngine)
            const tookOverFrom = (await lease(raw.sessionId, from, raw.takeOver === true, at.agent.name)) ?? null
            return { mark: markOf(fileOf(raw.sessionId)), tookOverFrom, engine: expected }
          })
        case 'pc-control-bind':
          return answer(raw => {
            if (!isObject(raw) || Object.keys(raw).some(k => !['floorId','agentId','sessionId','revision','expectedEngine'].includes(k)) || typeof raw.floorId !== 'string' || typeof raw.agentId !== 'string' || typeof raw.sessionId !== 'string' || !UUID_RE.test(raw.sessionId)) throw apiError(400, 'Expected a pinned PC binding.')
            const floor = floorOf(raw.floorId), agent = agentOf(floor, raw.agentId)
            if (!isPcControl(floor)) throw immutablePcControl()
            assertPcControlTarget(floor, from.id, {})
            if (raw.revision !== pcControlRevision(floor) || agent.sessionId !== null || raw.expectedEngine !== engineFor(agent)) throw pcControlError('pc-control-stale', 'Refresh PC Control before opening this slot.')
            if (controlAlias(raw.sessionId) || allFloors().some(f => f.agents.some(a => a.sessionId === raw.sessionId))) throw immutablePcControl()
            return { floor: floors.bindSession(floor.id, agent.id, raw.sessionId) }
          })
        case 'release':
          return answer(async raw => {
            if (!isObject(raw) || typeof raw.sessionId !== 'string' || !validTransferSid(raw.sessionId)) throw apiError(400, 'Expected {sessionId, mark}')
            const pin = controlPinnedPc(raw.sessionId)
            if (pin && pin !== from.id) throw pcControlError('pc-control-wrong-device', 'Only the pinned PC can release this managed conversation.')
            const link = team?.member(from.id)
            if (pin && !link) throw pcControlError('pc-control-stale', 'The managed source PC connection is no longer current.')
            const guard = link ? controlTransferGuard(link, raw.sessionId) : () => {}
            guard()
            if (link && isMark(raw.mark)) await catchUpFrom(link, raw.sessionId, raw.mark).catch(e => log?.warn(`couldn't bring chat ${String(raw.sessionId).slice(0, 8)} up from ${from.name}: ${message(e)}`))
            guard()
            release(raw.sessionId, from)
            return { ok: true }
          })
        case 'tool':
          return answer(raw => {
            if (!isObject(raw) || typeof raw.sessionId !== 'string' || typeof raw.name !== 'string') throw apiError(400, 'Expected {sessionId, name, arguments}')
            // Only for a chat that PC holds: a member speaks for its own chats.
            if (held.get(raw.sessionId)?.holder !== from.id && remote.get(from.id)?.live[raw.sessionId] === undefined) throw apiError(403, `${from.name} isn't running that chat`)
            // memory-identity: W7 (link kind tool: a member passes a chat's call; the hub trusts that PC's own report of the sessions it holds: boundary B7)
            return toolFor(raw.sessionId, raw.name, raw.arguments)
          })
        case 'sessions':
          return answer(raw => ownSessions(pageOf(isObject(raw) ? raw : {})))
        case 'session-files':
          return answer(async raw => {
            const files = await sessionFiles(projectsDir)
            return { files: isObject(raw) && typeof raw.sessionId === 'string' ? files.filter(f => f.sessionId === raw.sessionId) : files }
          })
        case 'terminal':
          return stream => serveTerminal(stream, from)
        case 'attach-put':
          return answer(raw => attachPutPeer(raw))
        case 'attach-get':
          return answer(raw => attachGetPeer(raw))
        case 'open':
          // F-025: another PC's Run on, for this one: the chat taken over here.
          return answer(raw => {
            if (!isObject(raw) || typeof raw.floorId !== 'string' || typeof raw.agentId !== 'string') throw apiError(400, 'Expected {floorId, agentId}')
            // F-302 L4b (Agent 14's R6): judged like a terminal stream: the person this PC opens it for (v exactly 2, a person, or the owner's own unsigned page of a PC he marked as his), who must OWN the chat, and a message typed with the start
            // only where that person may type on the Server (the L2 rule over the link). A member that names no usable person is refused with the plain words and nothing is started. A claim, not a proof (member-terminal.ts). The START of a
            // Server chat by a person who is not an administrator is L6 (his question), not decided here.
            const claim = terminalClaimOf(raw, { admins: o.auth?.admins() ?? [], ownerPc: ownerPcs.has(from.id) })
            if (claim.kind === 'none') throw authError(403, terminalNotice(claim.why), 'not-yours')
            const asked = agentOf(floorOf(raw.floorId), raw.agentId)
            if (access.rights(claim.caller, asked)?.can !== 'owner') throw authError(403, 'Only the owner of a chat can open it on the Server from another PC.', 'not-yours')
            const expected = engineFor(agentOf(floorOf(raw.floorId), raw.agentId))
            if (raw.expectedEngine === undefined && expected !== 'claude') throw engineUpdateRequired(from.name)
            if (raw.expectedEngine !== undefined) requireRunningEngine(expected, raw.expectedEngine as RuntimeEngine)
            const target = floorOf(raw.floorId)
            if (isPcControl(target)) { assertPcControlTarget(target, self().id, {}); if (raw.expectedEngine === undefined) throw pcControlError('pc-control-update-required', 'PC Control requires explicit engine proof.') }
            return openChat(raw.floorId, raw.agentId, isPcControl(target) ? {} : { takeOver: true, here: true }, undefined, undefined, { kind: 'pc', pc: { id: from.id, name: from.name } }).then(opened => {
              if (opened.started && typeof raw.text === 'string' && raw.text) {
                if (access.mayType(claim.caller, { ...asked, homePc: self().id })) chats.typeWhenReady(opened.sessionId, raw.text.slice(0, MAX_SAY_TEXT))
                else log?.info(`terminal: ${from.name} opened chat ${opened.sessionId.slice(0, 8)} for a person who may not type into it on the Server: its message was not typed`)
              }
              return opened
            })
          })
        case 'pull':
          return servePull(sid => validMirrorSid(sid) ? findTranscript(sid, projectsDir) : null)
      }
    } else if (m === 'member' && from.id === team!.hub()?.id) {
      const approvalHubToken = team?.hub()?.link?.token ?? null
      switch (op) {
        // F-165: the hub's Dependencies page asks for this PC's checks.
        case 'dependencies':
          return answer(() => localDependencies())
        // F-168 part 2: the Server's MCP page asks this PC for its servers, and (an administrator's click on the Server, confirmed on its page) to
        // look at, add or remove ONE curated entry in this PC's own list. Only the Server's link reaches this switch.
        case 'mcp-inventory':
          return answer(() => localMcpInventory())
        case 'mcp-plan':
          return answer(raw => planInstall(mcpDeps(), mcpIdOf(raw)))
        case 'mcp-register':
          return answer(raw => registerCurated(mcpDeps(), mcpIdOf(raw), isObject(raw) ? raw.fingerprint : undefined))
        case 'mcp-remove':
          return answer(raw => removeCurated(mcpDeps(), mcpIdOf(raw)))
        case 'delivery-capabilities':
          return answer(() => ({ version: 1, idempotent: true, receipts: true, humanInputAuthorization: 1 }))
        case 'delivery-status':
          return answer(raw => {
            if (!isObject(raw) || typeof raw.messageId !== 'string' || typeof raw.owner !== 'string' || typeof raw.floorId !== 'string' || typeof raw.agentId !== 'string' || raw.targetPcId !== self().id) throw apiError(400, 'Expected a delivery receipt on this PC.')
            const receipt = nativeReceipts.lookup(raw.messageId, raw.owner, raw.floorId, raw.agentId)
            return { receipt, blockedByDraft: receipt?.state === 'blocked' && !!receipt.sessionId && chats.drafting(receipt.sessionId) }
          })
        case 'approval-snapshot-v1':
          return answer(raw => {
            requireApprovalHub(approvalHubToken, from.id)
            if (!isObject(raw) || Object.keys(raw).some(k => !['version', 'pcId', 'sessionId'].includes(k)) || raw.version !== 1 || raw.pcId !== self().id || typeof raw.sessionId !== 'string') throw apiError(400, 'Expected a versioned native approval target.')
            return localApprovalSnapshot(raw.sessionId, approvalHubToken)
          })
        case 'approval-commit-v1':
          return answer(raw => { requireApprovalHub(approvalHubToken, from.id); return commitNativeApproval(raw, approvalHubToken) })
        case 'pc-control-capabilities':
          return answer(() => ({ version: 1, pinnedWorkspace: true, actualEngineProof: true, engines: ['claude', 'codex'] }))
        case 'pc-control-runtime':
          return answer(localControlRuntime)
        case 'engine-open-capabilities':
          return answer(() => ({ version: 1, engines: ['claude', 'codex', 'opencode'] }))
        case 'engine-switch-finish':
          return answer(finishSwitchPeer)
        case 'engine-switch-prepare':
          return answer(prepareSwitchPeer)
        case 'stop':
          return answer(async raw => {
            if (!isObject(raw) || typeof raw.sessionId !== 'string') throw apiError(400, 'Expected {sessionId}')
            const current = bySession(raw.sessionId)
            if (current) assertPcControlTarget(current.floor, self().id, {})
            if (chats.info(raw.sessionId)) chats.kill(raw.sessionId)
            const mark = flushing.has(raw.sessionId) ? await endFlush(raw.sessionId) : markOf(fileOf(raw.sessionId))
            return { mark }
          })
        case 'read':
          return answer(raw => {
            if (!isObject(raw) || typeof raw.sessionId !== 'string') throw apiError(400, 'Expected {sessionId, lines}')
            const t = chats.read(raw.sessionId, typeof raw.lines === 'number' ? raw.lines : 100)
            if (t === null) throw apiError(404, "That chat isn't running here")
            return t
          })
        // o4743: the hub asks what this PC's chat holds in its input line, and asks it to clear an unsent draft there.
        case 'draft-read':
          return answer(raw => {
            if (!isObject(raw) || typeof raw.sessionId !== 'string') throw apiError(400, 'Expected {sessionId}')
            const v = chats.draftView?.(raw.sessionId) ?? null
            if (!v) throw apiError(404, "That chat isn't running here")
            return v
          })
        case 'draft-clear':
          return answer(raw => {
            if (!isObject(raw) || typeof raw.sessionId !== 'string') throw apiError(400, 'Expected {sessionId}')
            const current = bySession(raw.sessionId)
            if (current) assertPcControlTarget(current.floor, self().id, {})
            return chats.clearDraft?.(raw.sessionId) ?? { result: 'unsupported', draft: null }
          })
        case 'screen':
          // What its screen shows now (Approvals reads a prompt from this, not from the scroll-back).
          return answer(raw => {
            if (!isObject(raw) || typeof raw.sessionId !== 'string') throw apiError(400, 'Expected {sessionId}')
            const lines = chats.screen(raw.sessionId)
            if (lines === null) throw apiError(404, "That chat isn't running here")
            return lines.join('\n')
          })
        case 'type':
          return answer(raw => {
            if (!isObject(raw) || typeof raw.sessionId !== 'string' || typeof raw.text !== 'string') throw apiError(400, 'Expected {sessionId, text}')
            if (raw.confirmDelivery === true && raw.messageId !== undefined) {
              if (typeof raw.messageId !== 'string' || !UUID_RE.test(raw.messageId) || typeof raw.owner !== 'string' || raw.owner.length > 256 || typeof raw.floorId !== 'string' || typeof raw.agentId !== 'string' || typeof raw.expectedBinding !== 'string' || raw.targetPcId !== self().id) throw apiError(400, 'Expected one pinned delivery intent.')
              const { messageId, owner, floorId, agentId, sessionId, text: body } = raw
              const existing = nativeReceipts.lookup(messageId, owner, floorId, agentId)
              if (existing) {
                const receipt = nativeReceipts.begin({ id: messageId, owner, floorId, agentId, text: body, expectedSessionId: sessionId }, async () => 'blocked')
                return { receipt, blockedByDraft: receipt.state === 'blocked' && chats.drafting(sessionId) }
              }
              const current = bySession(sessionId)
              if (current?.floor.id !== floorId || current.agent.id !== agentId) throw apiError(409, 'The destination conversation changed. Nothing was submitted.')
              assertPcControlTarget(current.floor, self().id, {})
              const actor = isObject(raw.actor) ? raw.actor as unknown as Caller : undefined
              if (raw.humanAuthorization !== undefined && (typeof raw.humanAuthorization !== 'string' || !UUID_RE.test(raw.humanAuthorization))) throw apiError(400, 'Expected one native input authorization.')
              const hub = team!.hub()?.link, generation = chats.generation?.(sessionId)
              const nonce = raw.humanAuthorization
              let sequence = 0
              const authorize = typeof nonce === 'string' ? async (phase: HumanInputPhase) => {
                if (!hub || !generation || team!.hub()?.link?.token !== hub.token || chats.generation?.(sessionId) !== generation) return false
                const next = sequence++
                const proof = await request<unknown>(hub, 'delivery-authorize', { nonce, messageId, sessionId, generation, phase, sequence: next }, 3000).catch(() => null)
                return isObject(proof) && proof.version === 1 && proof.allowed === true && proof.sequence === next && team!.hub()?.link?.token === hub.token && chats.generation?.(sessionId) === generation
              } : undefined
              const receipt = beginNativeDelivery(sessionId, body, owner, messageId, raw.expectedBinding, actor ? () => deliveryAcl(actor, sessionId) : undefined, authorize)
              return nativeReceipts.wait(receipt.id, owner, floorId, agentId, 12_000).then(final => ({ receipt: final, blockedByDraft: final?.state === 'blocked' && chats.drafting(sessionId) }))
            }
            // A caller that is not the person typing (an agent's message, a broadcast, a nudge) asks for the draft check: this PC knows its own screens.
            if (raw.refuseDraft === true && chats.drafting(raw.sessionId)) return 'draft'
            if (raw.confirmDelivery === true) return confirmedDelivery(raw.sessionId, raw.text, raw.refuseDraft === true).then(delivery => ({ delivery }))
            // F-193: the live mirror's own text out of the line first (typed back after); while he types: refused as a draft.
            return (chats.mirrorTakeOut?.(raw.sessionId) ?? Promise.resolve('none')).then(r => r === 'typing' || r === 'failed' ? 'draft' as const : chats.type(raw.sessionId as string, raw.text as string, raw.refuseDraft === true ? { refuseDraft: true } : undefined))
          })
        case 'sessions':
          return answer(raw => ownSessions(pageOf(isObject(raw) ? raw : {})))
        case 'session-files':
          return answer(async raw => {
            const files = await sessionFiles(projectsDir)
            return { files: isObject(raw) && typeof raw.sessionId === 'string' ? files.filter(f => f.sessionId === raw.sessionId) : files }
          })
        // F-235: the hub's Import agent, run on this PC: a copy beside the original (only read), or taken back.
        case 'session-copy':
          return answer(raw => sessionCopy(raw))
        case 'terminal':
          return serveTerminal
        case 'attach-put':
          return answer(raw => attachPutPeer(raw))
        case 'attach-get':
          return answer(raw => attachGetPeer(raw))
        case 'keys':
          // Approval-only legacy RPC retired. Terminal sockets and ordinary MCP type remain unchanged.
          return answer(() => { throw Object.assign(apiError(409, 'Update the Server and target PC for versioned approval commits.'), { code: 'approval-peer-update-required' }) })
        case 'open':
          // F-025: another PC's Run on, for this one: the chat taken over here.
          return answer(async raw => {
            if (!isObject(raw) || typeof raw.floorId !== 'string' || typeof raw.agentId !== 'string') throw apiError(400, 'Expected {floorId, agentId}')
            // F-235: an agent the hub made a moment ago (Import agent opens its chat at once) may not have reached this PC's floors yet.
            await knownSoon(raw.floorId, raw.agentId)
            const expected = engineFor(agentOf(floorOf(raw.floorId), raw.agentId))
            if (raw.expectedEngine === undefined && expected !== 'claude') throw engineUpdateRequired(from.name)
            if (raw.expectedEngine !== undefined) requireRunningEngine(expected, raw.expectedEngine as RuntimeEngine)
            const target = floorOf(raw.floorId)
            if (isPcControl(target)) { assertPcControlTarget(target, self().id, {}); if (raw.expectedEngine === undefined) throw pcControlError('pc-control-update-required', 'PC Control requires explicit engine proof.') }
            return openChat(raw.floorId, raw.agentId, isPcControl(target) ? {} : { takeOver: true, here: true }, undefined, undefined, { kind: 'pc', pc: { id: from.id, name: from.name } }).then(opened => {
              if (opened.started && typeof raw.text === 'string' && raw.text) chats.typeWhenReady(opened.sessionId, raw.text.slice(0, MAX_SAY_TEXT))
              return opened
            })
          })
        case 'pull':
          return servePull(sid => validMirrorSid(sid) ? findTranscript(sid, projectsDir) : null)
      }
    }
    throw new Error(`this PC doesn't do ${String(op)}`)
  }

  // ---------------------------------------------------------------------------------------
  // WebSockets

  /**
   * F-302 L4 (Agent 14's census, L4; Agent 3's design page): what a person may do at a chat's terminal RIGHT NOW. `view`: the chat is theirs to see (a chat on a floor: they have rights to it; a session that is no chat's: the owner of the app only).
   * `keys`: raw keys and draft text: the runtime is admitted, the chat has NO staff policy (a person's own Assistant takes no raw key from any page: its words go in by the checked send only; the pool refuses them as well; a staff
   * Assistant counts as a policy chat for everybody, whether or not its run carries the flag, here or on another PC: a4) and the page's own
   * typing rule holds (access.mayType: the owner of the chat or a share Can type, under the owner's choice with the Server scope, where the chat RUNS counted). `size`: keys, or, for a policy chat, its OWNER (a3: geometry only).
   * The hub's own pages ask it for their caller; the link asks it for the person a member PC claims (serveTerminal): ONE function, so a rule added to one door cannot be forgotten on the other.
   */
  function terminalRights(sid: string, caller: Caller): { view: boolean; keys: boolean; size: boolean } {
    const at = bySession(sid)
    const view = at ? access.rights(caller, at.agent) !== null : access.isAdmin(caller)
    const admitted = !at || runtimeSidAllowed(sid)
    // F-302 a4 (Agent 14's review): a STAFF Assistant (a person's own Assistant whose owner is not an administrator: isStaffAssistant) takes no raw key and no draft from a page, from anybody, WHATEVER the pool says of its run. A flagged run
    // already takes none from anyone (administrator included); a run with no flag (an older start) is fenced one layer down (runFenced, on the `chats` facade), but a fence that cannot be proved (a chat that runs on another PC: its flag
    // is never visible here; a member's stale replica; a failed lookup) must not leave this layer open. An administrator's OWN Assistant is not a staff one, and he types in it as ever.
    const policy = !!chats.info(sid)?.policy || (!!at && isStaffAssistant(at.agent))
    const keys = admitted && !policy && (at ? access.mayType(caller, at.agent) : access.isAdmin(caller))
    const size = keys || (!!at && admitted && policy && isPersonAssistant(at.agent) && !!caller.person && at.agent.owner?.id === caller.person.id)
    return { view, keys, size }
  }

  function terminal(query: URLSearchParams, caller: Caller) {
    const sid = query.get('session') ?? ''
    // Who is at this page's terminal, for the presence record (chat-presence.ts): the person signed in on it, or the open app; the keys are noted where they reach the chat.
    const by = actorOfCaller(caller)
    // F-118: a person who may only view gets the screen and nothing they send reaches the chat (not keys, not a resize).
    // It is asked again at every key: a share changed to 'view' while the socket is open takes typing away at once.
    // F-302 L4: both are the ONE function terminalRights() below, asked at every frame, so the hub's own pages and a member's stream through the link cannot disagree.
    const typing = () => terminalRights(sid, caller).keys
    const sizing = () => terminalRights(sid, caller).size
    /** What a member PC's first line says about this page's person (member-terminal.ts): sent only to a Server that said it judges it. */
    const claim = terminalClaimLine(caller, access.isAdmin(caller))
    return (ws: WsSocket) => {
      const current = bySession(sid), running = chats.info(sid)
      // F-163: a paused bridge chat whose run lost its admission is still shown (typing() above keeps its keys out).
      if (current && !runtimeSidAllowed(sid) && !ownBridgeSid(sid)) return ws.close(1008, 'This execution has not proved a supported runtime.')
      if (current && isPcControl(current.floor) && running && current.floor.targetPcId !== self().id) return ws.close(1008, 'This runtime is on the wrong PC.')
      if (current && running) {
        try { requireRunningEngine(engineFor(current.agent), running.engine) }
        catch { ws.sendText(JSON.stringify({ t: 'exit', code: null })); return ws.close(1008, 'Saved and running engines disagree; reconcile the conversation first.') }
      }
      // F-193: a chat box's live mirror of the input line: no replay, no output, never a size; only for someone who may type.
      if (query.get('mode') === 'draft') return draftSocket(sid, ws, typing, claim)
      const detach = chats.attach(sid, { send: m => ws.sendText(JSON.stringify(m)) })
      // F-023: running on another of the hub's PCs: its terminal, used from here over the link.
      if (!detach && remoteTerminal(sid, ws, typing, undefined, by, claim)) return
      if (!detach) {
        ws.sendText(JSON.stringify({ t: 'exit', code: null }))
        return ws.close(1000, "That chat isn't running")
      }
      ws.onText(raw => {
        // Keys need the typing right; a size needs that or, for a policy chat, being its owner (sizing()): asked at every frame.
        const keys = typing(), size = keys || sizing()
        if (!size) return
        let m: TerminalClientMessage
        try {
          m = JSON.parse(raw) as TerminalClientMessage
        } catch {
          return
        }
        if (m.t === 'in' && typeof m.d === 'string') { if (keys) chats.input(sid, m.d, by) }
        else if (m.t === 'size' && typeof m.cols === 'number' && typeof m.rows === 'number') chats.resize(sid, m.cols, m.rows)
      })
      ws.onClose(detach)
    }
  }

  /** F-193: one draft-set from a page or the link; anything else is dropped. */
  const draftSetOf = (m: unknown) => isObject(m) && m.t === 'draft-set' && typeof m.text === 'string' && m.text.length <= 20_000 && Number.isSafeInteger(m.seq) && Number.isSafeInteger(m.base) ? { seq: m.seq as number, text: m.text, base: m.base as number, seal: m.seal === true } : null
  /** F-193: a chat box's mirror of a chat's input line, here or on the chat's PC (over the link, as its terminal is). */
  function draftSocket(sid: string, ws: WsSocket, typing: () => boolean, claim?: ReturnType<typeof terminalClaimLine>) {
    if (!typing()) return ws.close(1008, 'Only someone who may type in this chat gets its draft.')
    const mirror = chats.draftMirror?.(sid, { send: m => { if (typing()) ws.sendText(JSON.stringify(m)) } }) ?? null
    if (!mirror) {
      if (remoteTerminal(sid, ws, typing, 'draft', undefined, claim)) return
      ws.sendText(JSON.stringify({ t: 'exit', code: null }))
      return ws.close(1000, "That chat isn't running")
    }
    ws.onText(raw => {
      if (!typing() || switchFences.blocked(sid)) return
      let d: ReturnType<typeof draftSetOf> = null
      try { d = draftSetOf(JSON.parse(raw)) } catch { return }
      if (d) mirror.set(d.seq, d.text, d.base, d.seal)
    })
    ws.onClose(mirror.detach)
  }

  /** F-050: the chat view's feed for one session (chatview.ts): the end of its conversation, then what it grows by. */
  function chatSocket(query: URLSearchParams) {
    const sid = query.get('session') ?? ''
    // Stage 1 (o400b): a page that knows the `claude` message asks for it (&claude=1); every other page gets the feed exactly as before.
    const claude = query.get('claude') === '1'
    return (ws: WsSocket) => {
      if (!UUID_RE.test(sid)) return ws.close(1008, 'Expected ?session=<the chat id>')
      const detach = chatFeeds.attach(sid, m => ws.sendText(JSON.stringify(m)), { claude })
      ws.onText(() => {})
      ws.onClose(detach)
    }
  }

  /**
   * F-023, Use here: a chat that runs on another PC, its terminal on this PC's page. The link
   * carries the same messages the page's socket does, one JSON line each; it keeps running
   * there, and what is typed here goes to it. False when it isn't running on a PC within reach.
   */
  function remoteTerminal(sid: string, ws: WsSocket, typing: () => boolean = () => true, as?: 'draft', by?: ChatActor, claim?: ReturnType<typeof terminalClaimLine>): boolean {
    const w = whereAll()[sid]
    if (!w || w.id === self().id) return false
    let link: LinkPeer
    try {
      // F-116 (5 Nov): a member reaches only its hub, so a chat on ANOTHER member is asked of the hub, which relays it (serveTerminal).
      // Before, peerOf threw here and the page got "exit": the "running on <PC> … Use here" panel, again and again.
      link = mode() === 'member' && team?.hub()?.id !== w.id ? hubLink() : peerOf(w.id)
    } catch {
      return false
    }
    let stream: Duplex | null = null
    let closed = false
    const early: string[] = []
    ws.onText(raw => {
      if (!typing()) return
      // The keys of a chat on another PC never reach chats.input here: noted as they are handed to the link, toward the PC the chat runs on (presence record, chat-presence.ts).
      if (by) {
        try {
          noteRelayedFrame(sid, JSON.parse(raw), by, { id: w.id, name: w.name })
        } catch {
          // Not a message: relayLine drops it too.
        }
      }
      if (stream) relayLine(stream, raw)
      else early.push(raw)
    })
    ws.onClose(() => {
      closed = true
      stream?.destroy()
    })
    const expected = bySession(sid)
    const support = expected && isPcControl(expected.floor) ? requirePcControlPeer(link) : expected ? requirePeerEngine(link, expected.agent) : Promise.resolve()
    support.then(() => link.open({ op: 'terminal' })).then(
      s => {
        if (closed) return void s.destroy()
        stream = s
        // F-302 L4: a member PC names the person its page is for (member-terminal.ts), only to a Server that said it judges it; the Server judges that claim itself and the member's own check above is only fast feedback.
        writeLine(s, { sessionId: sid, ...(expected ? { expectedEngine: engineFor(expected.agent) } : {}), ...(as ? { mode: as } : {}), ...(claim && mode() === 'member' && hubJudgesTerminal ? claim : {}) })
        for (const raw of early.splice(0)) relayLine(s, raw)
        readLines(s, m => ws.sendText(JSON.stringify(m)))
        s.on('close', () => !closed && ws.close(1000, `The link to ${link.name} closed`))
      },
      (e: unknown) => {
        ws.sendText(JSON.stringify({ t: 'exit', code: null }))
        ws.close(1000, `${link.name} didn't open it: ${message(e)}`)
      },
    )
    log?.info(`chat ${sid.slice(0, 8)}: used here, running on ${w.name}${link.name !== w.name ? ` (through ${link.name})` : ''}`)
    return true
  }

  /** The link to the hub (a member's only way to the other PCs); throws when there is none. */
  function hubLink(): LinkPeer {
    const link = team?.hub()?.link ?? null
    if (!link) throw apiError(503, "The hub can't be reached right now")
    return link
  }

  /** A page's terminal message on to the link; one that isn't JSON is dropped, as the local socket drops it. */
  function relayLine(stream: Duplex, raw: string) {
    try {
      writeLine(stream, JSON.parse(raw))
    } catch {
      // Not a message.
    }
  }

  /**
   * F-023: the far end of Use here: this PC's chat, viewed and typed into from another PC's page.
   * F-116: on the hub, `from` (the member asking) may want a chat that runs on another member: the hub opens that one's terminal
   * and relays it, line for line, both ways (a member reaches only its hub). Never back to the PC that asked.
   */
  function serveTerminal(stream: Duplex, from?: { id: string; name: string }) {
    // Who sent these keys, for the presence record: the PC that asked. The PERSON on that PC is not carried over the link, so a line may name a PC rather than a person
    // (chat-presence.ts says so); with no `from` the keys are `unattributed`, never filed as somebody.
    const by: ChatActor = from ? { kind: 'pc', pc: { id: from.id, name: from.name } } : UNATTRIBUTED
    // F-302 L4 (Agent 14's census L4, his review R2-R5): on the HUB a stream from a member PC is JUDGED: its first line names the person its page is for (member-terminal.ts: `v` exactly 2, a valid person or an unsigned page of a PC the owner marked as his),
    // and from then on every key, size and draft frame is asked of the SAME function the hub's own pages use (terminalRights), per frame, fixed to that person for the stream. A stream without a usable claim looks and does not type, and is told so once.
    // The member's own check is fast feedback and is never consulted. NOT a proof of the person: a member PC that is modified can claim any person (see member-terminal.ts). The role where a member serves its hub (no `from`) is not judged.
    const judged = !!from && mode() === 'hub'
    let claimed: Caller | null = null
    let sid: string | null = null
    let detach: (() => void) | null = null
    let draft: { set(seq: number, text: string, base: number, seal?: boolean): void } | null = null
    let relay: Duplex | null = null
    let early: Record<string, unknown>[] | null = null
    /** The PC the chat runs on, when this PC is only the go-between: what the `keys-relayed` line says the keys were handed toward. */
    let toPc: { id: string; name: string } | undefined
    const ended = () => {
      writeLine(stream, { t: 'exit', code: null })
      stream.end()
    }
    /** A page's frame, passed on only when this person may do it NOW (asked again at every frame and at the flush of a queue): keys and drafts need `keys`, a size needs `size`, anything else is dropped. Not judged: the member serving its hub. */
    const frameOk = (m: Record<string, unknown>): boolean => {
      if (!judged) return true
      if (!claimed || sid === null) return false
      const r = terminalRights(sid, claimed)
      if (m.t === 'in' || m.t === 'draft-set') return r.keys
      if (m.t === 'size') return r.size
      return false
    }
    readLines(stream, raw => {
      if (!isObject(raw)) return
      if (sid === null) {
        sid = typeof raw.sessionId === 'string' ? raw.sessionId : ''
        const current = bySession(sid), running = chats.info(sid)
        try {
          if (current) requireLegacyExecution(current.agent, defaultsNow())
          if (current && isPcControl(current.floor)) assertPcControlTarget(current.floor, running ? self().id : current.floor.targetPcId, {})
          if (current && raw.expectedEngine !== undefined) requireRunningEngine(engineFor(current.agent), raw.expectedEngine as RuntimeEngine)
          if (current && running) requireRunningEngine(engineFor(current.agent), running.engine)
        } catch { return ended() }
        if (judged) {
          const claim = terminalClaimOf(raw, { admins: o.auth?.admins() ?? [], ownerPc: ownerPcs.has(from!.id) })
          if (claim.kind === 'none') {
            writeLine(stream, { t: 'notice', text: terminalNotice(claim.why) })
            log?.info(`terminal: ${from!.name} opened chat ${sid.slice(0, 8)} without a usable person (${claim.why}): it may look, not type`)
          } else {
            claimed = claim.caller
            if (claim.kind === 'open-app') log?.info(`terminal: ${from!.name} opened chat ${sid.slice(0, 8)} as the app's own unsigned page (as claimed by a PC the owner marked as his)`)
            // The first look: the person must be able to see this chat (a chat on no floor is for administrators only); and from now on a floors change judges the stream again, as the hub's own sockets are: a share taken away stops the output too.
            if (!terminalRights(sid, claimed).view) return ended()
            watch(sid, claimed, { sendText: () => {}, onText: () => {}, onClose: cb => void stream.on('close', cb), close: () => ended() } as WsSocket)
            // A person removed from the owners file ends here with the hub's own sockets ('revoked'), not only at the next floors event. Not for the owner's unsigned page (no person): auth.track would end it whenever a sign-in level is raised.
            const untrack = claimed.person ? o.auth?.track(claimed, () => ended()) : undefined
            if (untrack) stream.once('close', untrack)
          }
        }
        // F-193: a chat box's live mirror of the input line, asked over the link (an older PC ignores mode and the page falls back).
        if (raw.mode === 'draft') {
          // The mirror is for someone who may type: a judged stream asks for the keys right at the first line.
          if (judged && !(claimed && terminalRights(sid, claimed).keys)) return ended()
          const m = chats.draftMirror?.(sid, { send: r => void writeLine(stream, r) }) ?? null
          if (m) {
            draft = m
            detach = m.detach
            return
          }
        }
        detach = chats.attach(sid, { send: m => void writeLine(stream, m) })
        if (detach) return
        const w = from && mode() === 'hub' ? whereAll()[sid] : undefined
        const link = w && w.id !== self().id && w.id !== from!.id ? (team?.member(w.id) ?? null) : null
        if (!link) return ended()
        toPc = { id: w!.id, name: w!.name }
        early = []
        const asked = sid
        const expectedEngine = current ? engineFor(current.agent) : undefined
        const support = current && isPcControl(current.floor) ? requirePcControlPeer(link) : current ? requirePeerEngine(link, current.agent) : Promise.resolve()
        support.then(() => link.open({ op: 'terminal' })).then(
          s => {
            if (stream.destroyed) return void s.destroy()
            relay = s
            writeLine(s, { sessionId: asked, ...(expectedEngine ? { expectedEngine } : {}), ...(raw.mode === 'draft' ? { mode: 'draft' } : {}) })
            // Frames queued before the second PC's stream opened are judged AGAIN now (the rights may have changed in between).
            for (const m of early!.splice(0)) if (frameOk(m)) writeLine(s, m)
            readLines(s, m => void writeLine(stream, m))
            s.on('close', () => stream.end())
            s.on('error', () => stream.destroy())
          },
          () => ended(),
        )
        log?.info(`chat ${asked.slice(0, 8)}: ${from!.name} uses it through this hub, running on ${w!.name}`)
        return
      }
      if (early !== null) {
        if (!legacySidAllowed(sid)) return ended()
        // Judged before it is handed on: a refused frame never reaches the second PC.
        if (!frameOk(raw)) return
        // This PC is only the go-between (a member's keys to a chat on another member): they never reach chats.input here, so they are noted as they are handed to the link.
        noteRelayedFrame(sid, raw, by, toPc)
        if (relay) writeLine(relay, raw)
        else early.push(raw)
        return
      }
      if (draft) {
        const d = draftSetOf(raw)
        if (d && frameOk(raw) && !switchFences.blocked(sid)) draft.set(d.seq, d.text, d.base, d.seal)
        return
      }
      if (raw.t === 'in' && typeof raw.d === 'string') { if (frameOk(raw)) chats.input(sid, raw.d, by) }
      else if (raw.t === 'size' && typeof raw.cols === 'number' && typeof raw.rows === 'number') { if (frameOk(raw)) chats.resize(sid, raw.cols, raw.rows) }
    })
    stream.on('close', () => {
      detach?.()
      relay?.destroy()
    })
  }

  const mount: ApiMount = {
    prefix: AGENTIC_PREFIX,
    // F-118: this mount decides by person (policy in access.ts); every other mount is for the owner of the app.
    scoped: true,
    // The chats' own routes: their key, never the app's token, and never from a page (api.ts).
    ownAuth: rest => rest === '/mcp/call' || rest === '/mcp/recall' || rest === '/mcp/tools',
    // Order o869c follow-up: the page's whole-floor save (PATCH /floors/<id>) carries every agent, which passes the usual 64 KiB on a big floor. Only
    // that path gets the larger limit (the only route with a body there; DELETE has none), and api.ts reads the body after the token and the access
    // gate, so no anonymous caller reaches it. A plaster: floors.ts MAX_FLOOR_BODY says what the cure is.
    maxBody: rest => (/^\/floors\/[^/]+$/.test(rest) ? MAX_FLOOR_BODY : undefined),
    // F-054: the built-in CRM's calls to the CRM's backend, with this PC's CRM session (never passed to the hub).
    raw: (rest, url) => {
      // F-221 (order oeb56): a turn record of live talk for the log. A raw route (its own small body, read in it), so the owner's-page check
      // is in it too (talk-stage.ts), as for /media below: the route table and its POLICY (access.ts) are left as they are.
      if (rest === '/talk/stage') return (req, res, caller) => talkStage(req, res, caller ?? OPEN)
      const saved = /^\/saved-views\/(pc|phone)$/.exec(rest)
      if (saved) return (req, res, caller) => {
        if (url.search) throw apiError(400, 'Saved views do not accept selectors')
        return savedViewsRequest(o.auth, req, res, caller, saved[1])
      }
      if (rest.startsWith('/crm-proxy/')) {
        return (req, res, caller) => {
          const sub = rest.slice('/crm-proxy/'.length)
          // S3 (HIGH, security; Agent 14's desk note of 18 Nov; Shubham's answer o5f0a: no tool of his calls this route with the app's token alone): this route
          // acts as a CRM session, and for an administrator that is THIS PC's, the owner's. A program holding the app's token is a "machine", and a machine IS
          // an administrator (auth/index.ts), so before this the token alone, or any chat that could read it, was handed the owner's CRM: every email account with its
          // password in one GET, and the writes (a member's password, roles, bank, ledger, deletes), with no audit line. So the route serves a signed-in PERSON
          // only, never a chat key, asked BEFORE any choice of session (requireCrmHuman: a chat key is 403 not-yours, no live sign-in is 401), and every refusal is a
          // log line (auth.deny). This REVERSES F-118's 5 Nov intent (machine-caller.test.ts: the Server's own tool acts as the owner on any route) FOR THIS ROUTE.
          // It is asked HERE, at the raw branch, and NOT inside crmProxy.handle(): the drive host's loopback bridge (crm-files/index.ts) calls handle in-process with
          // no cookie and must keep working. No setting re-allows a machine: he has no such tool.
          let human: Caller
          try {
            human = requireCrmHuman(o.auth, { headers: req.headers })
          } catch (e) {
            const refusal = e as Partial<ReturnType<typeof authError>>
            if (refusal.status !== undefined && refusal.code !== undefined) o.auth?.deny(caller ?? OPEN, refusal.status, refusal.code, `${req.method ?? 'GET'} ${url.pathname}`)
            throw e
          }
          // The built-in CRM runs on this PC's own CRM session: Shubham's (the owner BY HIS ID, signed in as a person). A second owner (the owners file) is an administrator but this is his CRM sign-in, not the
          // second owner's (Shubham's order o2f32): he goes the person's way below, on his OWN CRM sign-in, and is told as any person is when he has none.
          if (access.isAdmin(human) && isFirstOwner(human)) return crmProxy.handle(req, res, sub, url.search)
          // Order o9465: Goals (its own CRM paths only) or the CRM page, opened to this person in Settings › Access: on THEIR OWN CRM sign-in
          // (their sign-in to this app), never this PC's; the CRM decides what they may see and do.
          const fa = o.featureAccess
          const open = !!human.person && !!fa && (fa.allows(human, 'crm') || (fa.allows(human, 'goals') && GOALS_CRM_PATH.test(sub)))
          if (!open) throw authError(403, 'The CRM page is for the owner of this app.', 'admin-only')
          const session = o.auth?.viewerCrm(req.headers)
          if (!session || session.user.id.toLowerCase() !== human.person!.id.toLowerCase()) throw authError(401, 'Your CRM sign-in here has ended: sign in again.', 'sign-in')
          return crmProxy.handleAs({ url: session.url, cookie: session.cookie }, req, res, sub, url.search)
        }
      }
      // F-069: a file sent to a chat (the body is the file), and one already sent, for its thumbnail.
      const up = /^\/floors\/([^/]+)\/agents\/([^/]+)\/attach$/.exec(rest)
      if (up)
        return (req, res, caller) => {
          // F-118: a file into a chat is typing into it.
          access.needChat(caller ?? OPEN, agentOf(floorOf(decodeURIComponent(up[1])), decodeURIComponent(up[2])), 'type', 'POST attach')
          // Order o7e6d: never into a staff Assistant (before the body is read, a file written or anything passed on), whoever asks.
          refuseStaffFiles(agentOf(floorOf(decodeURIComponent(up[1])), decodeURIComponent(up[2])))
          requireLegacyExecution(agentOf(floorOf(decodeURIComponent(up[1])), decodeURIComponent(up[2])), defaultsNow())
          return attachUpload(req, res, decodeURIComponent(up[1]), decodeURIComponent(up[2]), url)
        }
      const down = /^\/floors\/([^/]+)\/agents\/([^/]+)\/attachment\/([^/]+)$/.exec(rest)
      if (down)
        return (req, res, caller) => {
          access.needChat(caller ?? OPEN, agentOf(floorOf(decodeURIComponent(down[1])), decodeURIComponent(down[2])), 'view', 'GET attachment')
          // Order o7e6d: nor from one (before any file is looked up here or asked of another PC).
          refuseStaffFiles(agentOf(floorOf(decodeURIComponent(down[1])), decodeURIComponent(down[2])))
          return attachDownload(req, res, decodeURIComponent(down[1]), decodeURIComponent(down[2]), decodeURIComponent(down[3]))
        }
      // Order o16d2: a picture or video an agent showed in its chat: by its unguessable id only (never a path), the owner's only, read only, with Range.
      const shown = /^\/media\/([A-Za-z0-9_-]{24})$/.exec(rest)
      if (shown)
        return (req, res, caller) => {
          if (!access.isAdmin(caller ?? OPEN)) {
            o.auth?.deny(caller ?? OPEN, 403, 'admin-only', `GET ${AGENT_API_PREFIX}${AGENTIC_PREFIX}/media`)
            throw authError(403, 'The pictures and videos the agents show are for the owner of this app.', 'admin-only')
          }
          return mediaShelf.serve(shown[1], req, res, url.searchParams.get('download') === '1')
        }
      // Order o528e: a PDF from the CRM: how many pages, and one page drawn as a picture (?w= its width). The same id, the same owner check.
      const pages = /^\/media\/([A-Za-z0-9_-]{24})\/pdf(?:\/(\d{1,5}))?$/.exec(rest)
      if (pages)
        return (req, res, caller) => {
          if (!access.isAdmin(caller ?? OPEN)) {
            o.auth?.deny(caller ?? OPEN, 403, 'admin-only', `GET ${AGENT_API_PREFIX}${AGENTIC_PREFIX}/media/pdf`)
            throw authError(403, 'The files the agents give are for the owner of this app.', 'admin-only')
          }
          return mediaShelf.pdf(pages[1], pages[2] ? Number(pages[2]) : null, Number(url.searchParams.get('w') ?? 1080), req, res)
        }
      return null
    },
    http: r => route(r, mode() === 'member' ? toHub : undefined),
    // F-118: who may have this socket, decided before it is accepted (a chat they may not see is a 403).
    wsAllow(rest, query, caller) {
      const where = `WS ${AGENT_API_PREFIX}${AGENTIC_PREFIX}${rest}`
      if (rest === '/terminal' || rest === '/chat') {
        const at = bySession(query.get('session') ?? '')
        if (at) {
          access.needChat(caller, at.agent, 'view', where)
          // F-300 S0: the sockets of a person's own Assistant are asked against the table (person-assistant-doors.ts): the chat feed and the terminal VIEW are theirs (keys: terminalRights(), F-302 a2); the owner of the app is not asked.
          if (isPersonAssistant(at.agent) && !access.isAdmin(caller) && personSocketOf(rest) !== 'allow') {
            access.deny(caller, where, at.agent.sessionId)
            throw authError(403, PERSON_DOOR_REFUSED, 'admin-only')
          }
        } else if (!access.isAdmin(caller)) {
          access.deny(caller, where)
          throw authError(403, "That chat isn't yours.", 'not-yours')
        }
        return
      }
      // Order o5007: /old (the old-app reader) is the owner's, like the fast Assistant's.
      // Order o355e (+ oe3b1): the screen socket is anyone's own page: a signed-in person's (their own Assistant drives it, never anyone else's)
      // or the owner's open app. A page nobody is signed in on, not the owner's, has no one to be driven by.
      if (rest === '/ui') {
        if (!access.isAdmin(caller) && !caller.person) {
          o.auth?.deny(caller, 403, 'sign-in', where)
          throw authError(403, 'Sign in to let your Assistant use this page.', 'sign-in')
        }
        return
      }
      if (rest === '/fast' || rest === OLD_SOCKET) {
        if (!access.isAdmin(caller)) {
          o.auth?.deny(caller, 403, 'admin-only', where)
          throw authError(403, 'This is for the owner of this app.', 'admin-only')
        }
        // oc65c / F-051 S2 (Lead's ruling on Agent 7's F6): Quick is ONE conversation with ONE journal (the app owner's: createQuickHistory), so /fast is the app
        // owner's and not any administrator's. The old-app reader's socket keeps the administrator rule.
        if (rest === '/fast') appOwnerOnly(caller, where)
      }
    },
    ws(rest, query) {
      if (rest === '/terminal')
        return (ws, caller) => {
          watch(query.get('session') ?? '', caller ?? OPEN, ws)
          terminal(query, caller ?? OPEN)(ws)
        }
      if (rest === '/chat')
        return (ws, caller) => {
          watch(query.get('session') ?? '', caller ?? OPEN, ws)
          chatSocket(query)(ws)
        }
      // Order o355e: a member PC passes its pages on to the Server's bridge (the Assistant's ui tools run there); the Server keeps its own.
      if (rest === '/ui') return (ws, caller) => (mode() === 'member' ? relayUiPage(ws, caller ?? OPEN) : ui.socket()(ws, uiWho(caller ?? OPEN)))
      // F-086/F-087: the fast Assistant's stream for the web page (shared/fast.ts); no host = off = no such socket.
      if (rest === '/fast') {
        const h = fastSession?.socket('web')
        if (!h) return null
        return (ws, caller) => {
          const id = caller?.person?.id ?? null
          if (id) fastPeople.set(id, (fastPeople.get(id) ?? 0) + 1)
          ws.onClose(() => {
            if (!id) return
            const n = (fastPeople.get(id) ?? 1) - 1
            if (n > 0) fastPeople.set(id, n)
            else fastPeople.delete(id)
          })
          // oc65c / F-051 S2: the connection knows who is signed in on it (never a client's word): Quick's memory tools are decided on that person.
          h(ws, id)
        }
      }
      // Order o5007: the old-app reader's stream (the same frames); switched off, its folder not here, or a member PC: no such socket.
      if (rest === OLD_SOCKET) {
        if (!oldSession) startOldReader()
        return oldSession?.socket('web') ?? null
      }
      if (rest === '/events')
        return (ws, caller) => {
          const c = caller ?? OPEN
          events.set(ws, c)
          ws.onClose(() => events.delete(ws))
          // F-118: what this person may see, from the first message on.
          for (const e of [
            { t: 'floors', floors: allFloors() },
            { t: 'pc-control', answer: controlRawAnswer() },
            { t: 'live', live: chats.states() },
            { t: 'where', elsewhere: elsewhere(), last: lastAll(), team: teamInfo() },
          ] satisfies AgenticEvent[]) {
            const text = eventFor(e, c)
            if (text) ws.sendText(text)
          }
        }
      return null
    },
  }

  return {
    crmFiles,
    crmProxy,
    conversations,
    mount,
    browserMount: browserMount(browser),
    voiceMount: voice.mount,
    fastHost,
    oldReaderHost: () => oldHost,
    handoff,
    floors,
    chats,
    memory,
    // memory-identity: W8 (the exported callTool: the same funnel, handed to whoever holds the Agentic object: main.ts uses none of it today)
    callTool,
    routeKeys: () => routes.map(([m, p]) => policyKey(m, p)),
    executionRouteKeys: () => executionRoutes.map(([m, p]) => policyKey(m, p)),
    staffPreflight,
    serve,
    restartChat,
    restartCodexChats,
    resumeChat,
    busyChats: () => Object.values(chats.states()).filter(st => st === 'running' || st === 'question').length,
    updateBlockers: staffUpdateBlockers,
    quiet: {
      // The host has taken its chats over and recovery has reopened its list: before that "no chat" means "not known yet".
      // C0: store trouble alone is an activation hold, not an ordinary Update hold. Only a live unsafe staff/policy run can make it related.
      ready: () => hostAdopted && recoveryDone && staffUpdateBlockers().length === 0,
      // Every chat running on a PC this hub sees (its own and each member's), with its state: a chat on another PC is cut from the hub too.
      chats: () => Object.fromEntries(Object.entries(whereAll()).map(([sid, w]) => [sid, { state: w.state, name: floors.bySession(sid)?.agent.name }])),
      drafts: () => chats.live().filter(c => chats.drafting(c.sessionId)).length,
      orders: () => orders.list().length,
      // pendingCount() is null when a store is unavailable or closed: whether something is pending is then unknown, and the signal throws (= "not quiet", fail closed).
      deliveries: () => {
        const sends = messageReceipts.pendingCount(), native = nativeReceipts.pendingCount()
        if (sends === null || native === null) throw new Error('delivery receipts are unavailable')
        return sends + native
      },
      bridge: () => chats.live().filter(c => c.bridgeRunId !== undefined).map(c => floors.bySession(c.sessionId)?.agent.name ?? c.sessionId.slice(0, 8)),
    },
    autoUpdateStatus: () => autoUpdate.read(),
    async retireChatHost() {
      // Written down first: ending them would otherwise empty the list.
      recovery?.freeze()
      await o.chatHost?.shutdown(true)
    },
    humanProof,
    close() {
      // The chats are about to be closed with the app: what is open now is what the next start reopens.
      closing = true
      executionService?.close()
      messageReceipts.close()
      nativeReceipts.close()
      humanInputGrants.close()
      for (const cancel of threadWatchers.values()) cancel()
      threadWatchers.clear()
      // o13d4: started here as before, and kept: the returned promise waits for it (its pins engine saves into <state>/crm-pins last).
      const crmClosed = crmFiles.close()
      // Order ofedf: the usage ledger is saved and its timer stops (what is not yet sent waits in the file).
      void usage?.close().catch(() => undefined)
      // Order o5dc4: the Server's browser stops with the app.
      const browserClosed = browser.close().catch(() => undefined)
      // F-211: what was sent is saved; the parts on their way stay in their waiting folder and go on at the next start.
      conversations.close()
      const convClosed = convUploads.close().catch(() => undefined)
      recovery?.freeze()
      if (resumeTimer) clearTimeout(resumeTimer)
      if (liveTimer) clearTimeout(liveTimer)
      if (pushTimer) clearTimeout(pushTimer)
      if (replicaTimer) clearTimeout(replicaTimer)
      if (originsTimer) clearTimeout(originsTimer)
      if (memberTimer) clearInterval(memberTimer)
      if (stateTimer) clearInterval(stateTimer)
      tail.close()
      chatFeeds.close()
      turns?.close()
      clearInterval(memberBriefTimer)
      memoryPeople.close()
      chats.closeAll()
      // F-075: let go of the chat host (its chats go on).
      o.chatHost?.close()
      sub?.stream.destroy()
      sub = null
      for (const s of subs.values()) s.destroy()
      subs.clear()
      for (const s of events.keys()) s.close(1001, 'the agent is stopping')
      ui.close()
      voice.close()
      fastSession?.close()
      const fastStopped = fastHost?.stop('the app is stopping')
      const previewStopped = fastPreview?.stop()
      stopOldReader('the app is stopping')
      clearInterval(ordersTimer)
      clearInterval(heartbeatTimer)
      clearInterval(toolsRefreshTimer)
      clearInterval(staffConvergeTimer)
      clearInterval(voiceTimer)
      events.clear()
      // o13d4: settles once the last writes into the state folder are done; never rejects (a failed close was never thrown before either).
      return Promise.allSettled([crmClosed, fastStopped, previewStopped, convClosed, browserClosed]).then(() => undefined)
    },
  }
}
