import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  UnattendedAgentInfo,
  ServerMessage,
} from '../../../packages/shared/src';
import { UNATTENDED_ACCESS_TIMEOUT_MS } from '../../../packages/shared/src';
import { useWebSocket } from '../hooks/useWebSocket';

type ConnectPhase = 'idle' | 'key-input' | 'waiting' | 'result';

interface ConnectResult {
  granted: boolean;
  sessionCode?: string;
  reason?: string;
}

export default function UnattendedConnect() {
  const navigate = useNavigate();
  const { state: wsState, send, subscribe } = useWebSocket();

  const [agents, setAgents] = useState<UnattendedAgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<UnattendedAgentInfo | null>(null);
  const [accessKey, setAccessKey] = useState('');
  const [phase, setPhase] = useState<ConnectPhase>('idle');
  const [result, setResult] = useState<ConnectResult | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Request agent list when WS connects
  useEffect(() => {
    if (wsState !== 'connected') return;

    // Register as portal to get agent list updates
    send({ type: 'register', role: 'portal' });

    const unsub = subscribe((msg: ServerMessage) => {
      switch (msg.type) {
        case 'unattended_agent_list': {
          setAgents(msg.agents);
          break;
        }
        case 'unattended_access_result': {
          clearCountdown();
          if (msg.granted && msg.sessionCode) {
            setResult({ granted: true, sessionCode: msg.sessionCode });
            setPhase('result');
            // Auto-redirect after 2 seconds
            redirectTimerRef.current = setTimeout(() => {
              navigate(`/session/${msg.sessionCode}`);
            }, 2000);
          } else {
            setResult({
              granted: false,
              reason: msg.reason || 'Access declined',
            });
            setPhase('result');
          }
          break;
        }
        case 'error': {
          setError(msg.message);
          setPhase('idle');
          clearCountdown();
          break;
        }
      }
    });

    return unsub;
  }, [wsState, send, subscribe, navigate]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      clearCountdown();
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    };
  }, []);

  const clearCountdown = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  const handleSelectAgent = useCallback((agent: UnattendedAgentInfo) => {
    setSelectedAgent(agent);
    setAccessKey('');
    setPhase('key-input');
    setError(null);
    setResult(null);
  }, []);

  const handleConnect = useCallback(() => {
    if (!selectedAgent || !accessKey.trim()) return;

    setError(null);
    setPhase('waiting');

    send({
      type: 'unattended_connect',
      agentId: selectedAgent.agentId,
      accessKey: accessKey.trim(),
      displayName: 'Support Agent',
    });

    // Start countdown
    const timeoutSec = Math.ceil(
      (selectedAgent.online ? UNATTENDED_ACCESS_TIMEOUT_MS : 5000) / 1000,
    );
    setCountdown(timeoutSec);
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearCountdown();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [selectedAgent, accessKey, send, clearCountdown]);

  const handleCancel = useCallback(() => {
    setPhase('idle');
    setSelectedAgent(null);
    setAccessKey('');
    setResult(null);
    setError(null);
    clearCountdown();
    if (redirectTimerRef.current) {
      clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = null;
    }
  }, [clearCountdown]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleConnect();
      }
    },
    [handleConnect],
  );

  if (agents.length === 0 && phase === 'idle') {
    return (
      <div className="empty-state">
        <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.4 }}>
          {'\uD83D\uDD12'}
        </div>
        <p>No registered agents</p>
      </div>
    );
  }

  return (
    <div className="unattended-section">
      {/* Agent list */}
      {phase === 'idle' && (
        <div className="session-list">
          {agents.map((agent) => (
            <div key={agent.agentId} className="session-item">
              <div className="session-info">
                <span
                  className={`status-dot ${agent.online ? 'connected' : 'disconnected'}`}
                  style={{ marginRight: 8 }}
                />
                <span className="session-code" style={{ fontSize: 14, letterSpacing: 0 }}>
                  {agent.hostname}
                </span>
                <span className="session-host">
                  {agent.username} &middot; {agent.os}
                </span>
              </div>
              <div className="session-meta">
                <span
                  className={`badge ${agent.online ? 'badge-success' : 'badge-danger'}`}
                >
                  {agent.online ? 'Online' : 'Offline'}
                </span>
                {!agent.online && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Last seen: {new Date(agent.lastSeen).toLocaleString()}
                  </span>
                )}
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!agent.online}
                  onClick={() => handleSelectAgent(agent)}
                >
                  Connect
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Access key input dialog */}
      {phase === 'key-input' && selectedAgent && (
        <div className="unattended-dialog card fade-in">
          <div className="card-header">
            <h3>
              Connect to {selectedAgent.hostname}
            </h3>
            <button className="btn btn-secondary btn-sm" onClick={handleCancel}>
              Cancel
            </button>
          </div>
          <div className="card-body">
            <div className="unattended-agent-detail">
              <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                {selectedAgent.username}@{selectedAgent.hostname} &middot;{' '}
                {selectedAgent.os}
              </span>
            </div>
            <div style={{ marginTop: 16 }}>
              <label
                htmlFor="access-key"
                style={{
                  display: 'block',
                  fontSize: 13,
                  color: 'var(--text-secondary)',
                  marginBottom: 6,
                }}
              >
                Access Key
              </label>
              <input
                id="access-key"
                type="password"
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Enter the pre-shared access key"
                autoFocus
                style={{ width: '100%' }}
              />
            </div>
            {error && (
              <div style={{ marginTop: 12, color: 'var(--danger)', fontSize: 13 }}>
                {error}
              </div>
            )}
            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className="btn btn-primary"
                disabled={!accessKey.trim()}
                onClick={handleConnect}
              >
                Request Access
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Waiting for access */}
      {phase === 'waiting' && selectedAgent && (
        <div className="unattended-dialog card fade-in">
          <div className="card-header">
            <h3>Requesting Access</h3>
            <button className="btn btn-secondary btn-sm" onClick={handleCancel}>
              Cancel
            </button>
          </div>
          <div className="card-body" style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div className="spinner" style={{ margin: '0 auto 20px' }} />
            <p style={{ color: 'var(--text-primary)', fontSize: 15 }}>
              Waiting for access to{' '}
              <strong>{selectedAgent.hostname}</strong>...
            </p>
            <p
              style={{
                color: 'var(--text-muted)',
                fontSize: 13,
                marginTop: 8,
              }}
            >
              The remote user can decline within the timeout period.
            </p>
            {countdown > 0 && (
              <div className="countdown-timer" style={{ marginTop: 20 }}>
                <span className="countdown-value">{countdown}s</span>
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    marginLeft: 8,
                  }}
                >
                  remaining
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Result */}
      {phase === 'result' && result && (
        <div className="unattended-dialog card fade-in">
          <div className="card-header">
            <h3>{result.granted ? 'Access Granted' : 'Access Declined'}</h3>
          </div>
          <div className="card-body" style={{ textAlign: 'center', padding: '40px 20px' }}>
            {result.granted ? (
              <>
                <div
                  style={{
                    fontSize: 48,
                    marginBottom: 16,
                    color: 'var(--success)',
                  }}
                >
                  {'\u2713'}
                </div>
                <p style={{ color: 'var(--text-primary)', fontSize: 15 }}>
                  Access granted! Redirecting to session...
                </p>
                <p
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: 13,
                    marginTop: 8,
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  Session: {result.sessionCode}
                </p>
              </>
            ) : (
              <>
                <div
                  style={{
                    fontSize: 48,
                    marginBottom: 16,
                    color: 'var(--danger)',
                  }}
                >
                  {'\u2717'}
                </div>
                <p style={{ color: 'var(--text-primary)', fontSize: 15 }}>
                  Access was declined.
                </p>
                {result.reason && (
                  <p
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: 13,
                      marginTop: 8,
                    }}
                  >
                    Reason: {result.reason}
                  </p>
                )}
                <button
                  className="btn btn-secondary"
                  onClick={handleCancel}
                  style={{ marginTop: 20 }}
                >
                  Back to Agents
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
