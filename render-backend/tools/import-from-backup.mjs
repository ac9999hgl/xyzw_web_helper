#!/usr/bin/env node
// 从前端「全量备份」JSON 导入游戏角色凭证到云端挂机后端。
//
// 背景：云端后端（Render）只提供 REST API，没有扫码/录入界面。凭证先在本地
// 前端登录，再由前端「备份 / 恢复」页导出全量备份 JSON，用本脚本在本机解析后
// 直传 Render 后端，凭证不经过对话或第三方中转。
//
// 备份结构（src/utils/fullBackup.js）：
//   localStorage.gameTokens                      JSON 字符串，TokenData[]
//   indexedDB.xyzw_token_db.gameTokens           数组，同结构
//   indexedDB.xyzw.tokens                         BIN 登录凭据原件（ArrayBuffer，备份里为 base64），
//                                                 按角色 id 关联随会话串一并落库，供后端自动刷新会话。
//
// 用法：
//   1) 先在本地前端「备份 / 恢复」页点「备份」，下载 xyzw_full_backup_YYYY-MM-DD.json
//   2) 干跑预览（不发送任何请求）：
//      node tools/import-from-backup.mjs <backup.json> --dry-run
//   3) 正式录入角色凭证：
//      node tools/import-from-backup.mjs <backup.json>
//   4) 录入并顺带建一个日常任务（任务 key 见 /api/task-definitions）：
//      node tools/import-from-backup.mjs <backup.json> --task=signIn,claimHangup,claimDaily,claimMail --cron="5 */8 * * *" --task-name="日常挂机"
//
// 环境变量 / 选项：
//   RENDER_BASE   后端地址，默认 https://xyzw-web-helper-u6a1.onrender.com
//   API_KEY       后端接口密钥（必填），也可用 --key=... 传入
//   --dry-run     只解析并打印，不调用后端
//   --task=k1,k2  录入后创建任务，绑定本次备份覆盖的全部角色
//   --cron=...    任务 cron 表达式，默认每 8 小时一次（Asia/Shanghai）
//   --task-name=  任务名称，默认「日常挂机」
//
// 注意：roleToken/sessId/connId 属会话凭证，可能有时效；云端隔数小时复用能否成功
// 需首次触发验证，若失效需重新在本地登录并导出备份再次录入。

import fs from "node:fs";
import process from "node:process";

const args = process.argv.slice(2);

