export function formatNotificationDate(value) {
  if (!value) return 'TBD';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'TBD';

  return new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatNotificationMoney(value, currency = 'NGN') {
  if (value === undefined || value === null || value === '') return 'TBD';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value);

  const hasDecimals = Math.round(amount * 100) % 100 !== 0;
  return `${currency} ${amount.toLocaleString('en-NG', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: hasDecimals ? 2 : 0,
  })}`;
}
