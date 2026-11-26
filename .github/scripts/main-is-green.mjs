// The "Main is green" gate. A pull request labeled run-ci passes or fails with its own
// tests.yml run on its head; any other pull request passes or fails with main.
import { pathToFileURL } from 'node:url';

export const RUN_CI_LABEL = 'run-ci';
const WORKFLOW = 'tests.yml';

export const decide = ({ optedIn, ownRun = null, mainRun = null }) => {
  if (optedIn) {
    if (ownRun === null) {
      return { pass: false, dispatch: true, message: `${RUN_CI_LABEL}: no ${WORKFLOW} run on this head; dispatched one, waiting on it` };
    }
    if (ownRun.status !== 'completed') {
      return { pass: false, dispatch: false, message: `${RUN_CI_LABEL}: waiting on ${ownRun.html_url}` };
    }
    return ownRun.conclusion === 'success'
      ? { pass: true, dispatch: false, message: `${RUN_CI_LABEL}: this head is green: ${ownRun.html_url}` }
      : { pass: false, dispatch: false, message: `${RUN_CI_LABEL}: this head is red (${ownRun.conclusion}): ${ownRun.html_url}` };
  }
  if (mainRun === null || mainRun.conclusion === 'success') {
    return { pass: true, dispatch: false, message: 'main is green' };
  }
  return { pass: false, dispatch: false, message: `main is red (${mainRun.conclusion}): ${mainRun.html_url}` };
};

const main = async () => {
  const { GH_TOKEN, REPO, PR, HEAD_SHA, HEAD_REF } = process.env;
  const api = async (path, init = {}) => {
    const response = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${GH_TOKEN}`, accept: 'application/vnd.github+json' },
    });
    if (!response.ok) { throw new Error(`${init.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`); }
    return response.status === 204 ? null : response.json();
  };

  const workflow = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}`, {
    headers: { authorization: `Bearer ${GH_TOKEN}` },
  });
  if (workflow.status === 404) {
    console.log(`No ${WORKFLOW} in ${REPO}.`);
    return;
  }

  // Read the labels fresh: a re-run replays the original event payload.
  const labels = await api(`/issues/${PR}/labels`);
  const optedIn = labels.some(label => label.name === RUN_CI_LABEL);
  const runs = async query => (await api(`/actions/workflows/${WORKFLOW}/runs?${query}`)).workflow_runs;
  const result = optedIn
    ? decide({ optedIn, ownRun: (await runs(`head_sha=${HEAD_SHA}&per_page=1`))[0] ?? null })
    // biome-ignore lint/security/noSecrets: a query string, not a secret
    : decide({ optedIn, mainRun: (await runs('branch=main&status=completed&per_page=1'))[0] ?? null });

  if (result.dispatch) {
    await api(`/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref: HEAD_REF, inputs: { kind: 'plain' } }),
    });
  }
  console.log(result.message);
  if (!result.pass) { process.exitCode = 1; }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) { await main(); }
