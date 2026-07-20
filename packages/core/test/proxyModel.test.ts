import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProxiedModel } from '../src/proxyModel';

test('uses the upstream model when SSE advertises one', () => {
  assert.equal(
    resolveProxiedModel({
      responseModel: 'MiniMax-M3.0',
      requestModel: 'glm-4.7',
      inputTokens: 1745,
      outputTokens: 3703,
    }),
    'MiniMax-M3.0',
  );
});

test('returns unknown when upstream omits model and no tokens were billed', () => {
  assert.equal(
    resolveProxiedModel({
      responseModel: undefined,
      requestModel: 'glm-4.7',
      inputTokens: 0,
      outputTokens: 0,
    }),
    'unknown',
  );
});

test('falls back to request model when upstream omits model but tokens were billed', () => {
  assert.equal(
    resolveProxiedModel({
      responseModel: undefined,
      requestModel: 'MiniMax-M3.0',
      inputTokens: 96,
      outputTokens: 101,
    }),
    'MiniMax-M3.0',
  );
});

test('returns unknown when neither upstream nor request model is available', () => {
  assert.equal(
    resolveProxiedModel({
      responseModel: undefined,
      requestModel: undefined,
      inputTokens: 12,
      outputTokens: 4,
    }),
    'unknown',
  );
});