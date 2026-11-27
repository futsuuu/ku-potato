import PageHeader from "./PageHeader";
import Progress from "./Progress";

export default function LoadingPage() {
  return (
    <>
      <PageHeader title="読み込み中" />
      <div class="page-content">
        <Progress pending={true} error="" />
      </div>
    </>
  );
}
