import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSession } from '../hooks/useSession';
import RemoteScreen from '../components/RemoteScreen';
import ChatPanel from '../components/ChatPanel';
import FileTransfer from '../components/FileTransfer';
import StatusBar from '../components/StatusBar';

type SidebarTab = 'chat' | 'files';

export default function SessionView() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<SidebarTab>('chat');

  const session = useSession(code || '');

  if (!code) {
    navigate('/');
    return null;
  }

  const isConnected = session.rtcState === 'connected';

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">N</div>
          <span>Nexus Remote Assist</span>
        </div>
        <div className="session-toolbar-inline">
          <span className="session-toolbar-code">{session.sessionCode}</span>
          <span
            className={`badge ${
              isConnected
                ? 'badge-success'
                : session.rtcState === 'connecting' || session.rtcState === 'new'
                  ? 'badge-warning'
                  : 'badge-danger'
            }`}
            style={{ marginLeft: 12 }}
          >
            {session.rtcState === 'connected'
              ? 'Connected'
              : session.rtcState === 'connecting' || session.rtcState === 'new'
                ? 'Connecting...'
                : session.rtcState === 'failed'
                  ? 'Failed'
                  : 'Disconnected'}
          </span>
          {session.agentInfo && (
            <span
              style={{
                marginLeft: 16,
                fontSize: 13,
                color: 'var(--text-secondary)',
              }}
            >
              {session.agentInfo.username}@{session.agentInfo.hostname}
              {session.agentInfo.os && (
                <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>
                  ({session.agentInfo.os})
                </span>
              )}
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => navigate('/')}
            >
              Dashboard
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={() => {
                session.disconnect();
                navigate('/');
              }}
            >
              Disconnect
            </button>
          </div>
        </div>
      </header>

      <div className="session-layout">
        <div className="session-main">
          <RemoteScreen
            stream={session.remoteStream}
            onInput={session.sendInput}
            rtcState={session.rtcState}
          />
        </div>

        <div className="session-sidebar">
          <div className="sidebar-tabs">
            <button
              className={`sidebar-tab ${activeTab === 'chat' ? 'active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              Chat
              {session.chatMessages.length > 0 && (
                <span style={{ marginLeft: 6, opacity: 0.6 }}>
                  ({session.chatMessages.length})
                </span>
              )}
            </button>
            <button
              className={`sidebar-tab ${activeTab === 'files' ? 'active' : ''}`}
              onClick={() => setActiveTab('files')}
            >
              Files
              {session.files.length > 0 && (
                <span style={{ marginLeft: 6, opacity: 0.6 }}>
                  ({session.files.length})
                </span>
              )}
            </button>
          </div>

          <div className="sidebar-content">
            {activeTab === 'chat' && (
              <ChatPanel
                messages={session.chatMessages}
                onSend={session.sendChat}
                disabled={session.dcState !== 'open'}
              />
            )}
            {activeTab === 'files' && (
              <FileTransfer
                files={session.files}
                onSendFile={session.sendFile}
                disabled={session.dcState !== 'open'}
              />
            )}
          </div>
        </div>
      </div>

      <StatusBar
        wsState={session.wsState}
        rtcState={session.rtcState}
        dcState={session.dcState}
        agentInfo={session.agentInfo}
        error={session.error}
        onDisconnect={() => {
          session.disconnect();
          navigate('/');
        }}
      />
    </div>
  );
}
