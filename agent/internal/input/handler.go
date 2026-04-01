package input

import (
	"encoding/json"
	"fmt"
	"log"
	"runtime"
)

// InputMessage represents a remote input command from the support portal
type InputMessage struct {
	Type  string          `json:"type"`
	Input json.RawMessage `json:"input"`
}

// BaseInput has the shared action field
type BaseInput struct {
	Action string `json:"action"`
}

// MouseMoveInput represents a mouse move command
type MouseMoveInput struct {
	Action       string  `json:"action"`
	X            float64 `json:"x"`
	Y            float64 `json:"y"`
	ScreenWidth  float64 `json:"screenWidth"`
	ScreenHeight float64 `json:"screenHeight"`
}

// MouseClickInput represents a mouse click command
type MouseClickInput struct {
	Action       string `json:"action"`
	X            float64 `json:"x"`
	Y            float64 `json:"y"`
	Button       string `json:"button"`
	ClickType    string `json:"clickType"`
	ScreenWidth  float64 `json:"screenWidth"`
	ScreenHeight float64 `json:"screenHeight"`
}

// MouseScrollInput represents a mouse scroll command
type MouseScrollInput struct {
	Action       string  `json:"action"`
	X            float64 `json:"x"`
	Y            float64 `json:"y"`
	DeltaX       float64 `json:"deltaX"`
	DeltaY       float64 `json:"deltaY"`
	ScreenWidth  float64 `json:"screenWidth"`
	ScreenHeight float64 `json:"screenHeight"`
}

// KeyboardInput represents a keyboard command
type KeyboardInput struct {
	Action    string `json:"action"`
	Key       string `json:"key"`
	Code      string `json:"code"`
	KeyType   string `json:"keyType"`
	Modifiers struct {
		Ctrl  bool `json:"ctrl"`
		Alt   bool `json:"alt"`
		Shift bool `json:"shift"`
		Meta  bool `json:"meta"`
	} `json:"modifiers"`
}

// Handler processes remote input commands
type Handler struct {
	enabled      bool
	screenWidth  int
	screenHeight int
}

// NewHandler creates a new input handler
func NewHandler() *Handler {
	return &Handler{
		enabled: false,
	}
}

// SetEnabled enables or disables input handling
func (h *Handler) SetEnabled(enabled bool) {
	h.enabled = enabled
}

// SetScreenSize sets the local screen dimensions for coordinate mapping
func (h *Handler) SetScreenSize(width, height int) {
	h.screenWidth = width
	h.screenHeight = height
}

// ProcessInput handles an incoming input message
func (h *Handler) ProcessInput(data []byte) error {
	if !h.enabled {
		return nil
	}

	var base BaseInput
	if err := json.Unmarshal(data, &base); err != nil {
		return fmt.Errorf("failed to parse input action: %w", err)
	}

	switch base.Action {
	case "mouse_move":
		var input MouseMoveInput
		if err := json.Unmarshal(data, &input); err != nil {
			return err
		}
		return h.handleMouseMove(input)

	case "mouse_click":
		var input MouseClickInput
		if err := json.Unmarshal(data, &input); err != nil {
			return err
		}
		return h.handleMouseClick(input)

	case "mouse_scroll":
		var input MouseScrollInput
		if err := json.Unmarshal(data, &input); err != nil {
			return err
		}
		return h.handleMouseScroll(input)

	case "key":
		var input KeyboardInput
		if err := json.Unmarshal(data, &input); err != nil {
			return err
		}
		return h.handleKeyboard(input)

	default:
		return fmt.Errorf("unknown input action: %s", base.Action)
	}
}

// scaleCoords maps remote coordinates to local screen coordinates
func (h *Handler) scaleCoords(remoteX, remoteY, remoteWidth, remoteHeight float64) (int, int) {
	if remoteWidth == 0 || remoteHeight == 0 {
		return int(remoteX), int(remoteY)
	}

	localX := (remoteX / remoteWidth) * float64(h.screenWidth)
	localY := (remoteY / remoteHeight) * float64(h.screenHeight)

	return int(localX), int(localY)
}

func (h *Handler) handleMouseMove(input MouseMoveInput) error {
	x, y := h.scaleCoords(input.X, input.Y, input.ScreenWidth, input.ScreenHeight)
	return moveMouse(x, y)
}

func (h *Handler) handleMouseClick(input MouseClickInput) error {
	x, y := h.scaleCoords(input.X, input.Y, input.ScreenWidth, input.ScreenHeight)

	// Move to position first
	if err := moveMouse(x, y); err != nil {
		return err
	}

	return clickMouse(input.Button, input.ClickType)
}

func (h *Handler) handleMouseScroll(input MouseScrollInput) error {
	x, y := h.scaleCoords(input.X, input.Y, input.ScreenWidth, input.ScreenHeight)

	if err := moveMouse(x, y); err != nil {
		return err
	}

	return scrollMouse(int(input.DeltaX), int(input.DeltaY))
}

func (h *Handler) handleKeyboard(input KeyboardInput) error {
	log.Printf("Key event: %s %s (ctrl=%v alt=%v shift=%v meta=%v)",
		input.KeyType, input.Key,
		input.Modifiers.Ctrl, input.Modifiers.Alt,
		input.Modifiers.Shift, input.Modifiers.Meta)

	return handleKey(input.Key, input.Code, input.KeyType, input.Modifiers.Ctrl,
		input.Modifiers.Alt, input.Modifiers.Shift, input.Modifiers.Meta)
}

func init() {
	_ = runtime.GOOS // ensure runtime is imported
}
