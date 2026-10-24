package chromedp

import (
	"context"
	"os"
	"path/filepath"

	"github.com/chromedp/cdproto/browser"
	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/page"
	cd "github.com/chromedp/chromedp"
	"github.com/futsuuu/ku-potato/server/core/outport"
	"github.com/futsuuu/ku-potato/server/domain"
)

func (b *Browser) Download(ctx context.Context, material, resource, preferred, cachedURL string) (outport.Download, error) {
	return downloadWithCachedURL(ctx, cachedURL, func(ctx context.Context) (outport.Download, error) {
		return b.downloadCurrent(ctx, material, resource, preferred)
	}, b.startDriveDownload)
}

func (b *Browser) downloadCurrent(ctx context.Context, material, resource, preferred string) (download outport.Download, err error) {
	err = b.withPage(ctx, func(tab context.Context) error {
		snapshot, err := b.materialSnapshot(tab, material, preferred)
		if err != nil {
			return err
		}
		download.Snapshot = snapshot
		position := -1
		var selected domain.Resource
		for i, r := range snapshot.Resources {
			if r.ID == resource {
				position = i
				selected = r
				break
			}
		}
		if position < 0 {
			return domain.Fail("resource-not-found", "資料が現在の一覧にありません。保存済み内容を参照してください。")
		}
		if selected.Type == "external" {
			download.URL = selected.URL
			return nil
		}
		if selected.Type != "file" {
			return domain.Fail("unsupported-resource", "この資料種別はダウンロードに対応していません。")
		}
		directory := b.opts.DownloadDir
		if err = os.MkdirAll(directory, 0700); err != nil {
			return err
		}
		if err = browser.SetDownloadBehavior(browser.SetDownloadBehaviorBehaviorAllowAndName).WithBrowserContextID(cd.FromContext(tab).BrowserContextID).WithDownloadPath(directory).WithEventsEnabled(true).Do(cdp.WithExecutor(tab, cd.FromContext(tab).Browser)); err != nil {
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
		if err = cd.Run(tab, cd.Evaluate(`document.querySelectorAll('td[data-label="資料名"]')[`+js(position)+`].querySelector('a').click()`, nil)); err != nil {
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
						return domain.Fail("source", "資料のダウンロードが中断されました。")
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
