package main

import (
	"bufio"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/nexus-remote/nexus-agent/internal/session"
)

var (
	version    = "0.1.0"
	serverURL  = flag.String("server", "ws://localhost:3001", "Relay server WebSocket URL")
	unattended = flag.Bool("unattended", false, "Enable unattended access mode")
	setup      = flag.Bool("setup", false, "Run initial setup for unattended access")
	configPath = flag.String("config", "", "Path to config file (default: platform-specific)")
	timeoutSec = flag.Int("timeout", 30, "Seconds for user to decline unattended access")
)

func main() {
	flag.Parse()

	fmt.Printf("Nexus Remote Agent v%s\n", version)

	cfgPath := *configPath
	if cfgPath == "" {
		cfgPath = session.DefaultConfigPath()
	}

	if *setup {
		runSetup(cfgPath)
		return
	}

	if *unattended {
		runUnattended(cfgPath)
	} else {
		runAttended()
	}
}

func runSetup(cfgPath string) {
	fmt.Println("\n=== Nexus Agent Unattended Access Setup ===")

	// Check for existing config
	existing, _ := session.LoadConfig(cfgPath)
	if existing != nil {
		fmt.Printf("Existing configuration found at %s\n", cfgPath)
		fmt.Printf("  Agent ID: %s\n", existing.AgentID)
		fmt.Print("\nOverwrite? (y/N): ")

		reader := bufio.NewReader(os.Stdin)
		answer, _ := reader.ReadString('\n')
		answer = strings.TrimSpace(strings.ToLower(answer))
		if answer != "y" && answer != "yes" {
			fmt.Println("Setup cancelled.")
			return
		}
	}

	agentID := session.GenerateAgentID()
	accessKey := session.GenerateAccessKey()

	cfg := &session.Config{
		AgentID:   agentID,
		AccessKey: accessKey,
		ServerURL: *serverURL,
		TimeoutMs: *timeoutSec * 1000,
	}

	if err := session.SaveConfig(cfgPath, cfg); err != nil {
		log.Fatalf("Failed to save config: %v", err)
	}

	fmt.Printf("\n  Configuration saved to: %s\n", cfgPath)
	fmt.Printf("\n  Agent ID:   %s\n", agentID)
	fmt.Printf("  Access Key: %s\n", accessKey)
	fmt.Printf("  Timeout:    %d seconds\n", *timeoutSec)
	fmt.Printf("\n  ⚠  Save the Access Key! Support agents need it to connect.\n")
	fmt.Printf("     The key is stored hashed on the server and cannot be recovered.\n\n")
	fmt.Printf("  To start in unattended mode:\n")
	fmt.Printf("    nexus-agent --unattended\n\n")
}

func runUnattended(cfgPath string) {
	cfg, err := session.LoadConfig(cfgPath)
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}
	if cfg == nil {
		fmt.Println("No unattended access configuration found.")
		fmt.Println("Run 'nexus-agent --setup' first to configure unattended access.")
		os.Exit(1)
	}

	if cfg.ServerURL == "" {
		cfg.ServerURL = *serverURL
	}

	fmt.Println("Starting in UNATTENDED mode...")
	fmt.Printf("  Agent ID: %s\n", cfg.AgentID)
	fmt.Printf("  Server:   %s\n", cfg.ServerURL)
	fmt.Printf("  Decline timeout: %d seconds\n\n", cfg.TimeoutMs/1000)

	agent, err := session.NewUnattendedAgent(cfg.ServerURL, cfg)
	if err != nil {
		log.Fatalf("Failed to create unattended agent: %v", err)
	}

	if err := agent.Connect(); err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}

	fmt.Println("Registered and waiting for connections...")
	fmt.Println("When a support agent connects, you'll have", cfg.TimeoutMs/1000, "seconds to decline.")
	fmt.Println("Press 'd' + Enter to decline an incoming request.")
	fmt.Println("Press Ctrl+C to shut down.")

	// Handle user input for declining access
	go func() {
		reader := bufio.NewReader(os.Stdin)
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			line = strings.TrimSpace(strings.ToLower(line))
			if line == "d" || line == "decline" {
				agent.DeclineAccess()
			}
		}
	}()

	// Wait for interrupt
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case <-sigCh:
		fmt.Println("\nShutting down...")
	case <-agent.Done():
		fmt.Println("\nAgent stopped.")
	}

	agent.Close()
}

func runAttended() {
	fmt.Println("Connecting to relay server...")

	agent, err := session.NewAgent(*serverURL)
	if err != nil {
		log.Fatalf("Failed to create agent: %v", err)
	}

	if err := agent.Connect(); err != nil {
		log.Fatalf("Failed to connect to relay server: %v", err)
	}

	fmt.Printf("\n  Session Code: %s\n\n", agent.SessionCode())
	fmt.Println("Share this code with your support agent to start the session.")
	fmt.Println("Press Ctrl+C to disconnect.")

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case <-sigCh:
		fmt.Println("\nDisconnecting...")
	case <-agent.Done():
		fmt.Println("\nSession ended.")
	}

	agent.Close()
}
