// F-262 (Shubham, relayed by the overlay Assistant, 16 Nov 2026: "Now all the problems we fixed from the start should also be logged including the wayland... on sign up there should be option of dependecies which lets us install all app based on linux or ubuntu lunix whatever we are using because tbere where lot of wrror we solved"; "So depedencies and feature tab should be enough for sol ing any issue with this app in any pc"):
// the written record of the problems fixed since the start (the team's Linux and Windows setup records) and the install commands in it, as DATA for the Dependencies page's "Install commands" and "Problems fixed" tabs.
// SHOWS ONLY: nothing here is run by the app; a person copies a command and runs it on that PC. THIS FILE IS COMPILED INTO THE MAIN BUNDLE, so it is not behind the sign-in: no secret, no address, port, PC nickname, account name, firewall or product detail of this office, no weak spot of this app (a test holds that). The full entries stay in the team's own record.
// The headline of each row is the record's own summary table, scrubbed; the full entries (symptom, cause, check, fix) stay in the record.

export type SetupOs = 'windows' | 'linux' | 'both'
/** Who can type it: none = the person's own account; admin = an administrator PowerShell (he approves UAC); sudo = he types his own password; person = only he can do it (a sign-in, a password, a click at that PC). */
export type SetupRights = 'none' | 'admin' | 'sudo' | 'person'

export interface SetupProblem {
  id: string
  os: SetupOs
  /** What went wrong, in a line. */
  problem: string
  /** package, assumption, policy, permission, account, version, power, coexistence or code (the Windows half names it; null where the record does not). */
  shape: string | null
  rights: string
  /** Could the app fix it by itself, or is it "you must do X". */
  appAlone: string
  /** Where it stands. */
  state: string
}

export interface SetupCommand {
  id: string
  os: 'windows' | 'linux'
  label: string
  /** The exact text to copy. */
  command: string
  rights: SetupRights
  /** The record rows it answers. */
  for: string[]
  note?: string
}

/** The Problems fixed tab's filter: all, or one operating system (a row for both shows under either). */
export type ProblemFilter = 'all' | SetupOs

/** Whether a problem is shown under the chosen operating system and the words typed (any of its text; case does not matter). */
export const matchesProblem = (p: SetupProblem, os: ProblemFilter, words: string): boolean => {
  if (os !== 'all' && p.os !== os && p.os !== 'both') return false
  const w = words.trim().toLowerCase()
  if (!w) return true
  return [p.id, p.problem, p.shape ?? '', p.rights, p.appAlone, p.state].join(' ').toLowerCase().includes(w)
}

export const SETUP_RIGHTS_WORDS: Record<SetupRights, string> = {
  none: 'Your own account',
  admin: 'Administrator PowerShell (you approve the prompt)',
  sudo: 'sudo (you type your own password)',
  person: 'Only you can do it',
}

