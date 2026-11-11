package browser

// Error contains only diagnostics safe to return across the process boundary.
type Error struct {
	Reason  string
	Message string
}

func (e *Error) Error() string          { return e.Message }
func Fail(reason, message string) error { return &Error{Reason: reason, Message: message} }

type RegistrationResult struct {
	Registered bool
}
