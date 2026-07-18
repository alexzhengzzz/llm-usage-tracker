#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import minimist from 'minimist';
import { spawn } from 'child_process';
import { startServer } from '@llm-usage-tracker/server';

const HOME_DIR = path.join(os.homedir(), '.llm-usage-tracker');
const PID_FILE = path.join(HOME_DIR, 'pid');

const argv = minimist(process.argv.slice(2));
const command = argv._[0] || 'help';

async function main() {
  switch (command) {
    case 'start':
      await startCommand();
      break;
    case 'stop':
      stopCommand();
      break;
    case 'restart':
      await restartCommand();
      break;
    case 'status':
      statusCommand();
      break;
    case 'stats':
      await statsCommand();
      break;
    case 'help':
      helpCommand();
      break;
    default:
      console.log(`Unknown command: ${command}`);
      helpCommand();
      process.exit(1);
  }
}

// PID file management
function isServiceRunning(): boolean {
  if (!fs.existsSync(PID_FILE)) {
    return false;
  }

  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'), 10);
    if (isNaN(pid)) {
      cleanupPidFile();
      return false;
    }

    // Use signal 0 to check if process exists
    process.kill(pid, 0);
    return true;
  } catch (e) {
    cleanupPidFile();
    return false;
  }
}

function getServicePid(): number | null {
  if (!fs.existsSync(PID_FILE)) {
    return null;
  }
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'), 10);
    return isNaN(pid) ? null : pid;
  } catch (e) {
    return null;
  }
}

function savePid(pid: number) {
  if (!fs.existsSync(HOME_DIR)) {
    fs.mkdirSync(HOME_DIR, { recursive: true });
  }
  fs.writeFileSync(PID_FILE, pid.toString());
}

