# 출시 전 체크리스트

실제 사용자를 받기 직전에 아래 순서대로 진행한다.

1. **보안 강화** (필수)
   - 모든 표의 "누구나 읽기·쓰기" 접근 규칙(allow-all)을 역할별 규칙으로 교체
   - 탈퇴 번호 흔적(`withdrawn_identities`)은 앱에서 조회하지 못하게 서버 함수로만 처리
   - 알림 서명 키(`push_keys`)·알림 기기 목록(`push_subscriptions`)은 앱에서 못 읽게 막고, `/api/push`는 서버 전용 키로 읽게 변경
2. **테스트 데이터 삭제**
   - Supabase SQL Editor에서 `supabase/seeds/test_4444_reset.sql` 실행 (010-4444 파트너·회원·이용권·동맹)
3. **Supabase 요금제**
   - 출시 전까지는 무료로 두고 Usage에서 로그 수집량을 지켜본다
   - 실제 사용자가 들어오면 Pro로 전환
4. **정식 브랜치로 합치기**
   - 작업 브랜치(`claude/stoic-davinci-rkweyc`)를 main으로 합치고(PR), Vercel 배포 브랜치를 main으로 변경
   - 배포 주소(도메인)가 바뀌면 `add_web_push.sql`의 `fn_push_on_notification` 안 주소도 새 주소로 바꿔 다시 실행
