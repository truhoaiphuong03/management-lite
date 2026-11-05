import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const FORBIDDEN_PORTS = new Set([
  3000, 3001, 3002, 3008, 3017, 3018, 3027, 3028, 5432, 55432, 55433,
]);

export function findChromeBinary() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }

  const candidates =
    process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        ]
      : process.platform === 'win32'
        ? [
            resolve(
              process.env.PROGRAMFILES || 'C:\\Program Files',
              'Google\\Chrome\\Application\\chrome.exe',
            ),
            resolve(
              process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)',
              'Google\\Chrome\\Application\\chrome.exe',
            ),
            process.env.LOCALAPPDATA
              ? resolve(
                  process.env.LOCALAPPDATA,
                  'Google\\Chrome\\Application\\chrome.exe',
                )
              : '',
            resolve(
              process.env.PROGRAMFILES || 'C:\\Program Files',
              'Microsoft\\Edge\\Application\\msedge.exe',
            ),
            resolve(
              process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)',
              'Microsoft\\Edge\\Application\\msedge.exe',
            ),
          ].filter(Boolean)
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
          ];

  for (const bin of candidates) {
    if (existsSync(bin)) return bin;
  }
  return null;
}

export async function getFreeLoopbackPort(preferredPort = 0) {
  const tryBind = (portToTry) =>
    new Promise((res, rej) => {
      const srv = createServer();
      srv.unref();
      srv.once('error', rej);
      srv.listen(portToTry, '127.0.0.1', () => {
        const addr = srv.address();
        const boundPort = typeof addr === 'object' && addr ? addr.port : 0;
        srv.close(() => res(boundPort));
      });
    });

  if (preferredPort > 0 && !FORBIDDEN_PORTS.has(preferredPort)) {
    try {
      const bound = await tryBind(preferredPort);
      if (bound > 0 && !FORBIDDEN_PORTS.has(bound)) return bound;
    } catch {
      // Fall back to OS-assigned ephemeral port
    }
  }

  for (let attempt = 0; attempt < 10; attempt++) {
    const bound = await tryBind(0);
    if (bound > 0 && !FORBIDDEN_PORTS.has(bound)) return bound;
  }
  throw new Error('Unable to allocate isolated loopback port');
}

function killProcessTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
      return;
    } catch {
      // Fall through to child.kill()
    }
  }
  try {
    child.kill('SIGTERM');
  } catch {
    // Process already exited
  }
}

