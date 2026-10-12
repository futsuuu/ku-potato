import PageHeader from "../PageHeader";

export default function NotFound() {
  return (
    <>
      <PageHeader title="ページが見つかりません" />
      <div class="page-content">
        <p class="empty">指定されたページは存在しません。</p>
        <a class="app-button" href="/">
          講義一覧へ戻る
        </a>
      </div>
    </>
  );
}
