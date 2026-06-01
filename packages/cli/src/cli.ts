#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import minimist from 'minimist';
import { startServer } from '@llm-usage-tracker/server';

const argv = minimist(process.argv.slice(2));
const command = argv._[0] || 'help';

async function main() {
  switch (command) {
    case 'start':
      await startCommand();
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

async function startCommand() {
  let fileConfig: any = {};
  try {
    const configPath = path.join(os.homedir(), '.llm-usage-tracker', 'config.json');
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

  console.log(`Starting LLM Usage Tracker on ${host}:${port}`);
  if (target) {
    console.log(`Proxy target: ${target}`);
  }

  try {
    await startServer({
      port,
      host,
      proxyTarget: target,
      apiKey: apiKey
    });
    console.log('Server started successfully');
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
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
  start     Start the usage tracker server
  stats     Show usage statistics
  help      Show this help message

Options for 'start':
  --port     Server port (default: 3456)
  --host     Server host (default: 127.0.0.1)
  --target   Proxy target URL (optional)
  --apiKey   API key for authentication (optional)

Options for 'stats':
  --days     Number of days to summarize (default: 7)

Examples:
  lut start --port 3456
  lut start --target https://api.anthropic.com --apiKey sk-xxx
  lut stats --days 30
`);
}

main().catch(console.error);