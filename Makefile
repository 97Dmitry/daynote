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
	cd frontend && vp install --frozen-lockfile
bindings:
	go run -tags bindings .
ifneq ($(OS),Windows_NT)
	chmod 644 frontend/wailsjs/runtime/* frontend/wailsjs/go/main/* frontend/wailsjs/go/models.ts
endif
test:
	go test -race ./...
	cd frontend && vp test run
frontend-check: bindings
	cd frontend && vp check
	cd frontend && vp run typecheck
frontend-build: bindings
	cd frontend && vp run build
vet: frontend-build
	go vet ./...
	$(WIN_ENV) go vet ./...
build: frontend-build
	$(WAILS) build -platform windows/amd64 -skipbindings -s -o Daynote.exe
check: frontend-check test vet build
dev:
	$(WAILS) dev
