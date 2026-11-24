import type { CustomerDataField, FieldGroup } from '../../models/configuration';
import type { CustomerRecord } from '../../models/customer';
import { FieldInput } from './FieldInput';

export function WizardStepFields({
  fields,
  group,
  data,
  onFieldChange,
}: {
  fields: CustomerDataField[];
  group: FieldGroup;
  data: CustomerRecord;
  onFieldChange: (key: string, value: unknown) => void;
}) {
  const groupFields = fields.filter((f) => f.group === group && f.enabled && f.visibleInPlayground);

  return (
    <div className="grid grid-2">
      {groupFields.map((f) => (
        <FieldInput
          key={f.key}
          field={f}
          value={data[f.key]}
          onChange={(v) => onFieldChange(f.key, v)}
          onDeriveAge={(age) => onFieldChange('age', age)}
        />
      ))}
    </div>
  );
}
