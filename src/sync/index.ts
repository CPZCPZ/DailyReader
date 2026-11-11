import { useSettings } from '../store/useSettings';
import { GitHubSyncProvider } from './GitHubSyncProvider';

export type { SyncProvider } from './SyncProvider';
export {
  mergeShelves,
  pickProgress,
} from './merge';
export {
  GitHubSyncProvider,
  friendlyError,
  MAX_BOOK_BYTES,
} from './GitHubSyncProvider';

/** 读取设置并返回可用的同步 Provider；未配置完整时返回 null。
 * 单例缓存：同一配置复用实例，使所有写操作共享同一条串行队列，
 * 避免多实例并发读 head 导致 "not a fast forward" 冲突。 */
const providerCache = new Map<string, GitHubSyncProvider>();

export function getSync(): GitHubSyncProvider | null {
  const { token, owner, repo } = useSettings.getState();
  if (!token || !owner || !repo) return null;
  const key = `${token}|${owner}|${repo}`;
  let p = providerCache.get(key);
  if (!p) {
    p = new GitHubSyncProvider({ token, owner, repo });
    providerCache.set(key, p);
    // 缓存不宜无限增长（token 轮换等），超过 8 个清掉最旧的
    if (providerCache.size > 8) {
      const firstKey = providerCache.keys().next().value;
      if (firstKey) providerCache.delete(firstKey);
    }
  }
  return p;
}

export function isSyncConfigured(): boolean {
  const { token, owner, repo } = useSettings.getState();
  return Boolean(token && owner && repo);
}
