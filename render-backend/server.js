import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import cors from "cors";
/**
 * XYZW 游戏自动化后端 - Express + Supabase + Render
 */
import dotenv from "dotenv";
import express from "express";
import cron from "node-cron";
import { createApiKeyMiddleware } from "./lib/apiKeyAuth.js";
import { GameClient } from "./lib/gameClient.js";
import { refreshSessionFromBin } from "./lib/authRefresh.js";
import {
  claimDailyRewards,
  claimWeekRewards,
  claimDailyPoints,
  claimCards,
  claimFreeBuyGold,
  runDailyBoss,
} from "./lib/dailyRewards.js";

dotenv.config();

// ==================== 工具函数 ====================
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const app = express();
app.use(cors());
app.use(express.json());

// ==================== Supabase 客户端 ====================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
);

// ==================== 任务定义 ====================
const TASK_DEFINITIONS = {
  signIn: {
    name: "签到",
    commands: [{ cmd: "system_signinreward", params: {} }],
  },
  claimHangup: {
    name: "领取挂机奖励",
    commands: [{ cmd: "system_claimhangupreward", params: {} }],
  },
  claimDaily: {
    name: "领取日常奖励(动态)",
    dynamic: true,
    commands: [],
  },
  claimDailyPoint: {
    name: "领取每日积分",
    commands: [{ cmd: "task_claimdailypoint", params: { taskId: 1 } }],
  },
  climbTower: {
    name: "爬塔领奖励",
    commands: [
      { cmd: "tower_getinfo", params: {} },
      { cmd: "tower_claimreward", params: {} },
    ],
  },
  climbWeirdTower: {
    name: "怪异塔",
    commands: [
      { cmd: "evotower_getinfo", params: {} },
      { cmd: "evotower_claimreward", params: {} },
    ],
  },
  arenaFight: {
    name: "竞技场",
    commands: [
      { cmd: "arena_startarea", params: {} },
      { cmd: "arena_getareatarget", params: { refresh: false } },
    ],
  },
  claimMail: {
    name: "领取邮件附件",
    commands: [{ cmd: "mail_claimallattachment", params: { category: 0 } }],
  },
  legacyHangup: {
    name: "功法挂机",
    commands: [
      { cmd: "legacy_getinfo", params: {} },
      { cmd: "legacy_claimhangup", params: {} },
    ],
  },
  claimBottle: {
    name: "领取罐子",
    commands: [{ cmd: "bottlehelper_claim", params: {} }],
  },
  resetBottle: {
    name: "重置罐子",
    commands: [
      { cmd: "bottlehelper_stop", params: {} },
      { cmd: "bottlehelper_start", params: { bottleType: -1 } },
    ],
  },
  addHangUpTime: {
    name: "一键加钟",
    commands: [
      { cmd: "system_mysharecallback", params: { isSkipShareCard: true, type: 2 }, repeat: 4 },
    ],
  },
  freeRecruit: {
    name: "每日免费招募",
    commands: [
      { cmd: "hero_recruit", params: { recruitType: 3, recruitNumber: 1 } },
    ],
  },
  freeBuyGold: {
    name: "每日免费点金",
    dynamic: true,
    commands: [],
  },
  friendGift: {
    name: "赠送好友金币",
    commands: [{ cmd: "friend_batch", params: {} }],
  },
  freeFish: {
    name: "免费钓鱼",
    commands: [
      { cmd: "artifact_lottery", params: { lotteryNumber: 1, newFree: true, type: 1 }, repeat: 3 },
    ],
  },
  heroRecruit: {
    name: "武将招募",
    commands: [
      {
        cmd: "hero_recruit",
        params: { byClub: false, recruitNumber: 1, recruitType: 3 },
      },
    ],
  },
  studyGame: {
    name: "学习问答",
    commands: [{ cmd: "study_startgame", params: {} }],
  },
  genieSweep: {
    name: "灯神",
    commands: [{ cmd: "genie_sweep", params: { genieId: 1 } }],
  },
  openBox: {
    name: "开箱",
    commands: [{ cmd: "item_openbox", params: { itemId: 2001, number: 10 } }],
  },
  legionSignIn: {
    name: "俱乐部签到",
    commands: [{ cmd: "legion_signin", params: {} }],
  },
  bossTower: {
    name: "咸王宝库",
    commands: [
      { cmd: "bosstower_getinfo", params: {} },
      { cmd: "bosstower_startboss", params: {} },
      { cmd: "bosstower_startbox", params: {} },
    ],
  },
  mergeBox: {
    name: "合并魔盒",
    commands: [
      { cmd: "mergebox_getinfo", params: {} },
      { cmd: "mergebox_claimfreeenergy", params: {} },
      { cmd: "mergebox_openbox", params: {} },
    ],
  },
  discountClaim: {
    name: "每日特惠礼包",
    commands: [{ cmd: "discount_claimreward", params: { discountId: 1 } }],
  },
  dreamKing: {
    name: "咸王梦境",
    commands: [{ cmd: "dungeon_selecthero", params: { battleTeam: { 0: 107 } } }],
  },
  dailyBoss: {
    name: "咸王考验(每日BOSS)",
    dynamic: true,
    commands: [],
  },
  collectionGift: {
    name: "珍宝阁免费礼包",
    commands: [
      { cmd: "collection_goodslist", params: {} },
      { cmd: "collection_claimfreereward", params: {} },
    ],
  },
  genieSweep: {
    name: "灯神一键扫荡",
    commands: [
      { cmd: "genie_sweep", params: { genieId: 1 } },
      { cmd: "genie_sweep", params: { genieId: 2 } },
      { cmd: "genie_sweep", params: { genieId: 3 } },
      { cmd: "genie_sweep", params: { genieId: 4 } },
      { cmd: "genie_sweep", params: { genieId: 5, sweepCnt: 1 } },
      { cmd: "genie_buysweep", params: {}, repeat: 3 },
    ],
  },
  passClaim: {
    name: "领取通行证奖励",
    commands: [{ cmd: "activity_recyclewarorderrewardclaim", params: { actId: 1 } }],
  },
  claimWeek: {
    name: "领取周常积分(动态)",
    dynamic: true,
    commands: [],
  },
  claimPoint: {
    name: "领取任务积分(动态)",
    dynamic: true,
    commands: [],
  },
  claimCard: {
    name: "领取卡券礼包(动态)",
    dynamic: true,
    commands: [],
  },
  dailyBundle: {
    name: "一键日常",
    commands: [
      { cmd: "system_signinreward", params: {} },
      { cmd: "system_claimhangupreward", params: {} },
      { cmd: "task_claimdailyreward", params: { rewardId: 0 } },
      { cmd: "tower_getinfo", params: {} },
      { cmd: "tower_claimreward", params: {} },
      { cmd: "mail_claimallattachment", params: { category: 0 } },
      { cmd: "legacy_getinfo", params: {} },
      { cmd: "legacy_claimhangup", params: {} },
    ],
  },
};

