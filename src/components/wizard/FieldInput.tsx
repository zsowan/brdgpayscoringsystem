import type { CustomerDataField } from '../../models/configuration';
import { Field } from '../ui';
import { deriveAge } from '../../utils/format';

export function FieldInput({
  field,
  value,
  onChange,
  onDeriveAge,
}: {
  field: CustomerDataField;
  value: unknown;
  onChange: (value: unknown) => void;
  onDeriveAge?: (age: number | null) => void;
}) {
  const strValue = value === null || value === undefined ? '' : String(value);

  const note = field.source !== 'Customer Input' ? `Source: ${field.source}` : undefined;

  if (field.type === 'boolean') {
    return (
      <Field label={field.displayName} note={note}>
        <select value={strValue === 'true' ? 'true' : strValue === 'false' ? 'false' : ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'true')}>
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </Field>
    );
  }

  if (field.type === 'enum' && field.options) {
    return (
      <Field label={field.displayName} note={note}>
        <select value={strValue} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {field.options.map((o) => <option key={o} value={o}>{field.optionLabels?.[o] ?? o}</option>)}
        </select>
      </Field>
    );
  }

  if (field.type === 'number') {
    return (
      <Field label={field.displayName} note={note}>
        <input
          type="number"
          value={strValue}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      </Field>
    );
  }

  if (field.type === 'date') {
    return (
      <Field label={field.displayName} note={note}>
        <input
          type="date"
          value={strValue}
          onChange={(e) => {
            onChange(e.target.value || null);
            if (field.key === 'date_of_birth' && onDeriveAge) onDeriveAge(deriveAge(e.target.value));
          }}
        />
      </Field>
    );
  }

  return (
    <Field label={field.displayName} note={note}>
      <input type="text" value={strValue} onChange={(e) => onChange(e.target.value || null)} />
    </Field>
  );
}
