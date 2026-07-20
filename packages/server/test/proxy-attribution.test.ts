import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { Storage } from '@llm-usage-tracker/core';
import { createProxyHook } from '../src/proxy';

class FakeStorage {
  records: any[] = [];

  append(record: any) {
    this.records.push(record);
    return { ...record, id: `rec-${this.records.length}` };
  }
}

function buildUpstream(fastify: any) {
  fastify.post('/v1/messages', async (request: any, reply: any) => {
    reply.header('content-type', 'text/event-stream');
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream' });
    // No model field is emitted, no usage tokens are emitted — matches the
    // handshake pattern observed for the offending glm-4.7 record.
    reply.raw.write('event: message_start\ndata: {"type":"message_start","message":{"id":"m","role":"assistant","content":[],"usage":{}}}\n\n');
    reply.raw.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    reply.raw.end();
  });
}

test('proxy attributes unknown upstream calls instead of leaking the client model', async () => {
  const upstream = Fastify({ logger: false });
  buildUpstream(upstream);
  const upstreamPort = await new Promise<number>((resolve) => {
    upstream.listen({ port: 0, host: '127.0.0.1' }, (err: Error | null, address: string) => {
      if (err) throw err;
      resolve(Number(address.split(':').pop()));
    });
  });

  try {
    const tracker = Fastify({ logger: false });
    const storage = new FakeStorage();
    await createProxyHook(tracker, {
      target: `http://127.0.0.1:${upstreamPort}`,
      storage: storage as unknown as Storage,
      logsDir: '/tmp/lut-attribution-test',
    });

    const response = await tracker.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: { model: 'glm-4.7', stream: true, messages: [{ role: 'user', content: 'ping' }] },
    });

    assert.equal(response.statusCode, 200);
    await tracker.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(storage.records.length, 1);
    const record = storage.records[0];
    assert.notEqual(record.model, 'glm-4.7', 'should not attribute to client-supplied model');
    assert.equal(record.model, 'unknown');
    assert.equal(record.inputTokens, 0);
    assert.equal(record.outputTokens, 0);
  } finally {
    await upstream.close();
  }
});