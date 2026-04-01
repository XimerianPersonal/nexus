.PHONY: install dev build clean relay portal agent

install:
	cd relay && npm install
	cd portal && npm install
	cd packages/shared && npm install
	cd agent && go mod download

dev: dev-relay dev-portal

dev-relay:
	cd relay && npm run dev

dev-portal:
	cd portal && npm run dev

build: build-relay build-portal build-agent

build-relay:
	cd relay && npm run build

build-portal:
	cd portal && npm run build

build-agent:
	cd agent && go build -o bin/nexus-agent ./cmd/nexus-agent

build-agent-windows:
	cd agent && GOOS=windows GOARCH=amd64 go build -o bin/nexus-agent.exe ./cmd/nexus-agent

build-agent-mac:
	cd agent && GOOS=darwin GOARCH=amd64 go build -o bin/nexus-agent-darwin ./cmd/nexus-agent

clean:
	rm -rf relay/dist portal/dist agent/bin
