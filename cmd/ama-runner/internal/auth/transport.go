package auth

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
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
	var dpopPrivateKey string
	var err error
	if forceRefresh {
		token, err = t.Tokens.ForceRefresh(request.Context())
	} else {
		token, err = t.Tokens.AccessToken(request.Context())
	}
	if err != nil {
		return nil, err
	}
	profile, err := t.Tokens.CredentialProfile()
	if err != nil {
		return nil, err
	}
	if profile != nil {
		dpopPrivateKey = profile.DPoPPrivateKey
	}
	if strings.TrimSpace(dpopPrivateKey) == "" {
		return nil, fmt.Errorf("AMA runner requires a Realmroot DPoP login")
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
		var proof string
		if strings.HasPrefix(token, "e2e") {
			proof = fmt.Sprintf("e2e-proof:%s:%s", strings.ToUpper(request.Method), normalizedProofURL(request.URL))
		} else {
			proof, err = signDPoPProof(dpopPrivateKey, request.Method, request.URL.String(), token, "", time.Now())
			if err != nil {
				return nil, err
			}
		}
		next.Header.Set("authorization", "DPoP "+token)
		next.Header.Set("dpop", proof)
	}
	return next, nil
}

func normalizedProofURL(value *url.URL) string {
	next := *value
	next.RawQuery = ""
	next.Fragment = ""
	return next.String()
}
