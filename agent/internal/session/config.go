package session

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// Config holds the persistent agent configuration for unattended access
type Config struct {
	AgentID   string `json:"agent_id"`
	AccessKey string `json:"access_key"`
	ServerURL string `json:"server_url"`
	TimeoutMs int    `json:"timeout_ms"` // User decline timeout in ms (default 30000)
}

const configFileName = "nexus-agent.json"

// DefaultConfigPath returns the platform-appropriate config directory
func DefaultConfigPath() string {
	switch runtime.GOOS {
	case "windows":
		appData := os.Getenv("PROGRAMDATA")
		if appData == "" {
			appData = `C:\ProgramData`
		}
		return filepath.Join(appData, "NexusAgent", configFileName)
	case "darwin":
		return filepath.Join("/Library/Application Support/NexusAgent", configFileName)
	default:
		return filepath.Join("/etc/nexus-agent", configFileName)
	}
}

// LoadConfig loads the configuration from disk, or returns nil if not found
func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to read config: %w", err)
	}

	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config: %w", err)
	}

	return &cfg, nil
}

// SaveConfig writes the configuration to disk
func SaveConfig(path string, cfg *Config) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create config dir: %w", err)
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	if err := os.WriteFile(path, data, 0600); err != nil {
		return fmt.Errorf("failed to write config: %w", err)
	}

	return nil
}

// GenerateAgentID creates a random persistent agent identifier
func GenerateAgentID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// GenerateAccessKey creates a random access key
func GenerateAccessKey() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
