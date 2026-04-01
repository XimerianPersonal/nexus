package ws

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	heartbeatInterval = 30 * time.Second
	writeTimeout      = 10 * time.Second
	readTimeout       = 45 * time.Second
)

// Message represents a generic JSON message
type Message map[string]interface{}

// Client manages a WebSocket connection to the relay server
type Client struct {
	url       string
	conn      *websocket.Conn
	mu        sync.Mutex
	msgCh     chan Message
	closeCh   chan struct{}
	closeOnce sync.Once
	onMessage func(Message)
}

// NewClient creates a new WebSocket client
func NewClient(url string) *Client {
	return &Client{
		url:     url + "/ws",
		msgCh:   make(chan Message, 64),
		closeCh: make(chan struct{}),
	}
}

// Connect establishes the WebSocket connection
func (c *Client) Connect() error {
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	conn, _, err := dialer.Dial(c.url, nil)
	if err != nil {
		return fmt.Errorf("websocket dial failed: %w", err)
	}

	c.conn = conn
	go c.readLoop()
	go c.heartbeatLoop()

	return nil
}

// OnMessage sets the message handler
func (c *Client) OnMessage(handler func(Message)) {
	c.onMessage = handler
}

// Send sends a JSON message
func (c *Client) Send(msg Message) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn == nil {
		return fmt.Errorf("not connected")
	}

	c.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
	return c.conn.WriteJSON(msg)
}

// Close shuts down the connection
func (c *Client) Close() {
	c.closeOnce.Do(func() {
		close(c.closeCh)
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.conn != nil {
			c.conn.WriteMessage(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
			)
			c.conn.Close()
		}
	})
}

// Done returns a channel that's closed when the connection ends
func (c *Client) Done() <-chan struct{} {
	return c.closeCh
}

func (c *Client) readLoop() {
	defer c.Close()

	for {
		select {
		case <-c.closeCh:
			return
		default:
		}

		c.conn.SetReadDeadline(time.Now().Add(readTimeout))
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				log.Printf("WebSocket read error: %v", err)
			}
			return
		}

		var msg Message
		if err := json.Unmarshal(data, &msg); err != nil {
			log.Printf("Failed to parse message: %v", err)
			continue
		}

		if c.onMessage != nil {
			c.onMessage(msg)
		}
	}
}

func (c *Client) heartbeatLoop() {
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-c.closeCh:
			return
		case <-ticker.C:
			if err := c.Send(Message{"type": "heartbeat"}); err != nil {
				log.Printf("Heartbeat failed: %v", err)
				c.Close()
				return
			}
		}
	}
}
