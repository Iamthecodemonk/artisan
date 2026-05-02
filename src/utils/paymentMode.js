export const VALID_PAYMENT_MODES = ['upfront', 'aftercompletion'];

// Accept several common variants and be case-insensitive. Return the
// canonical token used across the codebase: 'upfront' or 'afterCompletion'.
export function normalizePaymentMode(mode) {
  if (mode === undefined || mode === null) return null;
  const normalized = String(mode).trim().toLowerCase().replace(/[_\s-]+/g, '');
  if (normalized === 'upfront') return 'upfront';
  if (normalized === 'aftercompletion') return 'afterCompletion';
  return null;
}

export function normalizePaymentModeOrDefault(mode, defaultMode = 'upfront') {
  const normalized = normalizePaymentMode(mode);
  return normalized || defaultMode;
}
