import React, { useMemo, useState } from 'react';
import { Button, Card, Empty } from './ui.jsx';

const LogsPanel = ({ logs, onOpenLogs, onRefresh }) => {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () =>
      logs.filter((entry) => {
        if (filter !== 'all' && entry.level !== filter) return false;
        if (!query) return true;
        const haystack = `${entry.scope} ${entry.msg} ${JSON.stringify(entry)}`.toLowerCase();
        return haystack.includes(query.toLowerCase());
      }),
    [logs, filter, query]
  );

  return (
    <Card
      title="Activity log"
      subtitle="Everything the desktop app is doing, newest last"
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={onRefresh}>
            Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={onOpenLogs}>
            Open folder
          </Button>
        </>
      }
    >
      <div className="logs__controls">
        <input placeholder="Filter…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">All levels</option>
          <option value="info">Info</option>
          <option value="warn">Warnings</option>
          <option value="error">Errors</option>
        </select>
      </div>

      <div className="logs">
        {filtered.length === 0 ? (
          <Empty icon="≡" title="Nothing logged yet" />
        ) : (
          filtered.map((entry, index) => (
            <div key={`${entry.ts}-${index}`} className={`logline logline--${entry.level}`}>
              <span className="logline__time">{new Date(entry.ts).toLocaleTimeString()}</span>
              <span className="logline__scope">{entry.scope}</span>
              <span className="logline__msg">{entry.msg}</span>
              {entry.error && <span className="logline__error">{entry.error}</span>}
            </div>
          ))
        )}
      </div>
    </Card>
  );
};

export default LogsPanel;
