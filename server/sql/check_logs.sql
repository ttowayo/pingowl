-- PingOwl 체크 로그 테이블
-- Supabase 대시보드 > SQL Editor 에서 이 파일 내용을 실행하세요.

create table if not exists check_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  site_id text not null,
  site_name text,
  url text not null,
  checked_at timestamptz not null default now(),
  response_time integer,       -- ms, 실패 시에도 소요 시간 기록
  status_code integer,         -- HTTP 상태 코드 (요청 자체가 실패하면 null)
  online boolean not null
);

-- 사용자별 / 사이트별 시간순 조회용 인덱스
create index if not exists idx_check_logs_user_site_time
  on check_logs (user_id, site_id, checked_at desc);

-- 참고: 서버가 anon key로 모든 사용자를 체크/기록하는 현재 구조(sites 테이블과 동일)에 맞춰
-- RLS는 켜지 않습니다. RLS를 쓰려면 서버를 service_role key로 전환한 뒤 아래를 활성화하세요.
-- alter table check_logs enable row level security;
-- create policy "own logs" on check_logs for select using (auth.uid() = user_id);

-- (선택) 로그가 너무 쌓이면 오래된 로그 정리 예시:
-- delete from check_logs where checked_at < now() - interval '90 days';
