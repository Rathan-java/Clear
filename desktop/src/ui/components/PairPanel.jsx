import React, { useEffect, useState } from 'react';
import { Button, Card, Empty, Pill } from './ui.jsx';

const PairPanel = ({ state, onCreateCode }) => {
  const [code, setCode] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const phones = state.connection?.presence?.mobile || [];

  const generate = async () => {
    setBusy(true);
    setError(null);
    const result = await onCreateCode();
    if (result.ok) {
      setCode(result.code);
      setSecondsLeft(result.ttlSeconds || 300);
    } else {
      setError(result.error);
    }
    setBusy(false);
  };

  useEffect(() => {
    if (!secondsLeft) return undefined;
    const timer = setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  useEffect(() => {
    if (secondsLeft === 0 && code) setCode(null);
  }, [secondsLeft, code]);

  return (
    <div className="pair">
      <Card title="Pair your phone" subtitle="Sign in on the Android app with the same account, then enter this code.">
        <div className="pair__code-area">
          {code ? (
            <>
              <div className="pair__code">{code}</div>
              <p className="pair__ttl">
                Expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
              </p>
              <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(code)}>
                Copy code
              </Button>
            </>
          ) : (
            <>
              <Empty icon="🔗" title="No active code">
                Codes are single use and expire after five minutes.
              </Empty>
              <Button variant="primary" onClick={generate} loading={busy} disabled={busy}>
                Generate pairing code
              </Button>
            </>
          )}
          {error && <p className="alert alert--error">{error}</p>}
        </div>

        <ol className="pair__steps">
          <li>Install <code>app-release.apk</code> on your Android phone.</li>
          <li>Sign in with <strong>{state.auth?.email || 'your account'}</strong>.</li>
          <li>Tap <strong>Pair with desktop</strong> and type the code above.</li>
          <li>Answers start arriving the moment a question is detected.</li>
        </ol>
      </Card>

      <Card title="Connected devices" subtitle="Live view of what is in this room right now">
        {phones.length === 0 ? (
          <Empty icon="📱" title="No phone connected">
            Once paired, your phone shows up here whenever the app is open.
          </Empty>
        ) : (
          <ul className="device-list">
            {phones.map((phone) => (
              <li key={phone.deviceId}>
                <span>{phone.name || 'Android phone'}</span>
                <Pill tone="good">online</Pill>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};

export default PairPanel;
