package browser

import (
	"context"
	"os"
	"path/filepath"

	"github.com/chromedp/cdproto/browser"
	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/page"
	cd "github.com/chromedp/chromedp"
	workerproto "github.com/futsuuu/ku-potato/browser-worker/protocol"
)

func (b *Browser) Download(
	ctx context.Context,
	material, resource, preferred string,
) (download DownloadResult, err error) {
	err = b.withPage(ctx, func(tab context.Context) error {
		snapshot, err := b.materialSnapshot(tab, material, preferred)
		if err != nil {
			return err
		}
		download.Snapshot = snapshot
		position := -1
		var selected *workerproto.Resource
		for i, r := range snapshot.GetResourceList().GetResources() {
			if r.GetId().GetValue() == resource {
				position = i
				selected = r
				break
			}
		}
		if position < 0 {
			return &Failure{
				Reason:  workerproto.FailureReason_FAILURE_REASON_RESOURCE_NOT_FOUND,
				Message: "The resource is not in the current listing. Refer to saved content.",
				Target: &workerproto.Failure_ResourceId{
					ResourceId: &workerproto.ResourceId{Value: resource},
				},
			}
		}
		if selected.GetExternalUrl() != "" {
			download.URL = selected.GetExternalUrl()
			return nil
		}
		if selected.GetFile() == nil {
			return &Failure{
				Reason:  workerproto.FailureReason_FAILURE_REASON_UNSUPPORTED_RESOURCE,
				Message: "This resource type does not support downloads.",
				Target: &workerproto.Failure_ResourceId{
					ResourceId: &workerproto.ResourceId{Value: resource},
				},
			}
		}
		directory := b.opts.DownloadDir
		if err = os.MkdirAll(directory, 0o700); err != nil {
			return err
		}
		if err = browser.SetDownloadBehavior(browser.SetDownloadBehaviorBehaviorAllowAndName).
			WithBrowserContextID(cd.FromContext(tab).BrowserContextID).
			WithDownloadPath(directory).
			WithEventsEnabled(true).
			Do(cdp.WithExecutor(tab, cd.FromContext(tab).Browser)); err != nil {
			return err
		}
		frame, err := page.GetFrameTree().Do(executor(tab))
		if err != nil {
			return err
		}
		events := make(chan any, 32)
		listen, cancel := context.WithCancel(tab)
		defer cancel()
		listeningGUID := ""
		cd.ListenBrowser(listen, func(event any) {
			switch e := event.(type) {
			case *browser.EventDownloadWillBegin:
				if e.FrameID != frame.Frame.ID || listeningGUID != "" {
					return
				}
				listeningGUID = e.GUID
			case *browser.EventDownloadProgress:
				if e.GUID != listeningGUID {
					return
				}
			default:
				return
			}
			select {
			case events <- event:
			case <-listen.Done():
			}
		})
		if err = cd.Run(
			tab,
			cd.Evaluate(
				`document.querySelectorAll(
					'td[data-label="資料名"]'
				)[`+js(position)+`].querySelector('a').click()`,
				nil,
			),
		); err != nil {
			return err
		}
		guid := ""
		success := false
		defer func() {
			if !success && guid != "" {
				_ = os.Remove(filepath.Join(directory, guid))
				_ = os.Remove(filepath.Join(directory, guid+".crdownload"))
			}
		}()
		for {
			select {
			case <-tab.Done():
				return tab.Err()
			case event := <-events:
				switch e := event.(type) {
				case *browser.EventDownloadWillBegin:
					if guid == "" {
						guid = e.GUID
						download.Filename = e.SuggestedFilename
					}
				case *browser.EventDownloadProgress:
					if e.GUID != guid {
						continue
					}
					if e.State == browser.DownloadProgressStateCanceled {
						return Fail(
							workerproto.FailureReason_FAILURE_REASON_SOURCE,
							"資料のダウンロードが中断されました。",
						)
					}
					if e.State == browser.DownloadProgressStateCompleted {
						download.Path = filepath.Join(directory, guid)
						success = true
						return nil
					}
				}
			}
		}
	})
	return
}
