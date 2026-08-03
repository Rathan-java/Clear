import React from 'react';
import { Card, Empty, Pill } from './ui.jsx';

/**
 * There is no pairing step any more: signing into the same account on the phone
 * is what links them, because both devices simply read and write the same
 * Firestore documents. This panel just shows what is currently online.
 */
const PhonePanel = ({ state }) => {
  const presence = state.connection?.presence || { desktop: [], mobile: [] };
  const phones = presence.mobile || [];
  const projectId = state.connection?.projectId;

  return (
    <div className="pair">
      <Card title="Your phone" subtitle="Sign in on Android with the same account. That is the whole setup.">
        {phones.length === 0 ? (
          <Empty icon="📱" title="No phone signed in yet">
            Install the app, sign in as <strong>{state.auth?.email || 'your account'}</strong>, and it appears here.
            No pairing code, no Wi-Fi, no cable.
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

        <ol className="pair__steps">
          <li>Install <code>app-release.apk</code> on your Android phone.</li>
          <li>Sign in with <strong>{state.auth?.email || 'the same email'}</strong>.</li>
          <li>That is it - answers arrive wherever the phone has signal.</li>
        </ol>
      </Card>

      <Card title="How answers reach your phone" subtitle="No direct link between this PC and the phone">
        <div className="flow">
          <div className="flow__step">
            <span className="flow__icon">🎧</span>
            <div>
              <strong>This PC</strong>
              <p>Hears the meeting, detects the question, asks Gemini</p>
            </div>
          </div>
          <div className="flow__arrow">↓</div>
          <div className="flow__step">
            <span className="flow__icon">☁️</span>
            <div>
              <strong>Firebase{projectId ? ` · ${projectId}` : ''}</strong>
              <p>The answer is written to your private collection</p>
            </div>
          </div>
          <div className="flow__arrow">↓</div>
          <div className="flow__step">
            <span className="flow__icon">📱</span>
            <div>
              <strong>Your phone</strong>
              <p>A live listener shows it instantly, on Wi-Fi or mobile data</p>
            </div>
          </div>
        </div>

        <p className="muted">
          The phone never contacts this PC. Both devices talk only to Google, so they can be on different
          networks, or different continents.
        </p>
      </Card>
    </div>
  );
};

export default PhonePanel;
