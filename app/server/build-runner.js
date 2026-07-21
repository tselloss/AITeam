import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

// "Build & Run" previews whatever the agents just wrote by actually
// installing and starting it, against the run's own local workspace
// directory (never the pushed repo) — so it reflects files on disk even if
// the run errored before a commit. This executes the agents' own
// install/start scripts unattended, the same trust boundary as running
// `npm install` on any repo you've just cloned; the caller (index.js) only
// starts one of these on an explicit button click, never automatically.

const NODE_SCRIPT_PRIORITY = ['dev', 'start', 'preview'];
const STATIC_OUTPUT_DIRS = ['dist', 'build', 'out', 'public'];
const LOG_LINE_CAP = 200;
// Long enough for `npm install` on a small generated project plus the dev
// server's own boot time; short enough that a genuinely stuck process
// doesn't leave the UI spinning forever.
const READY_TIMEOUT_MS = 90 * 1000;
const PROBE_INTERVAL_MS = 3 * 1000;

// Matches the "Local: http://localhost:5173/" style line nearly every
// Node dev server prints on boot (Vite, CRA, Next.js, plain Express apps
// that log their own URL, etc.).
const URL_IN_OUTPUT = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?[^\s"'<>)]*/i;
// Fallback for servers that log a bare port ("listening on port 3000")
// instead of a full URL.
const PORT_IN_OUTPUT = /(?:listening|running|started|ready).{0,40}?port\D{0,3}(\d{2,5})/i;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function normalizeUrl(url) {
  return url.replace('0.0.0.0', 'localhost').replace(/\/$/, '');
}

async function probeHttp(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res.status < 500;
  } catch {
    return false;
  }
}

function detectKind(workspaceDir) {
  if (fs.existsSync(path.join(workspaceDir, 'package.json'))) return 'node';
  if (fs.existsSync(path.join(workspaceDir, 'index.html'))) return 'static';
  return 'unsupported';
}

function readPackageScripts(workspaceDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(workspaceDir, 'package.json'), 'utf8'));
    return pkg.scripts || {};
  } catch {
    return {};
  }
}

function findStaticOutputDir(workspaceDir) {
  for (const dir of STATIC_OUTPUT_DIRS) {
    const full = path.join(workspaceDir, dir);
    if (fs.existsSync(path.join(full, 'index.html'))) return full;
  }
  return null;
}

// One handle per "Build & Run" click — a run may be retried, so callers
// should stop() a previous handle for the same runId before starting a new
// one rather than letting two dev servers fight over ports.
export class BuildRun {
  constructor(workspaceDir) {
    this.workspaceDir = workspaceDir;
    this.status = 'starting'; // starting -> installing -> booting -> ready | running_no_url | error
    this.logLines = [];
    this.url = null;
    this.message = null;
    this.child = null;
    this.staticServer = null;
    this.stopped = false;
  }

  log(line) {
    for (const part of line.split('\n')) {
      if (!part) continue;
      this.logLines.push(part);
    }
    if (this.logLines.length > LOG_LINE_CAP) {
      this.logLines = this.logLines.slice(-LOG_LINE_CAP);
    }
  }

  fail(message) {
    if (this.stopped) return;
    this.status = 'error';
    this.message = message;
    this.log(`✖ ${message}`);
  }

  stop() {
    this.stopped = true;
    if (this.child && !this.child.killed) this.child.kill();
    if (this.staticServer) this.staticServer.close();
  }

  async run() {
    if (!fs.existsSync(this.workspaceDir)) {
      this.fail('this run\'s workspace no longer exists on disk');
      return;
    }

    const kind = detectKind(this.workspaceDir);
    if (kind === 'unsupported') {
      this.fail('could not detect how to run this project automatically (no package.json or index.html found) — open the repo and run it yourself');
      return;
    }
    if (kind === 'static') {
      await this.runStatic();
      return;
    }
    await this.runNode();
  }

  async runStatic() {
    const outputDir = fs.existsSync(path.join(this.workspaceDir, 'index.html'))
      ? this.workspaceDir
      : findStaticOutputDir(this.workspaceDir);
    if (!outputDir) {
      this.fail('no index.html found to serve');
      return;
    }
    const app = express();
    app.use(express.static(outputDir));
    await new Promise((resolve, reject) => {
      const server = app.listen(0, '127.0.0.1', () => {
        this.staticServer = server;
        resolve();
      });
      server.on('error', reject);
    }).catch((error) => this.fail(error.message));
    if (this.stopped || this.status === 'error') return;
    const { port } = this.staticServer.address();
    this.url = `http://localhost:${port}`;
    this.status = 'ready';
    this.log(`✔ serving ${outputDir} at ${this.url}`);
  }

