//go:build !windows && !bindings

package main

import "fmt"

func main() { fmt.Println("Daynote desktop runs on Windows. Use make build to cross-compile.") }
