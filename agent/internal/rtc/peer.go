package rtc

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"

	"github.com/pion/webrtc/v4"
)

// PeerConnection wraps a WebRTC peer connection for screen sharing
type PeerConnection struct {
	pc              *webrtc.PeerConnection
	videoTrack      *webrtc.TrackLocalStaticSample
	dataChannel     *webrtc.DataChannel
	mu              sync.Mutex
	onICECandidate  func(candidate webrtc.ICECandidateInit)
	onDataMessage   func([]byte)
	onConnected     func()
	onDisconnected  func()
	closed          bool
}

// ICEServers are the STUN/TURN servers to use
var ICEServers = []webrtc.ICEServer{
	{URLs: []string{"stun:stun.l.google.com:19302"}},
	{URLs: []string{"stun:stun1.l.google.com:19302"}},
}

// NewPeerConnection creates a new WebRTC peer connection
func NewPeerConnection() (*PeerConnection, error) {
	config := webrtc.Configuration{
		ICEServers: ICEServers,
	}

	pc, err := webrtc.NewPeerConnection(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create peer connection: %w", err)
	}

	p := &PeerConnection{pc: pc}

	// Handle ICE candidates
	pc.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		if p.onICECandidate != nil {
			p.onICECandidate(candidate.ToJSON())
		}
	})

	// Handle connection state changes
	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		log.Printf("WebRTC connection state: %s", state.String())
		switch state {
		case webrtc.PeerConnectionStateConnected:
			if p.onConnected != nil {
				p.onConnected()
			}
		case webrtc.PeerConnectionStateDisconnected,
			webrtc.PeerConnectionStateFailed,
			webrtc.PeerConnectionStateClosed:
			if p.onDisconnected != nil {
				p.onDisconnected()
			}
		}
	})

	// Handle data channels created by remote peer
	pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		log.Printf("Data channel received: %s", dc.Label())
		p.mu.Lock()
		p.dataChannel = dc
		p.mu.Unlock()

		dc.OnMessage(func(msg webrtc.DataChannelMessage) {
			if p.onDataMessage != nil {
				p.onDataMessage(msg.Data)
			}
		})
	})

	return p, nil
}

// OnICECandidate sets the handler for new ICE candidates
func (p *PeerConnection) OnICECandidate(handler func(webrtc.ICECandidateInit)) {
	p.onICECandidate = handler
}

// OnDataMessage sets the handler for data channel messages
func (p *PeerConnection) OnDataMessage(handler func([]byte)) {
	p.onDataMessage = handler
}

// OnConnected sets the handler for successful connection
func (p *PeerConnection) OnConnected(handler func()) {
	p.onConnected = handler
}

// OnDisconnected sets the handler for disconnection
func (p *PeerConnection) OnDisconnected(handler func()) {
	p.onDisconnected = handler
}

// AddVideoTrack adds a video track for screen sharing
func (p *PeerConnection) AddVideoTrack() error {
	track, err := webrtc.NewTrackLocalStaticSample(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8},
		"screen",
		"nexus-screen",
	)
	if err != nil {
		return fmt.Errorf("failed to create video track: %w", err)
	}

	_, err = p.pc.AddTrack(track)
	if err != nil {
		return fmt.Errorf("failed to add video track: %w", err)
	}

	p.videoTrack = track
	return nil
}

// VideoTrack returns the video track for sending frames
func (p *PeerConnection) VideoTrack() *webrtc.TrackLocalStaticSample {
	return p.videoTrack
}

// CreateOffer creates an SDP offer (agent side initiates)
func (p *PeerConnection) CreateOffer() (string, error) {
	offer, err := p.pc.CreateOffer(nil)
	if err != nil {
		return "", fmt.Errorf("failed to create offer: %w", err)
	}

	if err := p.pc.SetLocalDescription(offer); err != nil {
		return "", fmt.Errorf("failed to set local description: %w", err)
	}

	return offer.SDP, nil
}

// HandleAnswer processes an SDP answer from the portal
func (p *PeerConnection) HandleAnswer(sdp string) error {
	answer := webrtc.SessionDescription{
		Type: webrtc.SDPTypeAnswer,
		SDP:  sdp,
	}

	return p.pc.SetRemoteDescription(answer)
}

// HandleOffer processes an SDP offer from the portal and creates an answer
func (p *PeerConnection) HandleOffer(sdp string) (string, error) {
	offer := webrtc.SessionDescription{
		Type: webrtc.SDPTypeOffer,
		SDP:  sdp,
	}

	if err := p.pc.SetRemoteDescription(offer); err != nil {
		return "", fmt.Errorf("failed to set remote description: %w", err)
	}

	answer, err := p.pc.CreateAnswer(nil)
	if err != nil {
		return "", fmt.Errorf("failed to create answer: %w", err)
	}

	if err := p.pc.SetLocalDescription(answer); err != nil {
		return "", fmt.Errorf("failed to set local description: %w", err)
	}

	return answer.SDP, nil
}

// AddICECandidate adds a remote ICE candidate
func (p *PeerConnection) AddICECandidate(candidate webrtc.ICECandidateInit) error {
	return p.pc.AddICECandidate(candidate)
}

// SendData sends data over the data channel
func (p *PeerConnection) SendData(data []byte) error {
	p.mu.Lock()
	dc := p.dataChannel
	p.mu.Unlock()

	if dc == nil {
		return fmt.Errorf("data channel not open")
	}

	return dc.Send(data)
}

// SendJSON sends a JSON-encoded message over the data channel
func (p *PeerConnection) SendJSON(v interface{}) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return p.SendData(data)
}

// Close shuts down the peer connection
func (p *PeerConnection) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.closed {
		return nil
	}

	p.closed = true
	return p.pc.Close()
}
