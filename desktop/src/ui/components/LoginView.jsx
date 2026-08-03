import React, { useState } from 'react';
import { Button, Card, Field } from './ui.jsx';

/**
 * Sign-in doubles as first-run setup: if the Firebase project has not been
 * configured yet, the two config fields are shown inline so there is only ever
 * one screen to get through.
 */
const LoginView = ({ settings, onLogin }) => {
  const configured = Boolean(settings?.firebase?.apiKey && settings?.firebase?.projectId);

  const [email, setEmail] = useState(settings?.auth?.email || '');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState(settings?.firebase?.apiKey || '');
  const [projectId, setProjectId] = useState(settings?.firebase?.projectId || '');
  const [showConfig, setShowConfig] = useState(!configured);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await onLogin({
        email: email.trim(),
        password,
        firebase: { apiKey: apiKey.trim(), projectId: projectId.trim() },
      });
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
        subtitle="The same account on your phone shows the answers there. Nothing connects the two devices directly."
      >
        <form className="login__form" onSubmit={submit}>
          {showConfig && (
            <>
              <p className="login__note">
                One-time setup. Create a free Firebase project, then copy these two values from
                <strong> Project settings → General → Your apps → Web app</strong>.
              </p>

              <Field label="Firebase API key" hint="Looks like AIzaSy… - not a secret, it only identifies the project">
                <input
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="AIzaSy…"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </Field>

              <Field label="Firebase project ID" hint="e.g. clear-meeting-assistant">
                <input
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  placeholder="your-project-id"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </Field>
            </>
          )}

          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoFocus={configured}
              required
            />
          </Field>

          <Field label="Password" hint="At least 6 characters. A new email creates the account.">
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              minLength={6}
              required
            />
          </Field>

          {error && <p className="alert alert--error">{error}</p>}

          <Button type="submit" variant="primary" loading={busy} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>

          {configured && (
            <Button variant="ghost" size="sm" onClick={() => setShowConfig((value) => !value)}>
              {showConfig ? 'Hide Firebase settings' : 'Firebase settings'}
            </Button>
          )}
        </form>
      </Card>
    </div>
  );
};

export default LoginView;
