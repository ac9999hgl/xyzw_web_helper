-- =====================================================================
-- XYZW 挂机后端 —— Supabase Cron 定时唤醒（方案 A）
-- 作用：由 Supabase 数据库内的 pg_cron 每 8 小时经 pg_net POST 一次
--       后端 /api/tasks/1/run，替代/兜底 GitHub Actions 外部唤醒。
-- 执行位置：Supabase Dashboard -> SQL Editor，分段依次执行。
-- 调度基准：UTC（北京 = UTC+8）。表达式 '5 */8 * * *' 对应
--           UTC 00:05 / 08:05 / 16:05 = 北京 08:05 / 16:05 / 00:05，
--           与现有 GitHub Actions 时点保持一致。
-- 安全：后端 API key 存 Vault，不在 SQL / 仓库中硬编码明文。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. 启用扩展（幂等；已启用则跳过）
-- ---------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
-- Vault 为 Supabase 平台内置；如 SQL 提示 vault 不存在，再执行：
-- create extension if not exists vault;

-- ---------------------------------------------------------------------
-- 1. 把后端地址与 API key 写入 Vault（仅在 SQL Editor 本机执行，勿提交明文）
--    把下面两处占位符替换为真实值后再运行：
--      <RENDER_BACKEND_URL>  例：https://xyzw-web-helper-u6a1.onrender.com
--      <RENDER_API_KEY>      后端 x-api-key
--    name 唯一；同名先删旧再重建，避免唯一约束冲突。
-- ---------------------------------------------------------------------
delete from vault.secrets
where name in ('render_backend_url', 'render_api_key');

select vault.create_secret(
  '<RENDER_BACKEND_URL>',
  'render_backend_url'
);

select vault.create_secret(
  '<RENDER_API_KEY>',
  'render_api_key'
);

-- 核对 Vault 已写入（应能看到两条 name，decrypted_secret 为真实值）
select name, decrypted_secret
from vault.decrypted_secrets
where name in ('render_backend_url', 'render_api_key');

-- ---------------------------------------------------------------------
-- 2. 建定时任务
--    注意：cron.unschedule 在任务不存在时会报
--    "could not find valid entry for job"，并中断同批次后续语句。
--    首次部署：直接跑下面的 cron.schedule，先不要带 unschedule；
--    重建任务时：先单独执行 cron.unschedule，确认不报错后再 schedule。
-- ---------------------------------------------------------------------
select cron.schedule(
  'xyzw-daily-task-1',
  '5 */8 * * *',                                  -- UTC，每 8 小时第 5 分
  $$
    select net.http_post(
      url := (select decrypted_secret
              from vault.decrypted_secrets
              where name = 'render_backend_url') || '/api/tasks/1/run',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-api-key', (select decrypted_secret
                      from vault.decrypted_secrets
                      where name = 'render_api_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    ) as request_id;
  $$
);

-- ---------------------------------------------------------------------
-- 3. 校验
-- ---------------------------------------------------------------------
-- 3.1 已注册的定时任务（全表查看；任务名 xyzw-daily-task-1，schedule 与上面一致）
select * from cron.job;

-- 3.2 每次运行记录（状态 / 错误；按时间倒序）
select *
from cron.job_run_details
order by start_time desc
limit 20;

-- 3.3 pg_net 实际发出的 HTTP 响应（默认保留 6 小时；看 status_code 是否 200/409）
select id, status_code, content, timed_out, error_msg, created
from net._http_response
order by created desc
limit 20;

-- ---------------------------------------------------------------------
-- 4. 停用 / 删除（如需回退）
-- ---------------------------------------------------------------------
-- select cron.unschedule('xyzw-daily-task-1');
-- delete from vault.secrets where name = 'render_api_key';
-- delete from vault.secrets where name = 'render_backend_url';
