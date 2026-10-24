package chromedp

import (
	"context"
	"encoding/base64"
	"net/url"
	"regexp"
	"sync"

	"github.com/chromedp/cdproto/fetch"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/webauthn"
	cd "github.com/chromedp/chromedp"
	"github.com/futsuuu/ku-potato/server/domain"
)

var loginID = regexp.MustCompile(`ログインID:\s*([^\s]+)`)

func registrationForm(request *network.Request) (url.Values, error) {
	// Network.getRequestPostData cannot complete for a paused form navigation.
	// Fetch already includes its body as base64-encoded entries; inspect those
	// before allowing the request to reach the server.
	if request.HasPostData && len(request.PostDataEntries) == 0 {
		return nil, domain.Fail("source", "登録リクエストの本文を確認できません。")
	}
	var body []byte
	for _, entry := range request.PostDataEntries {
		if entry == nil {
			return nil, domain.Fail("source", "登録リクエストの本文が不正です。")
		}
		part, err := base64.StdEncoding.DecodeString(entry.Bytes)
		if err != nil {
			return nil, domain.Fail("source", "登録リクエストの本文が不正です。")
		}
		body = append(body, part...)
	}
	values, err := url.ParseQuery(string(body))
	if err != nil {
		return nil, domain.Fail("source", "登録リクエストの本文が不正です。")
	}
	return values, nil
}

func (b *Browser) RegisterWebAuthn(ctx context.Context, interactive bool) error {
	return b.withAuth(ctx, interactive, true, func(tab context.Context, stored *credentials, _ webauthn.AuthenticatorID) error {
		if stored != nil {
			return domain.Fail("conflict", "WebAuthn認証情報は保存済みです。")
		}
		if err := b.session(tab, interactive, nil); err != nil {
			return err
		}
		id, err := newAuthenticator(tab, nil)
		if err != nil {
			return err
		}
		settings := b.opts.SSOURL + "/user/?app=u2fregister"
		if err = cd.Run(tab, cd.Navigate(settings)); err != nil {
			return err
		}
		if err = poll(tab, `[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].some(e=>e.textContent.includes('FIDO認証デバイスの設定')) && !!document.querySelector('#create_button')`); err != nil {
			return err
		}
		var text string
		if err = cd.Run(tab, cd.Text("body", &text, cd.ByQuery)); err != nil {
			return err
		}
		username := loginID.FindStringSubmatch(text)
		if username == nil {
			return domain.Fail("source", "FIDO設定画面のログインIDが見つかりません。")
		}
		var existing []string
		if err = cd.Run(tab, cd.Evaluate(`[...document.querySelectorAll('#datatable input[id^="id_"]')].map(e=>e.value)`, &existing)); err != nil {
			return err
		}
		var actualURL string
		if err = cd.Run(tab, cd.Location(&actualURL)); err != nil {
			return err
		}
		listen, cancel := context.WithCancel(tab)
		defer cancel()
		waitContext, stopWaiting := context.WithCancel(tab)
		defer stopWaiting()
		var mu sync.Mutex
		var pending sync.WaitGroup
		var callbacks sync.Mutex
		var requests sync.Mutex
		acceptCallbacks := true
		var interceptionError error
		setError := func(e error) {
			mu.Lock()
			defer mu.Unlock()
			if interceptionError == nil {
				interceptionError = e
				stopWaiting()
			}
		}
		cd.ListenTarget(listen, func(event any) {
			paused, ok := event.(*fetch.EventRequestPaused)
			if !ok {
				return
			}
			callbacks.Lock()
			if !acceptCallbacks {
				callbacks.Unlock()
				return
			}
			pending.Add(1)
			callbacks.Unlock()
			go func() {
				defer pending.Done()
				requests.Lock()
				defer requests.Unlock()
				exec := executor(tab)
				if paused.Request.Method == "POST" {
					values, e := registrationForm(paused.Request)
					if e != nil {
						_ = fetch.FailRequest(paused.RequestID, network.ErrorReasonAborted).Do(exec)
						setError(e)
						return
					}
					if values.Get("operation") == "register" {
						// Save the private key before the remote server accepts registration.
						if e = b.saveCredentials(exec, id, username[1]); e != nil {
							_ = fetch.FailRequest(paused.RequestID, network.ErrorReasonAborted).Do(exec)
							setError(e)
							return
						}
					}
				}
				if e := fetch.ContinueRequest(paused.RequestID).Do(exec); e != nil {
					setError(e)
				}
			}()
		})
		defer func() {
			callbacks.Lock()
			acceptCallbacks = false
			cancel()
			callbacks.Unlock()
			pending.Wait()
		}()
		if err = fetch.Enable().WithPatterns([]*fetch.RequestPattern{{URLPattern: actualURL, RequestStage: fetch.RequestStageRequest}}).Do(tab); err != nil {
			return err
		}
		// Do not disable interception during failure cleanup: Fetch.disable would
		// resume paused requests. The dedicated registration tab is closed after this operation.
		if err = cd.Run(tab, cd.Click("#create_button", cd.ByQuery)); err != nil {
			return err
		}
		if err = poll(waitContext, `[...document.querySelectorAll('#datatable input[id^="id_"]')].some(e=>!`+js(existing)+`.includes(e.value))`); err != nil {
			mu.Lock()
			e := interceptionError
			mu.Unlock()
			if e != nil {
				return e
			}
			return err
		}
		if err = cd.Run(tab, cd.Evaluate(`(()=>{const row=[...document.querySelectorAll('#datatable tbody tr')].find(row=>{const e=row.querySelector('input[id^="id_"]');return e&&!`+js(existing)+`.includes(e.value)});row?.querySelector('.js-u2f-edit')?.click()})()`, nil), cd.WaitVisible("#prompt", cd.ByQuery), cd.SetValue("#prompt", "KU-POTATO (Go)", cd.ByQuery), cd.Evaluate(`(()=>{const b=[...document.querySelectorAll('button,input[type="submit"]')].find(e=>(e.textContent||e.value).trim()==='更新');if(!b)throw Error('Missing update button');b.click()})()`, nil)); err != nil {
			return err
		}
		if err = poll(tab, `document.querySelector('#datatable')?.textContent.includes('KU-POTATO (Go)')`); err != nil {
			return err
		}
		return b.saveCredentials(tab, id, username[1])
	})
}
