/**
 * checkpoint-commit.example.ts — report an automated git commit to Argus.
 *
 * Not a standalone hook (the actual "when do I auto-commit" logic is highly
 * specific to whatever workflow/spec-tracking system you're running). This
 * is the snippet to drop into wherever YOUR automation already does
 * `git commit` on your behalf, right after a successful commit:
 *
 *   const sha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD']).toString().trim();
 *   await pushToArgus(...)   <-- this part
 *
 * `project` is set to the repo's basename rather than cwd's, since the repo
 * being committed to may differ from wherever your automation is running.
 */

import { basename } from 'path';
import { pushToArgus } from './push-to-argus';

export async function reportCheckpointCommit(opts: {
  repo: string;
  sha: string;
  sessionId?: string;
  commitId: string;       // e.g. a task/ticket id this commit closes out
  description: string;
}) {
  await pushToArgus(
    'command',
    `Checkpoint commit: ${opts.commitId}`,
    opts.sessionId,
    { commit_id: opts.commitId, repo: opts.repo, sha: opts.sha, description: opts.description },
    { project: basename(opts.repo), status: 'success' }
  );
}
