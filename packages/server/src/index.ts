/**
 * LLM Usage Tracker Server
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { config } from 'dotenv';
import { Storage, Aggregator, LogReader, CodexLogReader } from '@llm-usage-tracker/core';
import { createRoutes } from './routes';
import { createProxyHook } from './proxy';

config();

const DEFAULT_PORT = 3456;
const DEFAULT_HOST = '127.0.0.1';

export interface ServerConfig {
  port?: number;
  host?: string;
  storageDir?: string;
  logsDir?: string;
  proxyTarget?: string;
  apiKey?: string;
  codexSessionsDir?: string;
}

export async function createServer(serverConfig: ServerConfig = {}) {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info'
    }
  });

  // Register CORS
  await fastify.register(cors, {
    origin: true,
    credentials: true
  });

  // Initialize core modules
  const storage = new Storage(serverConfig);
  const aggregator = new Aggregator(storage);
  const logReader = new LogReader(serverConfig);
  const codexLogReader = new CodexLogReader(storage, serverConfig);

  // Codex IDE/CLI sessions are local JSONL files, not traffic sent through this proxy.
  // Import new usage events at startup and keep the dashboard current while running.
  const importCodexUsage = () => {
    const imported = codexLogReader.sync();
    if (imported > 0) fastify.log.info({ imported }, 'Imported Codex usage records');
  };
  importCodexUsage();
  const codexImportTimer = setInterval(importCodexUsage, 5000);
  fastify.addHook('onClose', async () => clearInterval(codexImportTimer));

  // Register API routes
  await fastify.register(createRoutes, {
    storage,
    aggregator,
    logReader,
    codexLogReader,
    apiKey: serverConfig.apiKey
  });

  // Register proxy hook if target is configured
  if (serverConfig.proxyTarget) {
    await createProxyHook(fastify, {
      target: serverConfig.proxyTarget,
      storage,
      apiKey: serverConfig.apiKey,
      logsDir: serverConfig.logsDir
    });
  }

  // Serve static UI files (if built)
  // Try multiple paths to find UI dist (works for both development and bundled CLI)
  const possibleUiPaths = [
    path.join(__dirname, '..', '..', 'ui', 'dist'),  // Development: packages/server/dist -> packages/ui/dist
    path.join(__dirname, 'ui'),                      // Bundled: dist/cli.js -> dist/ui (if bundled together)
    path.resolve(__dirname, '..', 'ui', 'dist'),     // Alternative relative path
  ];

  let uiDistPath: string | null = null;
  for (const p of possibleUiPaths) {
    if (fs.existsSync(p) && fs.existsSync(path.join(p, 'index.html'))) {
      uiDistPath = p;
      break;
    }
  }

  if (uiDistPath && path.resolve(uiDistPath) !== path.resolve(__dirname)) {
    try {
      await fastify.register(staticPlugin, {
        root: uiDistPath,
        prefix: '/'
      });
      fastify.log.info(`UI static files served from ${uiDistPath}`);
    } catch (e) {
      fastify.log.warn('UI dist registration failed, skipping static file serving');
    }
  } else {
    fastify.log.warn('UI dist not found, skipping static file serving');
  }

  return fastify;
}

export async function startServer(serverConfig: ServerConfig = {}) {
  const fastify = await createServer(serverConfig);

  const port = serverConfig.port || parseInt(process.env.PORT || '') || DEFAULT_PORT;
  const host = serverConfig.host || process.env.HOST || DEFAULT_HOST;

  await fastify.listen({ port, host });
  fastify.log.info(`Server started at http://${host}:${port}`);

  return fastify;
}