// ==================== 日志存储 ====================
const LOG_MAX = 500;
const logs = [];

function addLog(level, category, message, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    category,
    message,
    ...meta,
  };
  logs.unshift(entry);
  if (logs.length > LOG_MAX) logs.pop();
  console.log(`[${level}] [${category}] ${message}`, meta);
}

// ==================== Token 加载 ====================
async function loadTokens() {
  const { data, error } = await supabase
    .from("tokens")
    .select("*")
    .eq("enabled", true);
  if (error) {
    addLog("ERROR", "supabase", "加载tokens失败", { error: error.message });
    return [];
  }
  addLog("INFO", "supabase", `加载${data?.length || 0}个tokens`);
  return data || [];
}

// ==================== 任务执行引擎 ====================
// 防重入锁：同一任务已有实例在跑时，跳过重复触发，避免并发重复消耗每日 BOSS/点金/钓鱼次数
const runningTaskIds = new Set();

async function executeTask(task) {
  if (runningTaskIds.has(task.id)) {
    addLog("WARN", "task", `任务已在运行，跳过重复触发: ${task.name}`, { taskId: task.id });
    return;
  }
  runningTaskIds.add(task.id);
  try {
    await runTaskOnce(task);
  } finally {
    runningTaskIds.delete(task.id);
  }
}