function arg(name, fallback) {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const hasFlag = (name) => args.includes(`--${name}`);

const backupPath = args.find((a) => !a.startsWith("--"));
const dryRun = hasFlag("dry-run");

const BASE = (process.env.RENDER_BASE || "https://xyzw-web-helper-u6a1.onrender.com").replace(/\/+$/, "");
const API_KEY = process.env.API_KEY || arg("key", "");

const taskKeys = (arg("task", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const cronExpr = arg("cron", "5 */8 * * *");
const taskName = arg("task-name", "日常挂机");

if (!backupPath) {
  console.error("用法: node tools/import-from-backup.mjs <backup.json> [--dry-run] [--task=k1,k2] [--cron=...] [--task-name=...]");
  process.exit(1);
}
if (!API_KEY) {
  console.error("缺少 API_KEY：先设置环境变量 API_KEY，或加 --key=<后端接口密钥>");
  process.exit(1);
}

const mask = (s) => {
  if (!s) return "";
  return s.length <= 14 ? s : `${s.slice(0, 8)}...${s.slice(-4)}`;
};

// 解析 token 串：以 { 开头则按 JSON 解析，否则视为裸 roleToken。
function parseCred(tokenStr) {
  if (typeof tokenStr !== "string" || !tokenStr.startsWith("{")) return null;
  try {
    return JSON.parse(tokenStr);
  } catch {
    return null;
  }
}

// ---------- 1. 读取并解析备份 ----------
let backup;
try {
  backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
} catch (err) {
  console.error(`备份文件读取/解析失败: ${err.message}`);
  process.exit(1);
}

const records = [];
const seen = new Set();

function pushRecord(rec) {
  if (!rec || typeof rec !== "object") return;
  const token = typeof rec.token === "string" ? rec.token : "";
  if (!token) return;
  const cred = parseCred(token);
  const roleId = rec.roleId ?? cred?.roleId ?? "";
  const key = String(roleId || token.slice(0, 32));
  if (seen.has(key)) return;
  seen.add(key);
  records.push(rec);
}

// localStorage.gameTokens：可能是 JSON 字符串，也可能已是数组
const ls = backup.localStorage || {};
if (typeof ls.gameTokens === "string") {
  try { (JSON.parse(ls.gameTokens) || []).forEach(pushRecord); } catch { /* 忽略坏条目 */ }
} else if (Array.isArray(ls.gameTokens)) {
  ls.gameTokens.forEach(pushRecord);
}

// indexedDB.xyzw_token_db.gameTokens
const idb = backup.indexedDB || {};
const idbTokens = idb.xyzw_token_db?.gameTokens;
if (Array.isArray(idbTokens)) idbTokens.forEach(pushRecord);

// indexedDB.xyzw.tokens：BIN 登录原件（ArrayBuffer，备份里编码为 base64）。
// 按前端 token id 与角色记录关联，随会话串一并落库，供后端在 token expired 时自动换新会话。
const binByTokenId = new Map();
const binRecords = idb.xyzw?.tokens;
if (Array.isArray(binRecords)) {
  for (const rec of binRecords) {
    const data = rec?.data;
    if (data && data.__xyzwType === "ArrayBuffer" && data.b64) {
      binByTokenId.set(rec.id, data.b64);
    }
  }
}

console.log(`解析到 ${records.length} 条角色记录${dryRun ? "（dry-run，不发送）" : ""}`);
if (records.length === 0) {
  console.error("备份里没有可用的角色记录（gameTokens 为空）。请先在本地前端登录角色后再导出备份。");
  process.exit(1);
}

// ---------- 2. 拉取已有凭证用于去重 ----------
let existing = [];
if (!dryRun) {
  const r = await fetch(`${BASE}/api/tokens`, { headers: { "x-api-key": API_KEY } });
  if (!r.ok) {
    console.error(`拉取已有 tokens 失败: HTTP ${r.status} ${await r.text()}`);
    process.exit(1);
  }
  existing = await r.json();
}
const existingByRoleId = new Map(existing.map((t) => [String(t.roleId), t]));
const existingByToken = new Set(existing.map((t) => t.token));

// ---------- 3. 逐条录入 ----------
const boundIds = [];      // 本次备份覆盖到的后端 token id（含已存在）
const importedIds = [];   // 本次新录入的 id

for (const rec of records) {
  const cred = parseCred(rec.token) || {};
  const roleId = rec.roleId ?? cred.roleId ?? null;
  const binB64 = binByTokenId.get(rec.id) || null;
  const body = {
    name: rec.name || String(roleId || "未命名角色"),
    token: rec.token,
    roleId: roleId ?? null,
    sessId: cred.sessId ?? null,
    connId: cred.connId ?? null,
    isRestore: Boolean(cred.isRestore ?? false),
    ws_url: rec.wsUrl || null,
    bin_b64: binB64,
    enabled: true,
  };

  const dup = existingByToken.has(rec.token) || (roleId != null && existingByRoleId.has(String(roleId)));
  if (dup) {
    const existingRow = existing.find((t) => t.token === rec.token || String(t.roleId) === String(roleId));
    if (existingRow) {
      boundIds.push(existingRow.id);
      // 旧记录若缺 BIN 原件，补写一份，使后端具备自动刷新能力
      if (binB64 && !existingRow.bin_b64) {
        if (dryRun) {
          console.log(`[dry-run] 将补写 BIN: ${body.name}`);
        } else {
          const pr = await fetch(`${BASE}/api/tokens/${existingRow.id}`, {
            method: "PATCH",
            headers: { "x-api-key": API_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({ bin_b64: binB64 }),
          });
          if (pr.ok) console.log(`- 补写 BIN: ${body.name} id=${existingRow.id}`);
          else console.error(`! 补写 BIN 失败 ${body.name}: HTTP ${pr.status}`);
        }
      }
    }
    console.log(`- 跳过(已存在): ${body.name} roleId=${roleId}`);
    continue;
  }

  if (dryRun) {
    console.log(`[dry-run] 将录入: ${body.name} roleId=${roleId} token=${mask(rec.token)}`);
    continue;
  }

  const r = await fetch(`${BASE}/api/tokens`, {
    method: "POST",
    headers: { "x-api-key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error(`! 录入失败 ${body.name}: ${data.error || `HTTP ${r.status}`}`);
    continue;
  }
  const row = Array.isArray(data) ? data[0] : data;
  boundIds.push(row.id);
  importedIds.push(row.id);
  console.log(`+ 已录入: ${body.name} id=${row.id} roleId=${roleId} token=${mask(rec.token)}`);
}

// ---------- 4. 可选：创建日常任务 ----------
if (!dryRun && taskKeys.length > 0) {
  if (boundIds.length === 0) {
    console.error("没有可绑定的角色 id，未创建任务。");
  } else {
    const taskBody = {
      name: taskName,
      selected_tokens: boundIds,
      selected_tasks: taskKeys,
      cron_expr: cronExpr,
      enabled: true,
    };
    const r = await fetch(`${BASE}/api/tasks`, {
      method: "POST",
      headers: { "x-api-key": API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(taskBody),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error(`! 创建任务失败: ${data.error || `HTTP ${r.status}`}`);
      process.exit(1);
    }
    const row = Array.isArray(data) ? data[0] : data;
    console.log(`✓ 任务已创建: ${taskName} id=${row.id} 绑定 ${boundIds.length} 个角色，任务=${taskKeys.join(",")}，cron=${cronExpr}`);
  }
}

console.log(`\n完成：新录入 ${importedIds.length} 条，共覆盖 ${boundIds.length} 条角色。`);
if (!dryRun) {
  console.log(`核对凭证: GET ${BASE}/api/tokens`);
  console.log(`手动触发: POST ${BASE}/api/tasks/<任务ID>/run`);
  console.log(`查看日志: GET ${BASE}/api/logs/db`);
}
