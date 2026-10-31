package browserauth

import (
	"encoding/base64"
	"errors"
	"strings"
	"testing"

	"github.com/chromedp/cdproto/network"
	"github.com/futsuuu/ku-potato/app-server/domain"
)

func TestRegistrationFormRejectsUninspectableRequests(t *testing.T) {
	entry := func(value string) *network.PostDataEntry {
		return &network.PostDataEntry{Bytes: base64.StdEncoding.EncodeToString([]byte(value))}
	}
	for name, request := range map[string]*network.Request{
		"missing body": {HasPostData: true},
		"nil entry":    {HasPostData: true, PostDataEntries: []*network.PostDataEntry{nil}},
		"bad base64":   {HasPostData: true, PostDataEntries: []*network.PostDataEntry{{Bytes: "private-secret!"}}},
		"bad form":     {HasPostData: true, PostDataEntries: []*network.PostDataEntry{entry("operation=register&response=%private-secret")}},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := registrationForm(request)
			var failure *domain.Error
			if !errors.As(err, &failure) || failure.Reason != "source" {
				t.Fatal("uninspectable registration accepted", err)
			}
			if strings.Contains(err.Error(), "private-secret") {
				t.Fatal("request body leaked in error")
			}
		})
	}
	values, err := registrationForm(&network.Request{HasPostData: true, PostDataEntries: []*network.PostDataEntry{entry("operation=reg"), entry("ister&response=encoded%2Bvalue")}})
	if err != nil || values.Get("operation") != "register" || values.Get("response") != "encoded+value" {
		t.Fatal("multipart body entries were not joined before parsing", err)
	}
}
