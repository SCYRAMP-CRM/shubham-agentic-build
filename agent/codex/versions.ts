// The Codex CLI versions native Codex chats are proved with. Shubham, 14 Nov 2026: "the new codex has new ui i want it" (0.169.0).
// 0.169.0 was run through agent/test/codex-real.ts on the Server (14 Nov 2026): start with the CRM's login, a message sent by the real
// sender, an MCP tool call, the rollout found and read by the chat view, a refreshed login written back, the chat ended and resumed with
// its memory. 0.163.0 stays accepted so a PC that still has it keeps working until it is updated.
// The Codex in Claude bridge keeps its own list (agent/codex-claude/requirements.ts, a pinned file); a test keeps the two the same.
export const SUPPORTED_CODEX_VERSIONS: readonly string[] = Object.freeze(['0.163.0', '0.169.0'])
export const isSupportedCodexVersion = (version: string | null | undefined): boolean => !!version && SUPPORTED_CODEX_VERSIONS.includes(version)
