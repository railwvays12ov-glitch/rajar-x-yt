import { useState } from 'react';
import { KEY_RATE_LIMIT_OPTIONS, MAX_KEY_RATE_LIMIT } from '@shared/types';

export const formatLimit = (n: number | null) => (n === null ? 'Unlimited' : `${n.toLocaleString()}/min`);

/**
 * Request-limit picker. Normal users get the presets; admins also get "Unlimited"
 * and a custom number (1 – 1,000,000 requests per minute).
 */
export function LimitPicker({
  value,
  onChange,
  admin,
  id = 'key-limit',
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  admin: boolean;
  id?: string;
}) {
  const preset = value !== null && (KEY_RATE_LIMIT_OPTIONS as readonly number[]).includes(value);
  const [mode, setMode] = useState<'preset' | 'custom' | 'unlimited'>(
    value === null ? 'unlimited' : preset ? 'preset' : 'custom',
  );
  const selectValue = mode === 'unlimited' ? 'unlimited' : mode === 'custom' ? 'custom' : String(value);

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <select
        id={id}
        className="field"
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'unlimited') {
            setMode('unlimited');
            onChange(null);
          } else if (v === 'custom') {
            setMode('custom');
            onChange(value ?? 1000);
          } else {
            setMode('preset');
            onChange(Number(v));
          }
        }}
      >
        {KEY_RATE_LIMIT_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n} requests / minute
          </option>
        ))}
        {admin && <option value="custom">Custom limit…</option>}
        {admin && <option value="unlimited">Unlimited (no rate limit, no daily quota)</option>}
      </select>
      {admin && mode === 'custom' && (
        <input
          className="field sm:!w-40"
          inputMode="numeric"
          aria-label="Requests per minute"
          value={value ?? ''}
          onChange={(e) => {
            const n = Math.min(MAX_KEY_RATE_LIMIT, Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1));
            onChange(n);
          }}
        />
      )}
    </div>
  );
}
