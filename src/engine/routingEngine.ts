import type { Configuration, RoutingRule } from '../models/configuration';
import type { CustomerRecord } from '../models/customer';
import { evaluateConditions } from './ruleEngine';

export interface RoutingResult {
  segmentId: string;
  matchedRule: RoutingRule | null;
}

/** Evaluates enabled routing rules in priority order, stopping at the first match. */
export function routeCustomer(config: Configuration, data: CustomerRecord): RoutingResult {
  const rules = [...config.routingRules]
    .filter((r) => r.enabled)
    .sort((a, b) => a.priority - b.priority);

  for (const rule of rules) {
    if (evaluateConditions(rule.conditions, data)) {
      return { segmentId: rule.targetSegmentId, matchedRule: rule };
    }
  }

  // Fallback: last-resort segment if no rule (including catch-all) matched. Must never
  // resolve to an inactive segment — an inactive segment is never routed to, full stop.
  const activeSegments = config.segments.filter((s) => s.active);
  const fallback = activeSegments[activeSegments.length - 1];
  return { segmentId: fallback?.id ?? '', matchedRule: null };
}
