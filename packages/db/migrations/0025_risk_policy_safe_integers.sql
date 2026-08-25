ALTER TABLE "risk_policy_revisions" DROP CONSTRAINT "risk_policy_revisions_payload_valid";--> statement-breakpoint
ALTER TABLE "risk_policy_revisions" ADD CONSTRAINT "risk_policy_revisions_payload_valid" CHECK (
        case
          when "risk_policy_revisions"."scope" = 'GLOBAL' then
            jsonb_typeof("risk_policy_revisions"."payload") = 'object'
            and "risk_policy_revisions"."payload" ?& array['version', 'currency', 'thresholds', 'caution']
            and ("risk_policy_revisions"."payload" - array['version', 'currency', 'thresholds', 'caution']) = '{}'::jsonb
            and jsonb_typeof("risk_policy_revisions"."payload"->'version') = 'string'
            and length(btrim("risk_policy_revisions"."payload"->>'version')) > 0
            and jsonb_typeof("risk_policy_revisions"."payload"->'currency') = 'string'
            and ("risk_policy_revisions"."payload"->>'currency') ~ '^[A-Z]{3}$'
            and jsonb_typeof("risk_policy_revisions"."payload"->'thresholds') = 'object'
            and ("risk_policy_revisions"."payload"->'thresholds') ?& array[
              'stopOnHoldValueAt', 'stopDeliveryRateBelow', 'minimumOrdersForRateRule',
              'resumeOnHoldValueBelow', 'resumeDeliveryRateAt', 'stableCyclesBeforeResume'
            ]
            and (("risk_policy_revisions"."payload"->'thresholds') - array[
              'stopOnHoldValueAt', 'stopDeliveryRateBelow', 'minimumOrdersForRateRule',
              'resumeOnHoldValueBelow', 'resumeDeliveryRateAt', 'stableCyclesBeforeResume'
            ]) = '{}'::jsonb
            and jsonb_typeof("risk_policy_revisions"."payload"->'caution') = 'object'
            and ("risk_policy_revisions"."payload"->'caution') ?& array['onHoldValue', 'deliveryRate']
            and (("risk_policy_revisions"."payload"->'caution') - array['onHoldValue', 'deliveryRate']) = '{}'::jsonb
          when "risk_policy_revisions"."scope" = 'SHOP' and not "risk_policy_revisions"."enabled" then
            "risk_policy_revisions"."payload" = '{"thresholds": {}, "caution": {}}'::jsonb
          when "risk_policy_revisions"."scope" = 'SHOP' then
            jsonb_typeof("risk_policy_revisions"."payload") = 'object'
            and "risk_policy_revisions"."payload" ?& array['thresholds', 'caution']
            and ("risk_policy_revisions"."payload" - array['thresholds', 'caution']) = '{}'::jsonb
            and jsonb_typeof("risk_policy_revisions"."payload"->'thresholds') = 'object'
            and (("risk_policy_revisions"."payload"->'thresholds') - array[
              'stopOnHoldValueAt', 'stopDeliveryRateBelow', 'minimumOrdersForRateRule',
              'resumeOnHoldValueBelow', 'resumeDeliveryRateAt', 'stableCyclesBeforeResume'
            ]) = '{}'::jsonb
            and jsonb_typeof("risk_policy_revisions"."payload"->'caution') = 'object'
            and (("risk_policy_revisions"."payload"->'caution') - array['onHoldValue', 'deliveryRate']) = '{}'::jsonb
          else false
        end
        and case when ("risk_policy_revisions"."payload"->'thresholds') ? 'stopOnHoldValueAt' then
          jsonb_typeof("risk_policy_revisions"."payload"->'thresholds'->'stopOnHoldValueAt') = 'string'
          and ("risk_policy_revisions"."payload"->'thresholds'->>'stopOnHoldValueAt') ~ '^[0-9]+([.][0-9]+)?$'
        else true end
        and case when ("risk_policy_revisions"."payload"->'thresholds') ? 'resumeOnHoldValueBelow' then
          jsonb_typeof("risk_policy_revisions"."payload"->'thresholds'->'resumeOnHoldValueBelow') = 'string'
          and ("risk_policy_revisions"."payload"->'thresholds'->>'resumeOnHoldValueBelow') ~ '^[0-9]+([.][0-9]+)?$'
        else true end
        and case when ("risk_policy_revisions"."payload"->'thresholds') ? 'stopDeliveryRateBelow' then
          jsonb_typeof("risk_policy_revisions"."payload"->'thresholds'->'stopDeliveryRateBelow') = 'number'
          and ("risk_policy_revisions"."payload"->'thresholds'->>'stopDeliveryRateBelow')::numeric between 0 and 1
        else true end
        and case when ("risk_policy_revisions"."payload"->'thresholds') ? 'resumeDeliveryRateAt' then
          jsonb_typeof("risk_policy_revisions"."payload"->'thresholds'->'resumeDeliveryRateAt') = 'number'
          and ("risk_policy_revisions"."payload"->'thresholds'->>'resumeDeliveryRateAt')::numeric between 0 and 1
        else true end
        and case when ("risk_policy_revisions"."payload"->'thresholds') ? 'minimumOrdersForRateRule' then
          jsonb_typeof("risk_policy_revisions"."payload"->'thresholds'->'minimumOrdersForRateRule') = 'number'
          and ("risk_policy_revisions"."payload"->'thresholds'->>'minimumOrdersForRateRule')::numeric >= 0
          and mod(("risk_policy_revisions"."payload"->'thresholds'->>'minimumOrdersForRateRule')::numeric, 1) = 0
          and ("risk_policy_revisions"."payload"->'thresholds'->>'minimumOrdersForRateRule')::numeric <= 9007199254740991
        else true end
        and case when ("risk_policy_revisions"."payload"->'thresholds') ? 'stableCyclesBeforeResume' then
          jsonb_typeof("risk_policy_revisions"."payload"->'thresholds'->'stableCyclesBeforeResume') = 'number'
          and ("risk_policy_revisions"."payload"->'thresholds'->>'stableCyclesBeforeResume')::numeric > 0
          and mod(("risk_policy_revisions"."payload"->'thresholds'->>'stableCyclesBeforeResume')::numeric, 1) = 0
          and ("risk_policy_revisions"."payload"->'thresholds'->>'stableCyclesBeforeResume')::numeric <= 9007199254740991
        else true end
        and case when ("risk_policy_revisions"."payload"->'caution') ? 'onHoldValue' then
          jsonb_typeof("risk_policy_revisions"."payload"->'caution'->'onHoldValue') = 'object'
          and case "risk_policy_revisions"."payload"->'caution'->'onHoldValue'->>'mode'
            when 'DISABLED' then "risk_policy_revisions"."payload"->'caution'->'onHoldValue' = '{"mode": "DISABLED"}'::jsonb
            when 'ABSOLUTE_BUFFER' then
              "risk_policy_revisions"."payload"->'caution'->'onHoldValue' ?& array['mode', 'buffer']
              and jsonb_typeof("risk_policy_revisions"."payload"->'caution'->'onHoldValue'->'buffer') = 'string'
              and ("risk_policy_revisions"."payload"->'caution'->'onHoldValue'->>'buffer') ~ '^[0-9]+([.][0-9]+)?$'
              and (("risk_policy_revisions"."payload"->'caution'->'onHoldValue') - array['mode', 'buffer']) = '{}'::jsonb
            when 'RELATIVE_RATIO' then
              "risk_policy_revisions"."payload"->'caution'->'onHoldValue' ?& array['mode', 'ratio']
              and jsonb_typeof("risk_policy_revisions"."payload"->'caution'->'onHoldValue'->'ratio') = 'number'
              and ("risk_policy_revisions"."payload"->'caution'->'onHoldValue'->>'ratio')::numeric > 0
              and ("risk_policy_revisions"."payload"->'caution'->'onHoldValue'->>'ratio')::numeric <= 1
              and (("risk_policy_revisions"."payload"->'caution'->'onHoldValue') - array['mode', 'ratio']) = '{}'::jsonb
            else false
          end
        else true end
        and case when ("risk_policy_revisions"."payload"->'caution') ? 'deliveryRate' then
          jsonb_typeof("risk_policy_revisions"."payload"->'caution'->'deliveryRate') = 'object'
          and case "risk_policy_revisions"."payload"->'caution'->'deliveryRate'->>'mode'
            when 'DISABLED' then "risk_policy_revisions"."payload"->'caution'->'deliveryRate' = '{"mode": "DISABLED"}'::jsonb
            when 'ABSOLUTE_BUFFER' then
              "risk_policy_revisions"."payload"->'caution'->'deliveryRate' ?& array['mode', 'buffer']
              and jsonb_typeof("risk_policy_revisions"."payload"->'caution'->'deliveryRate'->'buffer') = 'string'
              and ("risk_policy_revisions"."payload"->'caution'->'deliveryRate'->>'buffer') ~ '^[0-9]+([.][0-9]+)?$'
              and (("risk_policy_revisions"."payload"->'caution'->'deliveryRate') - array['mode', 'buffer']) = '{}'::jsonb
            when 'RELATIVE_RATIO' then
              "risk_policy_revisions"."payload"->'caution'->'deliveryRate' ?& array['mode', 'ratio']
              and jsonb_typeof("risk_policy_revisions"."payload"->'caution'->'deliveryRate'->'ratio') = 'number'
              and ("risk_policy_revisions"."payload"->'caution'->'deliveryRate'->>'ratio')::numeric > 0
              and ("risk_policy_revisions"."payload"->'caution'->'deliveryRate'->>'ratio')::numeric <= 1
              and (("risk_policy_revisions"."payload"->'caution'->'deliveryRate') - array['mode', 'ratio']) = '{}'::jsonb
            else false
          end
        else true end
        and case when "risk_policy_revisions"."scope" = 'GLOBAL' then
          ("risk_policy_revisions"."payload"->'thresholds'->>'resumeDeliveryRateAt')::numeric >=
            ("risk_policy_revisions"."payload"->'thresholds'->>'stopDeliveryRateBelow')::numeric
          and ("risk_policy_revisions"."payload"->'thresholds'->>'resumeOnHoldValueBelow')::numeric <=
            ("risk_policy_revisions"."payload"->'thresholds'->>'stopOnHoldValueAt')::numeric
        else true end
      );