import type { AgentInfo } from '../../../packages/shared/src';
import type { ConnectionState } from '../rtc/connection';
import type { WSState } from '../api/ws';

interface StatusBarProps {
  wsState: WSState;
  rtcState: ConnectionState;
  dcState: RTCDataChannelState | 'new';
  agentInfo: AgentInfo | null;
  error: string | null;
  onDisconnect: () => void;
}

function wsStateLabel(state: WSState): string {
  switch (state) {
    case 'connected':
      return 'WS Connected';
    case 'connecting':
      return 'WS Connecting';
    case 'disconnected':
      return 'WS Disconnected';
    case 'error':
      return 'WS Error';
  }
}

function rtcStateLabel(state: ConnectionState): string {
  switch (state) {
    case 'connected':
      return 'RTC Connected';
    case 'connecting':
      return 'RTC Connecting';
    case 'new':
      return 'RTC New';
    case 'disconnected':
      return 'RTC Disconnected';
    case 'failed':
      return 'RTC Failed';
    case 'closed':
      return 'RTC Closed';
  }
}

function stateToClass(
  state: WSState | ConnectionState | RTCDataChannelState | 'new',
): string {
  switch (state) {
    case 'connected':
    case 'open':
      return 'connected';
    case 'connecting':
      return 'connecting';
    case 'new':
      return 'connecting';
    case 'disconnected':
    case 'closed':
    case 'closing':
      return 'disconnected';
    case 'error':
    case 'failed':
      return 'failed';
    default:
      return 'disconnected';
  }
}

export default function StatusBar({
  wsState,
  rtcState,
  dcState,
  agentInfo,
  error,
  onDisconnect,
}: StatusBarProps) {
  return (
    <div className="status-bar">
      <div className="status-group">
        <div className="status-indicator">
          <span className={`status-dot ${stateToClass(wsState)}`} />
          <span>{wsStateLabel(wsState)}</span>
        </div>
        <div className="status-indicator">
          <span className={`status-dot ${stateToClass(rtcState)}`} />
          <span>{rtcStateLabel(rtcState)}</span>
        </div>
        <div className="status-indicator">
          <span className={`status-dot ${stateToClass(dcState)}`} />
          <span>
            DC: {dcState === 'open' ? 'Open' : dcState === 'new' ? 'Waiting' : dcState}
          </span>
        </div>
      </div>

      <div className="status-group">
        {error && (
          <span style={{ color: 'var(--danger)', marginRight: 12 }}>{error}</span>
        )}
        {agentInfo && (
          <span style={{ color: 'var(--text-secondary)' }}>
            {agentInfo.username}@{agentInfo.hostname}
            {agentInfo.os ? ` (${agentInfo.os})` : ''}
          </span>
        )}
        <button
          className="btn btn-danger btn-sm"
          onClick={onDisconnect}
          style={{ padding: '3px 10px', fontSize: 11 }}
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}
