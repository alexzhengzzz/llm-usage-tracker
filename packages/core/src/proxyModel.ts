/**
 * Decide how the proxy should attribute a request to a model.
 *
 * Upstream SSE often omits a `model` field for internal handshakes
 * (zero-token preflight calls, image-tool probes, etc.) which would
 * otherwise fall back to the Claude request body's `model` and
 * misattribute usage to a different provider.
 */

export interface AttributionInputs {
  responseModel?: string;
  requestModel?: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export function resolveProxiedModel(input: AttributionInputs): string {
  if (input.responseModel && input.responseModel.trim().length > 0) {
    return input.responseModel;
  }

  const totalInput = input.inputTokens
    + (input.cacheCreationInputTokens ?? 0)
    + (input.cacheReadInputTokens ?? 0);

  if (totalInput === 0 && input.outputTokens === 0) {
    return 'unknown';
  }

  return input.requestModel && input.requestModel.trim().length > 0
    ? input.requestModel
    : 'unknown';
}