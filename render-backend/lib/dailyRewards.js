/**
 * 日常/周常积分、任务积分、卡券动态领取
 * 对齐前端 dailyTaskState.js / dailyTaskRunner.js：
 * 1. system_getdatabundlever 取配置版本
 * 2. 拉官方 config.json 的 DailyTaskConf（任务）/ DayLimitConf（日常档位）/ WeekLimitConf（周常档位）
 * 3. 读 role.dailyTask / role.cardTime，算出可领取项后逐个领取
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 按配置版本缓存任务与档位配置，避免每角色重复拉取
const configCache = new Map();

async function fetchTaskConfig(client) {
  const verResp = await client.sendWithPromise(
    "system_getdatabundlever",
    {},
    15000,
  );
  const version = verResp?.dataBundleVer;
  if (typeof version !== "string" || !/^[\w-]+$/.test(version)) {
    throw new Error(`服务器未提供有效的任务配置版本（实际: ${JSON.stringify(version)}）`);
  }
  if (configCache.has(version)) return configCache.get(version);

  const url = `https://xxz-xyzw-res.hortorgames.com/data/${version}/config.json`;
  let resp;
  try {
    resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  } catch (e) {
    throw new Error(`官方任务配置请求异常: version=${version} url=${url} 错误=${e.message}`);
  }
  if (!resp.ok) {
    throw new Error(`官方任务配置读取失败: version=${version} url=${url} HTTP=${resp.status}`);
  }
  let config;
  try {
    config = await resp.json();
  } catch (e) {
    throw new Error(`官方任务配置解析失败: version=${version} url=${url} 错误=${e.message}`);
  }

  const tasks = Object.values(config?.DailyTaskConf ?? {}).filter(
    (t) => Number.isInteger(t.id) && Number.isInteger(t.completeCondition),
  );
  const dailyRewards = Object.values(config?.DayLimitConf ?? {}).filter(
    (r) => Number.isInteger(r.id) && Number.isFinite(r.limit) && r.limit >= 0,
  );
  const weeklyRewards = Object.values(config?.WeekLimitConf ?? {}).filter(
    (r) => Number.isInteger(r.id) && Number.isFinite(r.limit) && r.limit >= 0,
  );
  const cfg = { tasks, dailyRewards, weeklyRewards };
  configCache.set(version, cfg);
  return cfg;
}

/**
 * 依据积分与已领地图，返回可领取的档位 ID。
 * @param {object} dailyTask role.dailyTask
 * @param {Array<{id:number,limit:number}>} definitions 档位配置
 * @param {boolean} weekly 是否周常（weekPoint/weekReward）
 */
export function getClaimableIds(dailyTask, definitions, weekly = false) {
  const points = dailyTask?.[weekly ? "weekPoint" : "dailyPoint"];
  const claimed = dailyTask?.[weekly ? "weekReward" : "dailyReward"];
  if (
    !Number.isFinite(points) ||
    !claimed ||
    typeof claimed !== "object" ||
    Array.isArray(claimed)
  ) {
    return [];
  }
  return definitions
    .filter((r) => points >= r.limit && claimed[r.id] !== true)
    .map((r) => r.id);
}

async function fetchRole(client) {
  const roleResp = await client.sendWithPromise("role_getroleinfo", {}, 15000);
  return roleResp?.role || roleResp || {};
}

/**
 * 领取日常积分档位 task_claimdailyreward。
 */
export async function claimDailyRewards(client) {
  const cfg = await fetchTaskConfig(client);
  const role = await fetchRole(client);
  const dailyTask = role.dailyTask;
  const ids = getClaimableIds(dailyTask, cfg.dailyRewards, false);
  const claimed = dailyTask?.dailyReward;
  const claimedIds =
    claimed && typeof claimed === "object" && !Array.isArray(claimed)
      ? Object.entries(claimed)
          .filter(([, v]) => v === true)
          .map(([k]) => k)
      : null;

  const results = [];
  for (const rewardId of ids) {
    try {
      await client.sendWithPromise("task_claimdailyreward", { rewardId }, 8000);
      results.push({ rewardId, success: true });
    } catch (e) {
      results.push({ rewardId, success: false, error: e.message });
    }
    await sleep(500);
  }
  return {
    ids,
    points: dailyTask?.dailyPoint,
    rewardsCount: cfg.dailyRewards.length,
    claimedIds,
    results,
  };
}

/**
 * 领取周常积分档位 task_claimweekreward。
 */
export async function claimWeekRewards(client) {
  const cfg = await fetchTaskConfig(client);
  const role = await fetchRole(client);
  const dailyTask = role.dailyTask;
  const ids = getClaimableIds(dailyTask, cfg.weeklyRewards, true);

  const results = [];
  for (const rewardId of ids) {
    try {
      await client.sendWithPromise("task_claimweekreward", { rewardId }, 8000);
      results.push({ rewardId, success: true });
    } catch (e) {
      results.push({ rewardId, success: false, error: e.message });
    }
    await sleep(500);
  }
  return { ids, points: dailyTask?.weekPoint, results };
}

/**
 * 领取每个已完成日常任务的任务积分 task_claimdailypoint。
 * complete[condition] === -1 表示已领；>= completeValue 表示已完成可领。
 */
export async function claimDailyPoints(client) {
  const cfg = await fetchTaskConfig(client);
  const role = await fetchRole(client);
  const dailyTask = role.dailyTask || {};
  const complete = dailyTask.complete || {};

  const results = [];
  const claimedIds = [];
  for (const t of cfg.tasks) {
    const value = Object.hasOwn(complete, t.completeCondition)
      ? complete[t.completeCondition]
      : 0;
    if (value === -1 || value < t.completeValue) continue;
    try {
      await client.sendWithPromise(
        "task_claimdailypoint",
        { taskId: t.id },
        8000,
      );
      results.push({ taskId: t.id, success: true });
      claimedIds.push(t.id);
    } catch (e) {
      results.push({ taskId: t.id, success: false, error: e.message });
    }
    await sleep(500);
  }
  return { claimedIds, results };
}

