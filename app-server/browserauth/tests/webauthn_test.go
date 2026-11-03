package tests

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	adapter "github.com/futsuuu/ku-potato/app-server/browserauth"
	"github.com/futsuuu/ku-potato/app-server/domain"
)

func TestVirtualWebAuthnKeyIsSavedBeforeRegistration(t *testing.T) {
	for _, navigation := range []bool{false, true} {
		t.Run(fmt.Sprintf("navigation=%t", navigation), func(t *testing.T) {
			testVirtualWebAuthnRegistration(t, navigation)
		})
	}
}

func testVirtualWebAuthnRegistration(t *testing.T, navigation bool) {
	executable := chrome(t)
	data := t.TempDir()
	credentialPath := filepath.Join(data, "auth", "kogakuin", "webauthn.json")
	var accepted atomic.Int32
	var savedBeforeRequest atomic.Bool
	var needAssertion atomic.Bool
	var assertions atomic.Int32
	var blockStorage atomic.Bool
	var assertionError atomic.Value
	fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		switch r.URL.Path {
		case "/lms/homeRedirect/":
			if needAssertion.Load() {
				http.Redirect(w, r, "/pub/u2flogin.cgi", 302)
				return
			}
			http.Redirect(w, r, "/lms/homeHoml/doIndex", 302)
		case "/pub/u2flogin.cgi":
			fmt.Fprint(
				w,
				`<script>navigator.credentials.get({publicKey:{challenge:new Uint8Array(32).fill(2),rpId:location.hostname,userVerification:'required',timeout:10000}}).then(()=>fetch('/assert',{method:'POST'})).then(()=>location.href='/lms/homeHoml/doIndex').catch(e=>fetch('/assert-error?message='+encodeURIComponent(e.message)))</script>`,
			)
		case "/assert-error":
			assertionError.Store(r.URL.Query().Get("message"))
			fmt.Fprint(w, "ok")
		case "/assert":
			assertions.Add(1)
			needAssertion.Store(false)
			fmt.Fprint(w, "ok")
		case "/lms/homeHoml/doIndex":
			fmt.Fprint(
				w,
				`<span class="lms-search-condition-title">講義一覧</span><select name="nendo"><option value="2026" selected>2026</option></select><div class="lms-weekly-area"></div>`,
			)
		case "/user/":
			registered := false
			label := "Device"
			if r.Method == "POST" {
				r.ParseForm()
				if r.Form.Get("operation") == "register" {
					accepted.Add(1)
					body, err := os.ReadFile(credentialPath)
					if err == nil && strings.Contains(string(body), "privateKey") {
						savedBeforeRequest.Store(true)
					}
				}
				if !navigation {
					fmt.Fprint(w, "ok")
					return
				}
				registered = true
				if r.Form.Get("operation") == "update" {
					label = r.Form.Get("label")
				}
			}
			if blockStorage.Load() {
				if err := os.Mkdir(credentialPath, 0o700); err != nil {
					t.Error(err)
				}
			}
			row := ""
			if registered {
				row = `<tr><td><input id="id_1" value="1"><a class="js-u2f-edit" onclick="document.querySelector('#prompt').hidden=false">Edit</a></td><td id="device">` + label + `</td></tr>`
			}
			fmt.Fprintf(
				w,
				`<h2>FIDO認証デバイスの設定</h2><p>ログインID: fixture@example.org</p><table id="datatable"><tbody>%s</tbody></table><button id="create_button" onclick="register()">Create</button><input id="prompt" hidden><button onclick="update()">更新</button>
<form method="POST" id="registration"><input name="operation" value="register"><input name="label"></form>
<script>
const navigation=%t;
function update(){
if(navigation){const form=document.querySelector('#registration');form.elements.operation.value='update';form.elements.label.value=document.querySelector('#prompt').value;form.submit();}
else document.querySelector('#device').textContent=document.querySelector('#prompt').value;
}
async function register(){
try {
await navigator.credentials.create({publicKey:{challenge:new Uint8Array(32).fill(1),rp:{name:'Fixture',id:location.hostname},user:{id:new Uint8Array([1]),name:'fixture',displayName:'Fixture'},pubKeyCredParams:[{type:'public-key',alg:-7}],authenticatorSelection:{residentKey:'required',userVerification:'required'},timeout:10000}});
if(navigation){document.querySelector('#registration').submit();return;}
const response=await fetch(location.href,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'operation=register'});
if(!response.ok)throw Error('Registration failed');
document.querySelector('#datatable tbody').innerHTML='<tr><td><input id="id_1" value="1"><a class="js-u2f-edit" onclick="document.querySelector(\'#prompt\').hidden=false">Edit</a></td><td id="device">Device</td></tr>';
}catch(error){document.body.setAttribute('data-error',error.message)}
}
</script>`,
				row,
				navigation,
			)
		default:
			http.NotFound(w, r)
		}
	}))
	defer fixture.Close()
	// localhost is a valid WebAuthn RP ID and a potentially trustworthy origin.
	base := strings.Replace(fixture.URL, "127.0.0.1", "localhost", 1)
	browser, err := adapter.New(adapter.Options{
		StateDir: data, CacheDir: filepath.Join(t.TempDir(), "cache"),
		Executable: executable,
		LMSURL:     base, SSOURL: base,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { browser.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	if err = browser.RegisterWebAuthn(ctx, false); err != nil {
		t.Fatal(err)
	}
	if accepted.Load() != 1 || !savedBeforeRequest.Load() {
		t.Fatal("remote registration preceded durable key storage", accepted.Load())
	}
	body, err := os.ReadFile(credentialPath)
	if err != nil {
		t.Fatal(err)
	}
	var stored struct {
		Username    string
		Credentials []struct {
			PrivateKey   []byte
			CredentialID []byte
			SignCount    float64
		}
	}
	if err = json.Unmarshal(
		body,
		&stored,
	); err != nil || stored.Username != "fixture@example.org" || len(stored.Credentials) != 1 ||
		len(stored.Credentials[0].PrivateKey) == 0 {
		t.Fatal("invalid stored credentials", err)
	}
	needAssertion.Store(true)
	if _, err = browser.Status(ctx); err != nil {
		t.Fatal("restore virtual authenticator", err, assertionError.Load())
	}
	updated, err := os.ReadFile(credentialPath)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(
		updated,
		&stored,
	); err != nil || assertions.Load() != 1 ||
		stored.Credentials[0].SignCount < 1 {
		t.Fatal("assertion counter was not persisted", err)
	}
	err = browser.RegisterWebAuthn(ctx, false)
	var failure *domain.Error
	if !errors.As(err, &failure) || failure.Reason != "conflict" {
		t.Fatal("duplicate registration accepted", err)
	}
	if accepted.Load() != 1 {
		t.Fatal("duplicate remote registration")
	}
	if err = browser.DeleteWebAuthn(ctx); err != nil {
		t.Fatal(err)
	}
	blockStorage.Store(true)
	err = browser.RegisterWebAuthn(ctx, false)
	if !errors.As(err, &failure) || failure.Reason != "authentication-storage" {
		t.Fatal("registration continued after key storage failure", err)
	}
	if accepted.Load() != 1 {
		t.Fatal("remote server accepted registration without durable key")
	}
}
