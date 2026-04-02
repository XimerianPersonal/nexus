package session

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/user"
	"runtime"
	"sync"
	"time"

	"github.com/nexus-remote/nexus-agent/internal/capture"
	"github.com/nexus-remote/nexus-agent/internal/input"
	"github.com/nexus-remote/nexus-agent/internal/rtc"
	"github.com/nexus-remote/nexus-agent/internal/ws"
	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
)

// UnattendedAgent runs in persistent unattended mode, allowing support agents
// to connect without someone being present at the machine. The user gets a
// configurable timeout window to decline incoming connections.
type UnattendedAgent struct {
	config       *Config
	serverURL    string
	wsClient     *ws.Client
	peer         *rtc.PeerConnection
	capturer     *capture.ScreenCapturer
	inputHandler *input.Handler
	sessionCode  string

	mu       sync.Mutex
	doneCh   chan struct{}
	doneOnce sync.Once

	// Pending access request tracking
	pendingRequest *accessRequest
	declineCh      chan string // channel to send decline for a request ID
}

type accessRequest struct {
	requestID   string
	displayName string
	timeoutMs   int
	timer       *time.Timer
}

// NewUnattendedAgent creates an agent that operates in unattended mode
func NewUnattendedAgent(serverURL string, cfg *Config) (*UnattendedAgent, error) {
	return &UnattendedAgent{
		config:       cfg,
		serverURL:    serverURL,
		capturer:     capture.NewScreenCapturer(15, 70),
		inputHandler: input.NewHandler(),
		doneCh:       make(chan struct{}),
		declineCh:    make(chan string, 1),
	}, nil
}

// Connect establishes connection and registers for unattended access
func (a *UnattendedAgent) Connect() error {
	a.wsClient = ws.NewClient(a.serverURL)
	a.wsClient.OnMessage(a.handleMessage)

	if err := a.wsClient.Connect(); err != nil {
		return fmt.Errorf("failed to connect to relay: %w", err)
	}

	// Register for unattended access
	hostname, _ := os.Hostname()
	username := "unknown"
	if u, err := user.Current(); err == nil {
		username = u.Username
	}

	timeoutMs := a.config.TimeoutMs
	if timeoutMs == 0 {
		timeoutMs = 30000
	}

	msg := ws.Message{
		"type":      "unattended_register",
		"agentId":   a.config.AgentID,
		"accessKey": a.config.AccessKey,
		"hostname":  hostname,
		"os":        runtime.GOOS,
		"username":  username,
		"timeoutMs": timeoutMs,
	}
	if len(a.config.Tags) > 0 {
		msg["tags"] = a.config.Tags
	}
	err := a.wsClient.Send(msg)
	if err != nil {
		return fmt.Errorf("failed to register: %w", err)
	}

	// Wait for registration confirmation
	timeout := time.After(10 * time.Second)
	registered := make(chan bool, 1)

	originalHandler := a.wsClient
	_ = originalHandler // keep reference

	// Poll for registration (the handler will update state)
	for {
		select {
		case <-timeout:
			return fmt.Errorf("timeout waiting for unattended registration")
		case <-registered:
			return nil
		default:
			// Check if we got the registered message
			a.mu.Lock()
			code := a.sessionCode
			a.mu.Unlock()
			if code == "__registered__" {
				a.mu.Lock()
				a.sessionCode = ""
				a.mu.Unlock()
				return nil
			}
			time.Sleep(100 * time.Millisecond)
		}
	}
}

// AgentID returns the persistent agent identifier
func (a *UnattendedAgent) AgentID() string {
	return a.config.AgentID
}

// SessionCode returns the current session code (if in an active session)
func (a *UnattendedAgent) SessionCode() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.sessionCode
}

// Done returns a channel that closes when the agent shuts down
func (a *UnattendedAgent) Done() <-chan struct{} {
	return a.doneCh
}

// DeclineAccess declines the current pending access request
func (a *UnattendedAgent) DeclineAccess() {
	a.mu.Lock()
	req := a.pendingRequest
	a.mu.Unlock()

	if req != nil {
		a.declineCh <- req.requestID
	}
}

