/**
 * 日常积分奖励动态领取
 * 对齐前端 dailyTaskState.js / dailyTaskRunner.js：
 * 1. system_getdatabundlever 取配置版本
 * 2. 拉官方 config.json 的 DayLimitConf（积分档位 id/limit）
 * 3. 读 role.dailyTask 的 dailyPoint/dailyReward，算出可领取的档位 ID
 * 4. 逐个 task_claimdailyreward {rewardId}
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 按配置版本缓存档位，避免每角色重复拉取
const rewardsCache = new Map();

async function fetchDailyRewards(client) {
  const verResp = await client.sendWithPromise(
    "system_getdatabundlever",
    {},
    15000,
  );
  const version = verResp?.dataBundleVer;
  if (typeof version !== "string" || !/^[\w-]+$/.test(version)) {
    throw new Error("服务器未提供有效的任务配置版本");
  }
  if (rewardsCache.has(version)) return rewardsCache.get(version);

  const url = `https://xxz-xyzw-res.hortorgames.com/data/${version}/config.json`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error("官方任务配置读取失败");
  const config = await resp.json();

  const dailyRewards = Object.values(config?.DayLimitConf ?? {}).filter(
    (r) => Number.isInteger(r.id) && Number.isFinite(r.limit) && r.limit >= 0,
  );
  rewardsCache.set(version, dailyRewards);
  return dailyRewards;
}

/**
 * 依据当前积分与已领地图，返回可领取的档位 ID。
 * @param {object} dailyTask role.dailyTask（dailyPoint / dailyReward）
 * @param {Array<{id:number,limit:number}>} dailyRewards 积分档位
 * @returns {number[]}
 */
export function getClaimableIds(dailyTask, dailyRewards) {
  const points = dailyTask?.dailyPoint;
  const claimed = dailyTask?.dailyReward;
  if (
    !Number.isFinite(points) ||
    !claimed ||
    typeof claimed !== "object" ||
    Array.isArray(claimed)
  ) {
    return [];
  }
  return dailyRewards
    .filter((r) => points >= r.limit && claimed[r.id] !== true)
    .map((r) => r.id);
}

/**
 * 执行日常积分奖励动态领取。
 * @param {GameClient} client 已连接的游戏客户端
 * @returns {Promise<{ids:number[], points:number|undefined, results:Array}>}
 */
export async function claimDailyRewards(client) {
  const dailyRewards = await fetchDailyRewards(client);
  const roleResp = await client.sendWithPromise(
    "role_getroleinfo",
    {},
    15000,
  );
  const dailyTask = roleResp?.role?.dailyTask;
  const ids = getClaimableIds(dailyTask, dailyRewards);

  const results = [];
  for (const rewardId of ids) {
    try {
      await client.sendWithPromise(
        "task_claimdailyreward",
        { rewardId },
        8000,
      );
      results.push({ rewardId, success: true });
    } catch (e) {
      results.push({ rewardId, success: false, error: e.message });
    }
    await sleep(500);
  }
  return {
    ids,
    points: dailyTask?.dailyPoint,
    rewardsCount: dailyRewards.length,
    results,
  };
}