  async runNode() {
    const scripts = readPackageScripts(this.workspaceDir);
    const scriptName = NODE_SCRIPT_PRIORITY.find((name) => scripts[name]);
    if (!scriptName && !scripts.build) {
      this.fail('package.json has no dev/start/preview/build script to run');
      return;
    }

    this.status = 'installing';
    this.log('$ npm install');
    const installOk = await this.spawnAndWait('npm', ['install'], {});
    if (!installOk || this.stopped) {
      if (!this.stopped) this.fail('npm install failed — see log above');
      return;
    }

    if (scriptName) {
      await this.bootDevServer(scriptName);
    } else {
      this.status = 'booting';
      this.log('$ npm run build');
      const buildOk = await this.spawnAndWait('npm', ['run', 'build'], {});
      if (!buildOk || this.stopped) {
        if (!this.stopped) this.fail('npm run build failed — see log above');
        return;
      }
      const outputDir = findStaticOutputDir(this.workspaceDir);
      if (!outputDir) {
        this.fail(`build succeeded but no output directory with an index.html was found (looked in ${STATIC_OUTPUT_DIRS.join(', ')})`);
        return;
      }
      const app = express();
      app.use(express.static(outputDir));
      await new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
          this.staticServer = server;
          resolve();
        });
        server.on('error', reject);
      }).catch((error) => this.fail(error.message));
      if (this.stopped || this.status === 'error') return;
      const { port } = this.staticServer.address();
      this.url = `http://localhost:${port}`;
      this.status = 'ready';
      this.log(`✔ serving ${outputDir} at ${this.url}`);
    }
  }

  // Runs a one-shot command to completion (install/build) rather than a
  // long-lived dev server — resolves true/false on exit code instead of
  // detecting a URL.
  spawnAndWait(cmd, args, env) {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        cwd: this.workspaceDir,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.child = child;
      child.stdout.on('data', (d) => this.log(d.toString()));
      child.stderr.on('data', (d) => this.log(d.toString()));
      child.on('error', (error) => {
        this.log(`✖ ${error.message}`);
        resolve(false);
      });
      child.on('close', (code) => resolve(code === 0));
    });
  }

  // Runs a long-lived dev server and waits for it to announce its own URL
  // (or a bare port) in its output; falls back to probing our assigned PORT
  // directly if the process is still alive but stayed quiet about where
  // it bound.
  async bootDevServer(scriptName) {
    this.status = 'booting';
    const port = await getFreePort();
    this.log(`$ PORT=${port} npm run ${scriptName}`);
    const child = spawn('npm', ['run', scriptName], {
      cwd: this.workspaceDir,
      env: { ...process.env, PORT: String(port), BROWSER: 'none' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;

    let exited = false;
    child.on('exit', () => { exited = true; });
    child.on('error', (error) => this.fail(error.message));

    const onOutput = (chunk) => {
      const text = chunk.toString();
      this.log(text);
      if (this.url) return;
      const urlMatch = URL_IN_OUTPUT.exec(text);
      if (urlMatch) {
        this.url = normalizeUrl(urlMatch[0]);
        this.status = 'ready';
        return;
      }
      const portMatch = PORT_IN_OUTPUT.exec(text);
      if (portMatch) {
        this.url = `http://localhost:${portMatch[1]}`;
        this.status = 'ready';
      }
    };
    child.stdout.on('data', onOutput);
    child.stderr.on('data', onOutput);

    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (!this.url && !exited && !this.stopped && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, PROBE_INTERVAL_MS));
      if (this.url || exited || this.stopped) break;
      if (await probeHttp(`http://localhost:${port}`)) {
        this.url = `http://localhost:${port}`;
        this.status = 'ready';
      }
    }

    if (this.stopped) return;
    if (this.url) return;
    if (exited) {
      this.fail(`${scriptName} script exited before announcing a URL — see log above`);
      return;
    }
    // Still running, just never told us where it bound — let the user
    // inspect the log / try our best-guess port themselves rather than
    // killing a process that might be working fine.
    this.status = 'running_no_url';
    this.message = `still running after ${Math.round(READY_TIMEOUT_MS / 1000)}s but never printed a URL we recognized — check the log, or it may be on port ${port}`;
  }
}

export function startBuildRun(workspaceDir) {
  const buildRun = new BuildRun(workspaceDir);
  buildRun.run();
  return buildRun;
}
