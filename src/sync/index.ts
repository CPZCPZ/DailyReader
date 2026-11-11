import { useSettings } from '../store/useSettings';
import { GitHubSyncProvider } from './GitHubSyncProvider';
import type { SyncProvider } from './SyncProvider';

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

/** 读取设置并返回可用的同步 Provider；未配置完整时返回 null */
export function getSync(): SyncProvider | null {
  const { token, owner, repo } = useSettings.getState();
  if (!token || !owner || !repo) return null;
  return new GitHubSyncProvider({ token, owner, repo });
}

export function isSyncConfigured(): boolean {
  const { token, owner, repo } = useSettings.getState();
  return Boolean(token && owner && repo);
}
