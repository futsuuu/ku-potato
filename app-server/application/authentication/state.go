// Package authentication defines the application's last known login state.
package authentication

// AuthState is a cached observation, not a guarantee that a session remains valid.
// Unknown means the provider has not been checked during this server process.
type AuthState struct {
	Status string `json:"status" enum:"unknown,authenticated,unauthenticated"`
}
