package auth

import (
	"io"
	"net/http"
	"strings"
)

type AuthTransport struct {
	Base   http.RoundTripper
	Tokens *TokenSource
}

func (t AuthTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	base := t.Base
	if base == nil {
		base = http.DefaultTransport
	}
	authorized, err := t.authorizedRequest(request, false)
	if err != nil {
		return nil, err
	}
	response, err := base.RoundTrip(authorized)
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusUnauthorized || t.Tokens == nil || !t.Tokens.CanRefresh() {
		return response, nil
	}
	_, _ = io.Copy(io.Discard, response.Body)
	_ = response.Body.Close()
	retry, err := t.authorizedRequest(request, true)
	if err != nil {
		return nil, err
	}
	return base.RoundTrip(retry)
}

func (t AuthTransport) authorizedRequest(request *http.Request, forceRefresh bool) (*http.Request, error) {
	if t.Tokens == nil {
		return request, nil
	}
	var token string
	var err error
	if forceRefresh {
		token, err = t.Tokens.ForceRefresh(request.Context())
	} else {
		token, err = t.Tokens.AccessToken(request.Context())
	}
	if err != nil {
		return nil, err
	}
	next := request.Clone(request.Context())
	if request.Body != nil && request.GetBody != nil {
		body, err := request.GetBody()
		if err != nil {
			return nil, err
		}
		next.Body = body
	}
	if strings.TrimSpace(token) != "" {
		next.Header.Set("authorization", "Bearer "+token)
		next.Header.Del("dpop")
	}
	return next, nil
}
