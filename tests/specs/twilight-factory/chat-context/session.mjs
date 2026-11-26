// Runs tf's extension in a Pi session on a scripted (faux) model, so no real model is called.
// Prints the active tf tools, the tf prompt section, then the result of each tool named on the command line.
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const tf = fileURLToPath(new URL('../../../../packages/twilight-factory/', import.meta.url));
// Both packages export only `import`, so they are found by path; pi-ai is a dependency of Pi, not of tf.
const piDir = realpathSync(path.join(tf, 'node_modules/@earendil-works/pi-coding-agent'));
const pi = await import(pathToFileURL(path.join(piDir, 'dist/index.js')).href);
const { createFauxCore, fauxAssistantMessage, fauxToolCall } = await import(pathToFileURL(path.join(piDir, '../pi-ai/dist/index.js')).href);
const { default: tfExtension } = await import(pathToFileURL(path.join(tf, 'dist/extension.js')).href);

const cwd = process.cwd();
const agentDir = path.join(tmpdir(), `tf-chat-context-${process.pid}`);
const faux = createFauxCore({ provider: 'faux', models: [{ id: 'faux' }] });
const modelRuntime = await pi.ModelRuntime.create({ authPath: path.join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false });
modelRuntime.registerProvider('faux', {
  api: faux.api,
  apiKey: 'faux',
  baseUrl: 'http://faux.invalid',
  streamSimple: faux.streamSimple,
  models: [{ id: 'faux', name: 'faux', input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 1000 }],
});

const resourceLoader = new pi.DefaultResourceLoader({ cwd, agentDir, noExtensions: true, extensionFactories: [tfExtension] });
await resourceLoader.reload();
const { session } = await pi.createAgentSession({
  cwd,
  agentDir,
  model: modelRuntime.getModel('faux', 'faux'),
  modelRuntime,
  resourceLoader,
  sessionManager: pi.SessionManager.inMemory(cwd),
  settingsManager: pi.SettingsManager.inMemory({}),
});
await session.bindExtensions({});

const tools = process.argv.slice(2);
faux.setResponses([...tools.map(name => fauxAssistantMessage(fauxToolCall(name, {}), { stopReason: 'toolUse' })), fauxAssistantMessage('done')]);
await session.prompt('What is going on in this repo?');

const out = [`TOOLS ${session.getActiveToolNames().filter(name => name.startsWith('tf_')).join(' ')}`];
out.push(session.messages.find(message => message.sections?.twilight_factory)?.sections.twilight_factory ?? 'NO SECTION');
for (const message of session.messages) {
  if (message.role === 'toolResult') { out.push(`RESULT ${message.toolName}`, ...message.content.map(part => part.text)); }
}
console.log(out.join('\n'));
session.dispose();
process.exit(0);
