import type { Configuration } from '../models/configuration';
import type { CustomerRecord } from '../models/customer';
import type { CinetStatus } from '../models/cinet';
import { deriveAge } from './format';
import { deriveResidencyFields } from './residency';
import { computeDebtToIncome } from './dti';
import { deriveCurrentDelinquency } from './cinetDelinquency';

/**
 * Eligible for online-integration auto-fill only when the field was never touched
 * (`undefined`) or left as an empty string. `null` is a deliberate "confirmed
 * unavailable" signal (e.g. a sample simulating a bureau outage, or a user
 * explicitly clearing a field) and must be respected, not silently overwritten —
 * otherwise a customer's own entered value could be clobbered back to a mock default.
 */
function isFillable(value: unknown): boolean {
  return value === undefined || value === '';
}

function isUnset(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/**
 * Resolves the record actually seen by the decision engine: fields owned by a mock
 * integration are filled from its mock data when the wizard left them blank (ONLINE),
 * or forced to null when the integration is simulated as down (TIMEOUT/ERROR) —
 * even if the wizard has a value, since that data would never have arrived in reality.
 *
 * `cinet_open_accounts` (an array, not a scalar) rides through this same generic
 * loop like any other CINET-owned field — a sample or the wizard state can set it
 * directly, and it is nulled together with the rest of the CINET payload on a
 * simulated outage.
 */
export function resolveCustomerRecord(wizardData: CustomerRecord, config: Configuration): CustomerRecord {
  const result: CustomerRecord = { ...wizardData };

  for (const integration of config.integrations) {
    for (const field of integration.fields) {
      if (integration.state === 'ONLINE') {
        if (isFillable(result[field])) {
          result[field] = integration.mockData[field] ?? null;
        }
      } else {
        result[field] = null;
      }
    }
  }

  if (!isUnset(result.date_of_birth)) {
    const age = deriveAge(String(result.date_of_birth));
    if (age !== null) result.age = age;
  }

  // Residency stability is always derived fresh from status/dates — never from nationality.
  Object.assign(result, deriveResidencyFields(result));

  // Demo-configurable: mirror the CINET BNPL payment into the BRDG aggregate obligations
  // figure, or keep it as its own separate mock/editable value. BNPL payment alone is
  // never assumed to represent the customer's full debt load — this is an explicit choice.
  if (config.globalSettings.dtiSourceMode === 'bnpl_payment') {
    result.monthly_debt_obligations = result.total_monthly_bnpl_payment ?? null;
  }

  // Debt-to-Income is always derived from obligations ÷ income — never a raw CINET value,
  // never from Active Loans / BNPL account count.
  result.debt_to_income = computeDebtToIncome(result);

  // Current Delinquency is a BRDG playground derivation from CINET repayment/overdue
  // data — never a CINET-defined field, and never a claim of formal "default".
  result.current_delinquency = deriveCurrentDelinquency(result);

  // CINET Score is optional to scoring: cinet_status is a per-assessment choice
  // (set explicitly in the wizard), independent of the other CINET bureau fields
  // above, which keep following the Integration Simulator's global state as before.
  const requestedCinetStatus: CinetStatus = (result.cinet_status as CinetStatus) ?? 'NOT_CHECKED';
  if (requestedCinetStatus !== 'AVAILABLE') {
    result.cinet_score = null;
    result.cinet_status = requestedCinetStatus;
  } else if (isUnset(result.cinet_score)) {
    // The wizard asked for CINET, but the score never actually came back — reflect the
    // real cause from the CINET integration's simulated state rather than a false "Available".
    const cinetIntegration = config.integrations.find((i) => i.id === 'cinet');
    result.cinet_status = cinetIntegration?.state === 'ERROR' ? 'ERROR' : 'TIMEOUT';
  } else {
    result.cinet_status = 'AVAILABLE';
  }

  return result;
}
