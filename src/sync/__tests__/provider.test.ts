import { describe, expect, it, vi, type Mock } from 'vitest';
import { GitHubSyncProvider } from '../GitHubSyncProvider';

/**
 * 用 mock 的 octokit 实例直测 GitHubSyncProvider 的写路径：
 * - 数据仓库形状守卫（防误用代码仓库）
 * - 空仓库自动初始化（Contents API PUT）
 * - fast-forward 冲突自动重试（带退避）
 */

type Rest = Record<string, Record<string, Mock>>;

function makeOctokit(overrides: Partial<Rest> = {}): {
  octo: { rest: Rest; request: Mock };
  rest: Rest;
  request: Mock;
} {
  const rest: Rest = {
    git: {
      getRef: vi.fn(),
      createBlob: vi.fn(),
      createTree: vi.fn(),
      createCommit: vi.fn(),
      updateRef: vi.fn(),
    },
    repos: {
      get: vi.fn(),
      listCommits: vi.fn(),
      createOrUpdateFileContents: vi.fn(),
    },
    users: {
      getAuthenticated: vi.fn(),
    },
    ...overrides,
  };
  const request = vi.fn();
  rest.repos.get.mockResolvedValue({ data: { default_branch: 'main' } });
  return { octo: { rest, request }, rest, request };
}

const cfg = { token: 't', owner: 'u', repo: 'reader-data' };
const SHELF_B64 = Buffer.from('[]').toString('base64');
const TIP = { sha: 'head-sha', commit: { tree: { sha: 'tree-sha' } } };
const BLOB = { data: { sha: 'blob-sha' } };
const TREE = { data: { sha: 'new-tree-sha' } };
const COMMIT = { data: { sha: 'new-commit-sha' } };

/** request mock 路由：带 path 参数的是文件读取，否则是 getHead 的 commits 列表 */
function routeRequest(request: Mock) {
  request.mockImplementation(async (_tpl: string, params: Record<string, unknown>) => {
    if ('path' in params) {
      return { data: { type: 'file', encoding: 'base64', content: SHELF_B64 } };
    }
    return { data: [TIP] };
  });
}

/** 配置一个"合法数据仓库"（有 main + shelf.json）的 mock */
function validDataRepo(rest: Rest, request: Mock) {
  routeRequest(request);
  rest.git.createBlob.mockResolvedValue(BLOB);
  rest.git.createTree.mockResolvedValue(TREE);
  rest.git.createCommit.mockResolvedValue(COMMIT);
  rest.git.updateRef.mockResolvedValue({ data: {} });
}

describe('写入口形状守卫', () => {
  it('仓库有 main 但无 shelf.json（如代码仓库）→ 拒绝写入并给出明确原因', async () => {
    const { octo, rest, request } = makeOctokit();
    rest.git.getRef.mockResolvedValue({ data: { object: { sha: 'x' } } });
    request.mockRejectedValue({ status: 404 }); // shelf.json 不存在

    const p = new GitHubSyncProvider(cfg, octo as never);
    await expect(p.pushShelf([])).rejects.toThrow(/不是 DailyReader 数据仓库/);
    expect(rest.git.createBlob).not.toHaveBeenCalled();
    expect(rest.git.updateRef).not.toHaveBeenCalled();
  });

  it('空仓库（404）→ 自动初始化（Contents PUT）后正常写入', async () => {
    const { octo, rest, request } = makeOctokit();
    rest.git.getRef.mockRejectedValue({ status: 404 });
    rest.repos.createOrUpdateFileContents.mockResolvedValue({ data: {} });
    routeRequest(request);
    rest.git.createBlob.mockResolvedValue(BLOB);
    rest.git.createTree.mockResolvedValue(TREE);
    rest.git.createCommit.mockResolvedValue(COMMIT);
    rest.git.updateRef.mockResolvedValue({ data: {} });

    const p = new GitHubSyncProvider(cfg, octo as never);
    await p.pushShelf([]);
    expect(rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'shelf.json' }),
    );
    expect(rest.git.updateRef).toHaveBeenCalled();
  });

  it('GitHub 空仓库怪癖：refs 接口 409 "Git Repository is empty" 同样视为空仓库', async () => {
    const { octo, rest, request } = makeOctokit();
    rest.git.getRef.mockRejectedValue({
      status: 409,
      message: 'Git Repository is empty.',
    });
    rest.repos.createOrUpdateFileContents.mockResolvedValue({ data: {} });
    routeRequest(request);
    rest.git.createBlob.mockResolvedValue(BLOB);
    rest.git.createTree.mockResolvedValue(TREE);
    rest.git.createCommit.mockResolvedValue(COMMIT);
    rest.git.updateRef.mockResolvedValue({ data: {} });

    const p = new GitHubSyncProvider(cfg, octo as never);
    await p.pushShelf([]);
    expect(rest.repos.createOrUpdateFileContents).toHaveBeenCalled();
  });
});