async function runTaskOnce(task) {
  addLog("INFO", "task", `开始执行任务: ${task.name}`, { taskId: task.id });

  // 兼容旧字段 token_ids 和新字段 selected_tokens
  let tokenIds = task.selected_tokens || task.token_ids;
  if (typeof tokenIds === "string") {
    try {
      tokenIds = JSON.parse(tokenIds);
    } catch {
      tokenIds = [];
    }
  }
  if (!Array.isArray(tokenIds) || tokenIds.length === 0) {
    addLog("WARN", "task", "没有选中的token，跳过", { taskId: task.id });
    return;
  }

  // 支持多任务：selected_tasks 是数组，每个元素是 TASK_DEFINITIONS 的 key
  let taskKeys = task.selected_tasks;
  if (typeof taskKeys === "string") {
    try {
      taskKeys = JSON.parse(taskKeys);
    } catch {
      taskKeys = [];
    }
  }
  // 兼容旧字段 task_type（单个任务）
  if ((!Array.isArray(taskKeys) || taskKeys.length === 0) && task.task_type) {
    taskKeys = [task.task_type];
  }
  if (!Array.isArray(taskKeys) || taskKeys.length === 0) {
    addLog("ERROR", "task", "没有选择任何任务类型", { taskId: task.id });
    return;
  }

  // 收集所有需要执行的命令（去重）；dynamic 任务走独立动态分支
  const allCommands = [];
  const seenCmds = new Set();
  const dynamicKeys = [];
  for (const key of taskKeys) {
    const taskDef = TASK_DEFINITIONS[key];
    if (!taskDef) {
      addLog("WARN", "task", `未知任务类型: ${key}，跳过`, { taskId: task.id });
      continue;
    }
    if (taskDef.dynamic) {
      dynamicKeys.push(key);
      continue;
    }
    for (const cmd of taskDef.commands) {
      const cmdKey = cmd.cmd + JSON.stringify(cmd.params);
      const repeat = Number(cmd.repeat) > 1;
      if (repeat || !seenCmds.has(cmdKey)) {
        seenCmds.add(cmdKey);
        allCommands.push(cmd);
      }
    }
  }
  if (allCommands.length === 0 && dynamicKeys.length === 0) {
    addLog("ERROR", "task", "没有有效的命令可执行", { taskId: task.id });
    return;
  }

  const allTokens = await loadTokens();
  const targetTokens = allTokens.filter((t) => tokenIds.includes(t.id));
  if (targetTokens.length === 0) {
    addLog("WARN", "task", "没有找到匹配的tokens", { taskId: task.id });
    return;
  }

  addLog("INFO", "task", `将执行于 ${targetTokens.length} 个角色`, {
    taskId: task.id,
  });

  for (const token of targetTokens) {
    let tokenData;
    try {
      tokenData =
        typeof token.token === "string" && token.token.startsWith("{")
          ? JSON.parse(token.token)
          : {
              roleToken: token.token,
              roleId: token.roleId,
              sessId: token.sessId,
              connId: token.connId,
              isRestore: token.isRestore,
            };
    } catch (err) {
      addLog("ERROR", "task", `Token解析失败: ${token.name}`, {
        error: err.message,
      });
      continue;
    }

    tokenData.name = token.name;
    const binB64 = token.bin_b64 || null;
    let client = new GameClient(tokenData, token.ws_url);
    let refreshed = false;

    const establish = async (cli) => {
      await cli.connect(15000);
      try {
        await cli.sendWithPromise("role_getroleinfo", {}, 8000);
        await sleep(500);
      } catch (e) {
        addLog("WARN", "task", `获取角色信息失败 (${token.name})`, {
          error: e.message,
        });
      }
    };

    const isExpired = (cli, err) =>
      /expired|fatal/i.test(err?.message || "") ||
      /expired/i.test(cli?.lastFatal?.error || "");

    const refreshAndReconnect = async () => {
      const fresh = await refreshSessionFromBin(binB64);
      await supabase
        .from("tokens")
        .update({
          token: fresh.tokenStr,
          roleId: fresh.tokenData.roleId,
          sessId: String(fresh.tokenData.sessId),
          connId: String(fresh.tokenData.connId),
        })
        .eq("id", token.id);
      tokenData = { ...fresh.tokenData, name: token.name };
      refreshed = true;
      client.disconnect();
      client = new GameClient(tokenData, token.ws_url);
      await establish(client);
    };

    const runBatch = async () => {
      const results = [];
      if (allCommands.length > 0) {
        results.push(...(await client.executeBatch(allCommands, 800)));
      }
      // 动态任务：每日免费点金（按服务器剩余次数执行，任务已完成则不再发送）
      if (dynamicKeys.includes("freeBuyGold")) {
        try {
          const dyn = await claimFreeBuyGold(client);
          addLog(
            "INFO",
            "task",
            `[${token.name}] 免费点金: 剩余=${dyn.remaining} 次`,
            { taskId: task.id },
          );
          for (const r of dyn.results) {
            results.push({
              cmd: `system_buygold:${r.index}`,
              success: r.success,
              error: r.error,
            });
          }
        } catch (e) {
          results.push({
            cmd: "system_buygold",
            success: false,
            error: e.message,
          });
        }
      }
      // 动态任务：咸王考验（每日BOSS fight_startboss），按今日 bossId 挑战 1 次
      if (dynamicKeys.includes("dailyBoss")) {
        try {
          const dyn = await runDailyBoss(client);
          addLog(
            "INFO",
            "task",
            `[${token.name}] 咸王考验: bossId=${dyn.bossId}`,
            { taskId: task.id },
          );
          for (const r of dyn.results) {
            results.push({ cmd: r.cmd, success: r.success, error: r.error });
          }
        } catch (e) {
          results.push({
            cmd: "fight_startboss",
            success: false,
            error: e.message,
          });
        }
      }
      // 动态任务：先领取每个已完成日常任务的任务积分（攒 dailyPoint/weekPoint，宝箱档位据此判定）
      if (dynamicKeys.includes("claimPoint")) {
        try {
          const dyn = await claimDailyPoints(client);
          addLog(
            "INFO",
            "task",
            `[${token.name}] 任务积分: 已领=[${(dyn.claimedIds || []).join(",")}]`,
            { taskId: task.id },
          );
          for (const r of dyn.results) {
            results.push({
              cmd: `task_claimdailypoint:${r.taskId}`,
              success: r.success,
              error: r.error,
            });
          }
        } catch (e) {
          results.push({
            cmd: "task_claimdailypoint",
            success: false,
            error: e.message,
          });
        }
      }
      // 动态任务：日常积分奖励（任务积分到账、点位刷新后，按服务端可领档位逐个领取）
      if (dynamicKeys.includes("claimDaily")) {
        try {
          const dyn = await claimDailyRewards(client);
          addLog(
            "INFO",
            "task",
            `[${token.name}] 日常积分: points=${dyn.points} 档位=${dyn.rewardsCount} 已领=[${(dyn.claimedIds || []).join(",")}] 可领=[${dyn.ids.join(",")}]`,
            { taskId: task.id },
          );
          for (const r of dyn.results) {
            results.push({
              cmd: `task_claimdailyreward:${r.rewardId}`,
              success: r.success,
              error: r.error,
            });
          }
          if (dyn.ids.length === 0) {
            results.push({
              cmd: "task_claimdailyreward",
              success: true,
              note: "无可领取档位",
            });
          }
        } catch (e) {
          results.push({
            cmd: "task_claimdailyreward",
            success: false,
            error: e.message,
          });
        }
      }
      // 动态任务：周常积分档位按服务端可领档位逐个领取
      if (dynamicKeys.includes("claimWeek")) {
        try {
          const dyn = await claimWeekRewards(client);
          addLog(
            "INFO",
            "task",
            `[${token.name}] 周常积分: points=${dyn.points} 可领=[${dyn.ids.join(",")}]`,
            { taskId: task.id },
          );
          for (const r of dyn.results) {
            results.push({
              cmd: `task_claimweekreward:${r.rewardId}`,
              success: r.success,
              error: r.error,
            });
          }
          if (dyn.ids.length === 0) {
            results.push({
              cmd: "task_claimweekreward",
              success: true,
              note: "无可领取档位",
            });
          }
        } catch (e) {
          results.push({
            cmd: "task_claimweekreward",
            success: false,
            error: e.message,
          });
        }
      }
      // 动态任务：领取已持有卡券的每日礼包（免费/周卡/月卡/终身卡）
      if (dynamicKeys.includes("claimCard")) {
        try {
          const dyn = await claimCards(client);
          addLog(
            "INFO",
            "task",
            `[${token.name}] 卡券礼包: 已领=[${(dyn.claimedIds || []).join(",")}]`,
            { taskId: task.id },
          );
          for (const r of dyn.results) {
            results.push({
              cmd: `card_claimreward:${r.cardId}`,
              success: r.success,
              error: r.error,
            });
          }
        } catch (e) {
          results.push({
            cmd: "card_claimreward",
            success: false,
            error: e.message,
          });
        }
      }
      for (const r of results) {
        const logLevel = r.success ? "INFO" : "ERROR";
        addLog(
          logLevel,
          "task",
          `[${token.name}] ${r.cmd}: ${r.success ? "OK" : r.error}`,
          { taskId: task.id },
        );
        await logToDb(
          task.id,
          token.name,
          r.cmd,
          r.success ? "success" : "error",
          r.success ? undefined : r.error,
        );
      }
      return results;
    };

    try {
      await establish(client);

      // 会话过期且持有 BIN：自动换新会话、回写云端并重连一次
      if (!refreshed && binB64 && isExpired(client, null)) {
        addLog("WARN", "task", `会话过期，用 BIN 自动刷新: ${token.name}`, {
          taskId: task.id,
        });
        await refreshAndReconnect();
      }

      let cmdResults = await runBatch();

      // 批处理全部失败且判定过期：再刷新重连后重试一次
      const allFailed =
        cmdResults.length > 0 && cmdResults.every((r) => !r.success);
      if (allFailed && !refreshed && binB64 && isExpired(client, null)) {
        addLog("WARN", "task", `命令仍未连接，刷新后重试: ${token.name}`, {
          taskId: task.id,
        });
        await refreshAndReconnect();
        cmdResults = await runBatch();
      }
    } catch (err) {
      // 连接阶段就被拒：若过期且有 BIN，刷新重连后再跑一轮
      if (!refreshed && binB64 && isExpired(client, err)) {
        try {
          addLog("WARN", "task", `连接失败，用 BIN 刷新重试: ${token.name}`, {
            taskId: task.id,
            error: err.message,
          });
          await refreshAndReconnect();
          await runBatch();
        } catch (err2) {
          addLog("ERROR", "task", `执行失败 (${token.name}): ${err2.message}`, {
            taskId: task.id,
          });
          await logToDb(
            task.id,
            token.name,
            taskKeys.join(","),
            "error",
            err2.message,
          );
        }
      } else {
        addLog("ERROR", "task", `执行失败 (${token.name}): ${err.message}`, {
          taskId: task.id,
        });
        await logToDb(
          task.id,
          token.name,
          taskKeys.join(","),
          "error",
          err.message,
        );
      }
    } finally {
      client.disconnect();
    }
    await sleep(2000);
  }

  await supabase
    .from("cron_tasks")
    .update({ last_run_at: new Date().toISOString() })
    .eq("id", task.id);
  addLog("INFO", "task", `任务完成: ${task.name}`, { taskId: task.id });
}

