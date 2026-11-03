package browser

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	cd "github.com/chromedp/chromedp"
	workerproto "github.com/futsuuu/ku-potato/browser-worker/protocol"
)

func js(value any) string { body, _ := json.Marshal(value); return string(body) }
func poll(ctx context.Context, expression string) error {
	for {
		err := cd.Run(
			ctx,
			cd.Poll(
				expression,
				nil,
				cd.WithPollingInterval(100*time.Millisecond),
				cd.WithPollingTimeout(0),
			),
		)
		if err == nil || ctx.Err() != nil {
			return err
		}
		// SSO redirects can replace the execution context while Poll is installed.
		// These expressions only inspect the page, so retrying has no side effects.
		message := strings.ToLower(err.Error())
		if !strings.Contains(message, "navigated or closed") &&
			!strings.Contains(message, "execution context was destroyed") &&
			!strings.Contains(message, "cannot find context") {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
}

func (b *Browser) homeExpression() string {
	return `document.readyState === 'complete'
		&& location.origin === ` + js(b.opts.LMSURL) + `
		&& /^\/lms\/homeHoml\/doIndex(?:;|$)/.test(location.pathname)
		&& !!document.querySelector('.lms-weekly-area')
		&& [...document.querySelectorAll('.lms-search-condition-title')].some(
			e => e.textContent.includes('講義一覧')
		)`
}

func (b *Browser) notLoginExpression() string {
	return `location.origin === ` + js(b.opts.LMSURL) + `
		&& /^\/lms\/error\/notLogin(?:;|$)/.test(location.pathname)`
}

func (b *Browser) authenticationPageExpression() string {
	return `(` + b.homeExpression() + `) || (` + b.notLoginExpression() + `)
		|| location.origin === ` + js(b.opts.SSOURL) + `
		|| (!!document.querySelector('button[name="loginButton"]')
			&& document.body.innerText.includes('統合認証アカウントでログインします'))`
}

func (b *Browser) navigateHome(ctx context.Context) error {
	// KU-LMS can carry its session in the HOME URL instead of a cookie.
	// Retain the page's same-origin HOME link when returning from a course.
	var destination string
	expression := `(() => {
		const origin = ` + js(b.opts.LMSURL) + `;
		for (const a of document.querySelectorAll('a[href]')) {
			const u = new URL(a.getAttribute('href'), location.href);
			if (u.origin === origin && /^\/lms\/homeRedirect\/(?:;|$)/.test(u.pathname)) {
				return u.href;
			}
		}
		if (location.origin === origin && /^\/lms\/homeHoml\/doIndex(?:;|$)/.test(location.pathname)) {
			return location.href;
		}
		return origin + '/lms/homeRedirect/';
	})()`
	if err := cd.Run(ctx, cd.Evaluate(expression, &destination)); err != nil {
		return err
	}
	return cd.Run(ctx, cd.Navigate(destination))
}

func (b *Browser) home(ctx context.Context) error {
	if err := b.navigateHome(ctx); err != nil {
		return err
	}
	if err := poll(
		ctx,
		`(`+b.homeExpression()+`) || (`+b.notLoginExpression()+`)
			|| location.origin === `+js(b.opts.SSOURL)+`
			|| !!document.querySelector('button[name="loginButton"]')`,
	); err != nil {
		return err
	}
	var home bool
	if err := cd.Run(ctx, cd.Evaluate(b.homeExpression(), &home)); err != nil {
		return err
	}
	if !home {
		return Fail(workerproto.FailureReason_FAILURE_REASON_AUTHENTICATION_REQUIRED, "再ログインが必要です。")
	}
	return nil
}

func (b *Browser) authenticate(ctx context.Context) error {
	if err := poll(ctx, b.authenticationPageExpression()); err != nil {
		return err
	}
	var notLogin bool
	if err := cd.Run(ctx, cd.Evaluate(b.notLoginExpression(), &notLogin)); err != nil {
		return err
	}
	if notLogin {
		// HOME returns a 401 error page without a login button in a fresh or
		// expired session. Open the LMS entrypoint to begin the normal SSO flow.
		if err := cd.Run(ctx, cd.Navigate(b.opts.LMSURL+"/lms")); err != nil {
			return err
		}
		if err := poll(ctx, b.authenticationPageExpression()); err != nil {
			return err
		}
		if err := cd.Run(ctx, cd.Evaluate(b.notLoginExpression(), &notLogin)); err != nil {
			return err
		}
		if notLogin {
			return Fail(workerproto.FailureReason_FAILURE_REASON_SOURCE, "KU-LMS のログイン画面を開けません。")
		}
	}
	var home bool
	if err := cd.Run(ctx, cd.Evaluate(b.homeExpression(), &home)); err != nil {
		return err
	}
	if home {
		return nil
	}
	var login bool
	_ = cd.Run(ctx, cd.Evaluate(`!!document.querySelector('button[name="loginButton"]')`, &login))
	if login {
		if err := cd.Run(ctx, cd.Click(`button[name="loginButton"]`, cd.ByQuery)); err != nil {
			return err
		}
	}
	if err := poll(
		ctx,
		`(`+b.homeExpression()+`) || location.origin===`+js(b.opts.SSOURL),
	); err != nil {
		return err
	}
	_ = cd.Run(ctx, cd.Evaluate(b.homeExpression(), &home))
	if home {
		return nil
	}
	return Fail(workerproto.FailureReason_FAILURE_REASON_AUTHENTICATION_REQUIRED, "再ログインが必要です。")
}

func (b *Browser) session(ctx context.Context) error {
	if err := b.navigateHome(ctx); err != nil {
		return err
	}
	return b.authenticate(ctx)
}
