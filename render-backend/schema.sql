-- =====================================================================
-- XYZW 挂机后端 —— Supabase (Postgres) 建表脚本
-- 对齐 render-backend/server.js 的读写字段
-- 在 Supabase Dashboard -> SQL Editor 中依次执行本脚本
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. tokens：游戏角色 / 登录凭证
-- ---------------------------------------------------------------------
create table if not exists public.tokens (
  id          bigint generated always as identity primary key,
  name        text,                                  -- 角色备注名（展示用）
  token       text,                                  -- 裸 roleToken，或 JSON 字符串
  "roleId"    text,                                  -- 角色 ID
  "sessId"    text,                                  -- 会话 ID
  "connId"    text,                                  -- 连接 ID
  "isRestore" boolean default false,                 -- 是否恢复连接
  "ws_url"    text,                                  -- WebSocket 地址
  enabled     boolean default true,                  -- 是否启用
  "created_at" timestamptz default now()
);

create index if not exists tokens_enabled_idx on public.tokens (enabled);

-- ---------------------------------------------------------------------
-- 2. cron_tasks：定时任务定义
-- ---------------------------------------------------------------------
create table if not exists public.cron_tasks (
  id            bigint generated always as identity primary key,
  name          text,                                -- 任务名
  "selected_tokens" jsonb default '[]'::jsonb,      -- 选中的 token id 数组
  "token_ids"   jsonb default '[]'::jsonb,          -- 旧字段（兼容）
  "selected_tasks"  jsonb default '[]'::jsonb,     -- 任务 key 数组（对应 TASK_DEFINITIONS）
  "task_type"   text,                               -- 旧字段：单任务类型（兼容）
  "cron_expr"   text,                               -- cron 表达式，时区 Asia/Shanghai
  "cron_expression" text,                           -- 旧字段（兼容）
  enabled       boolean default true,
  "last_run_at" timestamptz,
  "created_at"  timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 3. task_logs：任务执行日志
-- ---------------------------------------------------------------------
create table if not exists public.task_logs (
  id          bigint generated always as identity primary key,
  "task_id"   bigint references public.cron_tasks (id) on delete set null,
  "token_name" text,
  "task_type"  text,
  status      text,                                 -- success / error
  message     text,
  "created_at" timestamptz default now()
);

create index if not exists task_logs_task_id_idx on public.task_logs ("task_id");
create index if not exists task_logs_created_at_idx on public.task_logs ("created_at");

-- ---------------------------------------------------------------------
-- 行级安全 (RLS)
-- 后端使用 service_role key 访问，service_role 默认绕过 RLS。
-- 启用 RLS 且不添加匿名策略，可避免 anon key 直接读写这些表。
-- ---------------------------------------------------------------------
alter table public.tokens      enable row level security;
alter table public.cron_tasks  enable row level security;
alter table public.task_logs   enable row level security;

-- ---------------------------------------------------------------------
-- 授予 service_role（后端 secret key）基础表级 DML 权限
-- RLS 由 service_role 绕过，但仍需显式 GRANT 表级权限，否则报 42501
-- "permission denied for table ..."
-- ---------------------------------------------------------------------
grant usage on schema public to service_role;
grant select, insert, update, delete on public.tokens      to service_role;
grant select, insert, update, delete on public.cron_tasks  to service_role;
grant select, insert, update, delete on public.task_logs   to service_role;