async function logToDb(taskId, tokenName, taskType, status, message) {
  try {
    await supabase.from("task_logs").insert({
      task_id: taskId,
      token_name: tokenName,
      task_type: taskType,
      status,
      message: message || null,
    });
  } catch (e) {
    console.error("写入日志失败:", e.message);
  }
}

// ==================== 定时任务调度 ====================
const cronJobs = new Map();

async function registerAllCrons() {
  for (const job of cronJobs.values()) job.stop();
  cronJobs.clear();

  const { data: tasks } = await supabase
    .from("cron_tasks")
    .select("*")
    .eq("enabled", true);
  if (!tasks) return;

  for (const task of tasks) {
    registerCron(task);
  }
  addLog("INFO", "cron", `已注册 ${tasks.length} 个定时任务`);
}

function registerCron(task) {
  if (cronJobs.has(task.id)) {
    cronJobs.get(task.id).stop();
  }
  // 兼容旧字段 cron_expression 和新字段 cron_expr
  const cronExpr = task.cron_expr || task.cron_expression;
  if (!task.enabled || !cronExpr) return;

  try {
    const job = cron.schedule(
      cronExpr,
      () => {
        executeTask(task).catch((err) => {
          addLog("ERROR", "cron", `任务执行异常: ${task.name}`, {
            error: err.message,
          });
        });
      },
      { timezone: "Asia/Shanghai" },
    );
    cronJobs.set(task.id, job);
    addLog(
      "INFO",
      "cron",
      `注册定时任务: ${task.name} (${cronExpr} Asia/Shanghai)`,
    );
  } catch (err) {
    addLog("ERROR", "cron", `注册失败: ${task.name}`, { error: err.message });
  }
}

