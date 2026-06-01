/**
 * Proxy hook - intercept and forward LLM API requests
 */

import type { FastifyInstance } from 'fastify';
import type { Storage } from '@llm-usage-tracker/core';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Transform, Readable } from 'node:stream';
import { getLocalDate, getProvidersConfig } from '@llm-usage-tracker/core';

interface ProxyConfig {
  target: string;
  storage: Storage;
  apiKey?: string;
  logsDir?: string;
}

// API paths to proxy and track
const PROXY_PATHS = ['/v1/messages', '/chat/completions', '/v1/chat/completions'];

function isProxyablePath(path: string): boolean {
  return PROXY_PATHS.some(p => path.includes(p));
}

export async function createProxyHook(fastify: FastifyInstance, config: ProxyConfig) {
  const { target, storage, apiKey, logsDir } = config;

  // Ensure logs directory exists
  const effectiveLogsDir = logsDir || path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.llm-usage-tracker', 'logs');
  if (!fs.existsSync(effectiveLogsDir)) {
    fs.mkdirSync(effectiveLogsDir, { recursive: true });
  }

  // Helper to write request body log
  const logRequestBody = (requestId: string, body: unknown) => {
    const logFile = path.join(effectiveLogsDir, `requests-${getLocalDate()}.log`);
    const logEntry = {
      time: new Date().toISOString(),
      reqId: requestId,
      type: 'request body',
      data: body
    };
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
  };

  // Helper to write response body log
  const logResponseBody = (requestId: string, text: string) => {
    const logFile = path.join(effectiveLogsDir, `requests-${getLocalDate()}.log`);
    const logEntry = {
      time: new Date().toISOString(),
      reqId: requestId,
      type: 'response body',
      data: text
    };
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
  };

  // Pre-request hook: generate request ID and start timing
  fastify.addHook('onRequest', async (request) => {
    if (!isProxyablePath(request.url)) return;
    request.id = randomUUID();
    (request as any).startTime = Date.now();
    (request as any).isProxied = true;
  });

  // Pre-handler hook to log body after parsing
  fastify.addHook('preHandler', async (request) => {
    if (!isProxyablePath(request.url)) return;
    if (request.body) {
      logRequestBody(request.id, request.body);
    } else {
      console.log('REQUEST BODY IS UNDEFINED in preHandler for', request.url, request.method);
    }
  });

  // Route handler for proxied paths
  for (const proxyPath of PROXY_PATHS) {
    fastify.all(`${proxyPath}*`, async (request, reply) => {
      if (request.body) {
        logRequestBody(request.id, request.body);
      }
      request.log.info({ url: request.url }, '--- ENTERED FASTIFY ROUTE ---');

      const targetUrl = new URL(request.url, target);

      // Forward request headers
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        if (key.toLowerCase() !== 'host' && key.toLowerCase() !== 'content-length' && typeof value === 'string') {
          headers[key] = value;
        }
      }

      // Add API key if needed
      if (apiKey && !headers['x-api-key'] && !headers['authorization']) {
        headers['x-api-key'] = apiKey;
      }

      let reqBody = request.body as any;
      if (reqBody && typeof reqBody === 'object' && reqBody.stream === true) {
        reqBody = {
          ...reqBody,
          stream_options: {
            ...(reqBody.stream_options || {}),
            include_usage: true
          }
        };
      }

      const response = await fetch(targetUrl.toString(), {
        method: request.method,
        headers,
        body: request.method !== 'GET' && request.method !== 'HEAD'
          ? JSON.stringify(reqBody)
          : undefined
      });

      // Forward response headers
      reply.status(response.status);
      for (const [key, value] of response.headers.entries()) {
        reply.header(key, value);
      }

      if (!response.body) {
        return reply.send('');
      }

      const contentType = response.headers.get('content-type') || '';
      const isEventStream = contentType.includes('event-stream');
      
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheCreationTokens = 0;
      let cacheReadTokens = 0;
      let buffer = '';
      let errorMessage: string | undefined;
      let responseModel: string | undefined;
      let responseText = '';

      // Transform stream to intercept chunks and extract usage without consuming the stream
      const monitorStream = new Transform({
        transform(chunk, encoding, callback) {
          const text = chunk.toString();
          
          if (isEventStream) {
            buffer += text;
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
              const line = buffer.slice(0, newlineIndex).trim();
              buffer = buffer.slice(newlineIndex + 1);
              
              if (line.startsWith('data:')) {
                const dataStr = line.substring(line.indexOf(':') + 1).trim();
                if (dataStr !== '[DONE]') {
                  try {
                    const data = JSON.parse(dataStr);
                    
                    if (data.model) {
                      responseModel = data.model;
                    } else if (data.message?.model) {
                      responseModel = data.message.model;
                    }

                    // Extract text content for logging
                    if (data.type === 'content_block_delta' && data.delta) {
                      if (data.delta.thinking) {
                        // If it's the first thinking chunk, add a tag
                        if (!responseText.includes('<thinking>')) {
                          responseText += '<thinking>\n';
                        }
                        responseText += data.delta.thinking;
                      }
                      if (data.delta.text) {
                        // If we had thinking, close it before text starts
                        if (responseText.includes('<thinking>') && !responseText.includes('</thinking>')) {
                          responseText += '\n</thinking>\n\n';
                        }
                        responseText += data.delta.text;
                      }
                    } else if (data.choices?.[0]?.delta?.content) {
                      responseText += data.choices[0].delta.content;
                    }

                    // Anthropic message_start
                    if (data.type === 'message_start' && data.message?.usage) {
                      if (data.message.usage.input_tokens !== undefined) inputTokens = data.message.usage.input_tokens;
                      if (data.message.usage.cache_creation_input_tokens !== undefined) cacheCreationTokens = data.message.usage.cache_creation_input_tokens;
                      if (data.message.usage.cache_read_input_tokens !== undefined) cacheReadTokens = data.message.usage.cache_read_input_tokens;
                    }
                    // Anthropic message_delta
                    if (data.type === 'message_delta' && data.usage) {
                      if (data.usage.output_tokens !== undefined) outputTokens = data.usage.output_tokens;
                      if (data.usage.input_tokens !== undefined) inputTokens = data.usage.input_tokens;
                      if (data.usage.cache_creation_input_tokens !== undefined) cacheCreationTokens = data.usage.cache_creation_input_tokens;
                      if (data.usage.cache_read_input_tokens !== undefined) cacheReadTokens = data.usage.cache_read_input_tokens;
                    }
                    // OpenAI format
                    if (data.usage) {
                      if (data.usage.prompt_tokens !== undefined) inputTokens = data.usage.prompt_tokens;
                      if (data.usage.completion_tokens !== undefined) outputTokens = data.usage.completion_tokens;
                    }
                    if (data.error) {
                      errorMessage = data.error.message;
                    }
                  } catch (e) {
                    console.log('PARSE ERROR on chunk', dataStr, (e as Error).message);
                    // Ignore parse errors on partial/invalid JSON
                  }
                }
              }
            }
          } else {
            // Buffer the whole body for non-streaming requests
            buffer += text;
          }
          
          // Pass the chunk along unchanged
          callback(null, chunk);
        },
        flush(callback) {
          const duration = Date.now() - (request as any).startTime;
          let success = response.status >= 200 && response.status < 300;

          // Parse the fully buffered response body for non-streaming requests
          if (!isEventStream && buffer) {
            try {
              const data = JSON.parse(buffer);
              
              if (data.model) {
                responseModel = data.model;
              } else if (data.message?.model) {
                responseModel = data.message.model;
              }

              // Extract text for logging
              if (data.content && Array.isArray(data.content)) {
                responseText = data.content.map((c: any) => {
                  let text = '';
                  if (c.thinking) {
                    text += `<thinking>\n${c.thinking}\n</thinking>\n\n`;
                  }
                  if (c.text) {
                    text += c.text;
                  }
                  return text;
                }).join('');
              } else if (data.choices?.[0]?.message?.content) {
                responseText = data.choices[0].message.content;
              }

              // Anthropic usage
              if (data.usage) {
                inputTokens = data.usage.input_tokens ?? data.usage.prompt_tokens ?? inputTokens;
                outputTokens = data.usage.output_tokens ?? data.usage.completion_tokens ?? outputTokens;
                cacheCreationTokens = data.usage.cache_creation_input_tokens ?? cacheCreationTokens;
                cacheReadTokens = data.usage.cache_read_input_tokens ?? cacheReadTokens;
              }
              if (data.error) {
                success = false;
                errorMessage = data.error.message || JSON.stringify(data.error);
              }
            } catch (e) {
              // Not JSON
            }
          }

            const requestModelName = (request.body as any)?.model || 'unknown';
            const finalModelName = responseModel || requestModelName;
            
            // Log response body for UI view
            if (responseText) {
              logResponseBody(request.id as string, responseText);
            }
            
            storage.append({
              timestamp: new Date().toISOString(),
              date: getLocalDate(),
              requestId: request.id as string,
              provider: extractProvider(target, finalModelName),
              model: finalModelName,
            inputTokens,
            outputTokens,
            cacheCreationInputTokens: cacheCreationTokens || undefined,
            cacheReadInputTokens: cacheReadTokens || undefined,
            stream: (request.body as any)?.stream || false,
            success,
            errorMessage,
            duration
          });

          callback();
        }
      });

      // Pipe the Web Stream through our Node Transform Stream and send to Fastify reply
      request.log.info('--- CREATING NODE STREAM ---');
      try {
        let nodeStream: NodeJS.ReadableStream;
        if (typeof (response.body as any).pipe === 'function') {
          // Already a node stream
          nodeStream = response.body as unknown as NodeJS.ReadableStream;
        } else {
          nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream);
        }
        return reply.send(nodeStream.pipe(monitorStream));
      } catch (e) {
        request.log.error({ err: e }, '--- ERROR PIPING STREAM ---');
        return reply.send(response.body);
      }
    });
  }
}

function extractProvider(target: string, model: string): string {
  if (target.includes('anthropic')) return 'anthropic';
  if (target.includes('openai')) return 'openai';
  if (target.includes('gemini') || target.includes('generativelanguage.googleapis')) return 'gemini';
  if (target.includes('deepseek')) return 'deepseek';
  if (target.includes('openrouter')) return 'openrouter';

  const m = model.toLowerCase();
  const config = getProvidersConfig();
  
  for (const [provider, prefixes] of Object.entries(config)) {
    if (prefixes.some(prefix => m.startsWith(prefix))) {
      return provider;
    }
  }
  
  return 'custom';
}