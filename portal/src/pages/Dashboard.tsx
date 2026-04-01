import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { listSessions } from '../api/rest';
import type { SessionListItem } from '../../../packages/shared/src';
import SessionConnect from '../components/SessionConnect';
import UnattendedConnect from '../components/UnattendedConnect';

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);

  const fetchSessions = useCallback(async () => {
    try {
      const data = await listSessions();
      setSessions(data);
    } catch {
      // Silently fail - sessions list is not critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 10000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const handleConnect = useCallback(
    (code: string) => {
      setConnectError(null);
      setConnectLoading(true);
      // Navigate to session view; validation happens there
      navigate(`/session/${code}`);
    },
    [navigate],
  );

  const activeSessions = sessions.filter(
    (s) => s.status === 'connected' || s.status === 'waiting',
  );

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">N</div>
          <span>Nexus Remote Assist</span>
        </div>
      </header>
      <div className="app-content">
        <div className="dashboard-container fade-in">
          <div className="dashboard-hero">
            <h1>Remote Support Portal</h1>
            <p>Enter a session code to connect to a remote machine</p>
            <SessionConnect
              onConnect={handleConnect}
              error={connectError}
              loading={connectLoading}
            />
          </div>

          <div className="dashboard-grid">
            <div className="sessions-section">
              <h2>Active Sessions</h2>
              {loading ? (
                <div className="empty-state">
                  <div className="spinner" style={{ margin: '0 auto' }} />
                </div>
              ) : activeSessions.length === 0 ? (
                <div className="empty-state">
                  <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.4 }}>
                    {'\uD83D\uDDA5'}
                  </div>
                  <p>No active sessions</p>
                </div>
              ) : (
                <div className="session-list">
                  {activeSessions.map((session) => (
                    <div
                      key={session.code}
                      className="session-item"
                      onClick={() => navigate(`/session/${session.code}`)}
                    >
                      <div className="session-info">
                        <span className="session-code">{session.code}</span>
                        <span className="session-host">
                          {session.hostname
                            ? `${session.username || 'Unknown'}@${session.hostname}`
                            : 'Waiting for agent...'}
                        </span>
                      </div>
                      <div className="session-meta">
                        {session.os && (
                          <span
                            className="badge badge-info"
                            style={{ textTransform: 'capitalize' }}
                          >
                            {session.os}
                          </span>
                        )}
                        {session.unattended && (
                          <span className="badge badge-warning">Unattended</span>
                        )}
                        <span
                          className={`badge ${
                            session.status === 'connected'
                              ? 'badge-success'
                              : 'badge-warning'
                          }`}
                        >
                          {session.status === 'connected' ? 'Connected' : 'Waiting'}
                        </span>
                        {session.duration != null && (
                          <span
                            style={{
                              fontSize: 12,
                              color: 'var(--text-muted)',
                              fontFamily: 'var(--font-mono)',
                            }}
                          >
                            {formatDuration(session.duration)}
                          </span>
                        )}
                        {session.connectedAt && (
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {timeAgo(session.connectedAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="sessions-section" style={{ marginTop: 32 }}>
              <h2>Unattended Agents</h2>
              <UnattendedConnect />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