async function init() {
  addLog("INFO", "server", "服务器启动中...");
  addLog("INFO", "server", `Supabase: ${process.env.SUPABASE_URL}`);

  await registerAllCrons();

  // 每天中午12点清理前一天的任务日志
  cron.schedule(
    "0 12 * * *",
    async () => {
      addLog("INFO", "cron", "执行每日日志清理...");
      try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);
        const { error } = await supabase
          .from("task_logs")
          .delete()
          .lt("created_at", yesterday.toISOString());
        if (error) {
          addLog("ERROR", "cron", "日志清理失败", { error: error.message });
        } else {
          addLog("INFO", "cron", "已清理前一天及更早的任务日志");
        }
      } catch (err) {
        addLog("ERROR", "cron", "日志清理异常", { error: err.message });
      }
    },
    { timezone: "Asia/Shanghai" },
  );

  setInterval(
    async () => {
      addLog("INFO", "cron", "重新加载定时任务配置...");
      await registerAllCrons();
    },
    5 * 60 * 1000,
  );

  addLog("INFO", "server", "服务器就绪");
}

// ==================== API 路由 ====================

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    time: new Date().toISOString(),
    activeCrons: cronJobs.size,
    logsInMemory: logs.length,
  });
});

// Every API route uses the same credentials; /health remains public.
app.use("/api", createApiKeyMiddleware());