// Close shuts down the agent
func (a *UnattendedAgent) Close() {
	a.doneOnce.Do(func() {
		close(a.doneCh)
	})

	if a.capturer != nil {
		a.capturer.Stop()
	}
	if a.peer != nil {
		a.peer.Close()
	}
	if a.wsClient != nil {
		a.wsClient.Close()
	}
}

func (a *UnattendedAgent) handleMessage(msg ws.Message) {
	msgType, ok := msg["type"].(string)
	if !ok {
		return
	}

	switch msgType {
	case "unattended_registered":
		a.mu.Lock()
		a.sessionCode = "__registered__"
		a.mu.Unlock()
		log.Println("Registered for unattended access")

	case "unattended_access_request":
		a.handleAccessRequest(msg)

	case "session_created":
		code, _ := msg["sessionCode"].(string)
		a.mu.Lock()
		a.sessionCode = code
		a.mu.Unlock()
		log.Printf("Session created: %s", code)

	case "peer_joined":
		log.Println("Support agent connected! Starting screen share...")
		go a.startScreenShare()

	case "peer_left":
		log.Println("Support agent disconnected.")
		a.capturer.Stop()
		if a.peer != nil {
			a.peer.Close()
			a.peer = nil
		}
		a.mu.Lock()
		a.sessionCode = ""
		a.mu.Unlock()
		log.Println("Ready for next connection...")

	case "signal":
		a.handleSignal(msg)

	case "chat":
		sender, _ := msg["sender"].(string)
		text, _ := msg["text"].(string)
		fmt.Printf("[%s]: %s\n", sender, text)

	case "error":
		errMsg, _ := msg["message"].(string)
		log.Printf("Server error: %s", errMsg)

	case "heartbeat_ack":
		// No-op
	}
}

func (a *UnattendedAgent) handleAccessRequest(msg ws.Message) {
	requestID, _ := msg["requestId"].(string)
	displayName, _ := msg["displayName"].(string)
	timeoutMsF, _ := msg["timeoutMs"].(float64)
	timeoutMs := int(timeoutMsF)

	if timeoutMs == 0 {
		timeoutMs = 30000
	}

	fmt.Printf("\n╔══════════════════════════════════════════════╗\n")
	fmt.Printf("║  INCOMING ACCESS REQUEST                     ║\n")
	fmt.Printf("╠══════════════════════════════════════════════╣\n")
	fmt.Printf("║  From: %-37s ║\n", displayName)
	fmt.Printf("║  Timeout: %d seconds                        ║\n", timeoutMs/1000)
	fmt.Printf("║                                              ║\n")
	fmt.Printf("║  Press 'd' + Enter to DECLINE                ║\n")
	fmt.Printf("║  Or wait %d seconds to auto-accept           ║\n", timeoutMs/1000)
	fmt.Printf("╚══════════════════════════════════════════════╝\n\n")

	// Set up the pending request
	timer := time.NewTimer(time.Duration(timeoutMs) * time.Millisecond)

	a.mu.Lock()
	a.pendingRequest = &accessRequest{
		requestID:   requestID,
		displayName: displayName,
		timeoutMs:   timeoutMs,
		timer:       timer,
	}
	a.mu.Unlock()

	// Listen for decline or timeout
	go func() {
		select {
		case reqID := <-a.declineCh:
			timer.Stop()
			a.mu.Lock()
			a.pendingRequest = nil
			a.mu.Unlock()

			// Send decline to server
			a.wsClient.Send(ws.Message{
				"type":      "unattended_response",
				"requestId": reqID,
				"action":    "decline",
			})
			fmt.Println("Access DECLINED.")

		case <-timer.C:
			a.mu.Lock()
			a.pendingRequest = nil
			a.mu.Unlock()
			fmt.Println("Auto-accepting access request...")
			// Server handles the auto-accept on timeout

		case <-a.doneCh:
			timer.Stop()
		}
	}()
}

