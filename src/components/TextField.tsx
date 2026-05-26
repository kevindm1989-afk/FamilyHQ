import { useId, type ReactElement } from 'react';

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'password';
  placeholder?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}

/**
 * Labelled text input. Label sits above the field (WCAG 3.3.2); the error text
 * is programmatically associated via aria-describedby and the field is marked
 * aria-invalid only when an error is present. The focus ring is on the row, not
 * the bare input.
 */
export function TextField(props: TextFieldProps): ReactElement {
  const {
    label,
    value,
    onChange,
    type = 'text',
    placeholder,
    error,
    required = false,
    disabled = false,
  } = props;

  const inputId = useId();
  const errorId = useId();
  const hasError = Boolean(error);

  return (
    <div className="flex flex-col gap-6">
      <label htmlFor={inputId} className="text-label font-semibold text-ink-2">
        {label}
        {required && <span className="text-ink-mute"> (Required)</span>}
      </label>
      <div
        className={`flex h-field items-center rounded-control border bg-surface-card px-14 focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-2 ${hasError ? 'border-status-danger' : 'border-surface-line focus-within:border-brand'} ${disabled ? 'opacity-50' : ''}`}
      >
        <input
          id={inputId}
          type={type}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? errorId : undefined}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent text-body text-ink placeholder:text-ink-mute2 focus:outline-none"
        />
      </div>
      {hasError && (
        <p id={errorId} className="flex items-center gap-4 text-meta text-status-danger-text">
          <AlertIcon />
          {error}
        </p>
      )}
    </div>
  );
}

function AlertIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="h-12 w-12 shrink-0" fill="currentColor" aria-hidden="true">
      <path d="M12 2L1 21h22L12 2zm0 6l.9 6h-1.8L12 8zm0 9a1.3 1.3 0 110 2.6 1.3 1.3 0 010-2.6z" />
    </svg>
  );
}
