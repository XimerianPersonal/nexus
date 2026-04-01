# Nexus Remote Assistance Platform

A browser-based remote assistance platform with a web portal for support agents and a lightweight desktop agent for supported workstations.

## Architecture

```
┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
│   Web Portal    │  WS/   │  Relay Server   │  WS/   │  Desktop Agent  │
│   (React/TS)    │◄──────►│  (Node.js)      │◄──────►│  (Go binary)    │
│   Browser-based │  RTC   │  Express + ws   │  RTC   │  Cross-platform │
└─────────────────┘        └─────────────────┘        └─────────────────┘
```

## Features

- **Remote Screen Viewing** — See the remote desktop via WebRTC video streaming
- **Remote Control** — Mouse and keyboard input forwarding over WebRTC DataChannel
- **Chat** — Real-time messaging between support agent and user
- **File Transfer** — Drag-and-drop file sharing over DataChannel
- **Session Codes** — 6-character codes for quick attended connections
- **Unattended Access** — Persistent agent registration with access key authentication and user-declinable timeout
- **Professional UI** — Dark-themed web portal inspired by TeamViewer/AnyDesk

## Components

| Component | Technology | Location |
|-----------|-----------|----------|
| **Relay Server** | Node.js, Express, WebSocket (`ws`) | `relay/` |
| **Web Portal** | React 18, TypeScript, Vite | `portal/` |
| **Desktop Agent** | Go, pion/webrtc, gorilla/websocket | `agent/` |
| **Shared Types** | TypeScript | `packages/shared/` |

## Quick Start

### Prerequisites

- Node.js 22+
- Go 1.22+
- npm

### Development

```bash
# Install all dependencies
make install

# Start the relay server (port 3001)
cd relay && npm run dev

# In another terminal, start the portal (port 5173)
cd portal && npm run dev

# Build and run the desktop agent
cd agent && go build -o bin/nexus-agent ./cmd/nexus-agent
./bin/nexus-agent --server ws://localhost:3001
```

### Docker

```bash
docker-compose up
# Portal: http://localhost:8080
# Relay:  ws://localhost:3001/ws
```

## Usage

### Attended Access (Session Codes)

1. Run the agent on the target machine:
   ```bash
   nexus-agent --server ws://your-relay-server:3001
   ```
2. The agent displays a 6-character session code (e.g., `X7K9M2`)
3. Open the web portal and enter the code
4. The WebRTC connection is established — you can see the screen, control it, chat, and transfer files

### Unattended Access

For machines that need remote access without someone present:

1. **Setup** (one-time on the target machine):
   ```bash
   nexus-agent --setup --server ws://your-relay-server:3001
   ```
   This generates a persistent Agent ID and Access Key. Save the access key — support agents need it to connect.

2. **Run in unattended mode**:
   ```bash
   nexus-agent --unattended
   ```
   The agent registers with the relay and waits for connections.

3. **Connect from the portal**:
   - Open the web portal dashboard
   - Find the agent in the "Unattended Agents" section
   - Click "Connect" and enter the access key
   - The user at the machine gets a 30-second window to decline
   - If not declined, access is granted automatically

**Timeout behavior**: When a support agent requests unattended access, the machine's user sees a notification with a countdown timer. They can press `d` + Enter to decline. If no action is taken within the timeout (default 30 seconds, configurable with `--timeout`), the connection is automatically accepted.

## Agent CLI Flags

```
Usage: nexus-agent [flags]

Flags:
  --server string     Relay server WebSocket URL (default "ws://localhost:3001")
  --unattended        Enable unattended access mode
  --setup             Run initial setup for unattended access
  --config string     Path to config file (default: platform-specific)
  --timeout int       Seconds for user to decline unattended access (default 30)
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check with uptime and session count |
| GET | `/api/sessions` | List active sessions |
| GET | `/api/agents` | List registered unattended agents |
| POST | `/api/auth/token` | Generate JWT token |

## Connection Flow

```
Agent                         Relay                         Portal
  │                             │                             │
  │─── WS connect ────────────►│                             │
  │─── register ──────────────►│                             │
  │◄── session_created ────────│  (code: X7K9M2)            │
  │                             │                             │
  │                             │◄── WS connect ─────────────│
  │                             │◄── join_session (X7K9M2) ──│
  │◄── peer_joined ────────────│──► session_joined ─────────►│
  │                             │                             │
  │                             │◄── signal:offer ───────────│
  │◄── signal:offer ───────────│                             │
  │─── signal:answer ─────────►│──► signal:answer ──────────►│
  │◄── signal:ice ─────────────│──► signal:ice ─────────────►│
  │                             │                             │
  │═══════════ WebRTC P2P Established ════════════════════════│
  │                             │                             │
  │─── video track (screen) ──────────────────────────────────►│
  │◄────────── input DataChannel (mouse/kbd) ──────────────────│
  │◄═══════════ chat + files (DataChannel) ═══════════════════►│
```

## Project Structure

```
nexus/
├── packages/shared/          # Shared TypeScript types
│   └── src/
│       ├── constants.ts      # Ports, timeouts, limits
│       ├── messages.ts       # WebSocket message types
│       └── session.ts        # Session and agent types
├── relay/                    # Relay server
│   └── src/
│       ├── api/              # REST endpoints
│       ├── auth/             # JWT auth
│       ├── session/          # Session + unattended management
│       ├── signaling/        # WebRTC signaling relay
│       └── ws/               # WebSocket handling
├── portal/                   # Web portal (React SPA)
│   └── src/
│       ├── api/              # WS + REST clients
│       ├── components/       # UI components
│       ├── hooks/            # React hooks
│       ├── pages/            # Dashboard + SessionView
│       ├── rtc/              # WebRTC + DataChannel
│       └── styles/           # CSS
├── agent/                    # Desktop agent (Go)
│   ├── cmd/nexus-agent/      # CLI entry point
│   └── internal/
│       ├── capture/          # Screen capture
│       ├── input/            # Mouse/keyboard injection
│       ├── rtc/              # pion/webrtc peer connection
│       ├── session/          # Session + unattended mode
│       └── ws/               # WebSocket client
├── docker-compose.yml
└── Makefile
```
