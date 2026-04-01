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

// Agent represents the desktop agent that connects to the relay server
type Agent struct {
	serverURL    string
	wsClient     *ws.Client
	peer         *rtc.PeerConnection
	capturer     *capture.ScreenCapturer
	inputHandler *input.Handler
	sessionCode  string
	mu           sync.Mutex
	doneCh       chan struct{}
	doneOnce     sync.Once
}

// NewAgent creates a new desktop agent
func NewAgent(serverURL string) (*Agent, error) {
	return &Agent{
		serverURL:    serverURL,
		capturer:     capture.NewScreenCapturer(15, 70), // 15 FPS, quality 70
		inputHandler: input.NewHandler(),
		doneCh:       make(chan struct{}),
	}, nil
}

// Connect establishes connection to the relay server and registers
func (a *Agent) Connect() error {
	a.wsClient = ws.NewClient(a.serverURL)
	a.wsClient.OnMessage(a.handleMessage)

	if err := a.wsClient.Connect(); err != nil {
		return fmt.Errorf("failed to connect to relay: %w", err)
	}

	// Register as an agent
	hostname, _ := os.Hostname()
	username := "unknown"
	if u, err := user.Current(); err == nil {
		username = u.Username
	}

	err := a.wsClient.Send(ws.Message{
		"type":     "register",
		"role":     "agent",
		"hostname": hostname,
		"os":       runtime.GOOS,
		"username": username,
	})
	if err != nil {
		return fmt.Errorf("failed to register: %w", err)
	}

	// Wait for session code (with timeout)
	timeout := time.After(10 * time.Second)
	for {
		select {
		case <-timeout:
			return fmt.Errorf("timeout waiting for session code")
		default:
			a.mu.Lock()
			code := a.sessionCode
			a.mu.Unlock()
			if code != "" {
				return nil
			}
			time.Sleep(100 * time.Millisecond)
		}
	}
}

// SessionCode returns the session code assigned by the relay
func (a *Agent) SessionCode() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.sessionCode
}

// Done returns a channel that closes when the session ends
func (a *Agent) Done() <-chan struct{} {
	return a.doneCh
}

// Close shuts down the agent
func (a *Agent) Close() {
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

func (a *Agent) handleMessage(msg ws.Message) {
	msgType, ok := msg["type"].(string)
	if !ok {
		return
	}

	switch msgType {
	case "session_created":
		code, _ := msg["sessionCode"].(string)
		a.mu.Lock()
		a.sessionCode = code
		a.mu.Unlock()

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

func (a *Agent) handleSignal(msg ws.Message) {
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
			"sessionCode": a.sessionCode,
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

func (a *Agent) startScreenShare() {
	peer, err := rtc.NewPeerConnection()
	if err != nil {
		log.Printf("Failed to create peer connection: %v", err)
		return
	}

	a.mu.Lock()
	a.peer = peer
	a.mu.Unlock()

	// Handle ICE candidates - send to relay
	peer.OnICECandidate(func(candidate webrtc.ICECandidateInit) {
		a.wsClient.Send(ws.Message{
			"type":        "signal",
			"sessionCode": a.sessionCode,
			"signal": map[string]interface{}{
				"kind":          "ice_candidate",
				"candidate":     candidate.Candidate,
				"sdpMid":        candidate.SDPMid,
				"sdpMLineIndex": candidate.SDPMLineIndex,
			},
		})
	})

	// Handle data channel messages (input events from portal)
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

	// Add video track
	if err := peer.AddVideoTrack(); err != nil {
		log.Printf("Failed to add video track: %v", err)
		return
	}

	// Create offer
	offer, err := peer.CreateOffer()
	if err != nil {
		log.Printf("Failed to create offer: %v", err)
		return
	}

	// Send offer via relay
	a.wsClient.Send(ws.Message{
		"type":        "signal",
		"sessionCode": a.sessionCode,
		"signal": map[string]interface{}{
			"kind": "offer",
			"sdp":  offer,
		},
	})

	// Start screen capture and send frames
	if err := a.capturer.Start(); err != nil {
		log.Printf("Failed to start screen capture: %v", err)
		return
	}

	go a.streamFrames()
}

func (a *Agent) streamFrames() {
	for frame := range a.capturer.Frames() {
		a.mu.Lock()
		peer := a.peer
		a.mu.Unlock()

		if peer == nil || peer.VideoTrack() == nil {
			continue
		}

		track := peer.VideoTrack()
		// Write the JPEG frame as a sample
		// In production, we'd encode to VP8/VP9 here
		err := track.WriteSample(media.Sample{Data: frame, Duration: time.Second / 15})
		if err != nil {
			log.Printf("Failed to write video sample: %v", err)
		}
	}
}
