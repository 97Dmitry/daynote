.DEFAULT_GOAL := help
WAILS := go run github.com/wailsapp/wails/v2/cmd/wails@v2.17.0
ifeq ($(OS),Windows_NT)
WIN_ENV :=
else
WIN_ENV := GOOS=windows GOARCH=amd64 CGO_ENABLED=0
endif
.PHONY: help install bindings test frontend-check frontend-build vet build check dev
help:
	@echo "make install: install frontend dependencies"
	@echo "make dev: run on Windows"
	@echo "make check: tests, format, typecheck, vet and Windows x64 build"
install:
	cd frontend && pnpm install --frozen-lockfile
bindings:
	go run -tags bindings .
ifneq ($(OS),Windows_NT)
	chmod 644 frontend/wailsjs/runtime/*
endif
test:
	go test -race ./...
	cd frontend && pnpm test
frontend-check: bindings
	cd frontend && pnpm exec prettier --check src e2e playwright.config.ts package.json tsconfig.json vite.config.ts index.html
	cd frontend && pnpm typecheck
frontend-build: bindings
	cd frontend && pnpm build
vet: frontend-build
	go vet ./...
	$(WIN_ENV) go vet ./...
build: frontend-build
	$(WAILS) build -platform windows/amd64 -skipbindings -s -o Daynote.exe
check: frontend-check test vet build
dev:
	$(WAILS) dev
