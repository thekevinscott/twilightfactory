import { expect, test } from 'vitest';
import { registerConflictResolver } from '../../../../packages/twilight-factory/src/conflict-resolver.ts';

// The fixture agent dir overrides the model, so these specs read the definition pi-subagents receives.
const registrations = () => {
  const requests: { definition: { model?: string } }[] = [];
  const pi = {
    events: {
      emit: (_: string, request: { definition: { model?: string }; result?: unknown }) => {
        requests.push(request);
        request.result = { ok: true, registration: { dispose: () => undefined } };
      },
    },
  } as unknown as Parameters<typeof registerConflictResolver>[0];
  registerConflictResolver(pi);
  return requests;
};

test('It registers the conflict resolver on Haiku', () => {
  const [request] = registrations();
  expect(request?.definition.model).toBe('claude-bridge/claude-haiku-5-5');
});
