import type { ComparisonOperator, Condition, CustomerDataField } from '../models/configuration';
import { Button } from './ui';

const OPERATORS: ComparisonOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'is_null', 'is_not_null'];

function parseValue(raw: string, field?: CustomerDataField): unknown {
  if (!field) return raw;
  if (field.type === 'number') return raw === '' ? '' : Number(raw);
  if (field.type === 'boolean') return raw === 'true';
  return raw;
}

function valueToInputString(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value);
}

export function ConditionEditor({
  conditions,
  fields,
  onChange,
}: {
  conditions: Condition[];
  fields: CustomerDataField[];
  onChange: (next: Condition[]) => void;
}) {
  const update = (idx: number, patch: Partial<Condition>) => {
    const next = conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onChange(next);
  };
  const remove = (idx: number) => onChange(conditions.filter((_, i) => i !== idx));
  const add = () => onChange([...conditions, { field: fields[0]?.key ?? '', operator: 'eq', value: '' }]);

  return (
    <div className="stack-sm">
      {conditions.length === 0 && <p className="muted" style={{ fontSize: 12.5 }}>No conditions — matches everything (catch-all).</p>}
      {conditions.map((cond, idx) => {
        const field = fields.find((f) => f.key === cond.field);
        const needsValue = cond.operator !== 'is_null' && cond.operator !== 'is_not_null';
        return (
          <div key={idx} className="flex-row" style={{ flexWrap: 'wrap' }}>
            <select value={cond.field} onChange={(e) => update(idx, { field: e.target.value })} style={{ maxWidth: 200 }}>
              {fields.map((f) => (
                <option key={f.key} value={f.key}>{f.displayName}</option>
              ))}
            </select>
            <select value={cond.operator} onChange={(e) => update(idx, { operator: e.target.value as ComparisonOperator })} style={{ maxWidth: 130 }}>
              {OPERATORS.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
            {needsValue && (
              field?.type === 'boolean' ? (
                <select value={valueToInputString(cond.value)} onChange={(e) => update(idx, { value: parseValue(e.target.value, field) })} style={{ maxWidth: 110 }}>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : field?.type === 'enum' && field.options ? (
                <select value={valueToInputString(cond.value)} onChange={(e) => update(idx, { value: e.target.value })} style={{ maxWidth: 150 }}>
                  <option value="">—</option>
                  {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  type={field?.type === 'number' ? 'number' : 'text'}
                  value={valueToInputString(cond.value)}
                  onChange={(e) => update(idx, { value: parseValue(e.target.value, field) })}
                  style={{ maxWidth: 130 }}
                  placeholder="value"
                />
              )
            )}
            <Button size="sm" variant="danger" onClick={() => remove(idx)}>Remove</Button>
          </div>
        );
      })}
      <Button size="sm" onClick={add}>+ Add Condition</Button>
    </div>
  );
}