func (a *UnattendedAgent) handleSignal(msg ws.Message) {
	signalData, ok := msg["signal"]
	if !ok {
		return
	}

	signalBytes, err := json.Marshal(signalData)
	if err != nil {
		log.Printf("Failed to marshal signal: %v", err)
		return
	}

	var signal struct {
		Kind          string  `json:"kind"`
		SDP           string  `json:"sdp"`
		Candidate     string  `json:"candidate"`
		SDPMid        *string `json:"sdpMid"`
		SDPMLineIndex *uint16 `json:"sdpMLineIndex"`
	}

	if err := json.Unmarshal(signalBytes, &signal); err != nil {
		log.Printf("Failed to parse signal: %v", err)
		return
	}

	switch signal.Kind {
	case "offer":
		if a.peer == nil {
			log.Println("Received offer but no peer connection")
			return
		}
		answer, err := a.peer.HandleOffer(signal.SDP)
		if err != nil {
			log.Printf("Failed to handle offer: %v", err)
			return
		}
		a.wsClient.Send(ws.Message{
			"type":        "signal",
			"sessionCode": a.SessionCode(),
			"signal": map[string]interface{}{
				"kind": "answer",
				"sdp":  answer,
			},
		})

	case "answer":
		if a.peer == nil {
			return
		}
		if err := a.peer.HandleAnswer(signal.SDP); err != nil {
			log.Printf("Failed to handle answer: %v", err)
		}

	case "ice_candidate":
		if a.peer == nil {
			return
		}
		candidate := webrtc.ICECandidateInit{
			Candidate: signal.Candidate,
		}
		if signal.SDPMid != nil {
			candidate.SDPMid = signal.SDPMid
		}
		if signal.SDPMLineIndex != nil {
			candidate.SDPMLineIndex = signal.SDPMLineIndex
		}
		if err := a.peer.AddICECandidate(candidate); err != nil {
			log.Printf("Failed to add ICE candidate: %v", err)
		}
	}
}

func (a *UnattendedAgent) startScreenShare() {
	peer, err := rtc.NewPeerConnection()
	if err != nil {
		log.Printf("Failed to create peer connection: %v", err)
		return
	}

	a.mu.Lock()
	a.peer = peer
	a.mu.Unlock()

	peer.OnICECandidate(func(candidate webrtc.ICECandidateInit) {
		a.wsClient.Send(ws.Message{
			"type":        "signal",
			"sessionCode": a.SessionCode(),
			"signal": map[string]interface{}{
				"kind":          "ice_candidate",
				"candidate":     candidate.Candidate,
				"sdpMid":        candidate.SDPMid,
				"sdpMLineIndex": candidate.SDPMLineIndex,
			},
		})
	})

	peer.OnDataMessage(func(data []byte) {
		var msg struct {
			Type  string          `json:"type"`
			Input json.RawMessage `json:"input"`
		}
		if err := json.Unmarshal(data, &msg); err != nil {
			return
		}
		if msg.Type == "input" && msg.Input != nil {
			if err := a.inputHandler.ProcessInput(msg.Input); err != nil {
				log.Printf("Input processing error: %v", err)
			}
		}
	})

	peer.OnConnected(func() {
		log.Println("WebRTC connected! Remote input enabled.")
		a.inputHandler.SetEnabled(true)
		bounds := capture.GetScreenBounds(0)
		a.inputHandler.SetScreenSize(bounds.Dx(), bounds.Dy())
	})

	peer.OnDisconnected(func() {
		log.Println("WebRTC disconnected.")
		a.inputHandler.SetEnabled(false)
	})

	if err := peer.AddVideoTrack(); err != nil {
		log.Printf("Failed to add video track: %v", err)
		return
	}

	offer, err := peer.CreateOffer()
	if err != nil {
		log.Printf("Failed to create offer: %v", err)
		return
	}

	a.wsClient.Send(ws.Message{
		"type":        "signal",
		"sessionCode": a.SessionCode(),
		"signal": map[string]interface{}{
			"kind": "offer",
			"sdp":  offer,
		},
	})

	if err := a.capturer.Start(); err != nil {
		log.Printf("Failed to start screen capture: %v", err)
		return
	}

	go a.streamFrames()
}

func (a *UnattendedAgent) streamFrames() {
	for frame := range a.capturer.Frames() {
		a.mu.Lock()
		peer := a.peer
		a.mu.Unlock()

		if peer == nil || peer.VideoTrack() == nil {
			continue
		}

		track := peer.VideoTrack()
		err := track.WriteSample(media.Sample{Data: frame, Duration: time.Second / 15})
		if err != nil {
			log.Printf("Failed to write video sample: %v", err)
		}
	}
}
