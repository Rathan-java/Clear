import React from 'react';
import { Pill } from './ui.jsx';

const latencyTone = (ms) => {
  if (ms == null) return 'neutral';
  if (ms < 150) return 'good';
  if (ms < 400) return 'warn';
  return 'bad';
};

const StatusBar = ({ state, onReconnect, tab, setTab }) => {
  const connection = state.connection || {};
  const capture = state.capture || {};
  const phones = connection.presence?.mobile?.length || 0;

  const tabs = [
    { id: 'live', label: 'Live' },
    { id: 'profile', label: 'Interview' },
    { id: 'pair', label: 'Phone' },
    { id: 'settings', label: 'Settings' },
    { id: 'logs', label: 'Logs' },
  ];

  return (
    <header className="statusbar">
      <div className="statusbar__brand">
        <span className="brand__mark" aria-hidden="true" />
        <div>
          <strong>Clear</strong>
          <span className="brand__sub">AI meeting assistant</span>
        </div>
      </div>

      <nav className="statusbar__tabs">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`tab${tab === item.id ? ' is-active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="statusbar__pills">
        <Pill tone={capture.capturing ? 'good' : 'neutral'} title={capture.deviceLabel}>
          {capture.capturing ? 'Listening' : 'Idle'}
        </Pill>

        <button type="button" className="pill-button" onClick={onReconnect} title="Reconnect to the backend">
          <Pill tone={connection.connected ? 'good' : connection.state === 'connecting' ? 'warn' : 'bad'}>
            {connection.connected ? 'Online' : connection.state === 'connecting' ? 'Connecting' : 'Offline'}
          </Pill>
        </button>

        <Pill tone={latencyTone(connection.latencyMs)} title="Round-trip time to the backend">
          {connection.latencyMs != null ? `${connection.latencyMs} ms` : '— ms'}
        </Pill>

        <Pill tone={phones ? 'good' : 'neutral'} title="Phones connected to this account">
          {phones} 📱
        </Pill>

        {connection.queued > 0 && (
          <Pill tone="warn" title="Events waiting for the backend to come back">
            {connection.queued} queued
          </Pill>
        )}
      </div>
    </header>
  );
};

export default StatusBar;
