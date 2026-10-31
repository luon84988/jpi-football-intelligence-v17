"""Publish only the validated snapshot onto current main, never replay old code."""
from datetime import datetime
import json
from pathlib import Path
import subprocess
import tempfile

class PublishError(RuntimeError):
    pass

def git(repo, *args):
    p = subprocess.run(['git', '-C', str(repo), *args], capture_output=True, text=True, timeout=60)
    if p.returncode:
        raise PublishError(p.stderr.strip() or 'Git command failed')
    return p.stdout.strip()

def observed_at(payload):
    date = datetime.fromisoformat(payload['source_updated_at'].replace('Z', '+00:00'))
    if not date.tzinfo:
        raise PublishError('Snapshot source timestamp requires timezone')
    return date

def publish(repo, snapshot, max_attempts=3):
    repo, snapshot = Path(repo).resolve(), Path(snapshot).resolve()
    raw = snapshot.read_bytes(); candidate = json.loads(raw); candidate_time = observed_at(candidate)
    if candidate.get('stale') is not False or not candidate.get('matches'):
        raise PublishError('Nonempty validated current snapshot required')
    last_error = None
    for attempt in range(1, max_attempts+1):
        with tempfile.TemporaryDirectory(prefix='jpi-publish-') as folder:
            worktree = Path(folder) / 'checkout'; added = False
            try:
                git(repo, 'fetch', '--no-tags', 'origin', 'refs/heads/main')
                base = git(repo, 'rev-parse', 'FETCH_HEAD')
                git(repo, 'worktree', 'add', '--detach', str(worktree), base); added = True
                target = worktree / 'dashboard_data.json'
                if target.exists():
                    saved_raw = target.read_bytes(); saved = json.loads(saved_raw); saved_time = observed_at(saved)
                    if saved_time > candidate_time:
                        return {'status': 'CURRENT_SNAPSHOT_NEWER', 'commit_sha': base, 'attempt': attempt}
                    if saved_time == candidate_time and saved.get('snapshot_hash') != candidate.get('snapshot_hash'):
                        raise PublishError('Same-time snapshots conflict; preserve current main')
                    if saved_raw == raw:
                        return {'status': 'UNCHANGED', 'commit_sha': base, 'attempt': attempt}
                target.write_bytes(raw)
                git(worktree, 'add', 'dashboard_data.json')
                git(worktree, '-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit', '-m', 'Auto-update dashboard data from verified snapshot [skip ci]')
                head = git(worktree, 'rev-parse', 'HEAD')
                try:
                    git(worktree, 'push', 'origin', 'HEAD:refs/heads/main')
                except PublishError as error:
                    last_error = error; continue
                if git(worktree, 'show', head+':dashboard_data.json') != raw.decode('utf-8').strip():
                    raise PublishError('Published commit snapshot readback failed')
                return {'status': 'PUBLISHED', 'commit_sha': head, 'base_sha': base, 'attempt': attempt}
            finally:
                if added:
                    git(repo, 'worktree', 'remove', '--force', str(worktree))
    raise PublishError('Snapshot push failed after bounded retries: '+str(last_error))

if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    print(json.dumps(publish(root, root/'dashboard_data.json')))
