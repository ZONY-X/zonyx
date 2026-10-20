-- Pin the namespace for the pure, private cents calculation; no data changes.
ALTER FUNCTION partner_private.calculate(bigint,integer) SET search_path=pg_catalog;