export const SETUP_PROBLEMS: readonly SetupProblem[] = [
  { id: "B-01", os: "both", problem: "The one bootstrap command: Node, Git and the app itself, and nothing else (a Dependencies tab cannot install the Node it needs in order to exist)", shape: "package + account", rights: "admin on Windows (UAC); none on Linux; the GitHub sign-in is a person step", appAlone: "no: the very first install is one command a person runs; everything it did is re-checked by the Dependencies tab", state: "planned, not built: today Install.cmd and install.sh stop with \"node isn't installed\"" },
  { id: "L-01", os: "linux", problem: "The app could not run on Ubuntu (no start script, Windows-only parts)", shape: null, rights: "none", appAlone: "no (first install by a person)", state: "fixed, published 5 Nov (1727)" },
  { id: "L-02", os: "linux", problem: "Node, Claude Code, build-repo sign-in on a fresh PC", shape: null, rights: "none; person for GitHub", appAlone: "no", state: "done 4-5 Nov" },
  { id: "L-03", os: "linux", problem: "The app ran from a hand-started terminal, no service", shape: null, rights: "none", appAlone: "no", state: "fixed 14 Nov" },
  { id: "L-04", os: "linux", problem: "npm broken, postgres package missing, update.sh hid the failure", shape: null, rights: "none (needs his OK)", appAlone: "no", state: "OPEN (last seen 14 Nov)" },
  { id: "L-05", os: "linux", problem: "\"Not submitted\": the PC ran a build older than 2026.11.08-2152", shape: null, rights: "none", appAlone: "yes after the first update", state: "updated 14 Nov (1707); now behind again" },
  { id: "L-06", os: "linux", problem: "RustDesk not found on Linux; what RustDesk itself needs", shape: null, rights: "sudo for the .deb", appAlone: "detection yes, install no", state: "fixed 5 Nov" },
  { id: "L-07", os: "linux", problem: "\"Your ip is blocked by the peer\" (RustDesk whitelist vs 127.0.0.1)", shape: null, rights: "none", appAlone: "yes (since 2048)", state: "fixed 5 Nov" },
  { id: "L-08", os: "linux", problem: "Ports \"cannot work on this PC\"; Tailscale operator", shape: null, rights: "sudo once", appAlone: "no (shows the line)", state: "fixed 5 Nov; operator already set" },
  { id: "L-09", os: "linux", problem: "The CRM drive on Ubuntu (gvfs / WebDAV, ~/CRM-Drive)", shape: null, rights: "sudo (packages), person (CRM sign-in)", appAlone: "partly", state: "working since 14 Nov" },
  { id: "L-10", os: "linux", problem: "A chat homed on the Linux PC failed to switch engine", shape: null, rights: "none", appAlone: "yes after update", state: "code fix merged; the Linux PC needs the build" },
  { id: "L-11", os: "linux", problem: "Getting into the Linux PC (Tailscale SSH, then OpenSSH on its own port)", shape: null, rights: "sudo", appAlone: "no", state: "working" },
  { id: "L-12", os: "linux", problem: "XFCE packages; vncpasswd missing (tigervnc-tools)", shape: null, rights: "sudo", appAlone: "no", state: "fixed 16 Nov" },
  { id: "L-13", os: "linux", problem: "linger: user services only ran while logged in", shape: null, rights: "sudo was used; polkit may allow none (untested)", appAlone: "maybe", state: "fixed 16 Nov" },
  { id: "L-14", os: "linux", problem: "The XFCE units and the VNC password", shape: null, rights: "none; person for the password", appAlone: "no", state: "running since 16 Nov 21:49" },
  { id: "L-15", os: "linux", problem: "The desktop-in-a-browser websocket door was shared by \"Share all\" (a second, unintended door)", shape: null, rights: "none", appAlone: "yes", state: "fixed 16 Nov" },
  { id: "L-16", os: "linux", problem: "https for the desktop: a tailscale serve rule on its own port", shape: null, rights: "none (operator)", appAlone: "no", state: "live 16 Nov" },
  { id: "L-17", os: "linux", problem: "RustDesk on Wayland: \"Please select the screen to be shared\"", shape: null, rights: "none", appAlone: "no", state: "fixed 16 Nov, worked 23:02" },
  { id: "L-18", os: "linux", problem: "OS limit: no Xorg / X11 session on Ubuntu 26.04 + GNOME 50", shape: null, rights: "n/a", appAlone: "n/a", state: "permanent" },
  { id: "L-19", os: "linux", problem: "RustDesk on Wayland came back: nothing kept its screen-grant token in step with the desktop portal", shape: null, rights: "none", appAlone: "yes from now on (two user units re-sync it); the very first \"Share\" click at that PC stays a person step", state: "fixed 17 Nov and made to stick" },
  { id: "L-20", os: "linux", problem: "noVNC / XFCE would not connect in a real browser: verbose logging turned on so the next attempt leaves evidence", shape: null, rights: "none", appAlone: "n/a: a diagnostic, not a feature", state: "left on while the real cause is looked for" },
  { id: "W-01", os: "windows", problem: "whoami.exe called by name: Git's usr\\bin ahead of System32 breaks engine-change conversions", shape: "assumption", rights: "none", appAlone: "yes (code)", state: "found 16 Nov; a one-line fix is pending; harmless while the start script puts System32 first" },
  { id: "W-02", os: "windows", problem: "The office firewall inspects WhatsApp Web's connection: WhatsApp setup fails with a certificate error", shape: "policy", rights: "person (firewall)", appAlone: "no: it can only be named, with the words to ask ready", state: "needs the office firewall's administrator to allow it" },
  { id: "W-03", os: "windows", problem: "Whisper program and model missing; the first model download died halfway (laptop disconnected)", shape: "package", rights: "none", appAlone: "yes, with his tap", state: "laptop done 15 Nov (never redo)" },
  { id: "W-04", os: "windows", problem: "Speech voices en-IN / hi-IN missing", shape: "package", rights: "admin", appAlone: "no (UAC)", state: "Server missing (14 Nov)" },
  { id: "W-05", os: "windows", problem: "Python missing", shape: "package", rights: "none", appAlone: "yes, with his tap", state: "Server missing (14 Nov)" },
  { id: "W-06", os: "windows", problem: "OpenSSH Server missing (SSH tab, agents reaching this PC)", shape: "package", rights: "admin", appAlone: "no (UAC)", state: "Server missing (14 Nov)" },
  { id: "W-07", os: "windows", problem: "WinFsp missing (the CRM drive)", shape: "package", rights: "admin", appAlone: "no (UAC)", state: "Server has 2.1.25156.0" },
  { id: "W-08", os: "windows", problem: "Smart App Control blocks the unsigned crm-fs.exe", shape: "policy", rights: "n/a", appAlone: "yes: the app uses its built-in WebDAV instead", state: "fixed by design, 11 Nov" },
  { id: "W-09", os: "windows", problem: "\"Not submitted\": a PC on an older build fails the hub's delivery check", shape: "version", rights: "none", appAlone: "yes after the first Update", state: "recurs on every PC that falls behind" },
  { id: "W-10", os: "windows", problem: "Claude subscription: the token is per PC; an ANTHROPIC_API_KEY silently overrides it; chats keep the old account until restarted", shape: "account", rights: "person", appAlone: "partly", state: "moved 16 Nov" },
  { id: "W-11", os: "windows", problem: "Codex needs its CLI and a device sign-in", shape: "account", rights: "none + person", appAlone: "partly", state: "per PC" },
  { id: "W-12", os: "windows", problem: "Tailscale signed out or stopped", shape: "account", rights: "person", appAlone: "no: NAME it", state: "per PC" },
  { id: "W-13", os: "windows", problem: "https names need HTTPS certificates and MagicDNS on in the tailnet admin console", shape: "policy", rights: "person (console)", appAlone: "no: NAME it", state: "on for this tailnet" },
  { id: "W-14", os: "windows", problem: "The Server laptop on battery went into Modern Standby: the whole app looked crashed", shape: "power", rights: "person (or admin)", appAlone: "no: NAME it", state: "seen 12 Nov" },
  { id: "W-15", os: "windows", problem: "A plain child process dies with its Node parent on Windows", shape: "code", rights: "none", appAlone: "yes (code)", state: "fixed 1 Nov" },
  { id: "W-16", os: "windows", problem: "process.exit waits for a worker inside a native (koffi) call; terminating it aborts the process", shape: "code", rights: "none", appAlone: "yes (code)", state: "fixed 31 Oct to 1 Nov" },
  { id: "W-17", os: "windows", problem: "The microphone needs a secure page (https or localhost)", shape: "policy", rights: "none", appAlone: "yes: the app offers the https address", state: "handled in the app" },
  { id: "W-18", os: "windows", problem: "An https page cannot frame a plain-http page (the Desktop tab)", shape: "policy", rights: "none", appAlone: "yes: names it, offers the link", state: "handled in the app, 16 Nov" },
  { id: "W-19", os: "windows", problem: "The OLD app's server on the same PC rewrites the real ~/.claude.json", shape: "coexistence", rights: "none", appAlone: "no: NAME it", state: "rule since 11 Nov" },
  { id: "W-22", os: "windows", problem: "Node, npm, Git, Chrome, Claude Code, the app's packages", shape: "package", rights: "admin / none", appAlone: "yes, with his tap", state: "Dependencies rows exist" },
  { id: "W-23", os: "windows", problem: "The private build repo needs a GitHub sign-in for Update", shape: "account", rights: "person", appAlone: "no", state: "per PC" },
]

