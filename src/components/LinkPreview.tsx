import Head from 'expo-router/head';
import { usePathname } from 'expo-router';
import { WEB_URL } from '@/lib/invite';

// 카카오톡·문자 등에 링크를 붙였을 때 보이는 미리보기 (제목·설명·이미지)
// 이미지는 public/ 폴더의 파일을 절대 주소로 가리킨다
export default function LinkPreview({ title, description, image = 'og.png' }: { title: string; description: string; image?: string }) {
  const img = `${WEB_URL}/${image}`;
  return (
    <Head>
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="두두인연" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={img} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:image" content={img} />
    </Head>
  );
}

// 주소에 맞는 미리보기를 고른다. 첫 화면을 그리기 전(로딩 중)에도 웹 페이지 파일에 들어가도록 루트에서 쓴다.
export function RouteLinkPreview() {
  const path = usePathname();
  if (path.startsWith('/invite') || path.startsWith('/c/')) {
    return (
      <LinkPreview
        title="두두인연 초대장이 도착했어요"
        description="가입하면 초대한 모임 대표에게 바로 연결돼요. 친구의 친구를 소개받아 보세요."
        image="og-invite.png"
      />
    );
  }
  return <LinkPreview title="두두인연" description="모임 대표가 이어주는 소개팅. 친구의 친구라서 더 믿을 수 있어요." />;
}
