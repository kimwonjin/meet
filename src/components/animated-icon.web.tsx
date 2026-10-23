// 웹: 시작 화면 애니메이션을 쓰지 않는다 (첫 화면을 빨리 띄우려고 애니메이션 라이브러리를 웹 번들에서 뺐다)
// 대신 HTML이 오자마자 보이는 가벼운 로딩 화면(+html.tsx의 #boot)을 쓴다
export function AnimatedSplashOverlay() {
  return null;
}

export function AnimatedIcon() {
  return null;
}
