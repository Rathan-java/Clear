import React, { useState } from 'react';
import { Button, Card, Field } from './ui.jsx';

const LoginView = ({ settings, onLogin, onPatchSettings }) => {
  const [email, setEmail] = useState(settings?.auth?.email || '');
  const [password, setPassword] = useState('');
  const [backendUrl, setBackendUrl] = useState(settings?.backendUrl || 'http://localhost:8080');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (backendUrl !== settings?.backendUrl) await onPatchSettings({ backendUrl });
      const result = await onLogin({ email: email.trim(), password });
      if (!result.ok) setError(result.error);
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <Card
        title="Sign in to Clear"
        subtitle="One account links this PC to your phone. First sign-in creates the account."
      >
        <form className="login__form" onSubmit={submit}>
          <Field label="Backend URL" hint="Your deployed server, or http://localhost:8080 while developing">
            <input
              type="url"
              value={backendUrl}
              onChange={(event) => setBackendUrl(event.target.value)}
              placeholder="https://clear-backend.onrender.com"
              required
            />
          </Field>

          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoFocus
              required
            />
          </Field>

          <Field label="Password" hint="At least 8 characters">
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              minLength={8}
              required
            />
          </Field>

          {error && <p className="alert alert--error">{error}</p>}

          <Button type="submit" variant="primary" loading={busy} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  );
};

export default LoginView;
