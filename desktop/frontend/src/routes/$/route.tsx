import PageHeader from "../../components/PageHeader";

export default function NotFound() {
  return (
    <>
      <PageHeader title="ページが見つかりません" ancestors={[{ label: "講義一覧", href: "/" }]} />
      <div class="page-content">
        <p class="no-content">指定されたページは存在しません。</p>
      </div>
    </>
  );
}