app.get("/api/tokens", async (req, res) => {
  const { data, error } = await supabase
    .from("tokens")
    .select("*")
    .order("created_at");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post("/api/tokens", async (req, res) => {
  const { data, error } = await supabase
    .from("tokens")
    .insert(req.body)
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.patch("/api/tokens/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("tokens")
    .update(req.body)
    .eq("id", req.params.id)
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.delete("/api/tokens/:id", async (req, res) => {
  const { error } = await supabase
    .from("tokens")
    .delete()
    .eq("id", req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});
app.get("/api/tasks", async (req, res) => {
  const { data, error } = await supabase
    .from("cron_tasks")
    .select("*")
    .order("created_at");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post("/api/tasks", async (req, res) => {
  const { data, error } = await supabase
    .from("cron_tasks")
    .insert(req.body)
    .select();
  if (error) return res.status(400).json({ error: error.message });
  if (data && data[0]) registerCron(data[0]);
  res.json(data);
});

app.patch("/api/tasks/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("cron_tasks")
    .update(req.body)
    .eq("id", req.params.id)
    .select();
  if (error) return res.status(400).json({ error: error.message });
  await registerAllCrons();
  res.json(data);
});

app.delete("/api/tasks/:id", async (req, res) => {
  const { error } = await supabase
    .from("cron_tasks")
    .delete()
    .eq("id", req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  await registerAllCrons();
  res.json({ ok: true });
});

app.post("/api/tasks/:id/run", async (req, res) => {
  const { data: task } = await supabase
    .from("cron_tasks")
    .select("*")
    .eq("id", req.params.id)
    .single();
  if (!task) return res.status(404).json({ error: "任务不存在" });
  if (runningTaskIds.has(task.id)) {
    addLog("WARN", "api", `任务运行中，拒绝重复触发: ${task.name}`, { taskId: task.id });
    return res.status(409).json({ status: "already_running", task: task.name });
  }
  executeTask(task).catch((err) =>
    addLog("ERROR", "api", `手动执行失败: ${err.message}`),
  );
  res.json({ status: "running", task: task.name });
});

app.get("/api/logs", (req, res) => {
  const limit = Math.min(Number.parseInt(req.query.limit) || 100, LOG_MAX);
  res.json(logs.slice(0, limit));
});

app.get("/api/logs/db", async (req, res) => {
  const limit = Math.min(Number.parseInt(req.query.limit) || 100, 500);
  const { data, error } = await supabase
    .from("task_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get("/api/task-definitions", (req, res) => {
  const list = Object.entries(TASK_DEFINITIONS).map(([key, val]) => ({
    key,
    name: val.name,
    commands: val.commands.map((c) => c.cmd),
  }));
  res.json(list);
});

const PORT = process.env.PORT || 3000;
init().then(() => {
  app.listen(PORT, () => {
    addLog("INFO", "server", `监听端口 ${PORT}`);
  });
});
