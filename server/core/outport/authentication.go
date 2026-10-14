package outport

// AuthenticationError identifies the session that failed when a source uses
// more than one authentication provider. Err retains the public domain error.
type AuthenticationError struct {
	Provider string
	Err      error
}

func (e *AuthenticationError) Error() string { return e.Err.Error() }
func (e *AuthenticationError) Unwrap() error { return e.Err }
