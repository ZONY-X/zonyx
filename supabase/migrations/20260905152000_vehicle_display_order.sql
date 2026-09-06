-- Admin-controlled vehicle display ordering.
-- Adds a persistent display_order column. Existing vehicles are backfilled to
-- match the pre-existing /fleet ordering (created_at DESC), so the visible
-- order does not change until an admin reorders vehicles.
alter table public.vehicles
  add column if not exists display_order integer;

with ranked as (
  select id, row_number() over (order by created_at desc, id) as rn
  from public.vehicles
)
update public.vehicles v
set display_order = ranked.rn
from ranked
where v.id = ranked.id
  and v.display_order is null;

create index if not exists vehicles_display_order_idx
  on public.vehicles (display_order);