/**
 * 领取已持有卡券的每日礼包 card_claimreward。
 * cardTime 仅记录已持有卡；lastClaimTime 早于今日 dailyTime 视为今日未领。
 * cardId：1=免费福利卡，4001=周卡，4002=月卡，4003=终身卡。
 */
export async function claimCards(client) {
  const role = await fetchRole(client);
  const dailyTask = role.dailyTask || {};
  const dailyTime = dailyTask.dailyTime;
  const cardTime = role.cardTime || {};

  const results = [];
  const claimedIds = [];
  for (const [cardId, info] of Object.entries(cardTime)) {
    const last = info?.lastClaimTime;
    const available = !Number.isFinite(last) || last < dailyTime;
    if (!available) continue;
    const id = Number(cardId);
    try {
      await client.sendWithPromise(
        "card_claimreward",
        { cardId: id },
        8000,
      );
      results.push({ cardId: id, success: true });
      claimedIds.push(id);
    } catch (e) {
      results.push({ cardId: id, success: false, error: e.message });
    }
    await sleep(500);
  }
  return { claimedIds, results };
}

/**
 * 每日免费点金：按服务器任务 6（completeCondition=6）的剩余次数点金。
 * 对齐前端 dailyTaskRunner.js 388-403：任务已完成（complete=-1）或进度达标则不再发送，
 * 避免自然日内二次启动时越过免费额度；免费次数内不消耗金币，超出额度由服务端拒绝。
 */
export async function claimFreeBuyGold(client) {
  const cfg = await fetchTaskConfig(client);
  const role = await fetchRole(client);
  const dailyTask = role.dailyTask || {};
  const complete = dailyTask.complete || {};

  const task = cfg.tasks.find((t) => t.completeCondition === 6);
  const required =
    Number(task?.completeValue) > 0 ? Number(task.completeValue) : 3;
  const value = Object.hasOwn(complete, 6) ? complete[6] : 0;
  const claimed = value === -1;
  const progress = claimed ? required : value;
  const remaining = Math.max(required - progress, 0);

  const results = [];
  for (let i = 0; i < remaining; i++) {
    try {
      await client.sendWithPromise(
        "system_buygold",
        { buyNum: 1 },
        8000,
      );
      results.push({ index: i + 1, success: true });
    } catch (e) {
      results.push({ index: i + 1, success: false, error: e.message });
    }
    await sleep(500);
  }
  return { remaining, results };
}

// 周日~周六 每日BOSS（咸王考验）bossId 映射，对齐前端 getTodayBossId
const DAY_BOSS_MAP = [9904, 9905, 9901, 9902, 9903, 9904, 9905];

function getTodayBossId(dailyTime) {
  const ts = Number(dailyTime);
  const dayOfWeek = Number.isFinite(ts)
    ? new Date((ts + 8 * 3600) * 1000).getUTCDay()
    : new Date().getUTCDay();
  return DAY_BOSS_MAP[dayOfWeek] ?? DAY_BOSS_MAP[0];
}

/**
 * 咸王考验（每日BOSS，fight_startboss）。
 * 按 dailyTime 换算今日 bossId，先检查/切换到 BOSS 阵容 1，
 * 挑战 1 次后切回初始阵容。
 * 注意区分：fight_startlegionboss=军团BOSS（俱乐部），dungeon_selecthero=咸王梦境。
 */
export async function runDailyBoss(client) {
  const role = await fetchRole(client);
  const dailyTime = role.dailyTask?.dailyTime;
  const bossId = getTodayBossId(dailyTime);
  const results = [];

  // 阵容检查：记录当前阵容，非 1 则切到 BOSS 阵容 1（对齐 switchToFormationIfNeeded）
  let originalFormation = null;
  let formationChanged = false;
  try {
    const teamInfo = await client.sendWithPromise(
      "presetteam_getinfo",
      {},
      10000,
    );
    const current = teamInfo?.presetTeamInfo?.useTeamId;
    if (Number.isInteger(current)) {
      originalFormation = current;
      if (current !== 1) {
        await client.sendWithPromise(
          "presetteam_saveteam",
          { teamId: 1 },
          10000,
        );
        formationChanged = true;
        results.push({
          cmd: "presetteam_saveteam",
          success: true,
          teamId: 1,
          from: current,
        });
      }
    }
  } catch (e) {
    results.push({
      cmd: "presetteam_getinfo",
      success: false,
      error: e.message,
    });
  }

  // 挑战 1 次（按需求改为单次；前端默认为 3 次）
  try {
    await client.sendWithPromise("fight_startboss", { bossId }, 12000);
    results.push({ cmd: "fight_startboss", success: true, bossId });
  } catch (e) {
    results.push({
      cmd: "fight_startboss",
      success: false,
      error: e.message,
      bossId,
    });
  }

  // 打完切回初始阵容（对齐前端 finally 中的阵容还原）
  if (formationChanged && Number.isInteger(originalFormation)) {
    try {
      await client.sendWithPromise(
        "presetteam_saveteam",
        { teamId: originalFormation },
        10000,
      );
      results.push({
        cmd: "presetteam_restore",
        success: true,
        teamId: originalFormation,
      });
    } catch (e) {
      results.push({
        cmd: "presetteam_restore",
        success: false,
        error: e.message,
      });
    }
  }
  return { bossId, results };
}