describe('fast-forward 冲突重试', () => {
  it('updateRef 首次 409 → 用最新 head 重建提交，第二次成功', async () => {
    const { octo, rest, request } = makeOctokit();
    validDataRepo(rest, request);
    rest.git.updateRef
      .mockRejectedValueOnce({
        status: 409,
        message: 'Update is not a fast forward',
      })
      .mockResolvedValue({ data: {} });

    const p = new GitHubSyncProvider(cfg, octo as never);
    p.retryBackoffMs = [0, 0, 0, 0];
    await p.pushShelf([]);
    expect(rest.git.updateRef).toHaveBeenCalledTimes(2);
    // 重试时重新读取了最新 head（无 path 参数的 request 调用）
    const headCalls = request.mock.calls.filter((c) => !('path' in (c[1] || {}))).length;
    expect(headCalls).toBeGreaterThanOrEqual(2);
  });

  it('连续 4 次冲突（422 fast forward）→ 抛错（不让重试无限循环）', async () => {
    const { octo, rest, request } = makeOctokit();
    validDataRepo(rest, request);
    rest.git.updateRef.mockRejectedValue({
      status: 422,
      message: 'Update is not a fast forward',
    });

    const p = new GitHubSyncProvider(cfg, octo as never);
    p.retryBackoffMs = [0, 0, 0, 0];
    await expect(p.pushShelf([])).rejects.toMatchObject({ status: 422 });
    expect(rest.git.updateRef).toHaveBeenCalledTimes(4);
  });

  it('非冲突错误不重试，直接抛出', async () => {
    const { octo, rest, request } = makeOctokit();
    validDataRepo(rest, request);
    rest.git.updateRef.mockRejectedValue({ status: 403, message: 'Forbidden' });

    const p = new GitHubSyncProvider(cfg, octo as never);
    await expect(p.pushShelf([])).rejects.toMatchObject({ status: 403 });
    expect(rest.git.updateRef).toHaveBeenCalledTimes(1);
  });
});

describe('testConnection 形状报告', () => {
  it('代码仓库（有内容无 shelf.json）→ ok:false 并说明原因', async () => {
    const { octo, rest, request } = makeOctokit();
    rest.users.getAuthenticated.mockResolvedValue({ data: { login: 'u' } });
    rest.repos.get.mockResolvedValue({ data: { full_name: 'u/DailyReader' } });
    rest.git.getRef.mockResolvedValue({ data: { object: { sha: 'x' } } });
    request.mockRejectedValue({ status: 404 });

    const p = new GitHubSyncProvider(cfg, octo as never);
    const r = await p.testConnection();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/不是 DailyReader 数据仓库/);
  });

  it('合法数据仓库 → ok:true 就绪', async () => {
    const { octo, rest, request } = makeOctokit();
    rest.users.getAuthenticated.mockResolvedValue({ data: { login: 'u' } });
    rest.repos.get.mockResolvedValue({ data: { full_name: 'u/reader-data' } });
    rest.git.getRef.mockResolvedValue({ data: { object: { sha: 'x' } } });
    request.mockResolvedValue({
      data: { type: 'file', encoding: 'base64', content: SHELF_B64 },
    });

    const p = new GitHubSyncProvider(cfg, octo as never);
    const r = await p.testConnection();
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/就绪/);
  });
});
