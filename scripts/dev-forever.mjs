// Keep-alive supervisor for the dev server (the paper bot lives inside it).
//
// The raw Vite process (`npm run dev:vite`) is where the paper bot lives. If it
// crashes, is killed, or exits for any reason, the bot stops. This wrapper
// respawns it automatically with a short backoff, so the only thing that can
// still stop the bot is the machine itself sleeping/shutting down. Combine with
// PAPER_BOT_AUTOSTART=active in .env.local so the bot also re-arms itself on each
// (re)start.
//
//   npm run dev                (or double-click start-bot.bat on Windows)
//
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const isWindows = process.platform === 'win32'
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const scriptsDir = join(rootDir, 'scripts')
const viteCliPath = join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')
const analyzerPath = join(scriptsDir, 'analyze-paper-bot-trades.mjs')
const lockPath = join(rootDir, '.paper-bot-dev.lock')
const MIN_UPTIME_MS = 10_000 // a run shorter than this counts as a crash loop
const MAX_BACKOFF_MS = 30_000

let backoff = 1_000
let stopping = false
let child = null
let analyzer = null
let wakeLock = null
let restartTimer = null
let analyzerRestartTimer = null
let lockClaimed = false

function ts() {
  return new Date().toISOString().slice(11, 19)
}

function loadLocalEnv() {
  const envPath = join(rootDir, '.env.local')
  if (!existsSync(envPath)) return

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    if (process.env[key] !== undefined) continue
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '')
  }
}

function optionEnabled(value, fallback = true) {
  if (value === undefined || value === '') return fallback
  return !/^(0|false|off|no)$/i.test(value.trim())
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function claimLock() {
  if (existsSync(lockPath)) {
    const existingPid = Number(readFileSync(lockPath, 'utf8').trim())
    if (isProcessAlive(existingPid) && existingPid !== process.pid) {
      console.log(`[dev-forever ${ts()}] supervisor already running as PID ${existingPid}; leaving it alone.`)
      process.exit(0)
    }
  }

  writeFileSync(lockPath, String(process.pid))
  lockClaimed = true
}

function releaseLock() {
  if (!lockClaimed || !existsSync(lockPath)) return
  const existingPid = readFileSync(lockPath, 'utf8').trim()
  if (existingPid === String(process.pid)) {
    try {
      unlinkSync(lockPath)
    } catch {
      /* ignore */
    }
  }
}

function runPowerShellScript(scriptName, args = []) {
  if (!isWindows) return
  const scriptPath = join(scriptsDir, scriptName)
  const result = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args], {
    cwd: rootDir,
    stdio: 'inherit',
    windowsHide: true,
  })
  return result
}

function runPowerShellScriptSync(scriptName, args = []) {
  if (!isWindows) return
  const scriptPath = join(scriptsDir, scriptName)
  spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args], {
    cwd: rootDir,
    stdio: 'inherit',
    windowsHide: true,
  })
}

function clearStaleDevPort() {
  if (!isWindows) return
  runPowerShellScriptSync('stop-stale-dev.ps1', ['-Port', '5173', '-Workspace', rootDir])
}

function startWakeLock() {
  if (!isWindows || !optionEnabled(process.env.PAPER_BOT_KEEP_AWAKE, true)) return
  if (wakeLock) return
  wakeLock = runPowerShellScript('keep-awake.ps1')
}

function analyzerArgs() {
  const args = [
    analyzerPath,
    '--watch',
    '--interval-seconds',
    process.env.PAPER_BOT_ANALYZER_INTERVAL_SECONDS || '60',
    '--min-trades',
    process.env.PAPER_BOT_ANALYZER_MIN_TRADES || '100',
  ]
  const mode = process.env.PAPER_BOT_ANALYZER_MODE?.trim().toLowerCase()
  if (mode === 'safe' || mode === 'active' || mode === 'turbo') args.push('--mode', mode)
  if (process.env.PAPER_BOT_ANALYZER_EQUITY) args.push('--equity', process.env.PAPER_BOT_ANALYZER_EQUITY)
  if (process.env.PAPER_BOT_ANALYZER_TARGET_ANNUAL_RETURN) {
    args.push('--target-annual-return', process.env.PAPER_BOT_ANALYZER_TARGET_ANNUAL_RETURN)
  }
  if (process.env.PAPER_BOT_ANALYZER_MAX_DRAWDOWN_PCT) {
    args.push('--max-drawdown-pct', process.env.PAPER_BOT_ANALYZER_MAX_DRAWDOWN_PCT)
  }
  return args
}

