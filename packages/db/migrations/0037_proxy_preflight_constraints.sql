ALTER TABLE "refresh_checkpoint_attempts" DROP CONSTRAINT "refresh_checkpoint_attempts_proxy_preflight_valid";--> statement-breakpoint
ALTER TABLE "refresh_checkpoint_attempts" ADD CONSTRAINT "refresh_checkpoint_attempts_proxy_preflight_valid" CHECK ("refresh_checkpoint_attempts"."proxy_preflight" is null or (
      jsonb_typeof("refresh_checkpoint_attempts"."proxy_preflight") = 'object'
      and jsonb_object_length("refresh_checkpoint_attempts"."proxy_preflight") = 4
      and ("refresh_checkpoint_attempts"."proxy_preflight" ?& array['status', 'latencyMs', 'exitIp', 'reasonClass'])
      and ("refresh_checkpoint_attempts"."proxy_preflight"->>'status') in ('HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN')
      and jsonb_typeof("refresh_checkpoint_attempts"."proxy_preflight"->'latencyMs') = 'number'
      and ("refresh_checkpoint_attempts"."proxy_preflight"->>'latencyMs')::numeric between 0 and 10000
      and mod(("refresh_checkpoint_attempts"."proxy_preflight"->>'latencyMs')::numeric, 1) = 0
      and jsonb_typeof("refresh_checkpoint_attempts"."proxy_preflight"->'exitIp') in ('string', 'null')
      and (jsonb_typeof("refresh_checkpoint_attempts"."proxy_preflight"->'exitIp') = 'null' or (
        ("refresh_checkpoint_attempts"."proxy_preflight"->>'exitIp') ~ '^(?:(?:25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])$'
        and split_part("refresh_checkpoint_attempts"."proxy_preflight"->>'exitIp', '.', 1)::integer not in (0, 10, 127)
        and split_part("refresh_checkpoint_attempts"."proxy_preflight"->>'exitIp', '.', 1)::integer < 224
        and not (split_part("refresh_checkpoint_attempts"."proxy_preflight"->>'exitIp', '.', 1)::integer = 100 and split_part("refresh_checkpoint_attempts"."proxy_preflight"->>'exitIp', '.', 2)::integer between 64 and 127)
        and not (split_part("refresh_checkpoint_attempts"."proxy_preflight"->>'exitIp', '.', 1)::integer = 169 and split_part("refresh_checkpoint_attempts"."proxy_preflight"->>'exitIp', '.', 2)::integer = 254)
        and not (split_part("refresh_checkpoint_attempts"."proxy_preflight"->>'exitIp', '.', 1)::integer = 172 and split_part("refresh_checkpoint_attempts"."proxy_preflight"->>'exitIp', '.', 2)::integer between 16 and 31)
        and not (split_part("refresh_checkpoint_attempts"."proxy_preflight"->>'exitIp', '.', 1)::integer = 192 and (split_part("refresh_checkpoint_attempts"."proxy_preflight"->>'exitIp', '.', 2)::integer in (0, 168) or (split_part("refresh_checkpoint_attempts"."proxy_preflight"->>'exitIp', '.', 2)::integer = 88 and split_part("refresh_checkpoint_attempts"."proxy_preflight"->>'exitIp', '.', 3)::integer = 99)))
        and not (split_part("refresh_checkpoint_attempts"."proxy_preflight"->>'exitIp', '.', 1)::integer = 198 and split_part("refresh_checkpoint_attempts"."proxy_preflight"->>'exitIp', '.', 2)::integer in (18, 19, 51))
        and not (split_part("refresh_checkpoint_attempts"."proxy_preflight"->>'exitIp', '.', 1)::integer = 203 and split_part("refresh_checkpoint_attempts"."proxy_preflight"->>'exitIp', '.', 2)::integer = 0)
      ))
      and (
        (("refresh_checkpoint_attempts"."proxy_preflight"->>'status') = 'HEALTHY' and ("refresh_checkpoint_attempts"."proxy_preflight"->>'reasonClass') = 'OBSERVED_HEALTHY')
        or (("refresh_checkpoint_attempts"."proxy_preflight"->>'status') = 'DEGRADED' and ("refresh_checkpoint_attempts"."proxy_preflight"->>'reasonClass') = 'OBSERVED_SLOW')
        or (("refresh_checkpoint_attempts"."proxy_preflight"->>'status') = 'UNAVAILABLE' and ("refresh_checkpoint_attempts"."proxy_preflight"->>'exitIp') is null and ("refresh_checkpoint_attempts"."proxy_preflight"->>'reasonClass') in ('OBSERVED_UNAVAILABLE', 'AUTH_REJECTED', 'HTTP_REJECTED', 'REQUEST_TIMEOUT', 'NETWORK_UNAVAILABLE'))
        or (("refresh_checkpoint_attempts"."proxy_preflight"->>'status') = 'UNKNOWN' and ("refresh_checkpoint_attempts"."proxy_preflight"->>'exitIp') is null and ("refresh_checkpoint_attempts"."proxy_preflight"->>'reasonClass') = 'OBSERVATION_UNAVAILABLE')
      )
    ));