export const SETUP_COMMANDS: readonly SetupCommand[] = [
  { id: "win-node", os: "windows", label: "Node.js", command: "winget install --id OpenJS.NodeJS.LTS -e", rights: "admin", for: ["B-01", "W-22"], note: "Part of the first install. npm comes with it." },
  { id: "win-git", os: "windows", label: "Git", command: "winget install --id Git.Git -e", rights: "admin", for: ["B-01", "W-22"] },
  { id: "win-chrome", os: "windows", label: "Google Chrome", command: "winget install --id Google.Chrome -e", rights: "admin", for: ["W-22"] },
  { id: "win-claude", os: "windows", label: "Claude Code", command: "irm https://claude.ai/install.ps1 | iex", rights: "none", for: ["W-22"] },
  { id: "win-packages", os: "windows", label: "The app's packages (in the build folder)", command: "npm ci --omit=dev", rights: "none", for: ["W-22"], note: "Run it inside the build folder." },
  { id: "win-python", os: "windows", label: "Python", command: "winget install --id Python.Python.3.12 -e", rights: "none", for: ["W-05"] },
  { id: "win-ssh", os: "windows", label: "OpenSSH Server (the SSH tab, agents reaching this PC)", command: "Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0; Set-Service sshd -StartupType Automatic; Start-Service sshd", rights: "admin", for: ["W-06"], note: "Afterwards check that the capability added its firewall rule: Get-NetFirewallRule -Name OpenSSH-Server-In-TCP" },
  { id: "win-winfsp", os: "windows", label: "WinFsp (the CRM drive)", command: "winget install --id WinFsp.WinFsp -e", rights: "admin", for: ["W-07"] },
  { id: "win-voices", os: "windows", label: "A speech voice (en-IN, hi-IN: one per language)", command: "Add-WindowsCapability -Online -Name Language.TextToSpeech~~~<lang>~0.0.1.0", rights: "admin", for: ["W-04"], note: "Replace <lang> with en-IN or hi-IN." },
  { id: "win-codex", os: "windows", label: "Codex CLI", command: "npm install -g @openai/codex@<version>", rights: "none", for: ["W-11"], note: "Then sign in with the device code: codex login (a person step)." },
  { id: "win-tailscale", os: "windows", label: "Tailscale", command: "winget install --id Tailscale.Tailscale -e", rights: "admin", for: ["W-12"], note: "Signing in is a person step: from the tray app, or tailscale up." },
  { id: "win-standby", os: "windows", label: "Keep a laptop from going into Modern Standby on battery (optional)", command: "powercfg /change standby-timeout-dc 0", rights: "admin", for: ["W-14"], note: "Or keep it on its charger." },
  { id: "lin-node", os: "linux", label: "Node.js (no sudo: into ~/.local/node, checksum checked)", command: "cd /tmp && V=24.22.1 && curl -fsSLO https://nodejs.org/dist/v$V/node-v$V-linux-x64.tar.xz && curl -fsSL https://nodejs.org/dist/v$V/SHASUMS256.txt | grep \" node-v$V-linux-x64.tar.xz$\" | sha256sum -c - && mkdir -p ~/.local/node && tar -xJf node-v$V-linux-x64.tar.xz -C ~/.local/node --strip-components=1", rights: "none", for: ["B-01", "L-02"], note: "Then put ~/.local/node/bin on the PATH. The build repo is private: the GitHub sign-in is a person step." },
  { id: "lin-install", os: "linux", label: "The app as a user service (in the build folder)", command: "cd <build folder> && bash install.sh", rights: "none", for: ["L-01", "L-03"], note: "Always \"bash <script>\": a build published from Windows loses the executable bit." },
  { id: "lin-linger", os: "linux", label: "Keep the user service running when nobody is logged in", command: "sudo loginctl enable-linger $USER", rights: "sudo", for: ["L-13"] },
  { id: "lin-update", os: "linux", label: "Bring the PC to the current build (in the build folder)", command: "bash update.sh", rights: "none", for: ["L-05"] },
  { id: "lin-rustdesk", os: "linux", label: "RustDesk", command: "sudo apt install ./rustdesk-<version>-x86_64.deb", rights: "sudo", for: ["L-06"], note: "Download the .deb from RustDesk first." },
  { id: "lin-operator", os: "linux", label: "Let this user run Tailscale commands (the Ports page)", command: "sudo tailscale set --operator=$USER", rights: "sudo", for: ["L-08"] },
  { id: "lin-drive", os: "linux", label: "The CRM drive (gvfs over WebDAV)", command: "sudo apt install libglib2.0-bin gvfs-backends gvfs-fuse fuse3", rights: "sudo", for: ["L-09"], note: "Signing in to the CRM is a person step." },
  { id: "lin-ssh", os: "linux", label: "OpenSSH Server", command: "sudo apt-get install -y -qq openssh-server", rights: "sudo", for: ["L-11"], note: "Key-only on its own port: see L-11 in the record before opening it to the network." },
  { id: "lin-xfce", os: "linux", label: "A desktop in a browser: XFCE, VNC and noVNC (only if wanted)", command: "sudo apt-get install -y --no-install-recommends tigervnc-standalone-server tigervnc-common tigervnc-tools novnc websockify xfwm4 xfce4-panel xfce4-settings xfce4-terminal xfce4-appfinder", rights: "sudo", for: ["L-12"] },
  { id: "lin-vncpass", os: "linux", label: "The desktop-in-a-browser password", command: "mkdir -p ~/.config/tigervnc && vncpasswd ~/.config/tigervnc/passwd", rights: "person", for: ["L-14"], note: "The person types the password; it never goes in a chat." },
]
