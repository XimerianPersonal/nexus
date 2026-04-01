package capture

import (
	"bytes"
	"image"
	"image/jpeg"
	"sync"
	"time"
)

// ScreenCapturer captures screenshots at a configurable frame rate
type ScreenCapturer struct {
	mu        sync.Mutex
	fps       int
	quality   int
	running   bool
	stopCh    chan struct{}
	frameCh   chan []byte
	bounds    image.Rectangle
}

// NewScreenCapturer creates a new screen capturer
func NewScreenCapturer(fps, quality int) *ScreenCapturer {
	return &ScreenCapturer{
		fps:     fps,
		quality: quality,
		stopCh:  make(chan struct{}),
		frameCh: make(chan []byte, 2),
	}
}

// Start begins capturing frames
func (sc *ScreenCapturer) Start() error {
	sc.mu.Lock()
	defer sc.mu.Unlock()

	if sc.running {
		return nil
	}

	sc.running = true
	go sc.captureLoop()
	return nil
}

// Stop halts capture
func (sc *ScreenCapturer) Stop() {
	sc.mu.Lock()
	defer sc.mu.Unlock()

	if !sc.running {
		return
	}

	sc.running = false
	close(sc.stopCh)
}

// Frames returns the channel of JPEG-encoded frames
func (sc *ScreenCapturer) Frames() <-chan []byte {
	return sc.frameCh
}

// Bounds returns the screen dimensions
func (sc *ScreenCapturer) Bounds() image.Rectangle {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	return sc.bounds
}

func (sc *ScreenCapturer) captureLoop() {
	interval := time.Second / time.Duration(sc.fps)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-sc.stopCh:
			return
		case <-ticker.C:
			frame, bounds, err := sc.captureFrame()
			if err != nil {
				continue
			}

			sc.mu.Lock()
			sc.bounds = bounds
			sc.mu.Unlock()

			select {
			case sc.frameCh <- frame:
			default:
				// Drop frame if consumer is too slow
			}
		}
	}
}

func (sc *ScreenCapturer) captureFrame() ([]byte, image.Rectangle, error) {
	img, err := CaptureScreen(0)
	if err != nil {
		return nil, image.Rectangle{}, err
	}

	var buf bytes.Buffer
	err = jpeg.Encode(&buf, img, &jpeg.Options{Quality: sc.quality})
	if err != nil {
		return nil, image.Rectangle{}, err
	}

	return buf.Bytes(), img.Bounds(), nil
}
