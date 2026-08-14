ALTER TABLE "ai_decisions" ADD CONSTRAINT "ai_decisions_failure_code_known" CHECK ("ai_decisions"."failure_code" is null or "ai_decisions"."failure_code" in (
        'FEATURE_DISABLED', 'MISSING_API_KEY', 'NOT_CONFIGURED', 'TIMEOUT',
        'NETWORK_ERROR', 'HTTP_ERROR', 'RATE_LIMITED', 'MALFORMED_RESPONSE',
        'INVALID_RESPONSE', 'INVALID_OUTPUT', 'PROVIDER_UNAVAILABLE'
      ));