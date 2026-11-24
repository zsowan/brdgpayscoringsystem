import type { Condition, ComparisonOperator } from '../models/configuration';
import type { CustomerRecord } from '../models/customer';

function toComparable(value: unknown): unknown {
  return value;
}

export function evaluateOperator(operator: ComparisonOperator, actual: unknown, expected: unknown): boolean {
  switch (operator) {
    case 'eq':
      return toComparable(actual) === toComparable(expected);
    case 'neq':
      return toComparable(actual) !== toComparable(expected);
    case 'gt':
      return Number(actual) > Number(expected);
    case 'gte':
      return Number(actual) >= Number(expected);
    case 'lt':
      return Number(actual) < Number(expected);
    case 'lte':
      return Number(actual) <= Number(expected);
    case 'in':
      return Array.isArray(expected) && expected.includes(actual);
    case 'not_in':
      return Array.isArray(expected) && !expected.includes(actual);
    case 'is_null':
      return actual === null || actual === undefined || actual === '';
    case 'is_not_null':
      return !(actual === null || actual === undefined || actual === '');
    default:
      return false;
  }
}

export function evaluateCondition(condition: Condition, data: CustomerRecord): boolean {
  const actual = data[condition.field];
  return evaluateOperator(condition.operator, actual, condition.value);
}

/** All conditions must pass (AND logic). An empty condition list always matches (catch-all). */
export function evaluateConditions(conditions: Condition[], data: CustomerRecord): boolean {
  if (conditions.length === 0) return true;
  return conditions.every((c) => evaluateCondition(c, data));
}

export function describeCondition(condition: Condition): string {
  const opLabels: Record<ComparisonOperator, string> = {
    eq: '=',
    neq: '≠',
    gt: '>',
    gte: '≥',
    lt: '<',
    lte: '≤',
    in: 'in',
    not_in: 'not in',
    is_null: 'is null',
    is_not_null: 'is not null',
  };
  if (condition.operator === 'is_null' || condition.operator === 'is_not_null') {
    return `${condition.field} ${opLabels[condition.operator]}`;
  }
  return `${condition.field} ${opLabels[condition.operator]} ${JSON.stringify(condition.value)}`;
}
