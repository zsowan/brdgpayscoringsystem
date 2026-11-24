export const NATIONALITY_OPTIONS: { code: string; label: string }[] = [
  { code: 'KW', label: 'Kuwaiti' },
  { code: 'JO', label: 'Jordanian' },
  { code: 'EG', label: 'Egyptian' },
  { code: 'IN', label: 'Indian' },
  { code: 'BD', label: 'Bangladeshi' },
  { code: 'PH', label: 'Filipino' },
  { code: 'PK', label: 'Pakistani' },
  { code: 'SY', label: 'Syrian' },
  { code: 'LB', label: 'Lebanese' },
  { code: 'SA', label: 'Saudi' },
  { code: 'AE', label: 'Emirati' },
  { code: 'QA', label: 'Qatari' },
  { code: 'BH', label: 'Bahraini' },
  { code: 'OM', label: 'Omani' },
  { code: 'OTHER', label: 'Other' },
];

export const NATIONALITY_LABELS: Record<string, string> = Object.fromEntries(
  NATIONALITY_OPTIONS.map((o) => [o.code, o.label])
);
