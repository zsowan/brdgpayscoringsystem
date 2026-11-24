export type CustomerRecord = Record<string, unknown>;

export interface SampleCustomer {
  id: string;
  label: string;
  description: string;
  data: CustomerRecord;
}