function startAnalyzer() {
  if (!optionEnabled(process.env.PAPER_BOT_ANALYZER_AUTOSTART, true)) return
  if (analyzer || analyzerRestartTimer) return
  if (!existsSync(analyzerPath)) {
    console.error(`[dev-forever ${ts()}] analyzer script is missing at ${analyzerPath}`)
    return
  }

  console.log(`[dev-forever ${ts()}] starting paper bot analyzer watcher ...`)
  analyzer = spawn(process.execPath, analyzerArgs(), {
    cwd: rootDir,
    stdio: 'inherit',
    windowsHide: false,
  })

  analyzer.on('exit', (code, signal) => {
    analyzer = null
    if (stopping || !optionEnabled(process.env.PAPER_BOT_ANALYZER_AUTOSTART, true)) return
    console.log(`[dev-forever ${ts()}] analyzer exited (code=${code} signal=${signal ?? '-'}); restarting in 5s`)
    analyzerRestartTimer = setTimeout(() => {
      analyzerRestartTimer = null
      startAnalyzer()
    }, 5_000)
  })

  analyzer.on('error', (err) => {
    analyzer = null
    if (stopping) return
    console.error(`[dev-forever ${ts()}] failed to spawn analyzer: ${err.message}`)
  })
}

function stopTree(processToStop) {
  if (!processToStop?.pid) return
  if (isWindows) {
    spawnSync('taskkill', ['/PID', String(processToStop.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    return
  }
  processToStop.kill('SIGTERM')
}

function scheduleRestart(reason) {
  if (stopping || restartTimer) return
  console.log(`[dev-forever ${ts()}] ${reason}; restarting in ${Math.round(backoff / 1000)}s`)
  restartTimer = setTimeout(() => {
    restartTimer = null
    start()
  }, backoff)
}

function start() {
  clearStaleDevPort()
  if (!existsSync(viteCliPath)) {
    console.error(`[dev-forever ${ts()}] Vite is not installed. Run "npm ci" in ${rootDir}.`)
    scheduleRestart('Vite runtime is missing')
    return
  }

  console.log(`[dev-forever ${ts()}] starting Vite on http://127.0.0.1:5173 ...`)
  const startedAt = Date.now()
  // Invoke Vite with this exact Node runtime. This removes the npm.cmd/PATH
  // dependency that commonly breaks when Windows starts the supervisor under
  // Task Scheduler's service account instead of an interactive user account.
  child = spawn(process.execPath, [viteCliPath, '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
    cwd: rootDir,
    stdio: 'inherit',
    windowsHide: false,
  })

  child.on('exit', (code, signal) => {
    if (stopping) return
    const uptime = Date.now() - startedAt
    // A run that stayed up a while is a healthy reset of the backoff.
    backoff = uptime > MIN_UPTIME_MS ? 1_000 : Math.min(backoff * 2, MAX_BACKOFF_MS)
    scheduleRestart(
      `dev server exited (code=${code} signal=${signal ?? '-'}) after ${Math.round(uptime / 1000)}s`,
    )
  })

  child.on('error', (err) => {
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
    scheduleRestart(`failed to spawn dev server: ${err.message}`)
  })
}

function shutdown() {
  if (stopping) return
  stopping = true
  if (restartTimer) clearTimeout(restartTimer)
  if (analyzerRestartTimer) clearTimeout(analyzerRestartTimer)
  console.log(`\n[dev-forever ${ts()}] shutting down; stopping dev server.`)
  stopTree(child)
  stopTree(analyzer)
  stopTree(wakeLock)
  releaseLock()
  process.exit(0)
}

loadLocalEnv()
claimLock()
startWakeLock()
startAnalyzer()
process.on('exit', releaseLock)
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
start()
