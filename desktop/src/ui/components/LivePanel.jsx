import React, { useEffect, useRef, useState } from 'react';
import { Button, Card, Empty, Meter, Pill, relativeTime } from './ui.jsx';

const LivePanel = ({ state, devices, onToggle, onClear, onAsk, onSelectDevice, onRefreshDevices }) => {
  const capture = state.capture || {};
  const stats = state.stats || {};
  const lines = state.transcript?.lines || [];
  const answer = state.answer;

  const [manual, setManual] = useState('');
  const [asking, setAsking] = useState(false);
  const [copied, setCopied] = useState(false);
  const transcriptRef = useRef(null);

  useEffect(() => {
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines.length, state.transcript?.live]);

  const ask = async (event) => {
    event.preventDefault();
    if (!manual.trim()) return;
    setAsking(true);
    await onAsk(manual.trim());
    setManual('');
    setAsking(false);
  };

  const copyAnswer = async () => {
    if (!answer) return;
    const text = [answer.question && `Q: ${answer.question}`, answer.answer, ...(answer.summary || []).map((s) => `• ${s}`)]
      .filter(Boolean)
      .join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="live">
      <div className="live__controls">
        <Button variant={state.running ? 'danger' : 'primary'} size="lg" onClick={onToggle}>
          {state.running ? '■  Stop listening' : '●  Start listening'}
        </Button>

        <div className="live__device">
          <select
            value={capture.deviceId || 'system-loopback'}
            onChange={(event) => onSelectDevice(event.target.value)}
            title={capture.deviceLabel}
          >
            {(devices.length ? devices : [{ id: capture.deviceId, label: capture.deviceLabel }]).map((device) => (
              <option key={device.id} value={device.id}>
                {device.label}
                {device.recommended ? '  (recommended)' : ''}
              </option>
            ))}
          </select>
          <Button variant="ghost" size="sm" onClick={onRefreshDevices} title="Rescan audio devices">
            ⟳
          </Button>
        </div>

        <Meter level={capture.level || 0} active={capture.capturing} />

        <div className="live__hint">
          {capture.capturing
            ? 'Hearing everything played through your speakers or headset'
            : 'Press start, or use Ctrl+Shift+L from anywhere'}
        </div>
      </div>

      {capture.error && <p className="alert alert--error">{capture.error}</p>}

      <div className="live__grid">
        <Card
          title="Live transcript"
          subtitle={`${stats.questions || 0} questions detected · ${state.speech?.transcribed || 0} segments`}
          actions={
            <Button variant="ghost" size="sm" onClick={onClear}>
              Clear
            </Button>
          }
          className="live__transcript"
        >
          <div className="transcript" ref={transcriptRef}>
            {lines.length === 0 && !state.running && (
              <Empty icon="🎧" title="Nothing yet">
                Start listening and the meeting transcript appears here, line by line.
              </Empty>
            )}
            {lines.map((line) => (
              <p key={line.id} className={`transcript__line${line.isQuestion ? ' is-question' : ''}`}>
                <span className="transcript__time">{relativeTime(line.at)}</span>
                <span>{line.text}</span>
              </p>
            ))}
            {state.running && (
              <p className="transcript__live">
                <span className="dot dot--pulse" />
                {state.transcript?.live || 'Listening…'}
              </p>
            )}
          </div>
        </Card>

        <div className="live__right">
          <Card
            title="Detected question"
            tone={state.question ? 'accent' : undefined}
            className="live__question"
          >
            {state.question ? (
              <>
                <p className="question__text">{state.question.text}</p>
                <span className="question__time">{relativeTime(state.question.at)}</span>
              </>
            ) : (
              <Empty icon="?" title="No question yet">
                Clear only calls Gemini when someone actually asks something.
              </Empty>
            )}
          </Card>

          <Card
            title="AI answer"
            subtitle={answer ? `${answer.latencyMs} ms · ${answer.model}` : 'Waiting'}
            actions={
              answer && (
                <Button variant="ghost" size="sm" onClick={copyAnswer}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              )
            }
            className="live__answer"
          >
            {state.thinking && (
              <div className="thinking">
                <span className="spinner" /> Generating answer…
              </div>
            )}

            {!state.thinking && !answer && (
              <Empty icon="✦" title="No answers yet">
                Answers appear here and on your phone at the same time.
              </Empty>
            )}

            {answer && !state.thinking && (
              <>
                <p className="answer__text">{answer.answer}</p>
                {answer.summary?.length > 0 && (
                  <ul className="answer__summary">
                    {answer.summary.map((point, index) => (
                      <li key={index}>{point}</li>
                    ))}
                  </ul>
                )}
                <div className="answer__meta">
                  <Pill tone="good">{answer.latencyMs} ms</Pill>
                  <Pill tone="neutral">{relativeTime(answer.at)}</Pill>
                  {answer.manual && <Pill tone="neutral">manual</Pill>}
                </div>
              </>
            )}
          </Card>

          <form className="ask" onSubmit={ask}>
            <input
              value={manual}
              onChange={(event) => setManual(event.target.value)}
              placeholder="Ask Gemini something directly…"
            />
            <Button type="submit" variant="primary" size="sm" loading={asking} disabled={asking || !manual.trim()}>
              Ask
            </Button>
          </form>
        </div>
      </div>

      <div className="metrics">
        <Metric label="Answers" value={stats.answers || 0} />
        <Metric label="Questions" value={stats.questions || 0} />
        <Metric label="Avg answer" value={stats.avgAnswerMs ? `${stats.avgAnswerMs} ms` : '—'} />
        <Metric label="Last answer" value={stats.lastAnswerMs ? `${stats.lastAnswerMs} ms` : '—'} />
        <Metric label="Cloud write" value={state.connection?.latencyMs != null ? `${state.connection.latencyMs} ms` : '—'} />
        <Metric label="Audio captured" value={`${Math.round((capture.capturedMs || 0) / 1000)}s`} />
        <Metric label="Errors" value={stats.errors || 0} tone={stats.errors ? 'bad' : undefined} />
      </div>
    </div>
  );
};

const Metric = ({ label, value, tone }) => (
  <div className={`metric${tone ? ` metric--${tone}` : ''}`}>
    <span className="metric__value">{value}</span>
    <span className="metric__label">{label}</span>
  </div>
);

export default LivePanel;
