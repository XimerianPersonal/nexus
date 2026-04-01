// platform_stub.go provides stub implementations for input simulation.
// In a full build, these would use robotgo or platform-native APIs.
// This stub allows the agent to compile on all platforms without CGO dependencies.

package input

import "log"

func moveMouse(x, y int) error {
	log.Printf("[input] move mouse to (%d, %d)", x, y)
	// TODO: Integrate with robotgo or platform-native API
	// robotgo.Move(x, y)
	return nil
}

func clickMouse(button, clickType string) error {
	log.Printf("[input] click %s %s", button, clickType)
	// TODO: Integrate with robotgo or platform-native API
	return nil
}

func scrollMouse(deltaX, deltaY int) error {
	log.Printf("[input] scroll (%d, %d)", deltaX, deltaY)
	// TODO: Integrate with robotgo or platform-native API
	return nil
}

func handleKey(key, code, keyType string, ctrl, alt, shift, meta bool) error {
	log.Printf("[input] key %s %s", keyType, key)
	// TODO: Integrate with robotgo or platform-native API
	return nil
}
