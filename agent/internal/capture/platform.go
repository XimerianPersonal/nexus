package capture

import (
	"fmt"
	"image"

	"github.com/kbinani/screenshot"
)

// CaptureScreen captures the specified display (0 = primary)
func CaptureScreen(displayIndex int) (*image.RGBA, error) {
	n := screenshot.NumActiveDisplays()
	if n == 0 {
		return nil, fmt.Errorf("no active displays found")
	}

	if displayIndex >= n {
		displayIndex = 0
	}

	bounds := screenshot.GetDisplayBounds(displayIndex)
	img, err := screenshot.CaptureRect(bounds)
	if err != nil {
		return nil, fmt.Errorf("screen capture failed: %w", err)
	}

	return img, nil
}

// GetScreenBounds returns the bounds of the specified display
func GetScreenBounds(displayIndex int) image.Rectangle {
	n := screenshot.NumActiveDisplays()
	if n == 0 || displayIndex >= n {
		return image.Rect(0, 0, 1920, 1080) // sensible default
	}
	return screenshot.GetDisplayBounds(displayIndex)
}