function cleanupPidFile() {
  if (fs.existsSync(PID_FILE)) {
    try {
      fs.unlinkSync(PID_FILE);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

async function waitForService(port: number, host: string, timeout = 10000): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const socket = new net.Socket();
      await new Promise<void>((resolve, reject) => {
        socket.setTimeout(500);
        socket.connect(port, host, () => {
          socket.destroy();
          resolve();
        });
        socket.on('error', () => {
          socket.destroy();
          reject();
        });
        socket.on('timeout', () => {
          socket.destroy();
          reject();
        });
      });
      // Wait a bit more to ensure service is fully ready
      await new Promise(resolve => setTimeout(resolve, 500));
      return true;
    } catch (e) {
      // Connection failed, wait and retry
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  return false;
}

async function startCommand() {
  // Check if already running
  if (isServiceRunning()) {
    const pid = getServicePid();
    console.log(`LLM Usage Tracker is already running (PID: ${pid})`);
    return;
  }

  let fileConfig: any = {};
  try {
    const configPath = path.join(HOME_DIR, 'config.json');
    if (fs.existsSync(configPath)) {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (error) {
    console.error('Failed to read config.json', error);
  }

  const port = argv.port || fileConfig.port || 3456;
  const host = argv.host || fileConfig.host || '127.0.0.1';
  const target = argv.target || fileConfig.target;
  const apiKey = argv.apiKey || fileConfig.apiKey;
  const codexSessionsDir = fileConfig.codexSessionsDir;

  // Check if running in foreground mode (with -f or --foreground flag)
  const foreground = argv.f || argv.foreground;

  if (foreground) {
    // Run in foreground
    console.log(`Starting LLM Usage Tracker on ${host}:${port}`);
    if (target) {
      console.log(`Proxy target: ${target}`);
    }

    try {
      savePid(process.pid);
      await startServer({
        port,
        host,
        proxyTarget: target,
        apiKey: apiKey,
        codexSessionsDir
      });
      console.log('Server started successfully');
    } catch (error) {
      console.error('Failed to start server:', error);
      cleanupPidFile();
      process.exit(1);
    }
  } else {
    // Run in background (daemon mode)
    console.log(`Starting LLM Usage Tracker in background on ${host}:${port}...`);

    const cliPath = __dirname + '/cli.js';
    const args = [cliPath, 'start', '--foreground', '--port', String(port), '--host', host];
    if (target) {
      args.push('--target', target);
    }
    if (apiKey) {
      args.push('--apiKey', apiKey);
    }

    const childProcess = spawn('node', args, {
      detached: true,
      stdio: 'ignore'
    });

    childProcess.on('error', (error) => {
      console.error('Failed to start service:', error.message);
      process.exit(1);
    });

    childProcess.unref();

    // Wait for service to start (check port connection)
    if (await waitForService(port, host)) {
      // Read PID from file (child process should have written it)
      const pid = getServicePid();
      console.log(`✅ Service started successfully (PID: ${pid})`);
      console.log(`   Endpoint: http://${host}:${port}`);
    } else {
      console.error('Service startup timeout');
      process.exit(1);
    }
  }
}

function stopCommand() {
  if (!isServiceRunning()) {
    console.log('LLM Usage Tracker is not running');
    cleanupPidFile();
    return;
  }

  try {
    const pid = getServicePid();
    if (pid) {
      process.kill(pid);
      cleanupPidFile();
      console.log(`LLM Usage Tracker stopped (PID: ${pid})`);
    }
  } catch (e) {
    console.log('Failed to stop service. It may have already stopped.');
    cleanupPidFile();
  }
}

async function restartCommand() {
  console.log('Restarting LLM Usage Tracker...');
  stopCommand();
  await new Promise(resolve => setTimeout(resolve, 1000));
  await startCommand();
}

function statusCommand() {
  if (!isServiceRunning()) {
    console.log('LLM Usage Tracker: Not running');
    return;
  }

  const pid = getServicePid();

  // Read config to get port
  let port = 3456;
  let host = '127.0.0.1';
  try {
    const configPath = path.join(HOME_DIR, 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      port = config.port || port;
      host = config.host || host;
    }
  } catch (e) {
    // Ignore
  }

  console.log('LLM Usage Tracker: Running');
  console.log(`  PID: ${pid}`);
  console.log(`  Endpoint: http://${host}:${port}`);
}

async function statsCommand() {
  const { Storage, Aggregator } = await import('@llm-usage-tracker/core');
  const storage = new Storage();
  const aggregator = new Aggregator(storage);

  const days = argv.days || 7;
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const summary = aggregator.aggregate({ startDate, endDate });

  console.log('\n=== Usage Summary ===');
  console.log(`Period: ${startDate} to ${endDate}`);
  console.log(`Total Requests: ${summary.totalRequests}`);
  console.log(`Success: ${summary.successRequests}`);
  console.log(`Failed: ${summary.failedRequests}`);
  console.log(`Input Tokens: ${summary.totalInputTokens.toLocaleString()}`);
  console.log(`Output Tokens: ${summary.totalOutputTokens.toLocaleString()}`);
  console.log(`Cache Read: ${summary.totalCacheReadTokens.toLocaleString()}`);
  if (summary.avgLatency) {
    console.log(`Avg Latency: ${summary.avgLatency}ms`);
  }
  if (summary.avgSpeed) {
    console.log(`Avg Speed: ${summary.avgSpeed} tokens/s`);
  }

  if (summary.byProvider && summary.byProvider.length > 0) {
    console.log('\n--- By Provider ---');
    for (const p of summary.byProvider) {
      console.log(`${p.provider}: ${p.requests} requests, ${p.inputTokens + p.outputTokens} tokens`);
    }
  }

  if (summary.byModel && summary.byModel.length > 0) {
    console.log('\n--- Top Models ---');
    const topModels = summary.byModel.slice(0, 5);
    for (const m of topModels) {
      const modelStr = Array.isArray(m.model) ? m.model.join(',') : m.model;
      console.log(`${m.provider}/${modelStr}: ${m.requests} requests`);
    }
  }
}

function helpCommand() {
  console.log(`
LLM Usage Tracker CLI

Usage: lut <command> [options]

Commands:
  start     Start the usage tracker server (daemon mode by default)
  stop      Stop the server
  restart   Restart the server
  status    Show server status
  stats     Show usage statistics
  help      Show this help message

Options for 'start':
  --port        Server port (default: 3456)
  --host        Server host (default: 127.0.0.1)
  --target      Proxy target URL (optional)
  --apiKey      API key for authentication (optional)
  -f, --foreground   Run in foreground mode (not daemon)

Options for 'stats':
  --days     Number of days to summarize (default: 7)

Examples:
  lut start                          # Start in background
  lut start -f                       # Start in foreground
  lut start --port 3457              # Custom port
  lut start --target https://api.anthropic.com --apiKey sk-xxx
  lut stop                           # Stop the service
  lut status                         # Check if running
  lut stats --days 30                # Show 30-day stats
`);
}

main().catch(console.error);
