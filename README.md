# 인연장

Expo(웹/앱) + Supabase로 만든 인연장 앱입니다.

## 환경 변수

프로젝트 최상위에 `.env`를 만들고 `.env.example`의 값을 채웁니다. `.env`는 git에 올리지 않습니다.

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
EXPO_PUBLIC_TEST_MODE=true   # 테스트 단계: 로그인 화면에 최근 로그인 계정 목록 표시
```

## 로컬 실행

```bash
npm install
npx expo start   # w: 브라우저, Expo Go 앱으로 QR 스캔: 휴대폰
```

## 웹 배포 (Vercel)

GitHub 저장소가 Vercel에 연결되어 있어, Production 브랜치에 push하면 자동으로 배포됩니다.
빌드 설정은 `vercel.json`에 있고, 환경 변수는 Vercel 프로젝트의 Settings → Environment Variables에서 관리합니다.

## 코드와 데이터

- 코드: git (`src/`)
- DB 구조: `supabase/migrations/*.sql`에 기록하고 Supabase에 별도로 적용
- 실제 데이터: Supabase 대시보드
