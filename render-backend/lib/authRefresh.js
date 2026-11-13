import { g_utils } from "./bonProtocol.js";

/**
 * 会话令牌自动刷新。
 *
 * 背景：游戏凭证分两层：
 *  - BIN 登录原件（长期，ArrayBuffer）：换取会话串的账号票据；
 *  - roleToken 会话串（短期，roleToken/roleId/sessId/connId/isRestore）：WebSocket 鉴权用，会过期/被踢。
 *
 * 前端在 1006 握手失败时会用 IndexedDB 里的 BIN 重新调 `/login/authuser` 换新会话串；
 * 本模块把同一套逻辑搬到后端：当云端挂机遇到 token expired 时，用落库的 BIN 自动换新，
 * 避免每过一段时间就要回本地人工刷新。
 */

const AUTH_USER_URL = "https://xxz-xyzw.hortorgames.com/login/authuser?_seq=1";

function b64ToArrayBuffer(b64) {
  const binary = Buffer.from(b64, "base64");
  return binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
}

/**
 * 用 BIN 原件换取新的会话串。
 * @param {string} binB64 BIN ArrayBuffer 的 base64
 * @returns {Promise<{tokenData:object, tokenStr:string}>}
 *  - tokenData: { roleToken, roleId, sessId, connId, isRestore }
 *  - tokenStr : 上述字段的 JSON 字符串，对应 tokens.token 字段
 */
export async function refreshSessionFromBin(binB64) {
  if (!binB64) throw new Error("缺少 BIN 原件（bin_b64 为空）");

  const arrayBuffer = b64ToArrayBuffer(binB64);

  const res = await fetch(AUTH_USER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      referrerPolicy: "no-referrer",
    },
    body: arrayBuffer,
  });

  const buf = await res.arrayBuffer();
  if (!res.ok) {
    throw new Error(`authuser HTTP ${res.status}，BIN 可能已失效`);
  }

  let data;
  try {
    const msg = g_utils.parse(buf);
    data = msg.getData();
  } catch (err) {
    throw new Error(`解析登录响应失败: ${err.message}`);
  }

  if (!data || !data.roleToken) {
    throw new Error("登录响应未返回 roleToken，BIN 可能已失效");
  }

  // 复刻前端 src/utils/token.ts 的 sessId / connId 生成规则
  const now = Date.now();
  const sessId = now * 100 + Math.floor(Math.random() * 100);
  const connId = now + Math.floor(Math.random() * 10);

  const tokenData = {
    roleToken: data.roleToken,
    roleId: data.roleId,
    sessId,
    connId,
    isRestore: 0,
  };

  return { tokenData, tokenStr: JSON.stringify(tokenData) };
}
