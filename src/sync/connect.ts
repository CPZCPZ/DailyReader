import { useSettings } from '../store/useSettings';
import { GitHubSyncProvider } from './GitHubSyncProvider';
import { syncNow, type SyncProgress, type SyncResult } from './orchestrator';

/** GitHub Pages 域名 `用户名.github.io` 时，预填仓库所有者。 */
export function suggestOwner(hostname = location.hostname): string {
  const suffix = '.github.io';
  if (!hostname.endsWith(suffix)) return '';
  const sub = hostname.slice(0, -suffix.length);
  if (!sub || sub.includes('.')) return '';
  return sub;
}

/**
 * 测试连接、确保数据仓库存在，然后全量同步。
 * 设置页和首次向导共用这一条路径。
 */
export async function connectAndSync(
  onProgress: SyncProgress = () => {},
): Promise<SyncResult> {
  const { token, owner, repo } = useSettings.getState();
  if (!token || !owner || !repo) {
    return { ok: false, message: '请填写 Token、用户名和仓库名' };
  }
  onProgress('测试连接…');
  const provider = new GitHubSyncProvider({ token, owner, repo });
  const test = await provider.testConnection();
  if (!test.ok) return { ok: false, message: test.message };
  onProgress(test.repoExists === false ? '创建数据仓库…' : '准备数据仓库…');
  try {
    await provider.ensureRepo();
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  onProgress('正在同步…');
  return syncNow(onProgress);
}
