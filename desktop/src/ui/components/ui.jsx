import React from 'react';

export const Card = ({ title, subtitle, actions, children, className = '', tone }) => (
  <section className={`card ${tone ? `card--${tone}` : ''} ${className}`}>
    {(title || actions) && (
      <header className="card__head">
        <div>
          {title && <h2 className="card__title">{title}</h2>}
          {subtitle && <p className="card__subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="card__actions">{actions}</div>}
      </header>
    )}
    <div className="card__body">{children}</div>
  </section>
);

export const Button = ({ children, variant = 'default', size, loading, ...rest }) => (
  <button
    type="button"
    className={`btn btn--${variant}${size ? ` btn--${size}` : ''}${loading ? ' btn--loading' : ''}`}
    {...rest}
  >
    {loading && <span className="spinner" aria-hidden="true" />}
    {children}
  </button>
);

export const Pill = ({ tone = 'neutral', children, title }) => (
  <span className={`pill pill--${tone}`} title={title}>
    {children}
  </span>
);

export const Field = ({ label, hint, children, htmlFor }) => (
  <label className="field" htmlFor={htmlFor}>
    <span className="field__label">{label}</span>
    {children}
    {hint && <span className="field__hint">{hint}</span>}
  </label>
);

export const Toggle = ({ checked, onChange, label, hint, disabled }) => (
  <div className={`toggle${disabled ? ' toggle--disabled' : ''}`}>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`toggle__track${checked ? ' is-on' : ''}`}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
    >
      <span className="toggle__thumb" />
    </button>
    <div className="toggle__text">
      <span className="toggle__label">{label}</span>
      {hint && <span className="toggle__hint">{hint}</span>}
    </div>
  </div>
);

export const Meter = ({ level = 0, active }) => {
  const bars = 24;
  const lit = Math.round(Math.min(1, level * 2.2) * bars);
  return (
    <div className={`meter${active ? ' is-active' : ''}`} aria-label="Input level">
      {Array.from({ length: bars }, (_, index) => (
        <span
          key={index}
          className={`meter__bar${index < lit ? ' is-lit' : ''}${index > bars - 5 ? ' is-hot' : ''}`}
        />
      ))}
    </div>
  );
};

export const Empty = ({ icon = '·', title, children }) => (
  <div className="empty">
    <div className="empty__icon">{icon}</div>
    <p className="empty__title">{title}</p>
    {children && <p className="empty__body">{children}</p>}
  </div>
);

export const relativeTime = (iso) => {
  if (!iso) return '';
  const delta = Math.max(0, Date.now() - new Date(iso).getTime());
  if (delta < 5000) return 'just now';
  if (delta < 60000) return `${Math.round(delta / 1000)}s ago`;
  if (delta < 3600000) return `${Math.round(delta / 60000)}m ago`;
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
