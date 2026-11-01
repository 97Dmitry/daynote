//go:build !windows

package desktop

import "errors"

const Supported = false

type Host struct{}

func Start(Callbacks) (*Host, error)  { return &Host{}, nil }
func (*Host) AttachMainWindow() error { return nil }
func (*Host) Notify(Notice) error     { return nil }
func (*Host) SetUnread(int) error     { return nil }
func (*Host) AllowQuit()              {}
func (*Host) Close() error            { return nil }
func ShowExisting() bool              { return false }
func AutostartEnabled() (bool, error) { return false, nil }
func SetAutostart(bool) error         { return errors.New("Windows autostart is unavailable on this platform") }
