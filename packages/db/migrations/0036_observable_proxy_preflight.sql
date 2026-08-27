ALTER TABLE "refresh_checkpoint_attempts" ADD COLUMN "proxy_preflight" jsonb;--> statement-breakpoint
ALTER TABLE "refresh_checkpoint_attempts" ADD CONSTRAINT "refresh_checkpoint_attempts_proxy_preflight_valid" CHECK ("refresh_checkpoint_attempts"."proxy_preflight" is null or (
      jsonb_typeof("refresh_checkpoint_attempts"."proxy_preflight") = 'object'
      and ("refresh_checkpoint_attempts"."proxy_preflight" ?& array['status', 'latencyMs', 'exitIp', 'reasonClass'])
      and ("refresh_checkpoint_attempts"."proxy_preflight" - array['status', 'latencyMs', 'exitIp', 'reasonClass']) = '{}'::jsonb
      and ("refresh_checkpoint_attempts"."proxy_preflight"->>'status') in ('HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN')
      and jsonb_typeof("refresh_checkpoint_attempts"."proxy_preflight"->'latencyMs') = 'number'
      and ("refresh_checkpoint_attempts"."proxy_preflight"->>'latencyMs')::numeric between 0 and 10000
      and mod(("refresh_checkpoint_attempts"."proxy_preflight"->>'latencyMs')::numeric, 1) = 0
      and jsonb_typeof("refresh_checkpoint_attempts"."proxy_preflight"->'exitIp') in ('string', 'null')
      and ("refresh_checkpoint_attempts"."proxy_preflight"->>'reasonClass') in ('OBSERVED_HEALTHY', 'OBSERVED_SLOW', 'OBSERVED_UNAVAILABLE', 'OBSERVATION_UNAVAILABLE', 'AUTH_REJECTED', 'HTTP_REJECTED', 'REQUEST_TIMEOUT', 'NETWORK_UNAVAILABLE')
    ));