export async function launchHeadlessChrome({
  preferredPort = 0,
  prefix = 'mglite-chrome-',
} = {}) {
  const chromeBin = findChromeBinary();
  if (!chromeBin) {
    throw new Error(
      'Headless Chrome/Chromium binary not found (set CHROME_BIN or install Chrome/Edge)',
    );
  }

  const port = await getFreeLoopbackPort(preferredPort);
  const userDataDir = mkdtempSync(join(tmpdir(), prefix));
  const chrome = spawn(
    chromeBin,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${userDataDir}`,
    ],
    { stdio: 'ignore' },
  );

  const deadline = Date.now() + 12_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // Wait for DevTools endpoint
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  if (!ready) {
    killProcessTree(chrome);
    rmSync(userDataDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    throw new Error(
      `Headless Chrome failed to expose DevTools on 127.0.0.1:${port}`,
    );
  }

  const cleanup = async () => {
    killProcessTree(chrome);
    await new Promise((r) => setTimeout(r, 100));
    try {
      rmSync(userDataDir, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    } catch {
      // Ignore transient OS file lock cleanup race
    }
  };

  return { chrome, port, userDataDir, cleanup };
}

export function installScriptWatchdog(label, timeoutMs = 75_000) {
  const timer = setTimeout(() => {
    console.error(`[WATCHDOG] ${label} timed out after ${timeoutMs}ms`);
    process.exit(1);
  }, timeoutMs);
  timer.unref();
  return () => clearTimeout(timer);
}

export function createBoundedCdpSender(
  ws,
  callbacks,
  { commandTimeoutMs = 45_000 } = {},
) {
  let msgId = 1;

  const rejectAllPending = (reason) => {
    for (const [id, entry] of callbacks.entries()) {
      callbacks.delete(id);
      clearTimeout(entry.timer);
      entry.rej(new Error(reason));
    }
  };

  ws.addEventListener('close', () => {
    rejectAllPending('CDP WebSocket closed before command completed');
  });
  ws.addEventListener('error', () => {
    rejectAllPending('CDP WebSocket error');
  });

  return (method, params = {}) =>
    new Promise((res, rej) => {
      if (ws.readyState !== 1) {
        rej(new Error(`CDP WebSocket is not open (method: ${method})`));
        return;
      }
      const id = msgId++;
      const timer = setTimeout(() => {
        if (callbacks.has(id)) {
          callbacks.delete(id);
          rej(
            new Error(
              `CDP command timed out after ${commandTimeoutMs}ms: ${method}`,
            ),
          );
        }
      }, commandTimeoutMs);
      timer.unref();
      callbacks.set(id, {
        res: (val) => {
          clearTimeout(timer);
          res(val);
        },
        rej: (err) => {
          clearTimeout(timer);
          rej(err);
        },
        timer,
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
}

export async function waitForAppStartupSettled(
  evaluate,
  { timeoutMs = 30_000 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let startupAuthSeen = false;
  let lastState = null;
  while (Date.now() < deadline) {
    const state = await evaluate(`
      ({
        readyState: document.readyState,
        href: location.href,
        authSeen:
          Array.isArray(window.__FAIL_CLOSED_VIOLATIONS__) &&
          window.__FAIL_CLOSED_VIOLATIONS__.some((v) =>
            (typeof v === 'string' ? v : v?.url || '').includes('/api/v1/auth/me'),
          ),
      })
    `);
    lastState = state;
    if (state?.readyState === 'complete' && state?.authSeen) {
      startupAuthSeen = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!startupAuthSeen) {
    throw new Error(
      `Timed out (${timeoutMs}ms) waiting for initial App /api/v1/auth/me startup check (lastState=${JSON.stringify(lastState)})`,
    );
  }
  // Allow App.tsx unauthenticated redirect microtasks to settle, then detach #root
  // so App's <LoginScreen /> never collides with test-mounted component trees.
  await new Promise((r) => setTimeout(r, 250));
  await evaluate(`document.getElementById('root')?.remove(); true;`);
}

export async function withIsolatedViteDevServer(
  repoRoot,
  fn,
  { apiTarget = null } = {},
) {
  const viteCli = resolve(repoRoot, 'node_modules/vite/bin/vite.js');
  const webDir = resolve(repoRoot, 'apps/web');

  if (apiTarget !== null) {
    const parsed = new URL(apiTarget);
    const targetPort = Number(parsed.port || 80);
    if (
      parsed.hostname !== '127.0.0.1' ||
      !Number.isInteger(targetPort) ||
      targetPort <= 0 ||
      FORBIDDEN_PORTS.has(targetPort)
    ) {
      throw new Error(
        `Refusing unsafe VITE_API_TARGET in isolated harness: ${apiTarget}`,
      );
    }
  }

  let vitePort = 0;
  let deadApiPort = 0;
  let viteProc = null;
  let logs = '';

  for (let attempt = 0; attempt < 3; attempt++) {
    vitePort = await getFreeLoopbackPort(0);
    if (!apiTarget) {
      deadApiPort = await getFreeLoopbackPort(0);
      while (deadApiPort === vitePort) {
        deadApiPort = await getFreeLoopbackPort(0);
      }
    }

    logs = '';
    let exitedEarly = false;
    viteProc = spawn(
      process.execPath,
      [
        viteCli,
        '--host',
        '127.0.0.1',
        '--port',
        String(vitePort),
        '--strictPort',
      ],
      {
        cwd: webDir,
        env: {
          ...process.env,
          VITE_PORT: String(vitePort),
          // Point /api proxy to isolated test API or unused loopback port so Vite never reaches Production :3002
          VITE_API_TARGET: apiTarget || `http://127.0.0.1:${deadApiPort}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    viteProc.stdout?.on('data', (chunk) => {
      logs += chunk.toString();
    });
    viteProc.stderr?.on('data', (chunk) => {
      logs += chunk.toString();
    });
    viteProc.once('exit', () => {
      exitedEarly = true;
    });

    const baseUrl = `http://127.0.0.1:${vitePort}`;
    const deadline = Date.now() + 20_000;
    let ready = false;
    while (Date.now() < deadline && !exitedEarly) {
      try {
        const res = await fetch(`${baseUrl}/`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {
        // Wait for Vite server bind
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    if (ready) {
      try {
        await Promise.all([
          fetch(`${baseUrl}/src/main.tsx`).catch(() => {}),
          fetch(`${baseUrl}/src/App.tsx`).catch(() => {}),
        ]);
        return await fn(baseUrl);
      } finally {
        killProcessTree(viteProc);
      }
    }

    killProcessTree(viteProc);
    if (attempt === 2) {
      throw new Error(
        `Isolated Vite DEV server failed to start on 127.0.0.1:${vitePort}:\n${logs}`,
      );
    }
  }
}
