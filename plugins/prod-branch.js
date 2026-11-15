import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// dist/ is a git worktree of `prod`. After each build, `prod` is replaced with a single commit of dist/
// and FORCE-PUSHED to origin. Skipped when process.env.CI is set. Git failures only warn.
export default function prodBranch({ branch = 'prod', remote = 'origin' } = {}) {
	let outDir;
	let active = false;
	const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
	const tryGit = (args, cwd) => {
		try {
			return git(args, cwd);
		} catch {
			return null;
		}
	};
	const warn = (msg) => console.warn(`[prod-branch] ${msg}`);

	return {
		name: 'prod-branch',
		apply: 'build',

		configResolved(config) {
			outDir = path.resolve(config.root, config.build.outDir);
		},

		buildStart() {
			if (process.env.CI) return;
			try {
				if (!existsSync(path.join(outDir, '.git'))) {
					rmSync(outDir, { recursive: true, force: true });
					git(['worktree', 'prune']);
					tryGit(['fetch', '--quiet', remote, branch]);
					if (tryGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])) {
						git(['worktree', 'add', '--quiet', outDir, branch]);
					} else if (tryGit(['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${branch}`])) {
						git(['worktree', 'add', '--quiet', '-b', branch, outDir, `${remote}/${branch}`]);
					} else {
						git(['worktree', 'add', '--quiet', '--orphan', '-b', branch, outDir]);
					}
					console.log(`[prod-branch] dist/ is now a checkout of ${branch}`);
				}
				if (git(['branch', '--show-current'], outDir) !== branch) throw new Error(`dist/ is not on ${branch}`);
				active = true;
			} catch (err) {
				warn(`disabled for this build: ${err.message.split('\n')[0]}`);
			}
		},

		closeBundle() {
			if (!active) return;
			try {
				// dist/.git is a pointer file; keep it out of the Cloudflare upload
				writeFileSync(path.join(outDir, '.assetsignore'), '.git\n');

				const source = `${git(['branch', '--show-current']) || 'detached'}@${git(['rev-parse', '--short', 'HEAD'])}`;
				const dirty = git(['status', '--porcelain']) ? ' (with uncommitted changes)' : '';

				git(['add', '--all', '--force', '.'], outDir);
				const tree = git(['write-tree'], outDir);
				const commit = git(['commit-tree', tree, '-m', `Build from ${source}${dirty}`], outDir);
				git(['reset', '--soft', commit], outDir);
				console.log(`[prod-branch] ${branch} → ${commit.slice(0, 7)} (build from ${source}${dirty})`);

				if (tryGit(['push', '--force', '--quiet', remote, `${branch}:${branch}`], outDir) === null) {
					warn(`could not push ${branch} to ${remote}; it is updated locally only.`);
				} else {
					console.log(`[prod-branch] pushed ${branch} to ${remote}`);
				}
			} catch (err) {
				warn(`skipped: ${err.message.split('\n')[0]}`);
			}
		},
	};
}
